package insights

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

const Scale = 2

type MonthPoint struct {
	Month        string `json:"month"` // YYYY-MM
	CurrencyCode string `json:"currency_code"`
	Income       string `json:"income"`
	Expense      string `json:"expense"`
	Net          string `json:"net"`
}

type CategoryPoint struct {
	Category     string  `json:"category"`
	CurrencyCode string  `json:"currency_code"`
	Amount       string  `json:"amount"`
	Count        int     `json:"count"`
	SharePercent float64 `json:"share_percent"`
}

type Overview struct {
	CurrencyCode       string  `json:"currency_code"`
	PeriodFrom         string  `json:"period_from"`
	PeriodTo           string  `json:"period_to"`
	Income             string  `json:"income"`
	Expense            string  `json:"expense"`
	Net                string  `json:"net"`
	SavingsRatePercent *float64 `json:"savings_rate_percent,omitempty"`
	PrevIncome         string  `json:"prev_income"`
	PrevExpense        string  `json:"prev_expense"`
	IncomeMoMPercent   *float64 `json:"income_mom_percent,omitempty"`
	ExpenseMoMPercent  *float64 `json:"expense_mom_percent,omitempty"`
	OpenReceivables    string  `json:"open_receivables"`
	OpenPayables       string  `json:"open_payables"`
	DebtServiceRatio   *float64 `json:"debt_service_ratio,omitempty"`
	ActiveGoals        int     `json:"active_goals"`
	GoalsProgressAvg   *float64 `json:"goals_progress_avg,omitempty"`
	GoalsFunded        string  `json:"goals_funded"`
	GoalsTarget        string  `json:"goals_target"`
}

type DebtSlice struct {
	CurrencyCode string `json:"currency_code"`
	Receivables  string `json:"receivables"`
	Payables     string `json:"payables"`
	Net          string `json:"net"`
	OpenCount    int    `json:"open_count"`
}

type DebtsSummary struct {
	PreferredCurrency string      `json:"preferred_currency,omitempty"`
	Receivables       string      `json:"receivables"`
	Payables          string      `json:"payables"`
	Net               string      `json:"net"`
	DebtServiceRatio  *float64    `json:"debt_service_ratio,omitempty"`
	ByCurrency        []DebtSlice `json:"by_currency"`
}

type GoalInsight struct {
	ID              uuid.UUID `json:"id"`
	Title           string    `json:"title"`
	GoalType        string    `json:"goal_type"`
	CurrencyCode    string    `json:"currency_code"`
	TargetAmount    string    `json:"target_amount"`
	CurrentAmount   string    `json:"current_amount"`
	ProgressPercent float64   `json:"progress_percent"`
	Status          string    `json:"status"`
	ETAMonths       *int      `json:"eta_months,omitempty"`
}

type CashflowTotals struct {
	Income  decimal.Decimal
	Expense decimal.Decimal
}

type MonthlyRow struct {
	Month        time.Time
	CurrencyCode string
	Income       decimal.Decimal
	Expense      decimal.Decimal
}

type CategoryRow struct {
	Category     string
	CurrencyCode string
	Amount       decimal.Decimal
	Count        int
}

type Store interface {
	CashflowTotals(ctx context.Context, userID uuid.UUID, from, to time.Time, currency string) (CashflowTotals, error)
	CashflowSeries(ctx context.Context, userID uuid.UUID, from time.Time, currency string) ([]MonthlyRow, error)
	CategorySpend(ctx context.Context, userID uuid.UUID, from, to time.Time, currency string) ([]CategoryRow, error)
}
