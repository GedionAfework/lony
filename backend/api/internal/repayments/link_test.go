package repayments

import (
	"context"
	"errors"
	"testing"
	"time"

	"equilend/api/internal/httpx"
	"equilend/api/internal/loans"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

func strp(s string) *string { return &s }

func apiCode(err error) string {
	var e *httpx.APIError
	if errors.As(err, &e) {
		return e.Code
	}
	return ""
}

func setupInstitutional() (me, loanID uuid.UUID, svc *Service, store *memoryStore) {
	me = uuid.New()
	loanID = uuid.New()
	total := decimal.RequireFromString("1000.0000")
	due := time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC)
	etb := "ETB"
	bank := "CBE"
	store = newMemoryStore(loans.Record{
		ID: loanID, BorrowerID: me, LenderID: me, Status: loans.StatusActive, PartyMode: loans.PartyAlone,
		CurrencyCode: &etb, ExpectedTotal: &total, OutstandingAmount: &total, DueAt: &due, InstitutionLabel: &bank,
	})
	svc = NewService(store, loanAccess{m: store})
	svc.now = func() time.Time { return time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC) }
	return me, loanID, svc, store
}

func TestInstitutionalClaimConfirmsImmediately(t *testing.T) {
	me, loanID, svc, store := setupInstitutional()
	acct := store.addAccount(me, "ETB", "5000")

	out, err := svc.Claim(context.Background(), me, loanID, ClaimInput{Amount: strp("400"), PayFromAccountID: &acct})
	if err != nil {
		t.Fatal(err)
	}
	if out.Status != StatusConfirmed || out.CanConfirm || out.CanReject {
		t.Fatalf("want confirmed with no actions, got %+v", out)
	}
	loan := store.loans[loanID]
	if loan.Status != loans.StatusActive || !loan.OutstandingAmount.Equal(decimal.RequireFromString("600")) {
		t.Fatalf("loan %s outstanding %s", loan.Status, loan.OutstandingAmount)
	}
	if got := store.balance(acct); got != "4600.00" {
		t.Fatalf("balance %s", got)
	}
	if ev := store.events[loanID]; len(ev) != 2 || ev[0].Type != EventClaimed || ev[1].Type != EventConfirmed {
		t.Fatalf("events %+v", ev)
	}

	if _, err := svc.Claim(context.Background(), me, loanID, ClaimInput{Amount: strp("600")}); err != nil {
		t.Fatal(err)
	}
	if store.loans[loanID].Status != loans.StatusCompleted {
		t.Fatalf("status %s", store.loans[loanID].Status)
	}
}

// Claims made before the fix are stuck in pending; the user can now confirm them.
func TestInstitutionalStuckClaimCanBeSelfConfirmed(t *testing.T) {
	me, loanID, svc, store := setupInstitutional()
	stuck := Record{ID: uuid.New(), LoanID: loanID, SubmittedByUserID: me, Amount: decimal.RequireFromString("250"), Status: StatusPending}
	store.reps[stuck.ID] = stuck
	store.byLoan[loanID] = []uuid.UUID{stuck.ID}
	loan := store.loans[loanID]
	loan.Status = loans.StatusRepaymentPending
	store.loans[loanID] = loan

	acct := store.addAccount(me, "ETB", "100")
	if _, err := svc.Confirm(context.Background(), me, stuck.ID, ConfirmInput{ReceivedAccountID: &acct}); err == nil {
		t.Fatal("receiving into an account on a self-recorded debt must be refused")
	}
	out, err := svc.Confirm(context.Background(), me, stuck.ID, ConfirmInput{})
	if err != nil {
		t.Fatal(err)
	}
	if out.Status != StatusConfirmed || !store.loans[loanID].OutstandingAmount.Equal(decimal.RequireFromString("750")) {
		t.Fatalf("%+v outstanding %s", out, store.loans[loanID].OutstandingAmount)
	}
}

func TestClaimWithAccountIsLinked(t *testing.T) {
	borrower, _, loanID, svc, store := setupRepay()
	acct := store.addAccount(borrower, "ETB", "2000")

	out, err := svc.Claim(context.Background(), borrower, loanID, ClaimInput{Amount: strp("500"), PayFromAccountID: &acct})
	if err != nil {
		t.Fatal(err)
	}
	if out.Status != StatusPending || out.PaidEntryID == nil {
		t.Fatalf("%+v", out)
	}
	if got := store.balance(acct); got != "1500.00" {
		t.Fatalf("balance %s", got)
	}
	if e := store.entries[*out.PaidEntryID]; e.Kind != KindExpense || !e.Amount.Equal(decimal.RequireFromString("500")) {
		t.Fatalf("entry %+v", e)
	}
}

