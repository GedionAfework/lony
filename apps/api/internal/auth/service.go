package auth

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"equilend/api/internal/config"
	"equilend/api/internal/httpx"
	"equilend/api/internal/legal"
	"equilend/api/internal/mailer"
	"equilend/api/internal/users"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type Service struct {
	store      Store
	cfg        config.Config
	mail       mailer.Sender
	now        func() time.Time
	onPhoneSet func(ctx context.Context, userID uuid.UUID, phoneE164 string) error
}

func NewService(store Store, cfg config.Config) *Service {
	return &Service{
		store: store,
		cfg:   cfg,
		mail: mailer.NewFromEnv(
			cfg.ResendAPIKey,
			cfg.SMTPHost,
			cfg.SMTPPort,
			cfg.SMTPUser,
			cfg.SMTPPass,
			cfg.MailFrom,
		),
		now: time.Now,
	}
}

// SetPhoneHook runs after a user sets/updates their phone (e.g. resolve invites).
func (s *Service) SetPhoneHook(fn func(ctx context.Context, userID uuid.UUID, phoneE164 string) error) {
	s.onPhoneSet = fn
}

// WithMailer overrides the email sender (tests).
func (s *Service) WithMailer(m mailer.Sender) *Service {
	s.mail = m
	return s
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
		hash, hashErr := HashPassword(in.Password)
		if hashErr != nil {
			return RegisterResult{}, hashErr
		}
		if updErr := s.store.UpdatePasswordHash(ctx, existing.ID, hash); updErr != nil {
			return RegisterResult{}, updErr
		}
		existing.PasswordHash = hash
		if dn := strings.TrimSpace(displayName); dn != "" {
			if updated, updErr := s.store.UpdateUserAccount(ctx, existing.ID, AccountUpdate{DisplayName: &dn}); updErr == nil {
				existing = updated
			}
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
	if challenge.Channel != "" && challenge.Channel != "email" {
		return users.PublicUser{}, httpx.E(http.StatusConflict, "CODE_EXPIRED", "request a new verification code")
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

type CodeResult struct {
	VerificationCode string `json:"verification_code,omitempty"`
	VerificationHint string `json:"verification_hint"`
}

func (s *Service) ResendVerification(ctx context.Context, email string) (CodeResult, error) {
	normalized, err := normalizeEmail(email)
	if err != nil {
		return CodeResult{}, err
	}
	user, err := s.store.GetUserByEmail(ctx, normalized)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Don't leak account existence.
			return CodeResult{VerificationHint: "If an unverified account exists for that email, we sent a code."}, nil
		}
		return CodeResult{}, err
	}
	if user.EmailVerifiedAt != nil {
		return CodeResult{VerificationHint: "That email is already verified. You can sign in."}, nil
	}
	code, err := s.issueChallenge(ctx, user)
	if err != nil {
		return CodeResult{}, err
	}
	out := CodeResult{VerificationHint: "We sent a 6-digit code to your email."}
	if s.cfg.Dev() && (s.mail == nil || !s.mail.Configured()) {
		out.VerificationCode = code
		out.VerificationHint = "Development mode: use the verification_code in this response."
	}
	return out, nil
}

func (s *Service) ForgotPassword(ctx context.Context, email string) (CodeResult, error) {
	normalized, err := normalizeEmail(email)
	if err != nil {
		return CodeResult{}, err
	}
	hint := CodeResult{VerificationHint: "If an account exists for that email, we sent a reset code."}
	user, err := s.store.GetUserByEmail(ctx, normalized)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return hint, nil
		}
		return CodeResult{}, err
	}
	if user.EmailVerifiedAt == nil || user.Status != "active" {
		return hint, nil
	}
	code, err := s.issuePasswordResetChallenge(ctx, user)
	if err != nil {
		return CodeResult{}, err
	}
	if s.cfg.Dev() && (s.mail == nil || !s.mail.Configured()) {
		hint.VerificationCode = code
		hint.VerificationHint = "Development mode: use the verification_code in this response."
	}
	return hint, nil
}

