package accounts

import (
	"context"
	"testing"
	"time"

	"equilend/api/internal/loans"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
)

type wealthStore struct {
	Store
	rows []Account // active accounts, as List returns them
	all  []Account // every account, as Get sees them
}

func (w wealthStore) List(context.Context, uuid.UUID, bool) ([]Account, error) {
	return w.rows, nil
}

type wealthLoans []loans.Record

func (w wealthLoans) AllForUser(context.Context, uuid.UUID) ([]loans.Record, error) {
	return w, nil
}

// A partially repaid loan must count only what is still owed; the repaid part
// already sits in the lender's account balance.
func TestWealthUsesRemainingNotExpectedTotal(t *testing.T) {
	me, peer := uuid.New(), uuid.New()
	etb := "ETB"
	dec := func(s string) *decimal.Decimal { d := decimal.RequireFromString(s); return &d }

	svc := NewService(wealthStore{rows: []Account{
		{ID: uuid.New(), UserID: me, AccountType: TypeBank, CurrencyCode: "ETB", Balance: decimal.RequireFromString("1400")},
		{ID: uuid.New(), UserID: me, AccountType: TypeCreditCard, CurrencyCode: "ETB", Balance: decimal.RequireFromString("100")},
	}})
	svc.SetLoans(wealthLoans{
		// I lent 1000; 400 has been repaid and confirmed (now in my bank balance).
		{ID: uuid.New(), LenderID: me, BorrowerID: peer, Status: loans.StatusActive, CurrencyCode: &etb,
			ExpectedTotal: dec("1000"), OutstandingAmount: dec("600")},
		// I borrowed 500; 200 paid via installments.
		{ID: uuid.New(), LenderID: peer, BorrowerID: me, Status: loans.StatusActive, CurrencyCode: &etb,
			ExpectedTotal: dec("500"), OutstandingAmount: dec("300")},
	})

	got, err := svc.Wealth(context.Background(), me, "ETB")
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"cash": "1400", "recv": "600", "pay": "400", "net": "1600"} // pay = 300 loan + 100 card
	check := func(name, val string) {
		if !decimal.RequireFromString(val).Equal(decimal.RequireFromString(want[name])) {
			t.Fatalf("%s = %s, want %s", name, val, want[name])
		}
	}
	check("cash", got.CashOnHand)
	check("recv", got.Receivables)
	check("pay", got.Payables)
	check("net", got.NetWorth)
}

func (w wealthStore) Get(_ context.Context, userID, id uuid.UUID) (Account, error) {
	for _, a := range w.all {
		if a.ID == id && a.UserID == userID {
			return a, nil
		}
	}
	return Account{}, pgx.ErrNoRows
}

func netOf(t *testing.T, svc *Service, me uuid.UUID) (pay, net string) {
	t.Helper()
	got, err := svc.Wealth(context.Background(), me, "ETB")
	if err != nil {
		t.Fatal(err)
	}
	return decimal.RequireFromString(got.Payables).StringFixed(0), decimal.RequireFromString(got.NetWorth).StringFixed(0)
}

// While the lender has not confirmed, a payment already taken from the borrower's
// account must not also stay in what the borrower owes.
func TestWealthPendingPaidClaimCountsOnce(t *testing.T) {
	me, peer := uuid.New(), uuid.New()
	etb := "ETB"
	dec := func(s string) *decimal.Decimal { d := decimal.RequireFromString(s); return &d }
	acct := Account{ID: uuid.New(), UserID: me, AccountType: TypeBank, CurrencyCode: "ETB", Balance: decimal.RequireFromString("700")}
	borrowed := loans.Record{ID: uuid.New(), LenderID: peer, BorrowerID: me, Status: loans.StatusRepaymentPending, CurrencyCode: &etb,
		ExpectedTotal: dec("1000"), OutstandingAmount: dec("1000"), PendingPaid: dec("300")}

	svc := NewService(wealthStore{rows: []Account{acct}})
	svc.SetLoans(wealthLoans{borrowed})
	if pay, net := netOf(t, svc, me); pay != "700" || net != "0" {
		t.Fatalf("borrower pay %s net %s, want 700 / 0", pay, net)
	}

	// The lender still sees the full 1000 until they confirm receipt.
	lenderSvc := NewService(wealthStore{})
	lenderSvc.SetLoans(wealthLoans{borrowed})
	got, _ := lenderSvc.Wealth(context.Background(), peer, "ETB")
	if !decimal.RequireFromString(got.Receivables).Equal(decimal.RequireFromString("1000")) {
		t.Fatalf("lender receivables %s", got.Receivables)
	}

	// A claim without a recorded expense is not subtracted.
	borrowed.PendingPaid = nil
	svc.SetLoans(wealthLoans{borrowed})
	if pay, _ := netOf(t, svc, me); pay != "1000" {
		t.Fatalf("pay %s", pay)
	}
}

