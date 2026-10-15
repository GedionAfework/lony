package expenses

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

const (
	KindIncome  = "income"
	KindExpense = "expense"
	Scale       = 2

	RecurrenceWeekly  = "weekly"
	RecurrenceMonthly = "monthly"
	RecurrenceYearly  = "yearly"

	StatusExpected  = "expected"
	StatusConfirmed = "confirmed"
	StatusSkipped   = "skipped"
)

type Category struct {
	ID       uuid.UUID
	UserID   *uuid.UUID
	Kind     string
	Name     string
	Slug     string
	IsSystem bool
	Active   bool
}

type CategoryDTO struct {
	ID       uuid.UUID `json:"id"`
	Kind     string    `json:"kind"`
	Name     string    `json:"name"`
	Slug     string    `json:"slug"`
	IsSystem bool      `json:"is_system"`
	Active   bool      `json:"active,omitempty"`
}

type Entry struct {
	ID               uuid.UUID
	UserID           uuid.UUID
	Kind             string
	Title            string
	Amount           decimal.Decimal
	CurrencyCode     string
	Category         string
	CategoryID       *uuid.UUID
	Note             *string
	OccurredAt       time.Time
	IsTemplate       bool
	Recurrence       *string
	NextOccurrenceAt *time.Time
	TemplateID       *uuid.UUID
	LinkedLoanID     *uuid.UUID
	AccountID        *uuid.UUID
	SplitGroupID     *uuid.UUID
	TripID           *uuid.UUID
	Status           string
	Paused           bool
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

type EntryDTO struct {
	ID               uuid.UUID  `json:"id"`
	Kind             string     `json:"kind"`
	Title            string     `json:"title"`
	Amount           string     `json:"amount"`
	CurrencyCode     string     `json:"currency_code"`
	Category         string     `json:"category"`
	CategoryID       *uuid.UUID `json:"category_id,omitempty"`
	Note             *string    `json:"note,omitempty"`
	OccurredAt       time.Time  `json:"occurred_at"`
	IsTemplate       bool       `json:"is_template"`
	Recurrence       *string    `json:"recurrence,omitempty"`
	NextOccurrenceAt *time.Time `json:"next_occurrence_at,omitempty"`
	TemplateID       *uuid.UUID `json:"template_id,omitempty"`
	LinkedLoanID     *uuid.UUID `json:"linked_loan_id,omitempty"`
	AccountID        *uuid.UUID `json:"account_id,omitempty"`
	SplitGroupID     *uuid.UUID `json:"split_group_id,omitempty"`
	TripID           *uuid.UUID `json:"trip_id,omitempty"`
	Status           string     `json:"status"`
	Paused           bool       `json:"paused"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

type SummarySlice struct {
	CurrencyCode string `json:"currency_code"`
	Income       string `json:"income"`
	Expense      string `json:"expense"`
	Outcome      string `json:"outcome"` // alias for older clients
	Net          string `json:"net"`
	IncomeCount  int    `json:"income_count"`
	ExpenseCount int    `json:"expense_count"`
	OutcomeCount int    `json:"outcome_count"`
}

type Summary struct {
	From       *time.Time     `json:"from,omitempty"`
	To         *time.Time     `json:"to,omitempty"`
	ByCurrency []SummarySlice `json:"by_currency"`
}

type ListQuery struct {
	Kind      string
	From      *time.Time
	To        *time.Time
	Currency  string
	Templates *bool
	Limit     int
}

type CalendarBucket struct {
	Day          time.Time
	Income       decimal.Decimal
	Expense      decimal.Decimal
	IncomeCount  int
	ExpenseCount int
}

type CalendarDayDTO struct {
	Date         string `json:"date"`
	Income       string `json:"income"`
	Expense      string `json:"expense"`
	Net          string `json:"net"`
	IncomeCount  int    `json:"income_count"`
	ExpenseCount int    `json:"expense_count"`
	Heat         int    `json:"heat"`
}

type CalendarDTO struct {
	From         string           `json:"from"`
	To           string           `json:"to"`
	CurrencyCode string           `json:"currency_code"`
	Timezone     string           `json:"timezone"`
	MaxExpense   string           `json:"max_expense"`
	Days         []CalendarDayDTO `json:"days"`
}

type CreateInput struct {
	Kind             string
	Title            string
	Amount           string
	CurrencyCode     string
	Category         string
	CategoryID       *uuid.UUID
	AccountID        *uuid.UUID
	Note             *string
	OccurredAt       time.Time
	Recurrence       *string
	IsTemplate       bool
	SkipAccountDelta bool // SMS already carries the bank-stated remaining balance
	Legs             []SplitLegInput
	TripID           *uuid.UUID
}

type SplitLegInput struct {
	Amount     string
	Title      string
	Category   string
	CategoryID *uuid.UUID
	AccountID  *uuid.UUID
}

type UpdateInput struct {
	Title        *string
	Amount       *string
	CurrencyCode *string
	Category     *string
	CategoryID   *uuid.UUID
	AccountID    *uuid.UUID
	Note         *string
	OccurredAt   *time.Time
	Recurrence   *string
	TripID       *uuid.UUID
	ClearTrip    bool
}

type ShareInput struct {
	FriendID     uuid.UUID
	SharePercent *float64
	ShareAmount  *string
	DueAt        *time.Time
}

type CategorySpend struct {
	Category     string     `json:"category"`
	CategoryID   *uuid.UUID `json:"category_id,omitempty"`
	CurrencyCode string     `json:"currency_code"`
	Amount       string     `json:"amount"`
	Count        int        `json:"count"`
}

type Budget struct {
	ID           uuid.UUID
	UserID       uuid.UUID
	CategoryID   *uuid.UUID
	CategoryName string
	CurrencyCode string
	LimitAmount  decimal.Decimal
	PeriodMonth  time.Time
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

type BudgetDTO struct {
	ID           uuid.UUID  `json:"id"`
	CategoryID   *uuid.UUID `json:"category_id,omitempty"`
	CategoryName string     `json:"category_name"`
	CurrencyCode string     `json:"currency_code"`
	LimitAmount  string     `json:"limit_amount"`
	PeriodMonth  string     `json:"period_month"`
	Spent        string     `json:"spent"`
	Remaining    string     `json:"remaining"`
	CycleStart   string     `json:"cycle_start,omitempty"`
	CycleEnd     string     `json:"cycle_end,omitempty"`
	PacePct      int        `json:"pace_pct"`
	PaceAmount   string     `json:"pace_amount,omitempty"`
	SpentPct     int        `json:"spent_pct"`
	Ahead        bool       `json:"ahead"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

type PaydaySettings struct {
	UserID       uuid.UUID
	PaydayDay    *int
	SpendLimit   *decimal.Decimal
	CurrencyCode *string
	UpdatedAt    time.Time
}

type PaydayDTO struct {
	PaydayDay    *int    `json:"payday_day,omitempty"`
	Source       string  `json:"source"`
	CycleStart   string  `json:"cycle_start"`
	CycleEnd     string  `json:"cycle_end"`
	DaysTotal    int     `json:"days_total"`
	DaysElapsed  int     `json:"days_elapsed"`
	DaysLeft     int     `json:"days_left"`
	PacePct      int     `json:"pace_pct"`
	CurrencyCode string  `json:"currency_code"`
	LimitAmount  *string `json:"limit_amount,omitempty"`
	Spent        string  `json:"spent"`
	Remaining    *string `json:"remaining,omitempty"`
	PaceAmount   *string `json:"pace_amount,omitempty"`
	SpentPct     *int    `json:"spent_pct,omitempty"`
	Ahead        bool    `json:"ahead"`
	Alert        string  `json:"alert,omitempty"`
}

type PaydayInput struct {
	PaydayDay    *int
	SpendLimit   *string
	CurrencyCode *string
	ClearLimit   bool
}

type BudgetInput struct {
	CategoryID   *uuid.UUID
	CategoryName string
	CurrencyCode string
	LimitAmount  string
	PeriodMonth  string // YYYY-MM or YYYY-MM-01
}

type Trip struct {
	ID           uuid.UUID
	UserID       uuid.UUID
	Title        string
	CurrencyCode string
	LimitAmount  decimal.Decimal
	StartsOn     time.Time
	EndsOn       time.Time
	Note         *string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

type TripDTO struct {
	ID           uuid.UUID `json:"id"`
	Title        string    `json:"title"`
	CurrencyCode string    `json:"currency_code"`
	LimitAmount  string    `json:"limit_amount"`
	StartsOn     string    `json:"starts_on"`
	EndsOn       string    `json:"ends_on"`
	Note         *string   `json:"note,omitempty"`
	Spent        string    `json:"spent"`
	Remaining    string    `json:"remaining"`
	DaysTotal    int       `json:"days_total"`
	DaysElapsed  int       `json:"days_elapsed"`
	DaysLeft     int       `json:"days_left"`
	PacePct      int       `json:"pace_pct"`
	PaceAmount   string    `json:"pace_amount"`
	SpentPct     int       `json:"spent_pct"`
	Ahead        bool      `json:"ahead"`
	Alert        string    `json:"alert,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type TripInput struct {
	Title        string
	CurrencyCode string
	LimitAmount  string
	StartsOn     string
	EndsOn       string
	Note         *string
}

type Store interface {
	Insert(ctx context.Context, rec Entry) (Entry, error)
	Get(ctx context.Context, userID, id uuid.UUID) (Entry, error)
	List(ctx context.Context, userID uuid.UUID, q ListQuery) ([]Entry, error)
	Update(ctx context.Context, rec Entry) (Entry, error)
	Delete(ctx context.Context, userID, id uuid.UUID) error
	Summary(ctx context.Context, userID uuid.UUID, from, to *time.Time) ([]SummarySlice, error)
	CategoryBreakdown(ctx context.Context, userID uuid.UUID, kind string, from, to *time.Time) ([]CategorySpend, error)
	ListCategories(ctx context.Context, userID uuid.UUID, kind string) ([]Category, error)
	InsertCategory(ctx context.Context, cat Category) (Category, error)
	ListDueTemplates(ctx context.Context, before time.Time, limit int) ([]Entry, error)
	LinkLoan(ctx context.Context, userID, entryID, loanID uuid.UUID) error
	UpsertBudget(ctx context.Context, rec Budget) (Budget, error)
	ListBudgets(ctx context.Context, userID uuid.UUID, period time.Time) ([]Budget, error)
	DeleteBudget(ctx context.Context, userID, id uuid.UUID) error
	GetPayday(ctx context.Context, userID uuid.UUID) (PaydaySettings, error)
	UpsertPayday(ctx context.Context, rec PaydaySettings) (PaydaySettings, error)
	ListPaydayUserIDs(ctx context.Context) ([]uuid.UUID, error)
	ClaimBudgetAlert(ctx context.Context, userID uuid.UUID, scope string, cycleStart time.Time, threshold int) (bool, error)
	CalendarDays(ctx context.Context, userID uuid.UUID, from, to time.Time, currency, tz string) ([]CalendarBucket, error)
	InsertTrip(ctx context.Context, rec Trip) (Trip, error)
	UpdateTrip(ctx context.Context, rec Trip) (Trip, error)
	GetTrip(ctx context.Context, userID, id uuid.UUID) (Trip, error)
	ListTrips(ctx context.Context, userID uuid.UUID) ([]Trip, error)
	DeleteTrip(ctx context.Context, userID, id uuid.UUID) error
	TripSpend(ctx context.Context, userID, tripID uuid.UUID) (decimal.Decimal, error)
	AssignTripEntries(ctx context.Context, userID, tripID uuid.UUID, currency string, from, to time.Time) error
}

func toDTO(rec Entry) EntryDTO {
	status := rec.Status
	if status == "" {
		status = StatusConfirmed
	}
	return EntryDTO{
		ID:               rec.ID,
		Kind:             rec.Kind,
		Title:            rec.Title,
		Amount:           rec.Amount.StringFixed(Scale),
		CurrencyCode:     rec.CurrencyCode,
		Category:         rec.Category,
		CategoryID:       rec.CategoryID,
		Note:             rec.Note,
		OccurredAt:       rec.OccurredAt,
		IsTemplate:       rec.IsTemplate,
		Recurrence:       rec.Recurrence,
		NextOccurrenceAt: rec.NextOccurrenceAt,
		TemplateID:       rec.TemplateID,
		LinkedLoanID:     rec.LinkedLoanID,
		AccountID:        rec.AccountID,
		SplitGroupID:     rec.SplitGroupID,
		TripID:           rec.TripID,
		Status:           status,
		Paused:           rec.Paused,
		CreatedAt:        rec.CreatedAt,
		UpdatedAt:        rec.UpdatedAt,
	}
}

func toCategoryDTO(c Category) CategoryDTO {
	return CategoryDTO{
		ID:       c.ID,
		Kind:     c.Kind,
		Name:     c.Name,
		Slug:     c.Slug,
		IsSystem: c.IsSystem,
		Active:   c.Active,
	}
}
