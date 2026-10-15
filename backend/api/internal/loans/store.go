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

	KindOneTime  = "one_time"
	KindLongTerm = "long_term"

	PartyPeer   = "peer"
	PartyAlone  = "alone"
	PartyShared = "shared"

	InstallmentScheduled = "scheduled"
	InstallmentPaid      = "paid"
	InstallmentOverdue   = "overdue"
	InstallmentSkipped   = "skipped"
)

type Party struct {
	ID          uuid.UUID `json:"id"`
	DisplayName string    `json:"display_name"`
	Username    *string   `json:"username,omitempty"`
}

type Record struct {
	ID                   uuid.UUID
	ReferenceCode        string
	BorrowerID           uuid.UUID
	LenderID             uuid.UUID
	InitiatorID          uuid.UUID
	Status               string
	Principal            *decimal.Decimal
	CurrencyCode         *string
	InterestRatePercent  *decimal.Decimal
	InterestAmount       *decimal.Decimal
	ExpectedTotal        *decimal.Decimal
	OutstandingAmount    *decimal.Decimal
	DueAt                *time.Time
	Note                 *string
	Title                *string
	LoanKind             string
	InterestPeriodMonths *int32
	InstallmentCount     *int32
	InstallmentAmount    *decimal.Decimal
	InstitutionLabel     *string
	InstitutionType      *string
	PartyMode            string
	StartAt              *time.Time
	CurrentTermsID       *uuid.UUID
	AcceptedTermsID      *uuid.UUID
	TermsVersion         *int32
	ProposedByUserID     *uuid.UUID
	AcceptedAt           *time.Time
	CreatedAt            time.Time
	UpdatedAt            time.Time
	CoLenderIDs          []uuid.UUID
}

type Terms struct {
	ID                   uuid.UUID
	LoanID               uuid.UUID
	Version              int32
	Principal            decimal.Decimal
	CurrencyCode         string
	InterestRatePercent  decimal.Decimal
	InterestAmount       decimal.Decimal
	ExpectedTotal        decimal.Decimal
	DueAt                time.Time
	Note                 *string
	LoanKind             string
	InterestPeriodMonths *int32
	InstallmentCount     *int32
	InstallmentAmount    *decimal.Decimal
	InstitutionLabel     *string
	StartAt              *time.Time
	ProposedByUserID     uuid.UUID
	Status               string
	CreatedAt            time.Time
}

type Installment struct {
	ID               uuid.UUID
	LoanID           uuid.UUID
	Sequence         int32
	DueAt            time.Time
	Amount           decimal.Decimal
	PrincipalPortion decimal.Decimal
	InterestPortion  decimal.Decimal
	Status           string
	PaidAt           *time.Time
	CreatedAt        time.Time
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
	ID                   uuid.UUID         `json:"id"`
	ReferenceCode        string            `json:"reference_code"`
	Status               string            `json:"status"`
	Borrower             Party             `json:"borrower"`
	Lender               Party             `json:"lender"`
	YourRole             string            `json:"your_role"`
	InterestBasis        string            `json:"interest_basis"`
	LoanKind             string            `json:"loan_kind"`
	Principal            *string           `json:"principal"`
	CurrencyCode         *string           `json:"currency_code"`
	InterestRatePercent  *string           `json:"interest_rate_percent"`
	InterestAmount       *string           `json:"interest_amount"`
	ExpectedTotal        *string           `json:"expected_total"`
	DueAt                *time.Time        `json:"due_at"`
	Note                 *string           `json:"note"`
	Title                *string           `json:"title,omitempty"`
	InterestPeriodMonths *int32            `json:"interest_period_months,omitempty"`
	InstallmentCount     *int32            `json:"installment_count,omitempty"`
	InstallmentAmount    *string           `json:"installment_amount,omitempty"`
	InstitutionLabel     *string           `json:"institution_label,omitempty"`
	InstitutionType      *string           `json:"institution_type,omitempty"`
	PartyMode            string            `json:"party_mode"`
	StartAt              *time.Time        `json:"start_at,omitempty"`
	TermsVersion         *int32            `json:"terms_version"`
	ProposedByUserID     *uuid.UUID        `json:"proposed_by_user_id,omitempty"`
	AwaitingUserID       *uuid.UUID        `json:"awaiting_user_id,omitempty"`
	AcceptedAt           *time.Time        `json:"accepted_at,omitempty"`
	CreatedAt            time.Time         `json:"created_at"`
	CanAccept            bool              `json:"can_accept"`
	CanReject            bool              `json:"can_reject"`
	CanCancel            bool              `json:"can_cancel"`
	CanProposeTerms      bool              `json:"can_propose_terms"`
	CoLenders            []Party           `json:"co_lenders,omitempty"`
	Terms                []TermsDTO        `json:"terms,omitempty"`
	Events               []EventDTO        `json:"events,omitempty"`
	Installments         []InstallmentDTO  `json:"installments,omitempty"`
}

