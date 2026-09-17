package repayments

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

func TestIDORStrangerCannotSeeOrConfirmRepayment(t *testing.T) {
	borrower, lender, loanID, svc, _ := setupRepay()
	stranger := uuid.New()
	ctx := context.Background()

	claimed, err := svc.Claim(ctx, borrower, loanID, ClaimInput{})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := svc.Get(ctx, stranger, claimed.ID); err == nil {
		t.Fatal("stranger read repayment")
	}
	if _, err := svc.Confirm(ctx, stranger, claimed.ID); err == nil {
		t.Fatal("stranger confirmed repayment")
	}
	if _, err := svc.ListForLoan(ctx, stranger, loanID); err == nil {
		t.Fatal("stranger listed repayments")
	}
	_ = lender
}
