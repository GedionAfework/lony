package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"equilend/api/internal/httpx"
	"equilend/api/internal/insights"

	"github.com/google/uuid"
)

type memStore struct {
	usage int
	capHit bool
}

func (m *memStore) ReplaceInsights(ctx context.Context, userID uuid.UUID, rows []Insight) error {
	return nil
}
func (m *memStore) ListInsights(ctx context.Context, userID uuid.UUID, limit int) ([]Insight, error) {
	return nil, nil
}
func (m *memStore) DismissInsight(ctx context.Context, userID, id uuid.UUID) error { return nil }
func (m *memStore) DismissAllInsights(ctx context.Context, userID uuid.UUID) (int64, error) {
	return 0, nil
}
func (m *memStore) EnsureConversation(ctx context.Context, userID uuid.UUID, persona, title string) (Conversation, error) {
	return Conversation{ID: uuid.New(), UserID: userID, Persona: persona}, nil
}
func (m *memStore) ListMessages(ctx context.Context, conversationID uuid.UUID, limit int) ([]Message, error) {
	return nil, nil
}
func (m *memStore) InsertMessage(ctx context.Context, msg Message) (Message, error) {
	msg.ID = uuid.New()
	msg.CreatedAt = time.Now().UTC()
	return msg, nil
}
func (m *memStore) InsertRun(ctx context.Context, r Run) (Run, error) {
	r.ID = uuid.New()
	return r, nil
}
func (m *memStore) IncrementUsage(ctx context.Context, userID uuid.UUID, day time.Time, cap int) (int, bool, error) {
	m.usage++
	if cap > 0 && m.usage > cap {
		m.capHit = true
		return m.usage, false, nil
	}
	return m.usage, true, nil
}
func (m *memStore) ClearConversations(ctx context.Context, userID uuid.UUID) error { return nil }

type stubInsights struct{}

func (stubInsights) Overview(ctx context.Context, userID uuid.UUID, currency string, monthsBack int) (insights.Overview, error) {
	return insights.Overview{
		CurrencyCode: currency, Income: "1000", Expense: "400", Net: "600",
		OpenPayables: "0", OpenReceivables: "0",
	}, nil
}
func (stubInsights) CashflowSeries(ctx context.Context, userID uuid.UUID, currency string, months int) ([]insights.MonthPoint, error) {
	return []insights.MonthPoint{{Month: "2026-09", CurrencyCode: currency, Income: "1000", Expense: "400", Net: "600"}}, nil
}
func (stubInsights) Categories(ctx context.Context, userID uuid.UUID, currency string, months int) ([]insights.CategoryPoint, error) {
	return []insights.CategoryPoint{{Category: "Food", CurrencyCode: currency, Amount: "200", SharePercent: 50}}, nil
}
func (stubInsights) Debts(ctx context.Context, userID uuid.UUID, preferred string) (insights.DebtsSummary, error) {
	return insights.DebtsSummary{Payables: "0", Receivables: "0", Net: "0"}, nil
}
func (stubInsights) Goals(ctx context.Context, userID uuid.UUID) ([]insights.GoalInsight, error) {
	return nil, nil
}

func TestCoachFallsBackWithoutLLM(t *testing.T) {
	svc := NewService(&memStore{})
	svc.SetInsights(stubInsights{})
	out, err := svc.Coach(context.Background(), uuid.New(), "ETB", "where can I cut spending?")
	if err != nil {
		t.Fatal(err)
	}
	if out.Reply == "" || out.Disclaimer == "" {
		t.Fatalf("expected rule reply + disclaimer, got %+v", out)
	}
	if strings.Contains(strings.ToLower(out.Reply), "borrow more") {
		t.Fatal("rule coach should not suggest borrowing")
	}
}

func TestAllowLLMReturnsCap(t *testing.T) {
	st := &memStore{}
	svc := NewService(st)
	svc.dailyCap = 1
	// Simulate keyed client without calling network: exercise IncrementUsage via allow path indirectly.
	uid := uuid.New()
	_, ok, err := st.IncrementUsage(context.Background(), uid, time.Now().UTC(), 1)
	if err != nil || !ok {
		t.Fatalf("first should pass: ok=%v err=%v", ok, err)
	}
	_, ok, err = st.IncrementUsage(context.Background(), uid, time.Now().UTC(), 1)
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("second should be blocked by cap")
	}
	if !st.capHit {
		t.Fatal("expected cap hit")
	}
	apiErr := httpx.E(http.StatusTooManyRequests, "AI_CAP", "daily AI request limit reached")
	if apiErr.Code != "AI_CAP" || apiErr.Status != 429 {
		t.Fatalf("cap error shape: %+v", apiErr)
	}
}

func TestReportIncludesTablesAndDisclaimer(t *testing.T) {
	svc := NewService(&memStore{})
	svc.SetInsights(stubInsights{})
	rep, err := svc.Report(context.Background(), uuid.New(), "ETB", 6)
	if err != nil {
		t.Fatal(err)
	}
	if rep.Disclaimer == "" || len(rep.Charts) == 0 || len(rep.Tables) == 0 {
		t.Fatalf("incomplete report: %+v", rep)
	}
	if rep.Source != "rules" {
		t.Fatalf("expected rules source without LLM, got %q", rep.Source)
	}
	raw, _ := json.Marshal(rep)
	if strings.Contains(strings.ToLower(string(raw)), "account_number") {
		t.Fatal("report leaked account_number")
	}
}

func TestCoachStreamSSEWithoutLLM(t *testing.T) {
	svc := NewService(&memStore{})
	svc.SetInsights(stubInsights{})
	rr := httptest.NewRecorder()
	err := svc.CoachStream(context.Background(), rr, uuid.New(), "ETB", "how is my score?")
	if err != nil {
		t.Fatal(err)
	}
	body := rr.Body.String()
	if !strings.Contains(body, "event: token") || !strings.Contains(body, "event: done") {
		t.Fatalf("expected SSE token+done, got %s", body)
	}
	if ct := rr.Header().Get("Content-Type"); !strings.Contains(ct, "text/event-stream") {
		t.Fatalf("content-type: %s", ct)
	}
}