type TermsDTO struct {
	ID                   uuid.UUID  `json:"id"`
	Version              int32      `json:"version"`
	Status               string     `json:"status"`
	InterestBasis        string     `json:"interest_basis"`
	LoanKind             string     `json:"loan_kind"`
	Principal            string     `json:"principal"`
	CurrencyCode         string     `json:"currency_code"`
	InterestRatePercent  string     `json:"interest_rate_percent"`
	InterestAmount       string     `json:"interest_amount"`
	ExpectedTotal        string     `json:"expected_total"`
	DueAt                time.Time  `json:"due_at"`
	Note                 *string    `json:"note,omitempty"`
	InterestPeriodMonths *int32     `json:"interest_period_months,omitempty"`
	InstallmentCount     *int32     `json:"installment_count,omitempty"`
	InstallmentAmount    *string    `json:"installment_amount,omitempty"`
	InstitutionLabel     *string    `json:"institution_label,omitempty"`
	StartAt              *time.Time `json:"start_at,omitempty"`
	ProposedByUserID     uuid.UUID  `json:"proposed_by_user_id"`
	CreatedAt            time.Time  `json:"created_at"`
}

type InstallmentDTO struct {
	ID               uuid.UUID  `json:"id"`
	Sequence         int32      `json:"sequence"`
	DueAt            time.Time  `json:"due_at"`
	Amount           string     `json:"amount"`
	PrincipalPortion string     `json:"principal_portion"`
	InterestPortion  string     `json:"interest_portion"`
	Status           string     `json:"status"`
	PaidAt           *time.Time `json:"paid_at,omitempty"`
}

type EventDTO struct {
	ID        uuid.UUID       `json:"id"`
	Type      string          `json:"event_type"`
	ActorID   *uuid.UUID      `json:"actor_id,omitempty"`
	Payload   json.RawMessage `json:"payload"`
	CreatedAt time.Time       `json:"created_at"`
}

type CreateInput struct {
	CounterpartyID       uuid.UUID
	CoLenderIDs          []uuid.UUID
	Role                 string
	Principal            *string
	CurrencyCode         *string
	InterestRatePercent  *string
	DueAt                *time.Time
	Note                 *string
	Title                *string
	LoanKind             *string
	InterestPeriodMonths *int32
	InstallmentCount     *int32
	InstitutionLabel     *string
	InstitutionType      *string
	PartyMode            *string
	StartAt              *time.Time
	// AutoAccept activates peer loans immediately (used for expense splits).
	AutoAccept bool
}

type TermsInput struct {
	Principal            string
	CurrencyCode         string
	InterestRatePercent  string
	DueAt                time.Time
	Note                 *string
	LoanKind             string
	InterestPeriodMonths *int32
	InstallmentCount     *int32
	InstitutionLabel     *string
	StartAt              *time.Time
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
	ListInstallments(ctx context.Context, loanID uuid.UUID) ([]Installment, error)
	ReplaceInstallments(ctx context.Context, loanID uuid.UUID, rows []Installment) error
	MarkInstallmentPaid(ctx context.Context, loanID, installmentID uuid.UUID, paidAt time.Time) (Installment, error)
	ReplaceCoLenders(ctx context.Context, loanID uuid.UUID, userIDs []uuid.UUID) error
	ListCoLenders(ctx context.Context, loanID uuid.UUID) ([]uuid.UUID, error)
	ProposeTerms(ctx context.Context, rec Record, terms Terms, event Event) (Record, error)
	ApplyTransition(ctx context.Context, rec Record, acceptedTermsID *uuid.UUID, event Event) (Record, error)
	SaveScheduleMeta(ctx context.Context, rec Record) (Record, error)
	MarkOverdue(ctx context.Context, now time.Time) (int, error)
}

func (r Record) IsInstitutional() bool {
	return r.PartyMode == PartyAlone || r.BorrowerID == r.LenderID
}

func (r Record) OtherParty(actor uuid.UUID) uuid.UUID {
	if actor == r.BorrowerID {
		return r.LenderID
	}
	return r.BorrowerID
}

func (r Record) IsParty(actor uuid.UUID) bool {
	if actor == r.BorrowerID || actor == r.LenderID {
		return true
	}
	for _, id := range r.CoLenderIDs {
		if id == actor {
			return true
		}
	}
	return false
}

func (r Record) RoleOf(actor uuid.UUID) string {
	if r.IsInstitutional() && actor == r.BorrowerID {
		return RoleBorrower
	}
	if actor == r.BorrowerID {
		return RoleBorrower
	}
	if actor == r.LenderID {
		return RoleLender
	}
	for _, id := range r.CoLenderIDs {
		if id == actor {
			return RoleLender
		}
	}
	return ""
}

func (r Record) AwaitingUserID() *uuid.UUID {
	if r.Status != StatusPending || r.ProposedByUserID == nil || r.IsInstitutional() {
		return nil
	}
	other := r.OtherParty(*r.ProposedByUserID)
	return &other
}
