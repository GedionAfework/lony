package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"equilend/api/internal/httpx"
	"equilend/api/internal/users"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type OAuthInput struct {
	Provider           string
	IDToken            string            // Google
	TelegramAuth       map[string]string // Telegram Login Widget fields
	AcceptedDisclaimer bool
	DeviceLabel        *string
}

// OAuthLogin verifies Google ID tokens or Telegram Login Widget payloads and issues sessions.
// WhatsApp does not offer a consumer Sign-In OAuth API; use email or Telegram instead.
func (s *Service) OAuthLogin(ctx context.Context, in OAuthInput) (TokenPair, error) {
	if !in.AcceptedDisclaimer {
		return TokenPair{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"accepted_disclaimer": "you must accept the Lony product disclaimer",
		})
	}
	provider := strings.ToLower(strings.TrimSpace(in.Provider))
	var subject, email, displayName string
	var err error
	switch provider {
	case "google":
		subject, email, displayName, err = s.verifyGoogle(ctx, in.IDToken)
	case "telegram":
		subject, email, displayName, err = s.verifyTelegram(in.TelegramAuth)
	case "whatsapp":
		return TokenPair{}, httpx.E(http.StatusNotImplemented, "UNSUPPORTED_PROVIDER",
			"WhatsApp does not provide consumer Sign-In OAuth. Use Google, Telegram, or email.")
	default:
		return TokenPair{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"provider": "must be google or telegram",
		})
	}
	if err != nil {
		return TokenPair{}, err
	}
	if displayName == "" {
		displayName = "Lony user"
	}
	if utf8.RuneCountInString(displayName) > 120 {
		displayName = displayName[:120]
	}

	userID, err := s.store.FindIdentity(ctx, provider, subject)
	if err != nil && err != pgx.ErrNoRows {
		return TokenPair{}, err
	}
	var user UserRecord
	if err == nil {
		user, err = s.store.GetUserByID(ctx, userID)
		if err != nil {
			return TokenPair{}, err
		}
	} else {
		if email == "" {
			email = fmt.Sprintf("%s_%s@oauth.lony.local", provider, subject)
		}
		existing, getErr := s.store.GetUserByEmail(ctx, strings.ToLower(email))
		if getErr == nil {
			user = existing
		} else if getErr != pgx.ErrNoRows {
			return TokenPair{}, getErr
		} else {
			hash, herr := HashPassword(randomSecret())
			if herr != nil {
				return TokenPair{}, herr
			}
			user, err = s.store.CreateUser(ctx, strings.ToLower(email), hash, displayName, "UTC", "en")
			if err != nil {
				return TokenPair{}, err
			}
			user, err = s.store.MarkEmailVerified(ctx, user.ID)
			if err != nil {
				return TokenPair{}, err
			}
		}
		emailPtr := &email
		if linkErr := s.store.LinkIdentity(ctx, user.ID, provider, subject, emailPtr); linkErr != nil {
			return TokenPair{}, linkErr
		}
	}

	if user.Status != "active" {
		return TokenPair{}, httpx.E(http.StatusForbidden, "FORBIDDEN", "account is not active")
	}
	return s.issueTokens(ctx, user, in.DeviceLabel)
}

func (s *Service) SetAvatar(ctx context.Context, userID uuid.UUID, objectKey string) (users.PublicUser, error) {
	user, err := s.store.SetUserAvatar(ctx, userID, objectKey)
	if err != nil {
		return users.PublicUser{}, err
	}
	return ToPublic(user), nil
}

func (s *Service) verifyGoogle(ctx context.Context, idToken string) (subject, email, name string, err error) {
	if s.cfg.GoogleClientID == "" && !s.cfg.Dev() {
		return "", "", "", httpx.E(http.StatusServiceUnavailable, "GOOGLE_UNCONFIGURED",
			"Set GOOGLE_CLIENT_ID to enable Google sign-in")
	}
	idToken = strings.TrimSpace(idToken)
	if idToken == "" {
		return "", "", "", httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"id_token": "required for Google sign-in",
		})
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://oauth2.googleapis.com/tokeninfo?id_token="+url.QueryEscape(idToken), nil)
	if err != nil {
		return "", "", "", err
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", "", "", httpx.E(http.StatusBadGateway, "OAUTH_UPSTREAM", "could not verify Google token")
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode != http.StatusOK {
		return "", "", "", httpx.E(http.StatusUnauthorized, "INVALID_TOKEN", "Google token is invalid")
	}
	var payload struct {
		Sub           string `json:"sub"`
		Email         string `json:"email"`
		EmailVerified string `json:"email_verified"`
		Name          string `json:"name"`
		Aud           string `json:"aud"`
	}
	if err := json.Unmarshal(body, &payload); err != nil || payload.Sub == "" {
		return "", "", "", httpx.E(http.StatusUnauthorized, "INVALID_TOKEN", "Google token is invalid")
	}
	if s.cfg.GoogleClientID != "" && payload.Aud != s.cfg.GoogleClientID {
		return "", "", "", httpx.E(http.StatusUnauthorized, "INVALID_TOKEN", "Google token audience mismatch")
	}
	if payload.EmailVerified != "true" && payload.EmailVerified != "1" {
		return "", "", "", httpx.E(http.StatusUnauthorized, "EMAIL_UNVERIFIED", "Google email is not verified")
	}
	return payload.Sub, payload.Email, payload.Name, nil
}

func (s *Service) verifyTelegram(fields map[string]string) (subject, email, name string, err error) {
	if s.cfg.TelegramBotToken == "" {
		return "", "", "", httpx.E(http.StatusServiceUnavailable, "TELEGRAM_UNCONFIGURED",
			"Set TELEGRAM_BOT_TOKEN to enable Telegram sign-in")
	}
	if fields == nil {
		return "", "", "", httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"telegram": "required",
		})
	}
	hash := fields["hash"]
	if hash == "" || fields["id"] == "" {
		return "", "", "", httpx.E(http.StatusUnauthorized, "INVALID_TOKEN", "Telegram auth payload incomplete")
	}
	authDate, _ := strconv.ParseInt(fields["auth_date"], 10, 64)
	if authDate == 0 || time.Now().UTC().Unix()-authDate > 86400 {
		return "", "", "", httpx.E(http.StatusUnauthorized, "INVALID_TOKEN", "Telegram auth payload expired")
	}
	pairs := make([]string, 0, len(fields))
	for k, v := range fields {
		if k == "hash" || v == "" {
			continue
		}
		pairs = append(pairs, k+"="+v)
	}
	sort.Strings(pairs)
	dataCheck := strings.Join(pairs, "\n")
	secret := sha256.Sum256([]byte(s.cfg.TelegramBotToken))
	mac := hmac.New(sha256.New, secret[:])
	mac.Write([]byte(dataCheck))
	expected := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(expected), []byte(hash)) {
		return "", "", "", httpx.E(http.StatusUnauthorized, "INVALID_TOKEN", "Telegram auth signature invalid")
	}
	name = strings.TrimSpace(fields["first_name"] + " " + fields["last_name"])
	if uname := strings.TrimSpace(fields["username"]); uname != "" && name == "" {
		name = uname
	}
	return fields["id"], "", name, nil
}

func randomSecret() string {
	var b [32]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
