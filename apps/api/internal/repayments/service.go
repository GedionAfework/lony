package repayments

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"equilend/api/internal/httpx"
	"equilend/api/internal/loans"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
)

type Service struct {
	store    Store
	loans    LoanAccess
	notifier Notifier
	now      func() time.Time
}

type Notifier interface {
	OnClaimed(ctx context.Context, loan loans.Record) error
	OnConfirmed(ctx context.Context, loan loans.Record) error
	OnRejected(ctx context.Context, loan loans.Record) error
}

func NewService(store Store, loans LoanAccess) *Service {
	return &Service{store: store, loans: loans, now: time.Now}
}

func (s *Service) SetNotifier(n Notifier) {
	s.notifier = n
}

func (s *Service) Claim(ctx context.Context, actor, loanID uuid.UUID, in ClaimInput) (DTO, error) {
	_, _ = s.loans.MarkOverdue(ctx)
	loan, err := s.loans.Record(ctx, actor, loanID)
	if err != nil {
		return DTO{}, err
	}
	if loan.BorrowerID != actor {
		return DTO{}, httpx.E(http.StatusForbidden, "FORBIDDEN", "only the borrower can claim a repayment")
	}
	if loan.Status != loans.StatusActive && loan.Status != loans.StatusOverdue {
		return DTO{}, httpx.E(http.StatusConflict, "INVALID_STATE", "repayment can only be claimed on an open loan")
	}
	if _, err := s.store.GetPendingForLoan(ctx, loanID); err == nil {
		return DTO{}, httpx.E(http.StatusConflict, "PENDING_EXISTS", "a repayment claim is already waiting for confirmation")
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return DTO{}, err
	}

	outstanding := outstandingOf(loan)
	if !outstanding.GreaterThan(decimal.Zero) {
		return DTO{}, httpx.E(http.StatusConflict, "INVALID_STATE", "there is nothing left to repay")
	}

	amount := outstanding
	if in.Amount != nil && strings.TrimSpace(*in.Amount) != "" {
		parsed, err := decimal.NewFromString(strings.TrimSpace(*in.Amount))
		if err != nil || !parsed.GreaterThan(decimal.Zero) {
			return DTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"amount": "must be a positive decimal",
			})
		}
		amount = parsed.Round(loans.Scale)
	}
	if amount.GreaterThan(outstanding) {
		return DTO{}, httpx.E(http.StatusConflict, "EXCEEDS_OUTSTANDING", "claim would exceed the outstanding balance")
	}

	var note *string
	if in.Note != nil {
		n := strings.TrimSpace(*in.Note)
		if utf8.RuneCountInString(n) > 500 {
			return DTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"note": "max 500 characters",
			})
		}
		if n != "" {
			note = &n
		}
	}

	now := s.now().UTC()
	rec := Record{
		LoanID:            loanID,
		SubmittedByUserID: actor,
		Amount:            amount,
		Status:            StatusPending,
		Note:              note,
		SubmittedAt:       now,
	}
	loan.Status = loans.StatusRepaymentPending
	saved, updatedLoan, err := s.store.Insert(ctx, rec, loan, loans.Event{
		ActorID: &actor,
		Type:    EventClaimed,
		Payload: claimPayload(rec),
	})
	if err != nil {
		return DTO{}, err
	}
	if s.notifier != nil {
		_ = s.notifier.OnClaimed(ctx, updatedLoan)
	}
	return toDTO(saved, actor, updatedLoan), nil
}

