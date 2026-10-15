package banks

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"equilend/api/internal/httpx"
	"equilend/api/internal/loans"

	"github.com/google/uuid"
)

var testKey = []byte("0123456789abcdef0123456789abcdef")

type stubLoans struct {
	recs map[uuid.UUID]loans.Record
}

func (s stubLoans) Record(_ context.Context, actor, id uuid.UUID) (loans.Record, error) {
	rec, ok := s.recs[id]
	if !ok || !rec.IsParty(actor) {
		return loans.Record{}, httpx.E(404, "NOT_FOUND", "loan not found")
	}
	return rec, nil
}

type stubGate struct{ ok bool }

func (g stubGate) CanCreateLoan(context.Context, uuid.UUID, uuid.UUID) (bool, error) {
	return g.ok, nil
}

func setupBanks() (uuid.UUID, uuid.UUID, uuid.UUID, *Service, stubLoans) {
	owner := uuid.New()
	borrower := uuid.New()
	stranger := uuid.New()
	loanID := uuid.New()
	lookup := stubLoans{recs: map[uuid.UUID]loans.Record{
		loanID: {
			ID:         loanID,
			BorrowerID: borrower,
			LenderID:   owner,
			Status:     loans.StatusActive,
		},
	}}
	svc := NewService(newMemoryStore(), lookup, stubGate{ok: true}, testKey)
	svc.now = func() time.Time { return time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC) }
	return owner, borrower, stranger, svc, lookup
}

func TestCreateMasksIdentifier(t *testing.T) {
	owner, _, stranger, svc, _ := setupBanks()
	ctx := context.Background()
	created, err := svc.Create(ctx, owner, CreateInput{
		Type:        TypeBankAccount,
		Label:       "CBE checking",
		Identifier:  "1000123456789",
		IsPreferred: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.AccountLast4 != "6789" || created.AccountIdentifier != nil {
		t.Fatalf("leaked identifier %+v", created)
	}

	listed, err := svc.List(ctx, owner, false)
	if err != nil || len(listed) != 1 || listed[0].AccountIdentifier != nil {
		t.Fatalf("list %+v %v", listed, err)
	}

	if _, err := svc.Get(ctx, stranger, created.ID); err == nil {
		t.Fatal("stranger read profile")
	}

	if _, err := svc.Reveal(ctx, owner, created.ID, svc.now().Add(-6*time.Minute)); err == nil {
		t.Fatal("stale auth should fail")
	}

	revealed, err := svc.Reveal(ctx, owner, created.ID, svc.now())
	if err != nil {
		t.Fatal(err)
	}
	if revealed.AccountIdentifier == nil || *revealed.AccountIdentifier != "1000123456789" {
		t.Fatalf("reveal %+v", revealed)
	}

	events, err := svc.Events(ctx, owner, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(events)
	if strings.Contains(string(raw), "1000123456789") {
		t.Fatalf("audit leaked identifier %s", raw)
	}
	var kinds []string
	for _, ev := range events {
		kinds = append(kinds, ev.Type)
	}
	joined := strings.Join(kinds, ",")
	if !strings.Contains(joined, EventCreated) || !strings.Contains(joined, EventRevealed) {
		t.Fatalf("events %v", kinds)
	}
}

func TestShareAndRevoke(t *testing.T) {
	owner, borrower, stranger, svc, lookup := setupBanks()
	ctx := context.Background()
	created, err := svc.Create(ctx, owner, CreateInput{
		Type: TypeMobileWallet, Label: "Telebirr", Identifier: "0911234567",
	})
	if err != nil {
		t.Fatal(err)
	}
	var loanID uuid.UUID
	for id := range lookup.recs {
		loanID = id
	}

	share, err := svc.Share(ctx, owner, created.ID, ShareInput{RecipientID: borrower, LoanID: &loanID})
	if err != nil {
		t.Fatal(err)
	}
	if share.Profile.AccountIdentifier != nil || share.Profile.AccountLast4 != "4567" {
		t.Fatalf("share leaked %+v", share)
	}

	masked, err := svc.LoanPaymentProfile(ctx, borrower, loanID, false, svc.now())
	if err != nil {
		t.Fatal(err)
	}
	if masked.AccountIdentifier != nil || masked.AccountLast4 != "4567" {
		t.Fatalf("borrower list %+v", masked)
	}

	full, err := svc.LoanPaymentProfile(ctx, borrower, loanID, true, svc.now())
	if err != nil {
		t.Fatal(err)
	}
	if full.AccountIdentifier == nil || *full.AccountIdentifier != "0911234567" {
		t.Fatalf("borrower reveal %+v", full)
	}

	if _, err := svc.LoanPaymentProfile(ctx, stranger, loanID, true, svc.now()); err == nil {
		t.Fatal("stranger payment profile")
	}

	if _, err := svc.Revoke(ctx, owner, share.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.LoanPaymentProfile(ctx, borrower, loanID, false, svc.now()); err == nil {
		t.Fatal("revoked share still readable")
	}
	if _, err := svc.Get(ctx, borrower, created.ID); err == nil {
		t.Fatal("revoked get still readable")
	}

	events, err := svc.Events(ctx, owner, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(events)
	if strings.Contains(string(raw), "0911234567") {
		t.Fatalf("share audit leaked identifier %s", raw)
	}
}

func TestPreferredUniqueAndFriendShare(t *testing.T) {
	owner, borrower, _, svc, _ := setupBanks()
	ctx := context.Background()
	first, err := svc.Create(ctx, owner, CreateInput{Type: TypeOther, Label: "A", Identifier: "AAAA1111", IsPreferred: true})
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.Create(ctx, owner, CreateInput{Type: TypeOther, Label: "B", Identifier: "BBBB2222", IsPreferred: true})
	if err != nil {
		t.Fatal(err)
	}
	listed, err := svc.List(ctx, owner, false)
	if err != nil {
		t.Fatal(err)
	}
	preferred := 0
	for _, row := range listed {
		if row.IsPreferred {
			preferred++
			if row.ID != second.ID {
				t.Fatalf("preferred %s want %s", row.ID, second.ID)
			}
		}
	}
	if preferred != 1 {
		t.Fatalf("preferred count %d", preferred)
	}

	if _, err := svc.Share(ctx, owner, first.ID, ShareInput{RecipientID: borrower}); err != nil {
		t.Fatal(err)
	}
	got, err := svc.Get(ctx, borrower, first.ID)
	if err != nil || got.AccountIdentifier != nil {
		t.Fatalf("friend share %+v %v", got, err)
	}
}
