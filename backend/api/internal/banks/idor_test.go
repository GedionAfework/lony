package banks

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

func TestIDORBankProfileAndShare(t *testing.T) {
	owner, borrower, stranger, svc, lookup := setupBanks()
	ctx := context.Background()

	profile, err := svc.Create(ctx, owner, CreateInput{
		Type: TypeBankAccount, Label: "CBE", Identifier: "1000998877665", IsPreferred: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Get(ctx, stranger, profile.ID); err == nil {
		t.Fatal("stranger read bank profile")
	}
	if _, err := svc.Reveal(ctx, stranger, profile.ID, svc.now()); err == nil {
		t.Fatal("stranger reveal")
	}

	var loanID uuid.UUID
	for id := range lookup.recs {
		loanID = id
	}
	share, err := svc.Share(ctx, owner, profile.ID, ShareInput{RecipientID: borrower, LoanID: &loanID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Reveal(ctx, stranger, profile.ID, svc.now()); err == nil {
		t.Fatal("stranger reveal after share")
	}
	if _, err := svc.Revoke(ctx, stranger, share.ID); err == nil {
		t.Fatal("stranger revoke")
	}
}
