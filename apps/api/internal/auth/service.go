package auth

import (
	"context"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"equilend/api/internal/config"
	"equilend/api/internal/httpx"
	"equilend/api/internal/users"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type Service struct {
	store  Store
	cfg    config.Config
	now    func() time.Time
}

func NewService(store Store, cfg config.Config) *Service {
	return &Service{store: store, cfg: cfg, now: time.Now}
}

type RegisterInput struct {
	Email              string
	Password           string
	DisplayName        string
	AcceptedDisclaimer bool
}

type RegisterResult struct {
	User               users.PublicUser `json:"user"`
	VerificationCode   string           `json:"verification_code,omitempty"`
	VerificationHint   string           `json:"verification_hint"`
}

type TokenPair struct {
	AccessToken  string          `json:"access_token"`
	RefreshToken string          `json:"refresh_token"`
	ExpiresIn    int64           `json:"expires_in"`
	TokenType    string          `json:"token_type"`
	User         users.PublicUser `json:"user"`
}

type LoginInput struct {
	Email    string
	Password string
}

func (s *Service) Register(ctx context.Context, in RegisterInput) (RegisterResult, error) {
	email, err := normalizeEmail(in.Email)
	if err != nil {
		return RegisterResult{}, err
	}
	if !in.AcceptedDisclaimer {
		return RegisterResult{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"accepted_disclaimer": "you must accept the Lony product disclaimer",
		})
	}
	displayName := strings.TrimSpace(in.DisplayName)
	if utf8.RuneCountInString(displayName) < 1 || utf8.RuneCountInString(displayName) > 120 {
		return RegisterResult{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"display_name": "must be between 1 and 120 characters",
		})
	}
	if err := validatePassword(in.Password); err != nil {
		return RegisterResult{}, err
	}

	existing, err := s.store.GetUserByEmail(ctx, email)
	if err == nil {
		if existing.EmailVerifiedAt != nil {
			return RegisterResult{}, httpx.E(http.StatusConflict, "EMAIL_TAKEN", "an account with this email already exists")
		}
		code, issueErr := s.issueChallenge(ctx, existing)
		if issueErr != nil {
			return RegisterResult{}, issueErr
		}
		return s.registerResult(existing, code), nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return RegisterResult{}, err
	}

	hash, err := HashPassword(in.Password)
	if err != nil {
		return RegisterResult{}, err
	}
	user, err := s.store.CreateUser(ctx, email, hash, displayName, "UTC", "en")
	if err != nil {
		return RegisterResult{}, err
	}
	code, err := s.issueChallenge(ctx, user)
	if err != nil {
		return RegisterResult{}, err
	}
	return s.registerResult(user, code), nil
}

func (s *Service) VerifyEmail(ctx context.Context, email, code string) (users.PublicUser, error) {
	normalized, err := normalizeEmail(email)
	if err != nil {
		return users.PublicUser{}, err
	}
	code = strings.TrimSpace(code)
	if len(code) != 6 {
		return users.PublicUser{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"code": "must be a 6-digit code",
		})
	}

	user, err := s.store.GetUserByEmail(ctx, normalized)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return users.PublicUser{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "account not found")
		}
		return users.PublicUser{}, err
	}
	if user.EmailVerifiedAt != nil {
		return ToPublic(user), nil
	}

	challenge, err := s.store.GetLatestOpenChallenge(ctx, user.ID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return users.PublicUser{}, httpx.E(http.StatusConflict, "CODE_EXPIRED", "request a new verification code")
		}
		return users.PublicUser{}, err
	}
	if s.now().After(challenge.ExpiresAt) {
		return users.PublicUser{}, httpx.E(http.StatusConflict, "CODE_EXPIRED", "verification code expired")
	}
	if challenge.Attempts >= challenge.MaxAttempts {
		return users.PublicUser{}, httpx.E(http.StatusTooManyRequests, "RATE_LIMITED", "too many verification attempts")
	}
	if HashToken(code) != challenge.CodeHash {
		_, _ = s.store.IncrementChallengeAttempts(ctx, challenge.ID)
		return users.PublicUser{}, httpx.E(http.StatusUnauthorized, "INVALID_CODE", "verification code is incorrect")
	}

	if err := s.store.ConsumeChallenge(ctx, challenge.ID); err != nil {
		return users.PublicUser{}, err
	}
	verified, err := s.store.MarkEmailVerified(ctx, user.ID)
	if err != nil {
		return users.PublicUser{}, err
	}
	return ToPublic(verified), nil
}

func (s *Service) Login(ctx context.Context, in LoginInput, deviceLabel *string) (TokenPair, error) {
	email, err := normalizeEmail(in.Email)
	if err != nil {
		return TokenPair{}, err
	}
	user, err := s.store.GetUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return TokenPair{}, httpx.E(http.StatusUnauthorized, "INVALID_CREDENTIALS", "email or password is incorrect")
		}
		return TokenPair{}, err
	}
	ok, err := VerifyPassword(user.PasswordHash, in.Password)
	if err != nil || !ok {
		return TokenPair{}, httpx.E(http.StatusUnauthorized, "INVALID_CREDENTIALS", "email or password is incorrect")
	}
	if user.EmailVerifiedAt == nil {
		return TokenPair{}, httpx.E(http.StatusForbidden, "EMAIL_NOT_VERIFIED", "verify your email before signing in")
	}
	if user.Status != "active" {
		return TokenPair{}, httpx.E(http.StatusForbidden, "ACCOUNT_DISABLED", "this account cannot sign in")
	}
	return s.issueTokens(ctx, user, deviceLabel)
}