func (s *Service) Confirm(ctx context.Context, actor, repaymentID uuid.UUID) (DTO, error) {
	rec, loan, err := s.loadPending(ctx, actor, repaymentID)
	if err != nil {
		return DTO{}, err
	}
	if loan.LenderID != actor {
		return DTO{}, httpx.E(http.StatusForbidden, "FORBIDDEN", "only the lender can confirm a repayment")
	}
	if rec.SubmittedByUserID == actor {
		return DTO{}, httpx.E(http.StatusForbidden, "FORBIDDEN", "you cannot confirm your own repayment claim")
	}

	now := s.now().UTC()
	rec.Status = StatusConfirmed
	rec.ConfirmedByUserID = &actor
	rec.ConfirmedAt = &now

	outstanding := outstandingOf(loan)
	remaining := outstanding.Sub(rec.Amount)
	if remaining.IsNegative() {
		return DTO{}, httpx.E(http.StatusConflict, "EXCEEDS_OUTSTANDING", "claim exceeds the outstanding balance")
	}
	loan.OutstandingAmount = &remaining
	if remaining.IsZero() {
		loan.Status = loans.StatusCompleted
	} else if loan.DueAt != nil && !loan.DueAt.After(now) {
		loan.Status = loans.StatusOverdue
	} else {
		loan.Status = loans.StatusActive
	}

	payload, _ := json.Marshal(map[string]any{
		"repayment_id": rec.ID.String(),
		"amount":       rec.Amount.StringFixed(loans.Scale),
		"outstanding":  remaining.StringFixed(loans.Scale),
	})
	saved, updatedLoan, err := s.store.Confirm(ctx, rec, loan, loans.Event{
		ActorID: &actor,
		Type:    EventConfirmed,
		Payload: payload,
	})
	if err != nil {
		return DTO{}, err
	}
	if s.notifier != nil {
		_ = s.notifier.OnConfirmed(ctx, updatedLoan)
	}
	return toDTO(saved, actor, updatedLoan), nil
}

func (s *Service) Reject(ctx context.Context, actor, repaymentID uuid.UUID, in RejectInput) (DTO, error) {
	rec, loan, err := s.loadPending(ctx, actor, repaymentID)
	if err != nil {
		return DTO{}, err
	}
	if loan.LenderID != actor {
		return DTO{}, httpx.E(http.StatusForbidden, "FORBIDDEN", "only the lender can reject a repayment")
	}
	reason := strings.TrimSpace(in.Reason)
	if reason == "" || utf8.RuneCountInString(reason) > 500 {
		return DTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"reason": "required, max 500 characters",
		})
	}

	now := s.now().UTC()
	rec.Status = StatusRejected
	rec.RejectedAt = &now
	rec.RejectionReason = &reason
	if loan.DueAt != nil && !loan.DueAt.After(now) {
		loan.Status = loans.StatusOverdue
	} else {
		loan.Status = loans.StatusActive
	}

	payload, _ := json.Marshal(map[string]any{
		"repayment_id": rec.ID.String(),
		"reason":       reason,
	})
	saved, updatedLoan, err := s.store.Reject(ctx, rec, loan, loans.Event{
		ActorID: &actor,
		Type:    EventRejected,
		Payload: payload,
	})
	if err != nil {
		return DTO{}, err
	}
	if s.notifier != nil {
		_ = s.notifier.OnRejected(ctx, updatedLoan)
	}
	return toDTO(saved, actor, updatedLoan), nil
}

func (s *Service) ListForLoan(ctx context.Context, actor, loanID uuid.UUID) ([]DTO, error) {
	loan, err := s.loans.Record(ctx, actor, loanID)
	if err != nil {
		return nil, err
	}
	rows, err := s.store.ListForLoan(ctx, loanID)
	if err != nil {
		return nil, err
	}
	out := make([]DTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, toDTO(row, actor, loan))
	}
	return out, nil
}

func (s *Service) Get(ctx context.Context, actor, repaymentID uuid.UUID) (DTO, error) {
	rec, err := s.store.Get(ctx, repaymentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return DTO{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "repayment not found")
	}
	if err != nil {
		return DTO{}, err
	}
	loan, err := s.loans.Record(ctx, actor, rec.LoanID)
	if err != nil {
		return DTO{}, err
	}
	return toDTO(rec, actor, loan), nil
}

func (s *Service) loadPending(ctx context.Context, actor, repaymentID uuid.UUID) (Record, loans.Record, error) {
	rec, err := s.store.Get(ctx, repaymentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Record{}, loans.Record{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "repayment not found")
	}
	if err != nil {
		return Record{}, loans.Record{}, err
	}
	loan, err := s.loans.Record(ctx, actor, rec.LoanID)
	if err != nil {
		return Record{}, loans.Record{}, err
	}
	if rec.Status != StatusPending || loan.Status != loans.StatusRepaymentPending {
		return Record{}, loans.Record{}, httpx.E(http.StatusConflict, "INVALID_STATE", "this repayment is no longer pending")
	}
	return rec, loan, nil
}

func outstandingOf(loan loans.Record) decimal.Decimal {
	if loan.OutstandingAmount != nil {
		return *loan.OutstandingAmount
	}
	if loan.ExpectedTotal != nil {
		return *loan.ExpectedTotal
	}
	return decimal.Zero
}
