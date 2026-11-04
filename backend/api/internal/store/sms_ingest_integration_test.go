package store

import (
	"testing"
	"time"

	"equilend/api/internal/accounts"
	"equilend/api/internal/expenses"
)

func TestSMSIngestAgainstPostgres(t *testing.T) {
	e := newNetWorthEnv(t)
	svc := newCashflowSvc(e)
	me := e.user(t)
	wallet := e.account(t, me, accounts.TypeBank, "5000")
	at := func(min int) *int64 {
		ms := time.Date(2026, 10, 30, 9, min, 0, 0, time.UTC).UnixMilli()
		return &ms
	}
	ingest := func(text string, date *int64, confirmed bool) (expenses.SMSIngestResult, error) {
		return svc.IngestSMS(e.ctx, me, expenses.SMSIngestInput{
			Text: text, AccountID: &wallet, Create: true, SMSDateMs: date, Confirmed: confirmed,
		})
	}

	// A promotion is refused, unless the user confirmed it by hand.
	promo := "Pay with telebirr and win up to ETB 1,000! You have received a chance. Offer ends soon."
	if _, err := ingest(promo, at(1), false); err == nil {
		t.Fatal("promotion must be refused")
	}

	// Same text, different times: two separate payments, no currency printed → account's (ETB).
	pay := "Dear Abebe You have paid 50.00 for taxi to Sara on telebirr."
	first, err := ingest(pay, at(10), false)
	if err != nil || first.Entry == nil || first.Duplicate {
		t.Fatalf("first: %v %+v", err, first)
	}
	if first.Entry.CurrencyCode != "ETB" {
		t.Fatalf("currency %s, want the account's ETB", first.Entry.CurrencyCode)
	}
	second, err := ingest(pay, at(40), false)
	if err != nil || second.Duplicate || second.Entry == nil || second.Entry.ID == first.Entry.ID {
		t.Fatalf("second identical payment was dropped: %v %+v", err, second)
	}
	again, _ := ingest(pay, at(40), false)
	if !again.Duplicate {
		t.Fatal("re-sending the same message must be a duplicate")
	}

	// One typed-in expense absorbs one SMS of the same amount, not two.
	acct := wallet
	typed, err := svc.Create(e.ctx, me, expenses.CreateInput{Kind: "expense", Title: "Lunch", Amount: "120", CurrencyCode: "ETB", Category: "Food", AccountID: &acct,
		OccurredAt: time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)})
	if err != nil {
		t.Fatal(err)
	}
	lunch := "Dear Abebe You have paid ETB 120.00 to Cafe on telebirr."
	m1, _ := ingest(lunch, at(55), false)
	if !m1.Duplicate || m1.MatchedExistingID == nil || *m1.MatchedExistingID != typed.ID.String() {
		t.Fatalf("first lunch SMS should match the typed entry: %+v", m1)
	}
	m2, err := ingest(lunch+" Ref 2", at(58), false)
	if err != nil || m2.Duplicate {
		t.Fatalf("second lunch SMS is a second payment: %v %+v", err, m2)
	}
}
