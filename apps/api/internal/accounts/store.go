package accounts

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

const (
	TypeCash        = "cash"
	TypeBank        = "bank"
	TypeMobileMoney = "mobile_money"
	TypeWallet      = "wallet"
	TypeOther       = "other"

	CompoundNone    = "none"
	CompoundMonthly = "monthly"
	CompoundYearly  = "yearly"

	Scale = 2
)

type Account struct {
	ID                   uuid.UUID
	UserID               uuid.UUID
	Name                 string
	AccountType          string
	CurrencyCode         string
	Balance              decimal.Decimal
	BalanceAsOf          time.Time
	InterestRatePercent  *decimal.Decimal
	Compounding          *string
	InstitutionLabel     *string
	BankProfileID        *uuid.UUID
	ArchivedAt           *time.Time
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

type AccountDTO struct {
	ID                  uuid.UUID  `json:"id"`
	Name                string     `json:"name"`
	AccountType         string     `json:"account_type"`
	CurrencyCode        string     `json:"currency_code"`
	Balance             string     `json:"balance"`
	BalanceAsOf         time.Time  `json:"balance_as_of"`
	InterestRatePercent *string    `json:"interest_rate_percent,omitempty"`
	Compounding         *string    `json:"compounding,omitempty"`
	InstitutionLabel    *string    `json:"institution_label,omitempty"`
	BankProfileID       *uuid.UUID `json:"bank_profile_id,omitempty"`
	ProjectedBalance12m *string    `json:"projected_balance_12m,omitempty"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
}

type BalanceEvent struct {
	ID        uuid.UUID
	AccountID uuid.UUID
	UserID    uuid.UUID
	Balance   decimal.Decimal
	Source    string
	Note      *string
	CreatedAt time.Time
}

type CreateInput struct {
	Name                string
	AccountType         string
	CurrencyCode        string
	Balance             string
	InterestRatePercent *string
	Compounding         *string
	InstitutionLabel    *string
	BankProfileID       *uuid.UUID
}

type UpdateInput struct {
	Name                *string
	AccountType         *string
	CurrencyCode        *string
	InterestRatePercent *string
	Compounding         *string
	InstitutionLabel    *string
	BankProfileID       *uuid.UUID
	ClearInterest       bool
}

type SetBalanceInput struct {
	Balance string
	Note    *string
}

type CurrencySlice struct {
	CurrencyCode string `json:"currency_code"`
	CashOnHand   string `json:"cash_on_hand"`
	Receivables  string `json:"receivables"`
	Payables     string `json:"payables"`
	NetWorth     string `json:"net_worth"`
	AccountCount int    `json:"account_count"`
}

type WealthSummary struct {
	PreferredCurrency string          `json:"preferred_currency,omitempty"`
	CashOnHand        string          `json:"cash_on_hand"`
	Receivables       string          `json:"receivables"`
	Payables          string          `json:"payables"`
	NetWorth          string          `json:"net_worth"`
	ByCurrency        []CurrencySlice `json:"by_currency"`
	Accounts          []AccountDTO    `json:"accounts"`
}

type TransferInput struct {
	FromAccountID uuid.UUID
	ToAccountID   uuid.UUID
	Amount        string
	Note          *string
	OccurredAt    *time.Time
}

type TransferDTO struct {
	ID            uuid.UUID `json:"id"`
	FromAccountID uuid.UUID `json:"from_account_id"`
	ToAccountID   uuid.UUID `json:"to_account_id"`
	Amount        string    `json:"amount"`
	CurrencyCode  string    `json:"currency_code"`
	Note          *string   `json:"note,omitempty"`
	OccurredAt    time.Time `json:"occurred_at"`
}

// ReconcileDTO compares the stated balance to ledger activity since the last manual set.
type ReconcileDTO struct {
	AccountID            uuid.UUID `json:"account_id"`
	AccountName          string    `json:"account_name"`
	CurrencyCode         string    `json:"currency_code"`
	StatedBalance        string    `json:"stated_balance"`
	ExpectedBalance      string    `json:"expected_balance"`
	Difference           string    `json:"difference"` // stated - expected
	InSync               bool      `json:"in_sync"`
	BaselineBalance      string    `json:"baseline_balance"`
	BaselineAt           time.Time `json:"baseline_at"`
	IncomeSince          string    `json:"income_since"`
	ExpenseSince         string    `json:"expense_since"`
	TransfersInSince     string    `json:"transfers_in_since"`
	TransfersOutSince    string    `json:"transfers_out_since"`
	UnassignedConfirmed  string    `json:"unassigned_confirmed"` // same-currency confirmed cashflow with no account
}

type LedgerSlice struct {
	BaselineBalance     decimal.Decimal
	BaselineAt          time.Time
	Income              decimal.Decimal
	Expense             decimal.Decimal
	TransfersIn         decimal.Decimal
	TransfersOut        decimal.Decimal
	UnassignedConfirmed decimal.Decimal
}

type Store interface {
	Insert(ctx context.Context, rec Account, event BalanceEvent) (Account, error)
	Get(ctx context.Context, userID, id uuid.UUID) (Account, error)
	List(ctx context.Context, userID uuid.UUID, includeArchived bool) ([]Account, error)
	Update(ctx context.Context, rec Account) (Account, error)
	SetBalance(ctx context.Context, rec Account, event BalanceEvent) (Account, error)
	Archive(ctx context.Context, userID, id uuid.UUID, at time.Time) error
	AdjustBalance(ctx context.Context, userID, accountID uuid.UUID, delta decimal.Decimal, note string, at time.Time) (Account, error)
	Transfer(ctx context.Context, userID, fromID, toID uuid.UUID, amount decimal.Decimal, currency, note string, occurredAt, now time.Time) (uuid.UUID, error)
	LedgerSince(ctx context.Context, userID, accountID uuid.UUID, currency string) (LedgerSlice, error)
}

func toDTO(rec Account) AccountDTO {
	dto := AccountDTO{
		ID:               rec.ID,
		Name:             rec.Name,
		AccountType:      rec.AccountType,
		CurrencyCode:     rec.CurrencyCode,
		Balance:          rec.Balance.StringFixed(Scale),
		BalanceAsOf:      rec.BalanceAsOf,
		Compounding:      rec.Compounding,
		InstitutionLabel: rec.InstitutionLabel,
		BankProfileID:    rec.BankProfileID,
		CreatedAt:        rec.CreatedAt,
		UpdatedAt:        rec.UpdatedAt,
	}
	if rec.InterestRatePercent != nil {
		s := rec.InterestRatePercent.StringFixed(4)
		dto.InterestRatePercent = &s
	}
	if proj := project12m(rec); proj != nil {
		s := proj.StringFixed(Scale)
		dto.ProjectedBalance12m = &s
	}
	return dto
}

// project12m returns balance after 12 months of interest, or nil if no rate.
func project12m(rec Account) *decimal.Decimal {
	if rec.InterestRatePercent == nil || !rec.InterestRatePercent.GreaterThan(decimal.Zero) {
		return nil
	}
	rate := rec.InterestRatePercent.Div(decimal.NewFromInt(100))
	comp := CompoundNone
	if rec.Compounding != nil && *rec.Compounding != "" {
		comp = *rec.Compounding
	}
	var fv decimal.Decimal
	switch comp {
	case CompoundMonthly:
		// (1 + r/12)^12
		monthly := rate.Div(decimal.NewFromInt(12))
		factor := decimal.NewFromInt(1).Add(monthly)
		pow := decimal.NewFromInt(1)
		for i := 0; i < 12; i++ {
			pow = pow.Mul(factor)
		}
		fv = rec.Balance.Mul(pow)
	case CompoundYearly:
		fv = rec.Balance.Mul(decimal.NewFromInt(1).Add(rate))
	default:
		// Simple interest over one year
		fv = rec.Balance.Mul(decimal.NewFromInt(1).Add(rate))
	}
	rounded := fv.Round(Scale)
	return &rounded
}
