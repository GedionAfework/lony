package accounts

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

type dayStore struct {
	Store
	accts []AccountAt
	flows []DayFlow
}

func (d dayStore) AccountsAt(context.Context, uuid.UUID, time.Time) ([]AccountAt, error) {
	return d.accts, nil
}
func (d dayStore) DayFlows(context.Context, uuid.UUID, time.Time, time.Time) ([]DayFlow, error) {
	return d.flows, nil
}

func dd(s string) decimal.Decimal { return decimal.RequireFromString(s) }

func TestBalanceAt(t *testing.T) {
	// Bank holds 1000 now; after the day it got 300 salary, paid 50, sent 100 to the card.
	bank := AccountAt{Type: TypeBank, Balance: dd("1000"), NetAfter: dd("250"), TransferOut: dd("100")}
	if got := bank.BalanceAt(); !got.Equal(dd("850")) {
		t.Fatalf("bank at day end = %s, want 850", got)
	}
	// Card owes 200 now; after the day 80 was spent on it and 100 paid in.
	card := AccountAt{Type: TypeCreditCard, Balance: dd("200"), NetAfter: dd("-80"), TransferIn: dd("100")}
	if got := card.BalanceAt(); !got.Equal(dd("220")) {
		t.Fatalf("card at day end = %s, want 220", got)
	}
}

func TestDaySummary_CardsSubtractAndDayFlows(t *testing.T) {
	svc := NewService(dayStore{
		accts: []AccountAt{
			{Type: TypeBank, CurrencyCode: "USD", Balance: dd("1000")},
			{Type: TypeCash, CurrencyCode: "USD", Balance: dd("50")},
			{Type: TypeCreditCard, CurrencyCode: "USD", Balance: dd("300")},
		},
		flows: []DayFlow{
			{CurrencyCode: "USD", Kind: "income", Amount: dd("200"), Count: 1},
			{CurrencyCode: "USD", Kind: "expense", Amount: dd("45.50"), Count: 3},
		},
	})
	from := time.Date(2026, 11, 6, 5, 0, 0, 0, time.UTC)
	got, err := svc.DaySummary(context.Background(), uuid.New(), "usd", from, from.Add(24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if got.Balance != "750.00" || got.Assets != "1050.00" || got.Cards != "300.00" {
		t.Fatalf("balance %s assets %s cards %s; want 750 / 1050 / 300", got.Balance, got.Assets, got.Cards)
	}
	if got.Income != "200.00" || got.Expense != "45.50" || got.Net != "154.50" || got.Entries != 4 || got.CurrencyCode != "USD" {
		t.Fatalf("flows wrong: %+v", got)
	}
}

func TestDaySummary_OtherCurrencyWithoutRatesIsNamed(t *testing.T) {
	svc := NewService(dayStore{accts: []AccountAt{
		{Type: TypeBank, CurrencyCode: "USD", Balance: dd("100")},
		{Type: TypeBank, CurrencyCode: "ETB", Balance: dd("5000")},
	}})
	from := time.Date(2026, 11, 6, 0, 0, 0, 0, time.UTC)
	got, err := svc.DaySummary(context.Background(), uuid.New(), "USD", from, from.Add(24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if got.Balance != "100.00" || len(got.Missing) != 1 || got.Missing[0] != "ETB" {
		t.Fatalf("got %+v", got)
	}
}

func TestDaySummary_RejectsBadRange(t *testing.T) {
	svc := NewService(dayStore{})
	from := time.Now()
	if _, err := svc.DaySummary(context.Background(), uuid.New(), "USD", from, from); err == nil {
		t.Fatal("empty range accepted")
	}
}
