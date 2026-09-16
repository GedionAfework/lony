package auth

import (
	"testing"
)

func TestPasswordRoundTrip(t *testing.T) {
	hash, err := HashPassword("correct-horse")
	if err != nil {
		t.Fatal(err)
	}
	ok, err := VerifyPassword(hash, "correct-horse")
	if err != nil || !ok {
		t.Fatalf("expected match, ok=%v err=%v", ok, err)
	}
	ok, err = VerifyPassword(hash, "wrong")
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("expected mismatch")
	}
}

func TestTokenHashStable(t *testing.T) {
	if HashToken("abc") != HashToken("abc") {
		t.Fatal("hash should be deterministic")
	}
	if HashToken("abc") == HashToken("abd") {
		t.Fatal("different inputs should not collide in this test")
	}
}

func TestSixDigitCode(t *testing.T) {
	code, err := SixDigitCode()
	if err != nil {
		t.Fatal(err)
	}
	if len(code) != 6 {
		t.Fatalf("got %q", code)
	}
}
