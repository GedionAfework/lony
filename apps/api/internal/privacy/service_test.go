package privacy

import (
	"testing"

	"github.com/google/uuid"
)

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