func (s *Service) ResetPassword(ctx context.Context, email, code, newPassword string) error {
	normalized, err := normalizeEmail(email)
	if err != nil {
		return err
	}
	if err := validatePassword(newPassword); err != nil {
		return err
	}
	code = strings.TrimSpace(code)
	if len(code) != 6 {
		return httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"code": "must be a 6-digit code",
		})
	}
	user, err := s.store.GetUserByEmail(ctx, normalized)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return httpx.E(http.StatusUnauthorized, "INVALID_CODE", "reset code is incorrect")
		}
		return err
	}
	challenge, err := s.store.GetLatestOpenChallenge(ctx, user.ID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return httpx.E(http.StatusConflict, "CODE_EXPIRED", "request a new reset code")
		}
		return err
	}
	if challenge.Channel != "password_reset" {
		return httpx.E(http.StatusConflict, "CODE_EXPIRED", "request a new reset code")
	}
	if s.now().After(challenge.ExpiresAt) {
		return httpx.E(http.StatusConflict, "CODE_EXPIRED", "reset code expired")
	}
	if challenge.Attempts >= challenge.MaxAttempts {
		return httpx.E(http.StatusTooManyRequests, "RATE_LIMITED", "too many reset attempts")
	}
	if HashToken(code) != challenge.CodeHash {
		_, _ = s.store.IncrementChallengeAttempts(ctx, challenge.ID)
		return httpx.E(http.StatusUnauthorized, "INVALID_CODE", "reset code is incorrect")
	}
	if err := s.store.ConsumeChallenge(ctx, challenge.ID); err != nil {
		return err
	}
	hash, err := HashPassword(newPassword)
	if err != nil {
		return err
	}
	if err := s.store.UpdatePasswordHash(ctx, user.ID, hash); err != nil {
		return err
	}
	_ = s.store.RevokeAllSessions(ctx, user.ID)
	return nil
}

