package banks

import (
	"testing"
)

func TestEncryptRoundTrip(t *testing.T) {
	key, err := LoadKey("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", "", false)
	if err != nil {
		t.Fatal(err)
	}
	blob, err := Encrypt(key, "1000123456789")
	if err != nil {
		t.Fatal(err)
	}
	got, err := Decrypt(key, blob)
	if err != nil {
		t.Fatal(err)
	}
	if got != "1000123456789" {
		t.Fatalf("got %s", got)
	}
	if Last4("1000 1234 5678") != "5678" {
		t.Fatalf("last4 digits %s", Last4("1000 1234 5678"))
	}
	if Last4("ab-wallet-99") != "t-99" {
		t.Fatalf("last4 compact %s", Last4("ab-wallet-99"))
	}
}

func TestLoadKeyDevFallback(t *testing.T) {
	key, err := LoadKey("", "dev-only-change-me-to-at-least-32-chars", true)
	if err != nil || len(key) != 32 {
		t.Fatalf("dev key %v %d", err, len(key))
	}
	if _, err := LoadKey("", "secret", false); err == nil {
		t.Fatal("expected missing key in non-dev")
	}
}
