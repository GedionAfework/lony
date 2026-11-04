package store

import (
	"context"
	"testing"
	"time"

	"equilend/api/internal/accounts"
	"equilend/api/internal/expenses"
	"equilend/api/internal/loans"

	"github.com/google/uuid"
)

func newCashflowSvc(e netWorthEnv) *expenses.Service {
	svc := expenses.NewService(expenses.SQLStoreAdapter{Inner: e.store})
	svc.SetAccounts(e.accounts)
	return svc
}

func spend(t *testing.T, svc *expenses.Service, user, acct uuid.UUID, amount string) expenses.EntryDTO {
	t.Helper()
	out, err := svc.Create(context.Background(), user, expenses.CreateInput{
		Kind: "expense", Title: "Lunch", Amount: amount, CurrencyCode: "ETB", Category: "Food", AccountID: &acct,
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestCashflowDeleteAndEditMoveBalance(t *testing.T) {
	e := newNetWorthEnv(t)
	svc := newCashflowSvc(e)
	me := e.user(t)
	bank := e.account(t, me, accounts.TypeBank, "1000")
	cash := e.account(t, me, accounts.TypeCash, "100")

	lunch := spend(t, svc, me, bank, "200")
	if got := e.balance(t, me, bank); got != "800" {
		t.Fatalf("after spend %s", got)
	}

	// Edit the amount: the balance follows.
	amt := "250"
	if _, err := svc.Update(e.ctx, me, lunch.ID, expenses.UpdateInput{Amount: &amt}); err != nil {
		t.Fatal(err)
	}
	if got := e.balance(t, me, bank); got != "750" {
		t.Fatalf("after edit %s", got)
	}
	// Move it to another account: money goes back to bank, out of cash.
	if _, err := svc.Update(e.ctx, me, lunch.ID, expenses.UpdateInput{AccountID: &cash}); err != nil {
		t.Fatal(err)
	}
	if b, c := e.balance(t, me, bank), e.balance(t, me, cash); b != "1000" || c != "-150" {
		t.Fatalf("after move bank %s cash %s", b, c)
	}
	// A title-only edit touches no money.
	title := "Team lunch"
	if _, err := svc.Update(e.ctx, me, lunch.ID, expenses.UpdateInput{Title: &title}); err != nil {
		t.Fatal(err)
	}
	if c := e.balance(t, me, cash); c != "-150" {
		t.Fatalf("title edit moved money: %s", c)
	}
	// Delete: the money comes back.
	if err := svc.Delete(e.ctx, me, lunch.ID); err != nil {
		t.Fatal(err)
	}
	if c := e.balance(t, me, cash); c != "100" {
		t.Fatalf("after delete %s", c)
	}

	// Applying twice (a retried request) changes the balance once.
	coffee := spend(t, svc, me, bank, "50")
	if err := e.store.ApplyEntryBalance(e.ctx, me, coffee.ID, nil); err != nil {
		t.Fatal(err)
	}
	if got := e.balance(t, me, bank); got != "950" {
		t.Fatalf("double apply: %s", got)
	}
}

// After the user states the real balance, older entries are part of that number; deleting
// one of them must not change the balance the user typed in.
func TestCashflowDeleteAfterStatedBalanceKeepsIt(t *testing.T) {
	e := newNetWorthEnv(t)
	svc := newCashflowSvc(e)
	me := e.user(t)
	bank := e.account(t, me, accounts.TypeBank, "1000")

	dup := spend(t, svc, me, bank, "300")
	time.Sleep(10 * time.Millisecond)
	if _, err := e.accounts.SetBalance(e.ctx, me, bank, accounts.SetBalanceInput{Balance: "900"}); err != nil {
		t.Fatal(err)
	}
	if err := svc.Delete(e.ctx, me, dup.ID); err != nil {
		t.Fatal(err)
	}
	if got := e.balance(t, me, bank); got != "900" {
		t.Fatalf("stated balance changed: %s", got)
	}
}

type recordingHooks struct{ rejected []uuid.UUID }

func (h *recordingHooks) AfterCreate(context.Context, loans.Record) error { return nil }
func (h *recordingHooks) AfterAccept(context.Context, loans.Record) error { return nil }
func (h *recordingHooks) AfterReject(_ context.Context, loan loans.Record, _ uuid.UUID) error {
	if loan.SourceEntryID != nil {
		h.rejected = append(h.rejected, *loan.SourceEntryID)
	}
	return nil
}

func TestDeclinedShareFlow(t *testing.T) {
	e := newNetWorthEnv(t)
	hooks := &recordingHooks{}
	e.loans.SetHooks(hooks)
	svc := newCashflowSvc(e)
	svc.SetLoans(e.loans)
	payer, friend := e.user(t), e.user(t)
	bank := e.account(t, payer, accounts.TypeBank, "1000")

	dinner := spend(t, svc, payer, bank, "400")
	half := "200"
	_, share, err := svc.Share(e.ctx, payer, dinner.ID, expenses.ShareInput{FriendID: friend, ShareAmount: &half})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.loans.Reject(e.ctx, friend, share.ID); err != nil {
		t.Fatal(err)
	}
	if len(hooks.rejected) != 1 || hooks.rejected[0] != dinner.ID {
		t.Fatalf("payer not told: %+v", hooks.rejected)
	}

	declined, err := svc.DeclinedShares(e.ctx, payer)
	if err != nil || len(declined) != 1 || declined[0].EntryID != dinner.ID || declined[0].Friend.ID != friend {
		t.Fatalf("%v %+v", err, declined)
	}
	if other, _ := svc.DeclinedShares(e.ctx, friend); len(other) != 0 {
		t.Fatalf("friend should see nothing: %+v", other)
	}

	again, err := svc.ResolveDeclinedShare(e.ctx, payer, share.ID, expenses.DeclinedAskAgain)
	if err != nil || again == nil || again.Status != loans.StatusPending || *again.Principal != "200.0000" {
		t.Fatalf("%v %+v", err, again)
	}
	if left, _ := svc.DeclinedShares(e.ctx, payer); len(left) != 0 {
		t.Fatalf("still listed: %+v", left)
	}
	if _, err := svc.ResolveDeclinedShare(e.ctx, payer, share.ID, expenses.DeclinedKeepCost); err == nil {
		t.Fatal("answering twice must fail")
	}

	// Declined again → keep the full cost; the expense already counts all 400.
	if _, err := e.loans.Reject(e.ctx, friend, again.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ResolveDeclinedShare(e.ctx, payer, again.ID, expenses.DeclinedKeepCost); err != nil {
		t.Fatal(err)
	}
	if left, _ := svc.DeclinedShares(e.ctx, payer); len(left) != 0 || e.balance(t, payer, bank) != "600" {
		t.Fatalf("left %+v balance %s", left, e.balance(t, payer, bank))
	}
}

func TestSplitExpenseListsEveryShare(t *testing.T) {
	e := newNetWorthEnv(t)
	svc := newCashflowSvc(e)
	svc.SetLoans(e.loans)
	payer, sara, abel := e.user(t), e.user(t), e.user(t)
	bank := e.account(t, payer, accounts.TypeBank, "1000")
	dinner := spend(t, svc, payer, bank, "900")
	third := "300"
	for _, friend := range []uuid.UUID{sara, abel} {
		if _, _, err := svc.Share(e.ctx, payer, dinner.ID, expenses.ShareInput{FriendID: friend, ShareAmount: &third}); err != nil {
			t.Fatal(err)
		}
	}
	rows, err := svc.List(e.ctx, payer, expenses.ListQuery{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range rows {
		if r.ID == dinner.ID {
			if len(r.SharedWith) != 2 {
				t.Fatalf("want both friends' shares, got %+v", r.SharedWith)
			}
			return
		}
	}
	t.Fatal("expense not listed")
}