func (s *Service) Refresh(ctx context.Context, refreshToken string) (TokenPair, error) {
	refreshToken = strings.TrimSpace(refreshToken)
	if refreshToken == "" {
		return TokenPair{}, httpx.E(http.StatusUnauthorized, "UNAUTHORIZED", "refresh token is required")
	}
	session, err := s.store.GetSessionByRefreshHash(ctx, HashToken(refreshToken))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return TokenPair{}, httpx.E(http.StatusUnauthorized, "UNAUTHORIZED", "refresh token is invalid")
		}
		return TokenPair{}, err
	}
	if session.RevokedAt != nil || s.now().After(session.ExpiresAt) {
		return TokenPair{}, httpx.E(http.StatusUnauthorized, "UNAUTHORIZED", "refresh token is expired")
	}
	user, err := s.store.GetUserByID(ctx, session.UserID)
	if err != nil {
		return TokenPair{}, err
	}
	if user.Status != "active" {
		return TokenPair{}, httpx.E(http.StatusForbidden, "ACCOUNT_DISABLED", "this account cannot sign in")
	}

	raw, err := RandomToken()
	if err != nil {
		return TokenPair{}, err
	}
	rotated, err := s.store.RotateSession(ctx, session.ID, HashToken(raw))
	if err != nil {
		return TokenPair{}, err
	}
	access, err := SignAccessToken(s.cfg.JWTSecret, user.ID, rotated.ID, s.cfg.AccessTokenTTL)
	if err != nil {
		return TokenPair{}, err
	}
	return TokenPair{
		AccessToken:  access,
		RefreshToken: raw,
		ExpiresIn:    int64(s.cfg.AccessTokenTTL.Seconds()),
		TokenType:    "Bearer",
		User:         ToPublic(user),
	}, nil
}

func (s *Service) Logout(ctx context.Context, sessionID uuid.UUID) error {
	return s.store.RevokeSession(ctx, sessionID)
}

func (s *Service) Me(ctx context.Context, userID uuid.UUID) (users.PublicUser, error) {
	user, err := s.store.GetUserByID(ctx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return users.PublicUser{}, httpx.E(http.StatusUnauthorized, "UNAUTHORIZED", "session is no longer valid")
		}
		return users.PublicUser{}, err
	}
	return ToPublic(user), nil
}

func (s *Service) UpdateMe(ctx context.Context, userID uuid.UUID, displayName, timezone, locale, currency *string) (users.PublicUser, error) {
	if displayName != nil {
		name := strings.TrimSpace(*displayName)
		if utf8.RuneCountInString(name) < 1 || utf8.RuneCountInString(name) > 120 {
			return users.PublicUser{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"display_name": "must be between 1 and 120 characters",
			})
		}
		displayName = &name
	}
	if currency != nil {
		c := strings.ToUpper(strings.TrimSpace(*currency))
		if len(c) != 3 {
			return users.PublicUser{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"default_currency_code": "must be a 3-letter code",
			})
		}
		currency = &c
	}
	user, err := s.store.UpdateUserProfile(ctx, userID, displayName, timezone, locale, currency)
	if err != nil {
		return users.PublicUser{}, err
	}
	return ToPublic(user), nil
}

func (s *Service) issueChallenge(ctx context.Context, user UserRecord) (string, error) {
	if err := s.store.InvalidateOpenChallenges(ctx, user.ID); err != nil {
		return "", err
	}
	code, err := SixDigitCode()
	if err != nil {
		return "", err
	}
	_, err = s.store.CreateChallenge(ctx, user.ID, "email", user.Email, HashToken(code), s.now().Add(s.cfg.VerificationCodeTTL))
	if err != nil {
		return "", err
	}
	return code, nil
}

func (s *Service) issueTokens(ctx context.Context, user UserRecord, deviceLabel *string) (TokenPair, error) {
	raw, err := RandomToken()
	if err != nil {
		return TokenPair{}, err
	}
	session, err := s.store.CreateSession(ctx, user.ID, HashToken(raw), deviceLabel, s.now().Add(s.cfg.RefreshTokenTTL))
	if err != nil {
		return TokenPair{}, err
	}
	access, err := SignAccessToken(s.cfg.JWTSecret, user.ID, session.ID, s.cfg.AccessTokenTTL)
	if err != nil {
		return TokenPair{}, err
	}
	return TokenPair{
		AccessToken:  access,
		RefreshToken: raw,
		ExpiresIn:    int64(s.cfg.AccessTokenTTL.Seconds()),
		TokenType:    "Bearer",
		User:         ToPublic(user),
	}, nil
}

func (s *Service) registerResult(user UserRecord, code string) RegisterResult {
	out := RegisterResult{
		User:             ToPublic(user),
		VerificationHint: "We sent a 6-digit code to your email.",
	}
	if s.cfg.Dev() {
		out.VerificationCode = code
		out.VerificationHint = "Development mode: use the verification_code in this response."
	}
	return out
}

func ToPublic(user UserRecord) users.PublicUser {
	return users.PublicUser{
		ID:                  user.ID,
		Email:               user.Email,
		DisplayName:         user.DisplayName,
		Timezone:            user.Timezone,
		Locale:              user.Locale,
		DefaultCurrencyCode: user.DefaultCurrencyCode,
		EmailVerified:       user.EmailVerifiedAt != nil,
		Status:              user.Status,
		CreatedAt:           user.CreatedAt,
	}
}

func normalizeEmail(email string) (string, error) {
	email = strings.TrimSpace(strings.ToLower(email))
	if _, err := mail.ParseAddress(email); err != nil {
		return "", httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"email": "must be a valid email address",
		})
	}
	return email, nil
}

func validatePassword(password string) error {
	if utf8.RuneCountInString(password) < 8 {
		return httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"password": "must be at least 8 characters",
		})
	}
	return nil
}
