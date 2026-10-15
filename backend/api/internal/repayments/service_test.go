package repayments

import (
	"context"
	"testing"
	"time"

	"equilend/api/internal/httpx"
	"equilend/api/internal/loans"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

func setupRepay() (borrower, lender uuid.UUID, loanID uuid.UUID, svc *Service, store *memoryStore) {
	borrower = uuid.New()
	lender = uuid.New()
	loanID = uuid.New()
	outstanding := decimal.RequireFromString("1050.0000")
	due := time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC)
	currency := "ETB"
	loan := loans.Record{
		ID:                loanID,
		BorrowerID:        borrower,
		LenderID:          lender,
		Status:            loans.StatusActive,
		CurrencyCode:      &currency,
		ExpectedTotal:     &outstanding,
		OutstandingAmount: &outstanding,
		DueAt:             &due,
	}
	store = newMemoryStore(loan)
	svc = NewService(store, loanAccess{m: store})
	svc.now = func() time.Time { return time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC) }
	return borrower, lender, loanID, svc, store
}

func TestClaimConfirmCompletesLoan(t *testing.T) {
	borrower, lender, loanID, svc, store := setupRepay()
	ctx := context.Background()

	if _, err := svc.Claim(ctx, lender, loanID, ClaimInput{}); err == nil {
		t.Fatal("lender should not claim")
	}

	claimed, err := svc.Claim(ctx, borrower, loanID, ClaimInput{})
	if err != nil {
		t.Fatal(err)
	}
	if claimed.Amount != "1050.0000" || claimed.Status != StatusPending {
		t.Fatalf("%+v", claimed)
	}
	if store.loans[loanID].Status != loans.StatusRepaymentPending {
		t.Fatalf("loan status %s", store.loans[loanID].Status)
	}

	if _, err := svc.Claim(ctx, borrower, loanID, ClaimInput{}); err == nil {
		t.Fatal("duplicate claim")
	}

	if _, err := svc.Confirm(ctx, borrower, claimed.ID); err == nil {
		t.Fatal("borrower cannot confirm")
	}

	confirmed, err := svc.Confirm(ctx, lender, claimed.ID)
	if err != nil {
		t.Fatal(err)
	}
	if confirmed.Status != StatusConfirmed {
		t.Fatalf("%+v", confirmed)
	}
	loan := store.loans[loanID]
	if loan.Status != loans.StatusCompleted {
		t.Fatalf("loan %s", loan.Status)
	}
	if loan.OutstandingAmount == nil || !loan.OutstandingAmount.IsZero() {
		t.Fatalf("outstanding %+v", loan.OutstandingAmount)
	}

	if _, err := svc.Confirm(ctx, lender, claimed.ID); err == nil {
		t.Fatal("double confirm")
	}
}

func TestRejectReturnsActive(t *testing.T) {
	borrower, lender, loanID, svc, store := setupRepay()
	ctx := context.Background()
	claimed, err := svc.Claim(ctx, borrower, loanID, ClaimInput{})
	if err != nil {
		t.Fatal(err)
	}
	rejected, err := svc.Reject(ctx, lender, claimed.ID, RejectInput{Reason: "wrong amount"})
	if err != nil {
		t.Fatal(err)
	}
	if rejected.Status != StatusRejected || rejected.RejectionReason == nil {
		t.Fatalf("%+v", rejected)
	}
	if store.loans[loanID].Status != loans.StatusActive {
		t.Fatalf("loan %s", store.loans[loanID].Status)
	}
	// can claim again after reject
	again, err := svc.Claim(ctx, borrower, loanID, ClaimInput{})
	if err != nil {
		t.Fatal(err)
	}
	if again.Status != StatusPending {
		t.Fatalf("%+v", again)
	}
}

func TestClaimExceedsOutstanding(t *testing.T) {
	borrower, _, loanID, svc, _ := setupRepay()
	ctx := context.Background()
	amt := "2000"
	_, err := svc.Claim(ctx, borrower, loanID, ClaimInput{Amount: &amt})
	if err == nil {
		t.Fatal("expected exceed")
	}
	var api *httpx.APIError
	if !errorsAs(err, &api) || api.Code != "EXCEEDS_OUTSTANDING" {
		t.Fatalf("%v", err)
	}
}

func errorsAs(err error, target **httpx.APIError) bool {
	if err == nil {
		return false
	}
	e, ok := err.(*httpx.APIError)
	if !ok {
		return false
	}
	*target = e
	return true
}
