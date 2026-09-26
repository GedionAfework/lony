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
)

type Category struct {
	ID       uuid.UUID
	UserID   *uuid.UUID
	Kind     string
	Name     string
	Slug     string
	IsSystem bool
}

type CategoryDTO struct {
	ID       uuid.UUID `json:"id"`
	Kind     string    `json:"kind"`
	Name     string    `json:"name"`
	Slug     string    `json:"slug"`
	IsSystem bool      `json:"is_system"`
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
	Status           string
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
	Status           string     `json:"status"`
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
	Kind       string
	From       *time.Time
	To         *time.Time
	Currency   string
	Templates  *bool
	Limit      int
}

type CreateInput struct {
	Kind         string
	Title        string
	Amount       string
	CurrencyCode string
	Category     string
	CategoryID   *uuid.UUID
	AccountID    *uuid.UUID
	Note         *string
	OccurredAt   time.Time
	Recurrence   *string
	IsTemplate   bool
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
}

type ShareInput struct {
	FriendID     uuid.UUID
	SharePercent *float64
	ShareAmount  *string
	DueAt        *time.Time
}

type CategorySpend struct {
	Category     string `json:"category"`
	CategoryID   *uuid.UUID `json:"category_id,omitempty"`
	CurrencyCode string `json:"currency_code"`
	Amount       string `json:"amount"`
	Count        int    `json:"count"`
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
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

type BudgetInput struct {
	CategoryID   *uuid.UUID
	CategoryName string
	CurrencyCode string
	LimitAmount  string
	PeriodMonth  string // YYYY-MM or YYYY-MM-01
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
		Status:           status,
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
	}
}
