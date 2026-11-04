package expenses

import (
	"context"
	"testing"

	"equilend/api/internal/httpx"

	"github.com/google/uuid"
)

type catStore struct{ Store }

func (catStore) ListCategories(context.Context, uuid.UUID, string) ([]Category, error) { return nil, nil }

type outOfCaptures struct{ finished int }

func (g *outOfCaptures) BeginCapture(context.Context, uuid.UUID) error {
	return httpx.E(402, "CAPTURE_LIMIT", "no captures left")
}
func (g *outOfCaptures) FinishCapture(context.Context, uuid.UUID) error { g.finished++; return nil }

type failingVoice struct{ t *testing.T }

func (v failingVoice) TranscribeAudio(context.Context, uuid.UUID, string, []byte) (string, error) {
	v.t.Fatal("AI must not be called without a capture left")
	return "", nil
}
func (v failingVoice) ParseVoiceText(context.Context, uuid.UUID, string, []string) (VoiceExtract, error) {
	v.t.Fatal("AI must not be called without a capture left")
	return VoiceExtract{}, nil
}

// With no captures left, typed text still works through the rule-based parser, while
// recorded audio is refused with the limit message.
func TestVoiceWithoutCapturesLeft(t *testing.T) {
	gate := &outOfCaptures{}
	svc := NewService(catStore{})
	svc.SetVoice(failingVoice{t})
	svc.SetCaptureGate(gate)
	ctx := context.Background()

	out, err := svc.ParseVoice(ctx, uuid.New(), VoiceParseInput{Text: "lunch 250 birr"})
	if err != nil || out.Amount != "250.00" {
		t.Fatalf("%v %+v", err, out)
	}
	if _, err := svc.ParseVoice(ctx, uuid.New(), VoiceParseInput{Mime: "audio/m4a", AudioBase64: "AAAA"}); err == nil {
		t.Fatal("audio must be refused")
	}
	if gate.finished != 0 {
		t.Fatal("nothing should be counted")
	}
}
