package store

// Runs against a real Postgres (migrations applied) only when LONY_TEST_DATABASE_URL
// is set, e.g. the docker-compose database:
//   LONY_TEST_DATABASE_URL=postgres://... go test ./internal/store -run NetWorth

import (
	"context"
	"os"
	"testing"
	"time"

	"equilend/api/db"
	"equilend/api/internal/accounts"
	"equilend/api/internal/loans"
	"equilend/api/internal/repayments"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"
)

type allowAll struct{}

func (allowAll) CanCreateLoan(context.Context, uuid.UUID, uuid.UUID) (bool, error) { return true, nil }

type netWorthEnv struct {
	ctx      context.Context
	pool     *pgxpool.Pool
	store    *SQLStore
	accounts *accounts.Service
	loans    *loans.Service
	repay    *repayments.Service
}

func newNetWorthEnv(t *testing.T) netWorthEnv {
	t.Helper()
	url := os.Getenv("LONY_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("LONY_TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	if err := db.Migrate(ctx, url); err != nil {
		t.Fatal(err)
	}
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	st := New(pool)
	acc := accounts.NewService(MoneyAccountsAdapter(st))
	ln := loans.NewService(st, allowAll{})
	acc.SetLoans(ln)
	ln.SetCards(acc)
	return netWorthEnv{ctx: ctx, pool: pool, store: st, accounts: acc, loans: ln, repay: repayments.NewService(st, ln)}
}

func (e netWorthEnv) user(t *testing.T) uuid.UUID {
	t.Helper()
	u, err := e.store.CreateUser(e.ctx, "nw-"+uuid.NewString()+"@test.local", "x", "Test", "UTC", "en")
	if err != nil {
		t.Fatal(err)
	}
	return u.ID
}

func (e netWorthEnv) account(t *testing.T, owner uuid.UUID, typ, balance string) uuid.UUID {
	t.Helper()
	a, err := e.accounts.Create(e.ctx, owner, accounts.CreateInput{Name: typ + " " + uuid.NewString()[:6], AccountType: typ, CurrencyCode: "ETB", Balance: balance})
	if err != nil {
		t.Fatal(err)
	}
	return a.ID
}

func (e netWorthEnv) balance(t *testing.T, owner, id uuid.UUID) string {
	t.Helper()
	a, err := e.accounts.Get(e.ctx, owner, id)
	if err != nil {
		t.Fatal(err)
	}
	return decimal.RequireFromString(a.Balance).StringFixed(0)
}

func (e netWorthEnv) entryCount(t *testing.T, owner uuid.UUID) int {
	t.Helper()
	var n int
	if err := e.pool.QueryRow(e.ctx, `SELECT COUNT(*) FROM cashflow_entries WHERE user_id = $1`, owner).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func (e netWorthEnv) peerLoan(t *testing.T, lender, borrower uuid.UUID, amount string) uuid.UUID {
	t.Helper()
	due := time.Now().Add(30 * 24 * time.Hour)
	zero := "0"
	etb := "ETB"
	l, err := e.loans.Create(e.ctx, lender, loans.CreateInput{
		CounterpartyID: borrower, Role: loans.RoleLender, Principal: &amount, CurrencyCode: &etb,
		InterestRatePercent: &zero, DueAt: &due, AutoAccept: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	return l.ID
}

func TestNetWorthClaimWithExpenseIsAtomic(t *testing.T) {
	e := newNetWorthEnv(t)
	lender, borrower := e.user(t), e.user(t)
	acct := e.account(t, borrower, accounts.TypeBank, "2000")
	loanID := e.peerLoan(t, lender, borrower, "1000")
	amt := "300"

	// A proof id that does not exist makes the repayment insert fail after the expense
	// and balance change were written: everything must roll back.
	bogus := uuid.New()
	if _, err := e.repay.Claim(e.ctx, borrower, loanID, repayments.ClaimInput{Amount: &amt, PayFromAccountID: &acct, ProofAttachmentID: &bogus}); err == nil {
		t.Fatal("want error")
	}
	if got := e.balance(t, borrower, acct); got != "2000" || e.entryCount(t, borrower) != 0 {
		t.Fatalf("rollback failed: balance %s entries %d", got, e.entryCount(t, borrower))
	}

	claimed, err := e.repay.Claim(e.ctx, borrower, loanID, repayments.ClaimInput{Amount: &amt, PayFromAccountID: &acct})
	if err != nil {
		t.Fatal(err)
	}
	if claimed.PaidEntryID == nil || e.balance(t, borrower, acct) != "1700" {
		t.Fatalf("%+v balance %s", claimed, e.balance(t, borrower, acct))
	}
	w, err := e.accounts.Wealth(e.ctx, borrower, "ETB")
	if err != nil {
		t.Fatal(err)
	}
	if p := decimal.RequireFromString(w.Payables).StringFixed(0); p != "700" {
		t.Fatalf("pending paid claim should leave 700 owed, got %s", p)
	}

	// Rejected → undo puts the money back and removes the expense.
	if _, err := e.repay.Reject(e.ctx, lender, claimed.ID, repayments.RejectInput{Reason: "not received"}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.repay.Resolve(e.ctx, borrower, claimed.ID, repayments.ResolveUndoExpense); err != nil {
		t.Fatal(err)
	}
	if got := e.balance(t, borrower, acct); got != "2000" || e.entryCount(t, borrower) != 0 {
		t.Fatalf("undo: balance %s entries %d", got, e.entryCount(t, borrower))
	}
}

func TestNetWorthLenderReceivesIntoAccount(t *testing.T) {
	e := newNetWorthEnv(t)
	lender, borrower := e.user(t), e.user(t)
	lenderAcct := e.account(t, lender, accounts.TypeBank, "0")
	loanID := e.peerLoan(t, lender, borrower, "1000")
	amt := "400"

	claimed, err := e.repay.Claim(e.ctx, borrower, loanID, repayments.ClaimInput{Amount: &amt})
	if err != nil {
		t.Fatal(err)
	}
	out, err := e.repay.Confirm(e.ctx, lender, claimed.ID, repayments.ConfirmInput{ReceivedAccountID: &lenderAcct})
	if err != nil {
		t.Fatal(err)
	}
	if out.ReceivedEntryID == nil || e.balance(t, lender, lenderAcct) != "400" {
		t.Fatalf("%+v balance %s", out, e.balance(t, lender, lenderAcct))
	}
	w, _ := e.accounts.Wealth(e.ctx, lender, "ETB")
	if n := decimal.RequireFromString(w.NetWorth).StringFixed(0); n != "1000" {
		t.Fatalf("net worth %s, want 400 cash + 600 owed = 1000", n)
	}
	if _, err := e.repay.Confirm(e.ctx, lender, claimed.ID, repayments.ConfirmInput{}); err == nil {
		t.Fatal("double confirm must fail")
	}
}

func TestNetWorthInstitutionalDebtOnCard(t *testing.T) {
	e := newNetWorthEnv(t)
	me := e.user(t)
	bank := e.account(t, me, accounts.TypeBank, "5000")
	card := e.account(t, me, accounts.TypeCreditCard, "3000")
	label := "CBE"
	etb, principal, zero := "ETB", "3000", "0"
	months := int32(3)
	plan, err := e.loans.Create(e.ctx, me, loans.CreateInput{
		Role: loans.RoleBorrower, Principal: &principal, CurrencyCode: &etb, InterestRatePercent: &zero,
		InstitutionLabel: &label, InstallmentCount: &months, LinkedAccountID: &card,
	})
	if err != nil {
		t.Fatal(err)
	}
	w, _ := e.accounts.Wealth(e.ctx, me, "ETB")
	if p := decimal.RequireFromString(w.Payables).StringFixed(0); p != "3000" {
		t.Fatalf("card debt counted twice: payables %s", p)
	}

	// Paying the self-recorded debt confirms at once (nobody else to confirm).
	amt := "1000"
	out, err := e.repay.Claim(e.ctx, me, plan.ID, repayments.ClaimInput{Amount: &amt, PayFromAccountID: &bank})
	if err != nil {
		t.Fatal(err)
	}
	if out.Status != repayments.StatusConfirmed || e.balance(t, me, bank) != "4000" {
		t.Fatalf("%+v balance %s", out, e.balance(t, me, bank))
	}
}
