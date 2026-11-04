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
	ID                uuid.UUID
	LoanID            uuid.UUID
	SubmittedByUserID uuid.UUID
	Amount            decimal.Decimal
	Status            string
	Note              *string
	ProofAttachmentID *uuid.UUID
	ProofObjectKey    *string // hydrated from media_objects
	ProofName         *string
	SubmittedAt       time.Time
	ConfirmedByUserID *uuid.UUID
	ConfirmedAt       *time.Time
	RejectedAt        *time.Time
	RejectionReason   *string
	PaidEntryID       *uuid.UUID // borrower's expense that paid this claim
	ReceivedEntryID   *uuid.UUID // lender's income that received it
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

// EntryWrite is a cashflow entry the store creates in the same transaction as the
// repayment change, together with the matching account balance change.
type EntryWrite struct {
	UserID       uuid.UUID
	AccountID    uuid.UUID
	Kind         string // "expense" (borrower paid) or "income" (lender received)
	Title        string
	Category     string
	CategoryID   *uuid.UUID
	Amount       decimal.Decimal
	CurrencyCode string
	OccurredAt   time.Time
	LoanID       uuid.UUID
}

// EntryInfo is what validation needs to know about an existing cashflow entry or account.
type EntryInfo struct {
	ID           uuid.UUID
	UserID       uuid.UUID
	Kind         string
	Status       string
	IsTemplate   bool
	Amount       decimal.Decimal
	CurrencyCode string
	AccountID    *uuid.UUID
}

type AccountInfo struct {
	ID           uuid.UUID
	CurrencyCode string
	Archived     bool
}

type DTO struct {
	ID                uuid.UUID  `json:"id"`
	LoanID            uuid.UUID  `json:"loan_id"`
	SubmittedByUserID uuid.UUID  `json:"submitted_by_user_id"`
	Amount            string     `json:"amount"`
	Status            string     `json:"status"`
	Note              *string    `json:"note,omitempty"`
	ProofURL          *string    `json:"proof_url,omitempty"`
	ProofName         *string    `json:"proof_name,omitempty"`
	SubmittedAt       time.Time  `json:"submitted_at"`
	ConfirmedByUserID *uuid.UUID `json:"confirmed_by_user_id,omitempty"`
	ConfirmedAt       *time.Time `json:"confirmed_at,omitempty"`
	RejectedAt        *time.Time `json:"rejected_at,omitempty"`
	RejectionReason   *string    `json:"rejection_reason,omitempty"`
	PaidEntryID       *uuid.UUID `json:"paid_entry_id,omitempty"`
	ReceivedEntryID   *uuid.UUID `json:"received_entry_id,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	CanConfirm        bool       `json:"can_confirm"`
	CanReject         bool       `json:"can_reject"`
	// NeedsResolution: rejected, but the borrower's expense is still recorded.
	// The borrower must resubmit, undo the expense, or keep it as a plain expense.
	NeedsResolution bool `json:"needs_resolution"`
}

type ClaimInput struct {
	Amount             *string
	Note               *string
	ProofAttachmentID  *uuid.UUID
	ProofObjectKey     *string
	ProofName          *string
	// PayFromAccountID records the payment as an expense from this account in the
	// same transaction as the claim.
	PayFromAccountID *uuid.UUID
	Title            *string
	Category         *string
	CategoryID       *uuid.UUID
	OccurredAt       *time.Time
	// PaidEntryID links an expense the borrower already recorded (e.g. resubmitting).
	PaidEntryID *uuid.UUID
}

type ConfirmInput struct {
	// ReceivedAccountID records the money as income into this account.
	ReceivedAccountID *uuid.UUID
	// ReceivedEntryID links income the lender already recorded by hand.
	ReceivedEntryID *uuid.UUID
}

type RejectInput struct {
	Reason string
}

const (
	ResolveUndoExpense = "undo_expense"
	ResolveKeepExpense = "keep_expense"
)

type Store interface {
	// InsertRepayment saves a claim (pending, or already confirmed for institutional
	// loans), the loan change and its events in one transaction. When entry is set it
	// also creates that expense, adjusts the account and links it as PaidEntryID.
	// A PaidEntryID already on rec is moved off any rejected repayment that held it.
	InsertRepayment(ctx context.Context, rec Record, loan loans.Record, events []loans.Event, entry *EntryWrite) (Record, loans.Record, error)
	Get(ctx context.Context, id uuid.UUID) (Record, error)
	ListForLoan(ctx context.Context, loanID uuid.UUID) ([]Record, error)
	GetPendingForLoan(ctx context.Context, loanID uuid.UUID) (Record, error)
	SumClaimed(ctx context.Context, loanID uuid.UUID) (decimal.Decimal, error)
	// FinishRepayment saves a confirm/reject. When entry is set (confirm only) it also
	// creates the lender's income, adjusts the account and links it as ReceivedEntryID.
	FinishRepayment(ctx context.Context, rec Record, loan loans.Record, event loans.Event, entry *EntryWrite) (Record, loans.Record, error)
	// ResolveRejected clears the expense link of a rejected repayment. With undo it
	// also deletes that expense and reverses its account balance change.
	ResolveRejected(ctx context.Context, rec Record, undo bool) (Record, error)
	RepaymentEntryInfo(ctx context.Context, entryID uuid.UUID) (EntryInfo, error)
	RepaymentAccountInfo(ctx context.Context, userID, accountID uuid.UUID) (AccountInfo, error)
	// RepaymentForEntry returns the repayment linked to entryID as paid or received entry.
	RepaymentForEntry(ctx context.Context, entryID uuid.UUID) (Record, error)
}

type LoanAccess interface {
	Record(ctx context.Context, actor, id uuid.UUID) (loans.Record, error)
	MarkOverdue(ctx context.Context) (int, error)
}

func toDTO(rec Record, actor uuid.UUID, loan loans.Record) DTO {
	dto := DTO{
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
		PaidEntryID:       rec.PaidEntryID,
		ReceivedEntryID:   rec.ReceivedEntryID,
		CreatedAt:         rec.CreatedAt,
		CanConfirm:        rec.Status == StatusPending && loan.LenderID == actor,
		CanReject:         rec.Status == StatusPending && loan.LenderID == actor && !loan.IsInstitutional(),
		NeedsResolution:   rec.Status == StatusRejected && rec.PaidEntryID != nil && rec.SubmittedByUserID == actor,
	}
	if rec.ProofAttachmentID != nil && rec.ProofObjectKey != nil && *rec.ProofObjectKey != "" {
		url := "/api/v1/media/" + *rec.ProofObjectKey
		dto.ProofURL = &url
		dto.ProofName = rec.ProofName
	}
	return dto
}

func claimPayload(rec Record) json.RawMessage {
	raw, _ := json.Marshal(map[string]any{
		"repayment_id": rec.ID.String(),
		"amount":       rec.Amount.StringFixed(loans.Scale),
	})
	return raw
}
