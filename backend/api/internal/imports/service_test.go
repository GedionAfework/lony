package imports

import (
	"context"
	"testing"
	"time"

	"equilend/api/internal/accounts"
	"equilend/api/internal/expenses"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

type memCash struct {
	created []expenses.CreateInput
	list    []expenses.EntryDTO
}

func (m *memCash) Create(_ context.Context, _ uuid.UUID, in expenses.CreateInput) (expenses.EntryDTO, error) {
	m.created = append(m.created, in)
	return expenses.EntryDTO{
		ID:           uuid.New(),
		Kind:         in.Kind,
		Title:        in.Title,
		Amount:       in.Amount,
		CurrencyCode: in.CurrencyCode,
		Note:         in.Note,
		OccurredAt:   in.OccurredAt,
		AccountID:    in.AccountID,
		Status:       expenses.StatusConfirmed,
	}, nil
}

func (m *memCash) List(_ context.Context, _ uuid.UUID, _ expenses.ListQuery) ([]expenses.EntryDTO, error) {
	return m.list, nil
}

type memAcct struct {
	acct accounts.AccountDTO
}

func (m *memAcct) Get(_ context.Context, _, _ uuid.UUID) (accounts.AccountDTO, error) {
	return m.acct, nil
}

func (m *memAcct) SetBalance(_ context.Context, _, _ uuid.UUID, in accounts.SetBalanceInput) (accounts.AccountDTO, error) {
	m.acct.Balance = in.Balance
	return m.acct, nil
}

func TestImportCSVDuplicatesSkipped(t *testing.T) {
	aid := uuid.New()
	uid := uuid.New()
	cash := &memCash{}
	acct := &memAcct{acct: accounts.AccountDTO{
		ID:           aid,
		CurrencyCode: "USD",
		Balance:      "100.00",
		Name:         "Checking",
	}}
	svc := NewService(cash, acct)
	csv := `Date,Amount,Description
2026-01-05,-12.50,Coffee
2026-01-05,-12.50,Coffee
2026-01-06,10.00,Refund
`
	res, err := svc.ImportCSV(context.Background(), uid, aid, ImportInput{CSV: csv})
	if err != nil {
		t.Fatal(err)
	}
	if res.Imported != 2 {
		t.Fatalf("imported=%d want 2 (intra-batch dup skipped)", res.Imported)
	}
	if res.Skipped != 1 {
		t.Fatalf("skipped=%d want 1", res.Skipped)
	}
	if len(cash.created) != 2 {
		t.Fatalf("created %d", len(cash.created))
	}

	fpCoffee := fingerprint(ParsedRow{
		Date:   time.Date(2026, 1, 5, 12, 0, 0, 0, time.UTC),
		Amount: decimal.RequireFromString("12.50"),
		Kind:   "expense",
		Title:  "Coffee",
	})
	cash.list = []expenses.EntryDTO{
		{
			Kind:       "expense",
			Title:      "Coffee",
			Amount:     "12.50",
			OccurredAt: time.Date(2026, 1, 5, 12, 0, 0, 0, time.UTC),
			AccountID:  &aid,
			Note:       strPtr("statement-import:" + fpCoffee),
		},
		{
			Kind:       "income",
			Title:      "Refund",
			Amount:     "10.00",
			OccurredAt: time.Date(2026, 1, 6, 12, 0, 0, 0, time.UTC),
			AccountID:  &aid,
			Note:       cash.created[1].Note,
		},
	}
	cash.created = nil
	res2, err := svc.ImportCSV(context.Background(), uid, aid, ImportInput{CSV: csv})
	if err != nil {
		t.Fatal(err)
	}
	if res2.Imported != 0 || res2.Skipped != 3 {
		t.Fatalf("reimport imported=%d skipped=%d", res2.Imported, res2.Skipped)
	}
}

func strPtr(s string) *string { return &s }
