package ai

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"equilend/api/internal/httpx"

	"github.com/google/uuid"
)

// Voice add and receipt scan are "capture": the fast way to log money. Free users get a
// monthly allowance so they can rely on it; Premium is unlimited. Both still sit under
// the daily per-user cap (AI_DAILY_USER_CAP) that protects against abuse.

// CaptureCounter stores successful captures per user per calendar month (UTC).
type CaptureCounter interface {
	CaptureCount(ctx context.Context, userID uuid.UUID, month time.Time) (int, error)
	IncrementCapture(ctx context.Context, userID uuid.UUID, month time.Time) (int, error)
}

type CaptureAllowance struct {
	Used      int       `json:"used"`
	Limit     int       `json:"limit"`
	Unlimited bool      `json:"unlimited"`
	ResetsAt  time.Time `json:"resets_at"`
}

func (s *Service) SetCaptures(c CaptureCounter, freePerMonth int) {
	s.captures = c
	s.freeCaptures = freePerMonth
}

func monthStart(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC)
}

// CaptureAllowance reports how many captures the user has left this month.
func (s *Service) CaptureAllowance(ctx context.Context, userID uuid.UUID) (CaptureAllowance, error) {
	month := monthStart(s.now())
	out := CaptureAllowance{Limit: s.freeCaptures, ResetsAt: month.AddDate(0, 1, 0)}
	if s.plans != nil {
		l, err := s.plans.AILimits(ctx, userID)
		if err != nil {
			return CaptureAllowance{}, err
		}
		out.Limit = l.CapturesMonthly
		out.Unlimited = l.CapturesMonthly < 0
	} else if s.gate != nil {
		premium, err := s.gate.UserCanUseAI(ctx, userID)
		if err != nil {
			return CaptureAllowance{}, err
		}
		out.Unlimited = premium
	}
	if s.captures == nil {
		out.Unlimited = true
		return out, nil
	}
	used, err := s.captures.CaptureCount(ctx, userID, month)
	if err != nil {
		return CaptureAllowance{}, err
	}
	out.Used = used
	return out, nil
}

// BeginCapture checks that AI is on and the user has a capture left. It does not use
// one up: FinishCapture does that once the capture has worked.
func (s *Service) BeginCapture(ctx context.Context, userID uuid.UUID) error {
	if err := s.ensureCaptureReady(ctx); err != nil {
		return err
	}
	allowance, err := s.CaptureAllowance(ctx, userID)
	if err != nil {
		return err
	}
	if !allowance.Unlimited && allowance.Used >= allowance.Limit {
		return httpx.E(http.StatusPaymentRequired, "CAPTURE_LIMIT", fmt.Sprintf(
			"You've used the %d voice and receipt captures in your plan this month. Upgrade for more, or type it in.", allowance.Limit))
	}
	return nil
}

// FinishCapture counts one successful capture against the monthly allowance.
func (s *Service) FinishCapture(ctx context.Context, userID uuid.UUID) error {
	allowance, err := s.CaptureAllowance(ctx, userID)
	if err != nil || allowance.Unlimited || s.captures == nil {
		return err
	}
	_, err = s.captures.IncrementCapture(ctx, userID, monthStart(s.now()))
	return err
}

// ensureCaptureReady is the gate for capture calls: the admin kill switch and a
// configured model, but no Premium requirement (the allowance handles free users).
func (s *Service) ensureCaptureReady(ctx context.Context) error {
	if s.gate != nil {
		off, err := s.gate.AIDisabled(ctx)
		if err != nil {
			return err
		}
		if off {
			return httpx.E(http.StatusServiceUnavailable, "AI_DISABLED", "AI features are temporarily disabled")
		}
	}
	if s.llm == nil || !s.llm.Available() {
		return httpx.E(http.StatusServiceUnavailable, "AI_UNAVAILABLE", "AI is not configured")
	}
	return nil
}
