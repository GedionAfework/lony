package auth

import (
	"context"
	"errors"
	"testing"

	"equilend/api/internal/config"
	"equilend/api/internal/httpx"
)

func TestOAuthWhatsAppUnsupported(t *testing.T) {
	svc := NewService(nil, config.Config{})
	_, err := svc.OAuthLogin(context.Background(), OAuthInput{
		Provider:           "whatsapp",
		AcceptedDisclaimer: true,
	})
	if err == nil {
		t.Fatal("expected error")
	}
	var he *httpx.APIError
	if !errors.As(err, &he) || he.Status != 501 {
		t.Fatalf("want 501, got %v", err)
	}
}

func TestOAuthRequiresDisclaimer(t *testing.T) {
	svc := NewService(nil, config.Config{})
	_, err := svc.OAuthLogin(context.Background(), OAuthInput{Provider: "google"})
	if err == nil {
		t.Fatal("expected error")
	}
}
