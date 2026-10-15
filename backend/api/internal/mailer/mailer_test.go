package mailer

import (
	"context"
	"testing"
)

func TestNewFromEnvPrefersResend(t *testing.T) {
	s := NewFromEnv("re_test", "smtp.example.com", "587", "u", "p", "Lony <noreply@lony.app>")
	rs, ok := s.(ResendSender)
	if !ok {
		t.Fatalf("expected ResendSender, got %T", s)
	}
	if !rs.Configured() {
		t.Fatal("expected configured")
	}
}

func TestNewFromEnvSMTP(t *testing.T) {
	s := NewFromEnv("", "smtp.example.com", "587", "u", "p", "noreply@lony.app")
	ss, ok := s.(SMTPSender)
	if !ok {
		t.Fatalf("expected SMTPSender, got %T", s)
	}
	if ss.Port != "587" || !ss.Configured() {
		t.Fatalf("%+v", ss)
	}
}

func TestNewFromEnvLogFallback(t *testing.T) {
	s := NewFromEnv("", "", "", "", "", "")
	if s.Configured() {
		t.Fatal("log sender should report not configured")
	}
	if err := s.Send(context.Background(), "a@b.c", "Hi", "body"); err != nil {
		t.Fatal(err)
	}
}

func TestResendConfigured(t *testing.T) {
	if (ResendSender{}).Configured() {
		t.Fatal("empty sender should not be configured")
	}
	s := ResendSender{APIKey: "x", From: "a@b.c"}
	if !s.Configured() {
		t.Fatal("expected configured")
	}
}