func TestWealthSkipsDebtLinkedToActiveCard(t *testing.T) {
	me := uuid.New()
	etb := "ETB"
	dec := func(s string) *decimal.Decimal { d := decimal.RequireFromString(s); return &d }
	card := Account{ID: uuid.New(), UserID: me, AccountType: TypeCreditCard, CurrencyCode: "ETB", Balance: decimal.RequireFromString("4000")}
	cash := Account{ID: uuid.New(), UserID: me, AccountType: TypeCash, CurrencyCode: "ETB", Balance: decimal.RequireFromString("5000")}
	plan := loans.Record{ID: uuid.New(), LenderID: me, BorrowerID: me, PartyMode: loans.PartyAlone, Status: loans.StatusActive,
		CurrencyCode: &etb, ExpectedTotal: dec("3000"), OutstandingAmount: dec("3000"), LinkedAccountID: &card.ID}

	svc := NewService(wealthStore{rows: []Account{cash, card}})
	svc.SetLoans(wealthLoans{plan})
	if pay, net := netOf(t, svc, me); pay != "4000" || net != "1000" {
		t.Fatalf("pay %s net %s, want 4000 / 1000", pay, net)
	}

	// Card archived: its balance is gone from net worth, so the debt counts again.
	svc = NewService(wealthStore{rows: []Account{cash}})
	svc.SetLoans(wealthLoans{plan})
	if pay, _ := netOf(t, svc, me); pay != "3000" {
		t.Fatalf("pay %s, want 3000", pay)
	}
}

func TestCardLinkingAndDuplicates(t *testing.T) {
	me, other := uuid.New(), uuid.New()
	etb := "ETB"
	cbe := "Commercial Bank of Ethiopia"
	dec := func(s string) *decimal.Decimal { d := decimal.RequireFromString(s); return &d }
	card := Account{ID: uuid.New(), UserID: me, Name: "CBE Visa", InstitutionLabel: &cbe, AccountType: TypeCreditCard, CurrencyCode: "ETB"}
	usdCard := Account{ID: uuid.New(), UserID: me, Name: "CBE Dollar card", AccountType: TypeCreditCard, CurrencyCode: "USD"}
	bank := Account{ID: uuid.New(), UserID: me, Name: "CBE savings", AccountType: TypeBank, CurrencyCode: "ETB"}
	archived := Account{ID: uuid.New(), UserID: me, Name: "Old CBE card", AccountType: TypeCreditCard, CurrencyCode: "ETB", ArchivedAt: &time.Time{}}
	theirs := Account{ID: uuid.New(), UserID: other, Name: "CBE card", AccountType: TypeCreditCard, CurrencyCode: "ETB"}
	store := wealthStore{rows: []Account{card, usdCard, bank}, all: []Account{card, usdCard, bank, archived, theirs}}
	svc := NewService(store)
	ctx := context.Background()

	if err := svc.CheckCardForDebt(ctx, me, card.ID, "etb"); err != nil {
		t.Fatalf("own card: %v", err)
	}
	for name, id := range map[string]uuid.UUID{"bank": bank.ID, "usd": usdCard.ID, "archived": archived.ID, "theirs": theirs.ID} {
		if err := svc.CheckCardForDebt(ctx, me, id, "ETB"); err == nil {
			t.Errorf("%s: want error", name)
		}
	}

	matches, _ := svc.DebtMatches(ctx, me, "CBE", "ETB")
	if len(matches) != 1 || matches[0].ID != card.ID {
		t.Fatalf("matches %+v", matches)
	}
	if none, _ := svc.DebtMatches(ctx, me, "Awash", "ETB"); len(none) != 0 {
		t.Fatalf("Awash should not match: %+v", none)
	}

	short := "CBE"
	open := loans.Record{ID: uuid.New(), LenderID: me, BorrowerID: me, PartyMode: loans.PartyAlone, Status: loans.StatusActive,
		CurrencyCode: &etb, ExpectedTotal: dec("900"), OutstandingAmount: dec("900"), InstitutionLabel: &short}
	linked := open
	linked.ID = uuid.New()
	linked.LinkedAccountID = &card.ID
	dismissed := open
	dismissed.ID = uuid.New()
	dismissed.AccountLinkDismissed = true
	svc.SetLoans(wealthLoans{open, linked, dismissed})
	dups, err := svc.PossibleDuplicates(ctx, me)
	if err != nil {
		t.Fatal(err)
	}
	if len(dups) != 1 || dups[0].LoanID != open.ID || len(dups[0].Cards) != 1 {
		t.Fatalf("dups %+v", dups)
	}
}

type wealthRates struct{}

// 1 USD = 50 ETB.
func (wealthRates) Rates(_ context.Context, base string) (map[string]decimal.Decimal, time.Time, error) {
	return map[string]decimal.Decimal{"ETB": decimal.NewFromInt(1), "USD": decimal.RequireFromString("0.02")}, time.Now(), nil
}

func TestWealthAddsAllCurrencies(t *testing.T) {
	me := uuid.New()
	svc := NewService(wealthStore{rows: []Account{
		{ID: uuid.New(), UserID: me, AccountType: TypeBank, CurrencyCode: "ETB", Balance: decimal.RequireFromString("10000")},
		{ID: uuid.New(), UserID: me, AccountType: TypeBank, CurrencyCode: "USD", Balance: decimal.RequireFromString("100")},
		{ID: uuid.New(), UserID: me, AccountType: TypeBank, CurrencyCode: "XYZ", Balance: decimal.RequireFromString("7")},
	}})
	svc.SetFX(wealthRates{})
	got, err := svc.Wealth(context.Background(), me, "ETB")
	if err != nil {
		t.Fatal(err)
	}
	if !got.Converted || got.PreferredCurrency != "ETB" {
		t.Fatalf("%+v", got)
	}
	// 10,000 ETB + 100 USD (5,000 ETB); XYZ has no rate and is named, not guessed.
	if !decimal.RequireFromString(got.NetWorth).Equal(decimal.NewFromInt(15000)) {
		t.Fatalf("net worth %s, want 15000", got.NetWorth)
	}
	if len(got.MissingRates) != 1 || got.MissingRates[0] != "XYZ" {
		t.Fatalf("missing %v", got.MissingRates)
	}
}
