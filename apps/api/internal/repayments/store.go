package repayments

import (
	"context"
	"encoding/json"
	"time"

	"equilend/api/internal/loans"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

const (
	StatusPending   = "pending"
	StatusConfirmed = "confirmed"
	StatusRejected  = "rejected"
	StatusCancelled = "cancelled"

	EventClaimed    = "repayment_claimed"
	EventConfirmed  = "repayment_confirmed"
	EventRejected   = "repayment_rejected"
	EventCancelled  = "repayment_cancelled"
)

type Record struct {
	ID                 uuid.UUID
	LoanID             uuid.UUID
	SubmittedByUserID  uuid.UUID
	Amount             decimal.Decimal
	Status             string
	Note               *string
	ProofAttachmentID  *uuid.UUID
	SubmittedAt        time.Time
	ConfirmedByUserID  *uuid.UUID
	ConfirmedAt        *time.Time
	RejectedAt         *time.Time
	RejectionReason    *string
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

type DTO struct {
	ID                uuid.UUID  `json:"id"`
	LoanID            uuid.UUID  `json:"loan_id"`
	SubmittedByUserID uuid.UUID  `json:"submitted_by_user_id"`
	Amount            string     `json:"amount"`
	Status            string     `json:"status"`
	Note              *string    `json:"note,omitempty"`
	SubmittedAt       time.Time  `json:"submitted_at"`
	ConfirmedByUserID *uuid.UUID `json:"confirmed_by_user_id,omitempty"`
	ConfirmedAt       *time.Time `json:"confirmed_at,omitempty"`
	RejectedAt        *time.Time `json:"rejected_at,omitempty"`
	RejectionReason   *string    `json:"rejection_reason,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	CanConfirm        bool       `json:"can_confirm"`
	CanReject         bool       `json:"can_reject"`
}

type ClaimInput struct {
	Amount *string
	Note   *string
}

type RejectInput struct {
	Reason string
}

type Store interface {
	Insert(ctx context.Context, rec Record, loan loans.Record, event loans.Event) (Record, loans.Record, error)
	Get(ctx context.Context, id uuid.UUID) (Record, error)
	ListForLoan(ctx context.Context, loanID uuid.UUID) ([]Record, error)
	GetPendingForLoan(ctx context.Context, loanID uuid.UUID) (Record, error)
	SumClaimed(ctx context.Context, loanID uuid.UUID) (decimal.Decimal, error)
	Confirm(ctx context.Context, rec Record, loan loans.Record, event loans.Event) (Record, loans.Record, error)
	Reject(ctx context.Context, rec Record, loan loans.Record, event loans.Event) (Record, loans.Record, error)
}

type LoanAccess interface {
	Record(ctx context.Context, actor, id uuid.UUID) (loans.Record, error)
	MarkOverdue(ctx context.Context) (int, error)
}

func toDTO(rec Record, actor uuid.UUID, loan loans.Record) DTO {
	return DTO{
		ID:                rec.ID,
		LoanID:            rec.LoanID,
		SubmittedByUserID: rec.SubmittedByUserID,
		Amount:            rec.Amount.StringFixed(loans.Scale),
		Status:            rec.Status,
		Note:              rec.Note,
		SubmittedAt:       rec.SubmittedAt,
		ConfirmedByUserID: rec.ConfirmedByUserID,
		ConfirmedAt:       rec.ConfirmedAt,
		RejectedAt:        rec.RejectedAt,
		RejectionReason:   rec.RejectionReason,
		CreatedAt:         rec.CreatedAt,
		CanConfirm:        rec.Status == StatusPending && loan.LenderID == actor,
		CanReject:         rec.Status == StatusPending && loan.LenderID == actor,
	}
}

func claimPayload(rec Record) json.RawMessage {
	raw, _ := json.Marshal(map[string]any{
		"repayment_id": rec.ID.String(),
		"amount":       rec.Amount.StringFixed(loans.Scale),
	})
	return raw
}
