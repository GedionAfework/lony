package billing

import (
	"context"
	"errors"
	"testing"
)

// settingsless has no saved settings, so built-in limits and trial apply.
type settingsless struct{ *memStore }

func (settingsless) GetSetting(context.Context, string) (string, error) {
	return "", errors.New("not set")
}

// Without Polar the plan list still shows every tier, monthly and yearly, with prices,
// and marks them as not buyable yet.
func TestCatalogListsAllPlansWithPrices(t *testing.T) {
	svc := NewService(settingsless{newMem()}, NewPolar("", "sandbox"), Config{})
	cat := svc.Catalog(context.Background())
	want := map[string]int{"plus_month": 499, "plus_year": 4999, "pro_month": 999, "pro_year": 9999}
	if len(cat.Plans) != len(want) {
		t.Fatalf("plans = %+v", cat.Plans)
	}
	for _, p := range cat.Plans {
		if want[p.Key] != p.AmountCents || p.Currency != "usd" || p.Available || p.Interval == "" {
			t.Fatalf("plan %+v", p)
		}
	}

	svc = NewService(settingsless{newMem()}, NewPolar("", "sandbox"), Config{ListPrices: map[string]int{"plus_month": 300}, ListCurrency: "EUR"})
	for _, p := range svc.Catalog(context.Background()).Plans {
		if p.Key == "plus_month" && (p.AmountCents != 300 || p.Currency != "eur") {
			t.Fatalf("override not used: %+v", p)
		}
		if p.Key == "pro_year" && p.AmountCents != 0 {
			t.Fatalf("unlisted plan priced: %+v", p)
		}
	}
}
