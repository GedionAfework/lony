package expenses

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

type repayEntryStore struct {
	Store
	entry  Entry
	linked bool
	saved  *Entry
}

func (s *repayEntryStore) Get(context.Context, uuid.UUID, uuid.UUID) (Entry, error) { return s.entry, nil }
func (s *repayEntryStore) Update(_ context.Context, rec Entry) (Entry, error) {
	s.saved = &rec
	return rec, nil
}
func (s *repayEntryStore) EntryBacksRepayment(context.Context, uuid.UUID) (bool, error) {
	return s.linked, nil
}

// A loan repayment's amount and account stay what the loan says; words can change.
func TestRepaymentEntryKeepsItsAmount(t *testing.T) {
	acct := uuid.New()
	store := &repayEntryStore{linked: true, entry: Entry{ID: uuid.New(), Kind: KindExpense, Title: "Loan payment", Amount: decimal.RequireFromString("500"), CurrencyCode: "ETB", AccountID: &acct, Status: StatusConfirmed}}
	svc := NewService(store)
	ctx := context.Background()

	amount := "600"
	if _, err := svc.Update(ctx, uuid.New(), store.entry.ID, UpdateInput{Amount: &amount}); err == nil {
		t.Fatal("changing a repayment's amount must be refused")
	}
	same, title := "500.00", "Paid Sara back"
	if _, err := svc.Update(ctx, uuid.New(), store.entry.ID, UpdateInput{Amount: &same, AccountID: &acct, Title: &title}); err != nil {
		t.Fatalf("resending the same amount with a new title is fine: %v", err)
	}
	if store.saved == nil || store.saved.Title != title {
		t.Fatal("title not saved")
	}
}
