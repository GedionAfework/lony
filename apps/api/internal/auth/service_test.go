package auth

import (
	"context"
	"testing"
	"time"

	"equilend/api/internal/config"
)

func testService() (*Service, *memoryStore) {
	store := newMemoryStore()
	svc := NewService(store, config.Config{
		AppEnv:              "development",
		JWTSecret:           "dev-only-change-me-to-at-least-32-chars",
		AccessTokenTTL:      15 * time.Minute,
		RefreshTokenTTL:     24 * time.Hour,
		VerificationCodeTTL: 10 * time.Minute,
	})
	return svc, store
}

func TestRegisterValidateEmail(t *testing.T) {
	svc, _ := testService()
	_, err := svc.Register(context.Background(), RegisterInput{
		Email: "not-an-email", Password: "password12", DisplayName: "Abebe",
	})
	if err == nil {
		t.Fatal("expected validation error")
	}
}

func TestRegisterVerifyLoginMe(t *testing.T) {
	svc, _ := testService()
	ctx := context.Background()

	reg, err := svc.Register(ctx, RegisterInput{
		Email: "abebe@example.com", Password: "password12", DisplayName: "Abebe",
	})
	if err != nil {
		t.Fatal(err)
	}
	if reg.VerificationCode == "" {
		t.Fatal("expected dev verification code")
	}

	_, err = svc.Login(ctx, LoginInput{Email: "abebe@example.com", Password: "password12"}, nil)
	if err == nil {
		t.Fatal("login should fail before verify")
	}

	user, err := svc.VerifyEmail(ctx, "abebe@example.com", reg.VerificationCode)
	if err != nil {
		t.Fatal(err)
	}
	if !user.EmailVerified {
		t.Fatal("expected verified")
	}

	tokens, err := svc.Login(ctx, LoginInput{Email: "abebe@example.com", Password: "password12"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if tokens.AccessToken == "" || tokens.RefreshToken == "" {
		t.Fatal("expected tokens")
	}

	me, err := svc.Me(ctx, tokens.User.ID)
	if err != nil {
		t.Fatal(err)
	}
	if me.Email != "abebe@example.com" {
		t.Fatalf("got %s", me.Email)
	}

	refreshed, err := svc.Refresh(ctx, tokens.RefreshToken)
	if err != nil {
		t.Fatal(err)
	}
	if refreshed.RefreshToken == tokens.RefreshToken {
		t.Fatal("refresh token should rotate")
	}

	name := "Abebe Kebede"
	currency := "ETB"
	updated, err := svc.UpdateMe(ctx, me.ID, &name, nil, nil, &currency)
	if err != nil {
		t.Fatal(err)
	}
	if updated.DisplayName != name || updated.DefaultCurrencyCode == nil || *updated.DefaultCurrencyCode != "ETB" {
		t.Fatalf("unexpected profile %+v", updated)
	}
}

func TestDuplicateVerifiedEmail(t *testing.T) {
	svc, _ := testService()
	ctx := context.Background()
	reg, err := svc.Register(ctx, RegisterInput{
		Email: "sara@example.com", Password: "password12", DisplayName: "Sara",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.VerifyEmail(ctx, "sara@example.com", reg.VerificationCode); err != nil {
		t.Fatal(err)
	}
	_, err = svc.Register(ctx, RegisterInput{
		Email: "sara@example.com", Password: "password12", DisplayName: "Sara",
	})
	if err == nil {
		t.Fatal("expected email taken")
	}
}