func TestClaimWithAccountFailureLeavesNoExpense(t *testing.T) {
	borrower, _, loanID, svc, store := setupRepay()
	acct := store.addAccount(borrower, "ETB", "2000")
	store.failInsert = true

	if _, err := svc.Claim(context.Background(), borrower, loanID, ClaimInput{Amount: strp("500"), PayFromAccountID: &acct}); err == nil {
		t.Fatal("want error")
	}
	if len(store.entries) != 0 || store.balance(acct) != "2000.00" {
		t.Fatalf("entries %d balance %s", len(store.entries), store.balance(acct))
	}
}

func TestClaimAccountValidation(t *testing.T) {
	borrower, lender, loanID, svc, store := setupRepay()
	usd := store.addAccount(borrower, "USD", "100")
	theirs := store.addAccount(lender, "ETB", "100")
	mine := store.addAccount(borrower, "ETB", "100")
	entry := store.addEntry(borrower, KindExpense, "50", "ETB")
	ctx := context.Background()

	for name, in := range map[string]ClaimInput{
		"currency mismatch": {Amount: strp("50"), PayFromAccountID: &usd},
		"not my account":    {Amount: strp("50"), PayFromAccountID: &theirs},
		"both sources":      {Amount: strp("50"), PayFromAccountID: &mine, PaidEntryID: &entry},
		"entry too small":   {Amount: strp("80"), PaidEntryID: &entry},
	} {
		if _, err := svc.Claim(ctx, borrower, loanID, in); err == nil {
			t.Errorf("%s: want error", name)
		}
	}
	if len(store.reps) != 0 {
		t.Fatalf("nothing should be saved, got %d", len(store.reps))
	}
}

func TestRejectedPaymentUndoRestoresBalance(t *testing.T) {
	borrower, lender, loanID, svc, store := setupRepay()
	acct := store.addAccount(borrower, "ETB", "2000")
	ctx := context.Background()

	claimed, err := svc.Claim(ctx, borrower, loanID, ClaimInput{Amount: strp("500"), PayFromAccountID: &acct})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Resolve(ctx, borrower, claimed.ID, ResolveUndoExpense); apiCode(err) != "INVALID_STATE" {
		t.Fatalf("pending claim must not be resolvable, got %v", err)
	}
	if _, err := svc.Reject(ctx, lender, claimed.ID, RejectInput{Reason: "not received"}); err != nil {
		t.Fatal(err)
	}
	listed, _ := svc.ListForLoan(ctx, borrower, loanID)
	if len(listed) != 1 || !listed[0].NeedsResolution {
		t.Fatalf("borrower should be asked to resolve: %+v", listed)
	}
	if lenderView, _ := svc.ListForLoan(ctx, lender, loanID); lenderView[0].NeedsResolution {
		t.Fatal("lender has nothing to resolve")
	}
	if _, err := svc.Resolve(ctx, lender, claimed.ID, ResolveUndoExpense); err == nil {
		t.Fatal("lender cannot resolve")
	}

	out, err := svc.Resolve(ctx, borrower, claimed.ID, ResolveUndoExpense)
	if err != nil {
		t.Fatal(err)
	}
	if out.NeedsResolution || out.PaidEntryID != nil {
		t.Fatalf("%+v", out)
	}
	if store.balance(acct) != "2000.00" || len(store.entries) != 0 {
		t.Fatalf("balance %s entries %d", store.balance(acct), len(store.entries))
	}
}

func TestRejectedPaymentKeepExpense(t *testing.T) {
	borrower, lender, loanID, svc, store := setupRepay()
	acct := store.addAccount(borrower, "ETB", "2000")
	ctx := context.Background()

	claimed, _ := svc.Claim(ctx, borrower, loanID, ClaimInput{Amount: strp("500"), PayFromAccountID: &acct})
	_, _ = svc.Reject(ctx, lender, claimed.ID, RejectInput{Reason: "disputed"})
	if _, err := svc.Resolve(ctx, borrower, claimed.ID, "something"); err == nil {
		t.Fatal("unknown action")
	}
	out, err := svc.Resolve(ctx, borrower, claimed.ID, ResolveKeepExpense)
	if err != nil {
		t.Fatal(err)
	}
	if out.PaidEntryID != nil || store.balance(acct) != "1500.00" || len(store.entries) != 1 {
		t.Fatalf("%+v balance %s", out, store.balance(acct))
	}
}

