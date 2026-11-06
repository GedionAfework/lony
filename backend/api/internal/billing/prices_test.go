package billing

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

var errNotSet = errors.New("not set")

func at(s string) *time.Time { t, _ := time.Parse(time.RFC3339, s); return &t }

func TestPlanPriceApply(t *testing.T) {
	now, _ := time.Parse(time.RFC3339, "2026-11-06T12:00:00Z")
	base := PlanPrice{Tier: TierPro, Interval: "month", AmountCents: 1000, Currency: "usd"}

	if amt, d := base.Apply(now); amt != 1000 || d != nil {
		t.Fatalf("no discount: %d %+v", amt, d)
	}
	p := base
	p.Discount = &Discount{Kind: DiscountPercent, Value: 20, Label: "Launch", EndsAt: at("2026-11-10T00:00:00Z")}
	if amt, d := p.Apply(now); amt != 800 || d == nil || d.OffCents != 200 || d.Label != "Launch" || d.EndsAt == nil {
		t.Fatalf("percent: %d %+v", amt, d)
	}
	p.Discount = &Discount{Kind: DiscountFlat, Value: 250}
	if amt, d := p.Apply(now); amt != 750 || d.OffCents != 250 {
		t.Fatalf("flat: %d %+v", amt, d)
	}
	// Ended and not-yet-started discounts are ignored.
	p.Discount = &Discount{Kind: DiscountPercent, Value: 50, EndsAt: at("2026-11-01T00:00:00Z")}
	if amt, _ := p.Apply(now); amt != 1000 {
		t.Fatalf("expired discount applied: %d", amt)
	}
	p.Discount = &Discount{Kind: DiscountPercent, Value: 50, StartsAt: at("2026-12-01T00:00:00Z")}
	if amt, _ := p.Apply(now); amt != 1000 {
		t.Fatalf("future discount applied: %d", amt)
	}
}

func TestValidatePrices(t *testing.T) {
	ok, err := ValidatePrices([]PlanPrice{
		{Tier: "PRO", Interval: "Year", AmountCents: 10000, Currency: "USD", Discount: &Discount{Kind: "percent", Value: 0}},
		{Tier: "plus", Interval: "month", AmountCents: 500},
	})
	if err != nil {
		t.Fatal(err)
	}
	if ok[0].Key() != "plus_month" || ok[0].Currency != "usd" || ok[1].Key() != "pro_year" || ok[1].Discount != nil {
		t.Fatalf("not tidied: %+v", ok)
	}
	bad := [][]PlanPrice{
		{{Tier: "free", Interval: "month", AmountCents: 100}},
		{{Tier: "pro", Interval: "week", AmountCents: 100}},
		{{Tier: "pro", Interval: "month", AmountCents: 0}},
		{{Tier: "pro", Interval: "month", AmountCents: 100}, {Tier: "pro", Interval: "month", AmountCents: 200}},
		{{Tier: "pro", Interval: "month", AmountCents: 100, Discount: &Discount{Kind: "percent", Value: 100}}},
		{{Tier: "pro", Interval: "month", AmountCents: 100, Discount: &Discount{Kind: "flat", Value: 100}}},
		{{Tier: "pro", Interval: "month", AmountCents: 100, Discount: &Discount{Kind: "bogo", Value: 5}}},
		{{Tier: "pro", Interval: "month", AmountCents: 100, Discount: &Discount{Kind: "percent", Value: 5, StartsAt: at("2026-12-01T00:00:00Z"), EndsAt: at("2026-11-01T00:00:00Z")}}},
	}
	for i, in := range bad {
		if _, err := ValidatePrices(in); err == nil {
			t.Errorf("case %d accepted", i)
		}
	}
}

// Saved admin prices drive the plan list, with live discounts applied.
func TestCatalogUsesAdminPrices(t *testing.T) {
	st := &savedSettings{memStore: newMem(), vals: map[string]string{}}
	svc := NewService(st, NewPolar("", "sandbox"), Config{Products: map[string]string{"plus_month": "prod_a", "pro_month": "prod_b"}})
	end := time.Now().Add(48 * time.Hour).UTC().Truncate(time.Second)
	if err := svc.UpdateSettings(context.Background(), [16]byte{}, SettingsUpdate{Prices: &[]PlanPrice{
		{Tier: "pro", Interval: "month", AmountCents: 1000, Currency: "usd"},
		{Tier: "pro", Interval: "year", AmountCents: 10000, Currency: "usd", Discount: &Discount{Kind: "flat", Value: 2000, EndsAt: &end}},
	}}); err != nil {
		t.Fatal(err)
	}
	plans := svc.Catalog(context.Background()).Plans
	if len(plans) != 2 {
		t.Fatalf("plans = %+v", plans)
	}
	y := plans[1]
	if y.Key != "pro_year" || y.AmountCents != 8000 || y.ListCents != 10000 || y.Discount == nil || !y.Discount.EndsAt.Equal(end) {
		t.Fatalf("yearly = %+v", y)
	}
	if _, err := svc.Checkout(context.Background(), [16]byte{}, "plus_month"); err == nil || !strings.Contains(err.Error(), "invalid") {
		t.Fatal("checkout of a plan that is not offered was allowed")
	}
}

type savedSettings struct {
	*memStore
	vals map[string]string
}

func (s *savedSettings) GetSetting(_ context.Context, k string) (string, error) {
	if v, ok := s.vals[k]; ok {
		return v, nil
	}
	return "", errNotSet
}
func (s *savedSettings) SetSetting(_ context.Context, k, v string) error { s.vals[k] = v; return nil }
