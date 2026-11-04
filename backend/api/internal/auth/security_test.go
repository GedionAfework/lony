package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"equilend/api/internal/config"
	"equilend/api/internal/httpx"
)

// A password-reset code must never come back in the response: whoever knows an email
// address could otherwise take over that account.
func TestForgotPasswordNeverReturnsCode(t *testing.T) {
	svc, _ := testService() // codes exposed for sign-up, the most permissive setting
	ctx := context.Background()
	reg, err := svc.Register(ctx, RegisterInput{
		Email: "owner@example.com", Password: "password12", DisplayName: "Owner",
		FirstName: "Owner", LastName: "One", AcceptedDisclaimer: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.VerifyEmail(ctx, "owner@example.com", reg.VerificationCode); err != nil {
		t.Fatal(err)
	}
	res, err := svc.ForgotPassword(ctx, "owner@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if res.VerificationCode != "" {
		t.Fatal("reset code leaked in the response")
	}
}

// Development mode alone (as on the hosted server) must not reveal sign-up codes.
func TestRegisterHidesCodeUnlessOptedIn(t *testing.T) {
	store := newMemoryStore()
	svc := NewService(store, config.Config{
		AppEnv:              "development",
		JWTSecret:           "dev-only-change-me-to-at-least-32-chars",
		AccessTokenTTL:      15 * time.Minute,
		RefreshTokenTTL:     24 * time.Hour,
		VerificationCodeTTL: 10 * time.Minute,
	})
	reg, err := svc.Register(context.Background(), RegisterInput{
		Email: "someone@example.com", Password: "password12", DisplayName: "Someone",
		FirstName: "Some", LastName: "One", AcceptedDisclaimer: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if reg.VerificationCode != "" {
		t.Fatal("sign-up code leaked without DEV_EXPOSE_CODES")
	}
}

// Without a configured client ID we cannot check a Google token was meant for Lony.
func TestGoogleRequiresClientID(t *testing.T) {
	svc := NewService(nil, config.Config{AppEnv: "development"})
	_, _, _, err := svc.verifyGoogle(context.Background(), "any-token")
	var he *httpx.APIError
	if !errors.As(err, &he) || he.Code != "GOOGLE_UNCONFIGURED" {
		t.Fatalf("want GOOGLE_UNCONFIGURED, got %v", err)
	}
}