func TestResubmitMovesExpenseLink(t *testing.T) {
	borrower, lender, loanID, svc, store := setupRepay()
	acct := store.addAccount(borrower, "ETB", "2000")
	ctx := context.Background()

	first, _ := svc.Claim(ctx, borrower, loanID, ClaimInput{Amount: strp("500"), PayFromAccountID: &acct})
	_, _ = svc.Reject(ctx, lender, first.ID, RejectInput{Reason: "wrong amount"})

	second, err := svc.Claim(ctx, borrower, loanID, ClaimInput{Amount: strp("500"), PaidEntryID: first.PaidEntryID})
	if err != nil {
		t.Fatal(err)
	}
	if second.PaidEntryID == nil || *second.PaidEntryID != *first.PaidEntryID {
		t.Fatalf("link not moved: %+v", second)
	}
	if old := store.reps[first.ID]; old.PaidEntryID != nil {
		t.Fatal("rejected claim should no longer hold the expense")
	}
	if store.balance(acct) != "1500.00" {
		t.Fatalf("resubmitting must not spend again, balance %s", store.balance(acct))
	}
}

func TestEntryCannotBackTwoLiveRepayments(t *testing.T) {
	borrower, lender, loanID, svc, store := setupRepay()
	acct := store.addAccount(borrower, "ETB", "2000")
	ctx := context.Background()

	first, _ := svc.Claim(ctx, borrower, loanID, ClaimInput{Amount: strp("500"), PayFromAccountID: &acct})
	if _, err := svc.Confirm(ctx, lender, first.ID, ConfirmInput{}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Claim(ctx, borrower, loanID, ClaimInput{Amount: strp("100"), PaidEntryID: first.PaidEntryID}); apiCode(err) != "ENTRY_LINKED" {
		t.Fatalf("want ENTRY_LINKED, got %v", err)
	}
}

func TestConfirmRecordsIncomeOnce(t *testing.T) {
	borrower, lender, loanID, svc, store := setupRepay()
	lenderAcct := store.addAccount(lender, "ETB", "0")
	ctx := context.Background()

	claimed, _ := svc.Claim(ctx, borrower, loanID, ClaimInput{Amount: strp("300")})
	out, err := svc.Confirm(ctx, lender, claimed.ID, ConfirmInput{ReceivedAccountID: &lenderAcct})
	if err != nil {
		t.Fatal(err)
	}
	if out.ReceivedEntryID == nil || store.balance(lenderAcct) != "300.00" {
		t.Fatalf("%+v balance %s", out, store.balance(lenderAcct))
	}

	// Income the lender already typed in by hand is linked, not added again.
	manual := store.addEntry(lender, KindIncome, "200", "ETB")
	claimed2, _ := svc.Claim(ctx, borrower, loanID, ClaimInput{Amount: strp("200")})
	out2, err := svc.Confirm(ctx, lender, claimed2.ID, ConfirmInput{ReceivedEntryID: &manual})
	if err != nil {
		t.Fatal(err)
	}
	if out2.ReceivedEntryID == nil || *out2.ReceivedEntryID != manual || store.balance(lenderAcct) != "300.00" {
		t.Fatalf("%+v balance %s", out2, store.balance(lenderAcct))
	}

	claimed3, _ := svc.Claim(ctx, borrower, loanID, ClaimInput{Amount: strp("100")})
	if _, err := svc.Confirm(ctx, lender, claimed3.ID, ConfirmInput{ReceivedEntryID: &manual}); apiCode(err) != "ENTRY_LINKED" {
		t.Fatalf("want ENTRY_LINKED, got %v", err)
	}
	wrongKind := store.addEntry(lender, KindExpense, "100", "ETB")
	if _, err := svc.Confirm(ctx, lender, claimed3.ID, ConfirmInput{ReceivedEntryID: &wrongKind}); err == nil {
		t.Fatal("an expense cannot be the received income")
	}
}
