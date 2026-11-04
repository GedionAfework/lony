package loans

import (
	"context"
	"testing"
	"time"

	"github.com/shopspring/decimal"
)

func TestComputeCharged(t *testing.T) {
	p, r := decimal.RequireFromString("1000"), decimal.RequireFromString("5")
	start := time.Date(2026, 1, 15, 9, 0, 0, 0, time.UTC)
	cases := []struct {
		name   string
		charge string
		due    time.Time
		want   string
		months int32
	}{
		{"once ignores length", InterestOnce, start.AddDate(1, 0, 0), "50", 0},
		{"three full months", InterestPerMonth, time.Date(2026, 4, 15, 0, 0, 0, 0, time.UTC), "150", 3},
		{"a started month counts", InterestPerMonth, time.Date(2026, 4, 16, 0, 0, 0, 0, time.UTC), "200", 4},
		{"at least one month", InterestPerMonth, time.Date(2026, 1, 20, 0, 0, 0, 0, time.UTC), "50", 1},
		{"one year", InterestPerYear, time.Date(2027, 1, 15, 0, 0, 0, 0, time.UTC), "50", 0},
		{"half a year by days", InterestPerYear, start.AddDate(0, 0, 73), "10", 0},
	}
	for _, c := range cases {
		interest, total, months := ComputeCharged(p, r, c.charge, start, c.due)
		if !interest.Equal(decimal.RequireFromString(c.want)) || !total.Equal(p.Add(interest)) || months != c.months {
			t.Errorf("%s: interest %s months %d, want %s / %d", c.name, interest, months, c.want, c.months)
		}
	}
}

func TestCreateWithMonthlyInterest(t *testing.T) {
	a, b, _, svc := setup() // now = 2026-09-16
	due := time.Date(2026, 12, 16, 12, 0, 0, 0, time.UTC)
	monthly := InterestPerMonth
	loan, err := svc.Create(context.Background(), a.ID, CreateInput{
		CounterpartyID: b.ID, Role: RoleLender, Principal: ptr("1000"), CurrencyCode: ptr("ETB"),
		InterestRatePercent: ptr("5"), DueAt: &due, InterestCharge: &monthly,
	})
	if err != nil {
		t.Fatal(err)
	}
	if loan.InterestCharge != InterestPerMonth || loan.ExpectedTotal == nil || *loan.ExpectedTotal != "1150.0000" {
		t.Fatalf("charge %s total %v", loan.InterestCharge, loan.ExpectedTotal)
	}

	bad := "weekly"
	if _, err := svc.Create(context.Background(), a.ID, CreateInput{
		CounterpartyID: b.ID, Role: RoleLender, Principal: ptr("1000"), CurrencyCode: ptr("ETB"),
		InterestRatePercent: ptr("5"), DueAt: &due, InterestCharge: &bad,
	}); err == nil {
		t.Fatal("unknown charge must be refused")
	}

	// Default stays "once" so existing clients behave exactly as before.
	plain, err := svc.Create(context.Background(), a.ID, CreateInput{
		CounterpartyID: b.ID, Role: RoleLender, Principal: ptr("1000"), CurrencyCode: ptr("ETB"),
		InterestRatePercent: ptr("5"), DueAt: &due,
	})
	if err != nil || plain.InterestCharge != InterestOnce || *plain.ExpectedTotal != "1050.0000" {
		t.Fatalf("%v %s %v", err, plain.InterestCharge, plain.ExpectedTotal)
	}
}
