package loans

import (
	"testing"
	"time"

	"github.com/shopspring/decimal"
)

func TestComputeExpected(t *testing.T) {
	cases := []struct {
		principal, rate, interest, total string
	}{
		{"1000", "5", "50.0000", "1050.0000"},
		{"100", "0", "0.0000", "100.0000"},
		{"99.99", "10", "9.9990", "109.9890"},
		{"2500.5", "2.5", "62.5125", "2563.0125"},
	}
	for _, tc := range cases {
		p, _ := decimal.NewFromString(tc.principal)
		r, _ := decimal.NewFromString(tc.rate)
		interest, total := ComputeExpected(p, r)
		if interest.StringFixed(4) != tc.interest {
			t.Fatalf("principal=%s rate=%s interest=%s want %s", tc.principal, tc.rate, interest.StringFixed(4), tc.interest)
		}
		if total.StringFixed(4) != tc.total {
			t.Fatalf("principal=%s rate=%s total=%s want %s", tc.principal, tc.rate, total.StringFixed(4), tc.total)
		}
	}
}

func TestComputeEMI(t *testing.T) {
	p, _ := decimal.NewFromString("100000")
	r, _ := decimal.NewFromString("12")
	emi := ComputeEMI(p, r, 12)
	if emi.LessThanOrEqual(decimal.Zero) {
		t.Fatalf("expected positive EMI, got %s", emi)
	}
	zeroRate := ComputeEMI(p, decimal.Zero, 10)
	want, _ := decimal.NewFromString("10000.0000")
	if !zeroRate.Equal(want) {
		t.Fatalf("zero-rate EMI=%s want %s", zeroRate, want)
	}
	start, _ := time.Parse(time.RFC3339, "2026-01-15T00:00:00Z")
	plan := BuildInstallmentSchedule(p, r, emi, 12, start)
	if len(plan) != 12 {
		t.Fatalf("want 12 installments, got %d", len(plan))
	}
}
