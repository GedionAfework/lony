package loans

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

const (
	StatusPending          = "pending"
	StatusActive           = "active"
	StatusOverdue          = "overdue"
	StatusRepaymentPending = "repayment_pending"
	StatusRejected         = "rejected"
	StatusCancelled        = "cancelled"
	StatusCompleted        = "completed"

	TermsProposed   = "proposed"
	TermsAccepted   = "accepted"
	TermsSuperseded = "superseded"

	RoleBorrower = "borrower"
	RoleLender   = "lender"

	EventCreated       = "created"
	EventTermsProposed = "terms_proposed"
	EventAccepted      = "accepted"
	EventRejected      = "rejected"
	EventCancelled     = "cancelled"
	EventOverdue       = "marked_overdue"
)

type Party struct {
	ID          uuid.UUID `json:"id"`
	DisplayName string    `json:"display_name"`
	Username    *string   `json:"username,omitempty"`
}

type Record struct {
	ID                  uuid.UUID
	ReferenceCode       string
	BorrowerID          uuid.UUID
	LenderID            uuid.UUID
	InitiatorID         uuid.UUID
	Status              string
	Principal           *decimal.Decimal
	CurrencyCode        *string
	InterestRatePercent *decimal.Decimal
	InterestAmount      *decimal.Decimal
	ExpectedTotal       *decimal.Decimal
	OutstandingAmount   *decimal.Decimal
	DueAt               *time.Time
	Note                *string
	CurrentTermsID      *uuid.UUID
	AcceptedTermsID     *uuid.UUID
	TermsVersion        *int32
	ProposedByUserID    *uuid.UUID
	AcceptedAt          *time.Time
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

type Terms struct {
	ID                  uuid.UUID
	LoanID              uuid.UUID
	Version             int32
	Principal           decimal.Decimal
	CurrencyCode        string
	InterestRatePercent decimal.Decimal
	InterestAmount      decimal.Decimal
	ExpectedTotal       decimal.Decimal
	DueAt               time.Time
	Note                *string
	ProposedByUserID    uuid.UUID
	Status              string
	CreatedAt           time.Time
}

type Event struct {
	ID        uuid.UUID
	LoanID    uuid.UUID
	ActorID   *uuid.UUID
	Type      string
	Payload   json.RawMessage
	CreatedAt time.Time
}

type LoanDTO struct {
	ID                  uuid.UUID  `json:"id"`
	ReferenceCode       string     `json:"reference_code"`
	Status              string     `json:"status"`
	Borrower            Party      `json:"borrower"`
	Lender              Party      `json:"lender"`
	YourRole            string     `json:"your_role"`
	InterestBasis       string     `json:"interest_basis"`
	Principal           *string    `json:"principal"`
	CurrencyCode        *string    `json:"currency_code"`
	InterestRatePercent *string    `json:"interest_rate_percent"`
	InterestAmount      *string    `json:"interest_amount"`
	ExpectedTotal       *string    `json:"expected_total"`
	DueAt               *time.Time `json:"due_at"`
	Note                *string    `json:"note"`
	TermsVersion        *int32     `json:"terms_version"`
	ProposedByUserID    *uuid.UUID `json:"proposed_by_user_id,omitempty"`
	AwaitingUserID      *uuid.UUID `json:"awaiting_user_id,omitempty"`
	AcceptedAt          *time.Time `json:"accepted_at,omitempty"`
	CreatedAt           time.Time  `json:"created_at"`
	CanAccept           bool       `json:"can_accept"`
	CanReject           bool       `json:"can_reject"`
	CanCancel           bool       `json:"can_cancel"`
	CanProposeTerms     bool       `json:"can_propose_terms"`
	Terms               []TermsDTO `json:"terms,omitempty"`
	Events              []EventDTO `json:"events,omitempty"`
}

type TermsDTO struct {
	ID                  uuid.UUID `json:"id"`
	Version             int32     `json:"version"`
	Status              string    `json:"status"`
	InterestBasis       string    `json:"interest_basis"`
	Principal           string    `json:"principal"`
	CurrencyCode        string    `json:"currency_code"`
	InterestRatePercent string    `json:"interest_rate_percent"`
	InterestAmount      string    `json:"interest_amount"`
	ExpectedTotal       string    `json:"expected_total"`
	DueAt               time.Time `json:"due_at"`
	Note                *string   `json:"note,omitempty"`
	ProposedByUserID    uuid.UUID `json:"proposed_by_user_id"`
	CreatedAt           time.Time `json:"created_at"`
}

type EventDTO struct {
	ID        uuid.UUID       `json:"id"`
	Type      string          `json:"event_type"`
	ActorID   *uuid.UUID      `json:"actor_id,omitempty"`
	Payload   json.RawMessage `json:"payload"`
	CreatedAt time.Time       `json:"created_at"`
}

type CreateInput struct {
	CounterpartyID      uuid.UUID
	Role                string
	Principal           *string
	CurrencyCode        *string
	InterestRatePercent *string
	DueAt               *time.Time
	Note                *string
}

type TermsInput struct {
	Principal           string
	CurrencyCode        string
	InterestRatePercent string
	DueAt               time.Time
	Note                *string
}

type ListQuery struct {
	Status   string
	Role     string
	Currency string
	Filter   string
}

type Store interface {
	GetParty(ctx context.Context, id uuid.UUID) (Party, error)
	InsertLoan(ctx context.Context, rec Record, terms *Terms, events []Event) (Record, error)
	GetLoan(ctx context.Context, id uuid.UUID) (Record, error)
	ListLoans(ctx context.Context, userID uuid.UUID, status, role string) ([]Record, error)
	ListTerms(ctx context.Context, loanID uuid.UUID) ([]Terms, error)
	ListEvents(ctx context.Context, loanID uuid.UUID) ([]Event, error)
	ProposeTerms(ctx context.Context, rec Record, terms Terms, event Event) (Record, error)
	ApplyTransition(ctx context.Context, rec Record, acceptedTermsID *uuid.UUID, event Event) (Record, error)
	MarkOverdue(ctx context.Context, now time.Time) (int, error)
}

func (r Record) OtherParty(actor uuid.UUID) uuid.UUID {
	if actor == r.BorrowerID {
		return r.LenderID
	}
	return r.BorrowerID
}

func (r Record) RoleOf(actor uuid.UUID) string {
	if actor == r.BorrowerID {
		return RoleBorrower
	}
	if actor == r.LenderID {
		return RoleLender
	}
	return ""
}

func (r Record) IsParty(actor uuid.UUID) bool {
	return actor == r.BorrowerID || actor == r.LenderID
}

func (r Record) AwaitingUserID() *uuid.UUID {
	if r.Status != StatusPending || r.ProposedByUserID == nil {
		return nil
	}
	other := r.OtherParty(*r.ProposedByUserID)
	return &other
}
