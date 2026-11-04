package goals

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// fakeRates: 1 ETB = 1/57 USD, i.e. 1 USD = 57 ETB.
type fakeRates struct{ down bool }

func (f fakeRates) Rates(_ context.Context, base string) (map[string]decimal.Decimal, time.Time, error) {
	if f.down {
		return nil, time.Time{}, errors.New("no rates")
	}
	if base != "ETB" {
		return nil, time.Time{}, errors.New("unexpected base")
	}
	return map[string]decimal.Decimal{"ETB": decimal.NewFromInt(1), "USD": decimal.RequireFromString("0.0175438596")}, time.Now(), nil
}

type memGoals struct {
	Store
	saved   Goal
	history []PriceHistory
}

func (m *memGoals) Update(_ context.Context, rec Goal) (Goal, error) { m.saved = rec; return rec, nil }
func (m *memGoals) InsertPriceHistory(_ context.Context, rec PriceHistory) (PriceHistory, error) {
	m.history = append(m.history, rec)
	return rec, nil
}

func TestPriceDraftConvertsToUserCurrency(t *testing.T) {
	s := NewService(nil)
	s.SetFX(fakeRates{})
	ctx := context.Background()

	d := PlanDraft{SourceURL: "https://www.amazon.com/dp/X"}
	s.priceDraft(ctx, &d, decimal.RequireFromString("100"), "usd", "ETB", "")
	if d.CurrencyCode != "ETB" || d.SourceCurrency != "USD" || d.SourcePrice != "100.00" {
		t.Fatalf("%+v", d)
	}
	if amt := decimal.RequireFromString(d.TargetAmount); amt.Sub(decimal.NewFromInt(5700)).Abs().GreaterThan(decimal.NewFromInt(1)) {
		t.Fatalf("100 USD should be ≈5700 ETB, got %s", d.TargetAmount)
	}

	unknown := PlanDraft{SourceURL: "https://shop.example/x"}
	s.priceDraft(ctx, &unknown, decimal.RequireFromString("49.99"), "", "ETB", "")
	if !unknown.CurrencyUnknown || unknown.CurrencyCode != "" {
		t.Fatalf("a price with no currency must not become ETB: %+v", unknown)
	}

	s.SetFX(fakeRates{down: true})
	noRate := PlanDraft{SourceURL: "https://www.amazon.com/dp/X"}
	s.priceDraft(ctx, &noRate, decimal.RequireFromString("100"), "USD", "ETB", "")
	if noRate.CurrencyCode != "USD" || noRate.TargetAmount != "100.00" {
		t.Fatalf("without a rate keep the page's own currency: %+v", noRate)
	}
}

// Refreshing a USD listing for an ETB goal keeps the goal in ETB and the saved money intact.
func TestRefreshNeverChangesGoalCurrency(t *testing.T) {
	store := &memGoals{}
	s := NewService(store)
	s.SetFX(fakeRates{})
	usd := "USD"
	seen := decimal.RequireFromString("100")
	url := "https://www.amazon.com/dp/X"
	goal := Goal{
		ID: uuid.New(), UserID: uuid.New(), Title: "Headphones", CurrencyCode: "ETB", Status: StatusActive,
		TargetAmount: decimal.NewFromInt(5700), CurrentAmount: decimal.NewFromInt(1000),
		SourceURL: &url, LastSeenPrice: &seen, SourceCurrency: &usd,
	}

	dto, change, err := s.applyScrapedPrice(context.Background(), goal, PreviewURLResult{Price: "90.00", Currency: "USD"})
	if err != nil {
		t.Fatal(err)
	}
	g := store.saved
	if g.CurrencyCode != "ETB" || !g.CurrentAmount.Equal(decimal.NewFromInt(1000)) {
		t.Fatalf("goal currency or savings changed: %s %s", g.CurrencyCode, g.CurrentAmount)
	}
	if change == nil || change.Direction != DirectionDown || change.CurrencyCode != "USD" || !decimal.RequireFromString(change.OldPrice).Equal(decimal.NewFromInt(100)) {
		t.Fatalf("change %+v", change)
	}
	if g.TargetAmount.Sub(decimal.NewFromInt(5130)).Abs().GreaterThan(decimal.NewFromInt(1)) {
		t.Fatalf("90 USD should be ≈5130 ETB, got %s", g.TargetAmount)
	}
	if len(store.history) != 1 || store.history[0].CurrencyCode != "USD" {
		t.Fatalf("history %+v", store.history)
	}
	_ = dto

	// Same price again: no change reported.
	store.saved.LastSeenPrice = g.LastSeenPrice
	if _, again, _ := s.applyScrapedPrice(context.Background(), store.saved, PreviewURLResult{Price: "90.00", Currency: "USD"}); again != nil {
		t.Fatalf("unchanged price reported as a change: %+v", again)
	}
}