func (s *Service) ChangePassword(ctx context.Context, userID uuid.UUID, currentPassword, newPassword string) error {
	if err := validatePassword(newPassword); err != nil {
		return err
	}
	user, err := s.store.GetUserByID(ctx, userID)
	if err != nil {
		return err
	}
	ok, err := VerifyPassword(user.PasswordHash, currentPassword)
	if err != nil || !ok {
		return httpx.E(http.StatusUnauthorized, "INVALID_CREDENTIALS", "current password is incorrect")
	}
	hash, err := HashPassword(newPassword)
	if err != nil {
		return err
	}
	if err := s.store.UpdatePasswordHash(ctx, user.ID, hash); err != nil {
		return err
	}
	return nil
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

func (s *Service) UpdateMe(ctx context.Context, userID uuid.UUID, displayName, username, timezone, locale, currency *string) (users.PublicUser, error) {
	return s.UpdateAccount(ctx, userID, AccountUpdate{
		DisplayName: displayName,
		Username:    username,
		Timezone:    timezone,
		Locale:      locale,
		Currency:    currency,
	})
}

func (s *Service) UpdateAccount(ctx context.Context, userID uuid.UUID, in AccountUpdate) (users.PublicUser, error) {
	if in.DisplayName != nil {
		name := strings.TrimSpace(*in.DisplayName)
		if utf8.RuneCountInString(name) < 1 || utf8.RuneCountInString(name) > 120 {
			return users.PublicUser{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"display_name": "must be between 1 and 120 characters",
			})
		}
		in.DisplayName = &name
	}
	if in.FirstName != nil {
		v := strings.TrimSpace(*in.FirstName)
		if utf8.RuneCountInString(v) < 1 || utf8.RuneCountInString(v) > 60 {
			return users.PublicUser{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"first_name": "required, max 60 characters",
			})
		}
		in.FirstName = &v
	}
	if in.MiddleName != nil {
		v := strings.TrimSpace(*in.MiddleName)
		if utf8.RuneCountInString(v) > 60 {
			return users.PublicUser{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"middle_name": "max 60 characters",
			})
		}
		if v == "" {
			in.MiddleName = nil
		} else {
			in.MiddleName = &v
		}
	}
	if in.LastName != nil {
		v := strings.TrimSpace(*in.LastName)
		if utf8.RuneCountInString(v) < 1 || utf8.RuneCountInString(v) > 60 {
			return users.PublicUser{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"last_name": "required, max 60 characters",
			})
		}
		in.LastName = &v
	}
	if in.Username != nil {
		u := strings.ToLower(strings.TrimSpace(*in.Username))
		if len(u) < 3 || len(u) > 32 {
			return users.PublicUser{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"username": "must be 3–32 characters",
			})
		}
		for _, r := range u {
			if (r < 'a' || r > 'z') && (r < '0' || r > '9') && r != '_' {
				return users.PublicUser{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
					"username": "use letters, numbers, and underscores only",
				})
			}
		}
		in.Username = &u
	}
	if in.PhoneE164 != nil {
		p := strings.TrimSpace(*in.PhoneE164)
		if p != "" && (len(p) < 8 || len(p) > 20 || p[0] != '+') {
			return users.PublicUser{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"phone_e164": "use E.164 format like +2519…",
			})
		}
		if p == "" {
			in.PhoneE164 = nil
		} else {
			in.PhoneE164 = &p
		}
	}
	if in.CountryCode != nil {
		c := strings.ToUpper(strings.TrimSpace(*in.CountryCode))
		if len(c) != 2 {
			return users.PublicUser{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"country_code": "must be a 2-letter ISO country code",
			})
		}
		in.CountryCode = &c
	}
	if in.PreferredAuthProvider != nil {
		p := strings.ToLower(strings.TrimSpace(*in.PreferredAuthProvider))
		if p != "email" && p != "google" && p != "telegram" {
			return users.PublicUser{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"preferred_auth_provider": "must be email, google, or telegram",
			})
		}
		in.PreferredAuthProvider = &p
	}
	if in.Currency != nil {
		c := strings.ToUpper(strings.TrimSpace(*in.Currency))
		if len(c) != 3 {
			return users.PublicUser{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"default_currency_code": "must be a 3-letter code",
			})
		}
		in.Currency = &c
	}
	if in.HourCycle != nil {
		h := strings.TrimSpace(*in.HourCycle)
		// Legacy ethiopian_6 maps to 24h (removed from product).
		if h == "ethiopian_6" {
			h = "24h"
		}
		if h != "24h" && h != "12h" {
			return users.PublicUser{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"hour_cycle": "must be 24h or 12h",
			})
		}
		in.HourCycle = &h
	}
	if in.CalendarID != nil {
		c := strings.ToLower(strings.TrimSpace(*in.CalendarID))
		switch c {
		case "gregorian", "gregory":
			c = "gregorian"
		case "islamic", "hijri":
			c = "islamic"
		case "hebrew":
			c = "hebrew"
		case "chinese":
			c = "chinese"
		case "ethiopic", "ethiopian":
			c = "ethiopic"
		case "persian", "solar_hijri", "jalali":
			c = "persian"
		default:
			// Accept unknown ids that look like catalog keys so admin-added calendars work.
			if c == "" || len(c) > 32 {
				return users.PublicUser{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
					"calendar_id": "must be gregorian, islamic, hebrew, chinese, ethiopic, or persian",
				})
			}
			for _, r := range c {
				if (r < 'a' || r > 'z') && (r < '0' || r > '9') && r != '_' && r != '-' {
					return users.PublicUser{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
						"calendar_id": "must be gregorian, islamic, hebrew, chinese, ethiopic, or persian",
					})
				}
			}
		}
		in.CalendarID = &c
	}
	// Keep display_name aligned with structured names when provided.
	if in.DisplayName == nil && (in.FirstName != nil || in.LastName != nil) {
		parts := []string{}
		if in.FirstName != nil {
			parts = append(parts, *in.FirstName)
		}
		if in.MiddleName != nil && *in.MiddleName != "" {
			parts = append(parts, *in.MiddleName)
		}
		if in.LastName != nil {
			parts = append(parts, *in.LastName)
		}
		if len(parts) > 0 {
			joined := strings.Join(parts, " ")
			in.DisplayName = &joined
		}
	}
	user, err := s.store.UpdateUserAccount(ctx, userID, in)
	if err != nil {
		if isUniqueViolation(err) {
			return users.PublicUser{}, httpx.Field(http.StatusConflict, "CONFLICT", "username or phone already taken", map[string]string{
				"username": "already taken",
			})
		}
		msg := err.Error()
		if strings.Contains(msg, "calendar_id") || strings.Contains(msg, "users_calendar") {
			return users.PublicUser{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"calendar_id": "calendar is not supported by the database yet — run migrations",
			})
		}
		if strings.Contains(msg, "hour_cycle") {
			return users.PublicUser{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"hour_cycle": "must be 24h or 12h",
			})
		}
		return users.PublicUser{}, err
	}
	if s.onPhoneSet != nil && in.PhoneE164 != nil && *in.PhoneE164 != "" {
		_ = s.onPhoneSet(ctx, userID, *in.PhoneE164)
	}
	return ToPublic(user), nil
}

func (s *Service) AcceptTOS(ctx context.Context, userID uuid.UUID) (users.PublicUser, error) {
	user, err := s.store.AcceptTOS(ctx, userID, legal.Version)
	if err != nil {
		return users.PublicUser{}, err
	}
	return ToPublic(user), nil
}

func (s *Service) issueChallenge(ctx context.Context, user UserRecord) (string, error) {
	return s.issueCodedChallenge(ctx, user, "email",
		"Your Lony verification code",
		"Your Lony verification code is %s.\n\nIt expires in %s.\n\nIf you did not request this, ignore this email.\n",
		"could not send verification email; try again shortly",
	)
}

