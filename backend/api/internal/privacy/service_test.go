package privacy

import (
	"testing"

	"github.com/google/uuid"
)

func TestCanUseAI(t *testing.T) {
	if CanUseAI("free", "user") {
		t.Fatal("free users must not use AI")
	}
	if !CanUseAI("premium", "user") {
		t.Fatal("premium users can use AI")
	}
	if !CanUseAI("free", "admin") {
		t.Fatal("admins bypass the Premium gate")
	}
}

func TestFilename(t *testing.T) {
	id := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	got := Filename(id)
	if got != "lony-export-aaaaaaaa.zip" {
		t.Fatalf("got %s", got)
	}
}

func TestErrAIDisabled(t *testing.T) {
	err := ErrAIDisabled()
	if err == nil || err.Error() == "" {
		t.Fatal("expected error")
	}
}
