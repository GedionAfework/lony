package ai

import (
	"context"
	"errors"
	"testing"
	"time"

	"equilend/api/internal/ai/llm"
	"equilend/api/internal/httpx"

	"github.com/google/uuid"
)

type planGate struct {
	premium bool
	off     bool
}

func (g planGate) AIDisabled(context.Context) (bool, error)              { return g.off, nil }
func (g planGate) UserCanUseAI(context.Context, uuid.UUID) (bool, error) { return g.premium, nil }

type memCaptures map[string]int

func key(u uuid.UUID, m time.Time) string { return u.String() + m.Format("2006-01") }

func (m memCaptures) CaptureCount(_ context.Context, u uuid.UUID, month time.Time) (int, error) {
	return m[key(u, month)], nil
}
func (m memCaptures) IncrementCapture(_ context.Context, u uuid.UUID, month time.Time) (int, error) {
	m[key(u, month)]++
	return m[key(u, month)], nil
}

func captureSvc(gate planGate, counter memCaptures, now time.Time) *Service {
	s := NewService(&memStore{})
	s.SetGate(gate)
	s.SetLLM(llm.New(llm.Config{APIKey: "test"}), 40)
	s.SetCaptures(counter, 2)
	s.now = func() time.Time { return now }
	return s
}

func code(err error) string {
	var e *httpx.APIError
	if errors.As(err, &e) {
		return e.Code
	}
	return ""
}

func TestFreeUserCaptureAllowance(t *testing.T) {
	ctx := context.Background()
	user := uuid.New()
	counter := memCaptures{}
	oct := time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)
	s := captureSvc(planGate{}, counter, oct)

	for i := 0; i < 2; i++ {
		if err := s.BeginCapture(ctx, user); err != nil {
			t.Fatalf("capture %d: %v", i+1, err)
		}
		if err := s.FinishCapture(ctx, user); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.BeginCapture(ctx, user); code(err) != "CAPTURE_LIMIT" {
		t.Fatalf("third capture: want CAPTURE_LIMIT, got %v", err)
	}
	a, _ := s.CaptureAllowance(ctx, user)
	if a.Used != 2 || a.Limit != 2 || a.Unlimited || !a.ResetsAt.Equal(time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("%+v", a)
	}

	// A new month starts fresh.
	s.now = func() time.Time { return time.Date(2026, 11, 1, 0, 1, 0, 0, time.UTC) }
	if err := s.BeginCapture(ctx, user); err != nil {
		t.Fatalf("new month: %v", err)
	}
}

func TestPremiumCaptureUnlimitedAndKillSwitch(t *testing.T) {
	ctx := context.Background()
	user := uuid.New()
	counter := memCaptures{}
	s := captureSvc(planGate{premium: true}, counter, time.Now())
	for i := 0; i < 5; i++ {
		if err := s.BeginCapture(ctx, user); err != nil {
			t.Fatal(err)
		}
		_ = s.FinishCapture(ctx, user)
	}
	if len(counter) != 0 {
		t.Fatalf("premium captures should not be counted: %+v", counter)
	}
	off := captureSvc(planGate{premium: true, off: true}, counter, time.Now())
	if err := off.BeginCapture(ctx, user); code(err) != "AI_DISABLED" {
		t.Fatalf("kill switch: %v", err)
	}
}