func (s *Service) issuePasswordResetChallenge(ctx context.Context, user UserRecord) (string, error) {
	return s.issueCodedChallenge(ctx, user, "password_reset",
		"Your Lony password reset code",
		"Your Lony password reset code is %s.\n\nIt expires in %s.\n\nIf you did not request this, ignore this email.\n",
		"could not send password reset email; try again shortly",
	)
}

func (s *Service) issueCodedChallenge(ctx context.Context, user UserRecord, channel, subject, bodyFmt, sendFailMsg string) (string, error) {
	if err := s.store.InvalidateOpenChallenges(ctx, user.ID); err != nil {
		return "", err
	}
	code, err := SixDigitCode()
	if err != nil {
		return "", err
	}
	_, err = s.store.CreateChallenge(ctx, user.ID, channel, user.Email, HashToken(code), s.now().Add(s.cfg.VerificationCodeTTL))
	if err != nil {
		return "", err
	}
	body := fmt.Sprintf(bodyFmt, code, s.cfg.VerificationCodeTTL.Round(time.Minute))
	if s.mail != nil && s.mail.Configured() {
		if sendErr := s.mail.Send(ctx, user.Email, subject, body); sendErr != nil {
			log.Printf("auth: send %s email to %s: %v", channel, user.Email, sendErr)
			if !s.cfg.Dev() {
				return "", httpx.E(http.StatusBadGateway, "EMAIL_SEND_FAILED", sendFailMsg)
			}
		}
	} else if !s.cfg.Dev() {
		return "", httpx.E(http.StatusServiceUnavailable, "EMAIL_NOT_CONFIGURED", "email delivery is not configured")
	} else {
		log.Printf("auth: %s code for %s (dev, no mailer): %s", channel, user.Email, code)
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
	if s.cfg.Dev() && (s.mail == nil || !s.mail.Configured()) {
		out.VerificationCode = code
		out.VerificationHint = "Development mode: use the verification_code in this response."
	}
	return out
}

func ToPublic(user UserRecord) users.PublicUser {
	out := users.PublicUser{
		ID:                    user.ID,
		Email:                 user.Email,
		Username:              user.Username,
		PhoneE164:             user.PhoneE164,
		DisplayName:           user.DisplayName,
		FirstName:             user.FirstName,
		MiddleName:            user.MiddleName,
		LastName:              user.LastName,
		CountryCode:           user.CountryCode,
		PreferredAuthProvider: user.PreferredAuthProvider,
		TOSVersion:            user.TOSVersion,
		TOSAcceptedAt:         user.TOSAcceptedAt,
		Timezone:              user.Timezone,
		Locale:                user.Locale,
		CalendarID:            user.CalendarID,
		HourCycle:             user.HourCycle,
		LoanRequireApproval:   user.LoanRequireApproval,
		DefaultCurrencyCode:   user.DefaultCurrencyCode,
		EmailVerified:         user.EmailVerifiedAt != nil,
		Status:                user.Status,
		Role:                  user.Role,
		PlanTier:              user.PlanTier,
		CreatedAt:             user.CreatedAt,
	}
	if out.Role == "" {
		out.Role = "user"
	}
	if out.PlanTier == "" {
		out.PlanTier = "free"
	}
	if out.CalendarID == "" {
		out.CalendarID = "gregorian"
	}
	if out.HourCycle == "" {
		out.HourCycle = "24h"
	}
	if user.AvatarObjectKey != nil && *user.AvatarObjectKey != "" {
		url := "/api/v1/media/" + *user.AvatarObjectKey
		out.AvatarURL = &url
	}
	out.ProfileComplete = profileComplete(user)
	return out
}

func profileComplete(user UserRecord) bool {
	if user.Username == nil || strings.TrimSpace(*user.Username) == "" {
		return false
	}
	if user.FirstName == nil || strings.TrimSpace(*user.FirstName) == "" {
		return false
	}
	if user.LastName == nil || strings.TrimSpace(*user.LastName) == "" {
		return false
	}
	if user.CountryCode == nil || len(strings.TrimSpace(*user.CountryCode)) != 2 {
		return false
	}
	if user.DefaultCurrencyCode == nil || len(strings.TrimSpace(*user.DefaultCurrencyCode)) != 3 {
		return false
	}
	if user.TOSAcceptedAt == nil || user.TOSVersion == nil || *user.TOSVersion != legal.Version {
		return false
	}
	return true
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

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
