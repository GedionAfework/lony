package goals

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

const (
	TypeTravel     = "travel"
	TypePurchase   = "purchase"
	TypeSavings    = "savings"
	TypeDebtPayoff = "debt_payoff"
	TypeCustom     = "custom"

	StatusActive    = "active"
	StatusCompleted = "completed"
	StatusArchived  = "archived"

	Scale = 2
)

type Goal struct {
	ID              uuid.UUID
	UserID          uuid.UUID
	Title           string
	GoalType        string
	CurrencyCode    string
	TargetAmount    decimal.Decimal
	CurrentAmount   decimal.Decimal
	TargetDate      *time.Time
	LinkedAccountID *uuid.UUID
	LinkedLoanID    *uuid.UUID
	Note            *string
	CoverImageKey   *string
	TypeLabel       *string
	Status          string
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type Contribution struct {
	ID           uuid.UUID
	GoalID       uuid.UUID
	UserID       uuid.UUID
	Amount       decimal.Decimal
	CurrencyCode string
	AccountID    *uuid.UUID
	Note         *string
	OccurredAt   time.Time
	CreatedAt    time.Time
}

type GoalDTO struct {
	ID              uuid.UUID  `json:"id"`
	Title           string     `json:"title"`
	GoalType        string     `json:"goal_type"`
	CurrencyCode    string     `json:"currency_code"`
	TargetAmount    string     `json:"target_amount"`
	CurrentAmount   string     `json:"current_amount"`
	ProgressPercent float64    `json:"progress_percent"`
	Remaining       string     `json:"remaining"`
	TargetDate      *string    `json:"target_date,omitempty"`
	LinkedAccountID *uuid.UUID `json:"linked_account_id,omitempty"`
	LinkedLoanID    *uuid.UUID `json:"linked_loan_id,omitempty"`
	Note            *string    `json:"note,omitempty"`
	CoverImageURL   *string    `json:"cover_image_url,omitempty"`
	TypeLabel       *string    `json:"type_label,omitempty"`
	Status          string     `json:"status"`
	ETAMonths       *int       `json:"eta_months,omitempty"`
	MonthlyRate     *string    `json:"monthly_rate,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

type ContributionDTO struct {
	ID           uuid.UUID  `json:"id"`
	GoalID       uuid.UUID  `json:"goal_id"`
	Amount       string     `json:"amount"`
	CurrencyCode string     `json:"currency_code"`
	AccountID    *uuid.UUID `json:"account_id,omitempty"`
	Note         *string    `json:"note,omitempty"`
	OccurredAt   time.Time  `json:"occurred_at"`
	CreatedAt    time.Time  `json:"created_at"`
}

type ProjectionDTO struct {
	GoalID            uuid.UUID `json:"goal_id"`
	Remaining         string    `json:"remaining"`
	MonthlyRate       string    `json:"monthly_rate"`
	ETAMonths         *int      `json:"eta_months,omitempty"`
	OnTrack           *bool     `json:"on_track,omitempty"`
	TargetDate        *string   `json:"target_date,omitempty"`
	ContributionCount int       `json:"contribution_count"`
}

type CreateInput struct {
	Title           string
	GoalType        string
	CurrencyCode    string
	TargetAmount    string
	CurrentAmount   *string
	TargetDate      *string
	LinkedAccountID *uuid.UUID
	LinkedLoanID    *uuid.UUID
	Note            *string
	TypeLabel       *string
}

type UpdateInput struct {
	Title           *string
	GoalType        *string
	CurrencyCode    *string
	TargetAmount    *string
	TargetDate      *string
	ClearTargetDate bool
	LinkedAccountID *uuid.UUID
	ClearAccount    bool
	LinkedLoanID    *uuid.UUID
	ClearLoan       bool
	Note            *string
	TypeLabel       *string
	Status          *string
}

type ContributeInput struct {
	Amount    string
	AccountID *uuid.UUID
	Note      *string
	DebitAccount bool
}

type Store interface {
	Insert(ctx context.Context, rec Goal) (Goal, error)
	Get(ctx context.Context, userID, id uuid.UUID) (Goal, error)
	List(ctx context.Context, userID uuid.UUID, includeArchived bool) ([]Goal, error)
	Update(ctx context.Context, rec Goal) (Goal, error)
	InsertContribution(ctx context.Context, c Contribution) (Contribution, error)
	ListContributions(ctx context.Context, userID, goalID uuid.UUID, limit int) ([]Contribution, error)
	SumContributionsSince(ctx context.Context, userID, goalID uuid.UUID, since time.Time) (decimal.Decimal, int, error)
}

func toDTO(rec Goal, monthlyRate *decimal.Decimal) GoalDTO {
	pct := 0.0
	if rec.TargetAmount.GreaterThan(decimal.Zero) {
		pct = rec.CurrentAmount.Div(rec.TargetAmount).Mul(decimal.NewFromInt(100)).InexactFloat64()
		if pct > 100 {
			pct = 100
		}
	}
	remaining := rec.TargetAmount.Sub(rec.CurrentAmount)
	if remaining.IsNegative() {
		remaining = decimal.Zero
	}
	dto := GoalDTO{
		ID:              rec.ID,
		Title:           rec.Title,
		GoalType:        rec.GoalType,
		CurrencyCode:    rec.CurrencyCode,
		TargetAmount:    rec.TargetAmount.StringFixed(Scale),
		CurrentAmount:   rec.CurrentAmount.StringFixed(Scale),
		ProgressPercent: pct,
		Remaining:       remaining.StringFixed(Scale),
		LinkedAccountID: rec.LinkedAccountID,
		LinkedLoanID:    rec.LinkedLoanID,
		Note:            rec.Note,
		TypeLabel:       rec.TypeLabel,
		Status:          rec.Status,
		CreatedAt:       rec.CreatedAt,
		UpdatedAt:       rec.UpdatedAt,
	}
	if rec.CoverImageKey != nil && *rec.CoverImageKey != "" {
		url := "/api/v1/media/" + *rec.CoverImageKey
		dto.CoverImageURL = &url
	}
	if rec.TargetDate != nil {
		s := rec.TargetDate.Format("2006-01-02")
		dto.TargetDate = &s
	}
	if monthlyRate != nil && monthlyRate.GreaterThan(decimal.Zero) && remaining.GreaterThan(decimal.Zero) {
		months := remaining.Div(*monthlyRate).Ceil().IntPart()
		m := int(months)
		if m < 1 {
			m = 1
		}
		dto.ETAMonths = &m
		s := monthlyRate.StringFixed(Scale)
		dto.MonthlyRate = &s
	}
	return dto
}

func toContributionDTO(c Contribution) ContributionDTO {
	return ContributionDTO{
		ID:           c.ID,
		GoalID:       c.GoalID,
		Amount:       c.Amount.StringFixed(Scale),
		CurrencyCode: c.CurrencyCode,
		AccountID:    c.AccountID,
		Note:         c.Note,
		OccurredAt:   c.OccurredAt,
		CreatedAt:    c.CreatedAt,
	}
}
