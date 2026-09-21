package dashboard

import (
	"testing"
	"time"

	"equilend/api/internal/loans"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

func TestBuildEmptyWithoutLoans(t *testing.T) {
	got := Build(uuid.New(), time.Now().UTC(), nil, nil)
	if len(got.ByCurrency) != 0 {
		t.Fatalf("expected no currency tabs, got %+v", got.ByCurrency)
	}
}

func TestBuildReconcilesOpenLoansPerCurrency(t *testing.T) {
	actor := uuid.New()
	sara := uuid.New()
	chala := uuid.New()
	now := time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC)
	etb := "ETB"
	usd := "USD"
	dueSoon := now.Add(48 * time.Hour)
	dueLater := now.Add(30 * 24 * time.Hour)

	etbRecv := dec("1050")
	etbPay := dec("200")
	usdRecv := dec("50")
	pendingAmt := dec("9999")

	rows := []loans.Record{
		openLoan(actor, sara, true, &etb, &etbRecv, &dueSoon, loans.StatusActive),
		openLoan(actor, sara, false, &etb, &etbPay, &dueLater, loans.StatusActive),
		openLoan(actor, chala, true, &usd, &usdRecv, &dueLater, loans.StatusOverdue),
		{
			BorrowerID: actor, LenderID: sara, Status: loans.StatusPending,
			CurrencyCode: &etb, ExpectedTotal: &pendingAmt, OutstandingAmount: &pendingAmt,
		},
		{
			BorrowerID: actor, LenderID: sara, Status: loans.StatusCancelled,
			CurrencyCode: &etb, ExpectedTotal: &etbRecv, OutstandingAmount: &etbRecv,
		},
	}
	parties := map[uuid.UUID]loans.Party{
		sara:  {ID: sara, DisplayName: "Sara"},
		chala: {ID: chala, DisplayName: "Chala"},
	}

	got := Build(actor, now, rows, parties)
	if got.PendingConfirmations != 0 {
		t.Fatalf("confirmations %d", got.PendingConfirmations)
	}
	if len(got.ByCurrency) != 2 || got.ByCurrency[0].CurrencyCode != "ETB" || got.ByCurrency[1].CurrencyCode != "USD" {
		t.Fatalf("currencies %+v", got.ByCurrency)
	}

	etbSlice := got.ByCurrency[0]
	if etbSlice.Receivables != "1050.0000" || etbSlice.Payables != "200.0000" || etbSlice.Net != "850.0000" {
		t.Fatalf("etb money %+v", etbSlice)
	}
	if etbSlice.DueSoon != "1050.0000" || etbSlice.DueSoonCount != 1 {
		t.Fatalf("due soon %+v", etbSlice)
	}
	if etbSlice.OpenLoanCount != 2 {
		t.Fatalf("open %d", etbSlice.OpenLoanCount)
	}
	if len(etbSlice.Friends) != 1 || etbSlice.Friends[0].Peer.DisplayName != "Sara" || etbSlice.Friends[0].Net != "850.0000" {
		t.Fatalf("friends %+v", etbSlice.Friends)
	}

	usdSlice := got.ByCurrency[1]
	if usdSlice.Receivables != "50.0000" || usdSlice.Payables != "0.0000" || usdSlice.Net != "50.0000" {
		t.Fatalf("usd money %+v", usdSlice)
	}
	if usdSlice.Friends[0].Peer.DisplayName != "Chala" {
		t.Fatalf("usd friends %+v", usdSlice.Friends)
	}

	// No blended total field exists; ETB+USD must not be summed anywhere in the payload.
	if etbSlice.Net == "900.0000" || usdSlice.Net == "900.0000" {
		t.Fatal("cross-currency blend")
	}
}

func TestPendingWithoutTermsCountsAsRequest(t *testing.T) {
	actor := uuid.New()
	other := uuid.New()
	row := loans.Record{BorrowerID: actor, LenderID: other, InitiatorID: other, Status: loans.StatusPending}
	got := Build(actor, time.Now().UTC(), []loans.Record{row}, map[uuid.UUID]loans.Party{})
	if got.PendingRequests != 1 {
		t.Fatalf("pending %d", got.PendingRequests)
	}
}

func openLoan(actor, peer uuid.UUID, actorIsLender bool, currency *string, amount *decimal.Decimal, due *time.Time, status string) loans.Record {
	rec := loans.Record{
		Status: status, CurrencyCode: currency, ExpectedTotal: amount, OutstandingAmount: amount, DueAt: due,
	}
	if actorIsLender {
		rec.LenderID = actor
		rec.BorrowerID = peer
	} else {
		rec.BorrowerID = actor
		rec.LenderID = peer
	}
	return rec
}

func dec(s string) decimal.Decimal {
	d, _ := decimal.NewFromString(s)
	return d
}
