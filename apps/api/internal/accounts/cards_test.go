package accounts

import (
	"testing"
	"time"

	"github.com/shopspring/decimal"
)

func TestNextMonthDay(t *testing.T) {
	now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	got := nextMonthDay(now, 20)
	want := time.Date(2026, 10, 20, 0, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("upcoming: got %v want %v", got, want)
	}
	got = nextMonthDay(now, 10)
	want = time.Date(2026, 11, 10, 0, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("rolled: got %v want %v", got, want)
	}
	got = nextMonthDay(now, 14)
	want = time.Date(2026, 10, 14, 0, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("today: got %v want %v", got, want)
	}
}

func TestCashflowDeltaCreditCard(t *testing.T) {
	amt := decimal.NewFromInt(50)
	if got := cashflowDelta(TypeCreditCard, "expense", amt); !got.Equal(amt) {
		t.Fatalf("card expense should increase owed, got %s", got)
	}
	if got := cashflowDelta(TypeCreditCard, "income", amt); !got.Equal(amt.Neg()) {
		t.Fatalf("card refund should decrease owed, got %s", got)
	}
	if got := cashflowDelta(TypeBank, "expense", amt); !got.Equal(amt.Neg()) {
		t.Fatalf("bank expense should decrease cash, got %s", got)
	}
	if got := cashflowDelta(TypeBank, "income", amt); !got.Equal(amt) {
		t.Fatalf("bank income should increase cash, got %s", got)
	}
}

func TestCardMetrics(t *testing.T) {
	limit := decimal.NewFromInt(1000)
	rec := Account{Balance: decimal.NewFromInt(250), CreditLimit: &limit}
	avail, pct := cardMetrics(rec)
	if avail == nil || !avail.Equal(decimal.NewFromInt(750)) {
		t.Fatalf("available=%v want 750", avail)
	}
	if pct == nil || *pct != 25 {
		t.Fatalf("utilization=%v want 25", pct)
	}
}
