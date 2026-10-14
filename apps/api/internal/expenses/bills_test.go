package expenses

import (
	"testing"
	"time"

	"github.com/shopspring/decimal"
)

func TestSkipAdvance(t *testing.T) {
	due := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	got := skipAdvance(RecurrenceMonthly, due)
	want := time.Date(2026, 11, 14, 12, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("monthly skip: got %v want %v", got, want)
	}
	got = skipAdvance(RecurrenceWeekly, due)
	want = time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("weekly skip: got %v want %v", got, want)
	}
}

func TestBillFromEntryOverdue(t *testing.T) {
	now := time.Date(2026, 10, 14, 15, 0, 0, 0, time.UTC)
	e := Entry{Title: "Rent", Kind: KindExpense, Status: StatusExpected, Amount: decimal.NewFromInt(100)}
	due := time.Date(2026, 10, 10, 8, 0, 0, 0, time.UTC)
	b := billFromEntry(e, due, now, false)
	if b.Status != "overdue" {
		t.Fatalf("status=%s want overdue", b.Status)
	}
	paused := billFromEntry(e, due, now, true)
	if paused.Status != "paused" {
		t.Fatalf("status=%s want paused", paused.Status)
	}
}
