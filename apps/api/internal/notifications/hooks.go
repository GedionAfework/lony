package notifications

import (
	"context"

	"equilend/api/internal/loans"

	"github.com/google/uuid"
)

// LoanHooks schedules reminders and emits loan lifecycle inbox items.
type LoanHooks struct {
	Svc *Service
}

func (h LoanHooks) AfterCreate(ctx context.Context, loan loans.Record) error {
	other := loan.BorrowerID
	if loan.InitiatorID == loan.BorrowerID {
		other = loan.LenderID
	}
	return h.Svc.NotifyLoanRequest(ctx, other, loan.ID, loan.ReferenceCode)
}

func (h LoanHooks) AfterAccept(ctx context.Context, loan loans.Record) error {
	if err := h.Svc.ScheduleLoanReminders(ctx, loan); err != nil {
		return err
	}
	if loan.ProposedByUserID != nil {
		return h.Svc.NotifyLoanAccepted(ctx, *loan.ProposedByUserID, loan.ID, loan.ReferenceCode)
	}
	return nil
}

type FriendHooks struct {
	Svc *Service
}

func (h FriendHooks) OnFriendRequest(ctx context.Context, addresseeID uuid.UUID) error {
	return h.Svc.NotifyFriendRequest(ctx, addresseeID)
}

func (h FriendHooks) OnFriendAccepted(ctx context.Context, requesterID uuid.UUID) error {
	return h.Svc.NotifyFriendAccepted(ctx, requesterID)
}

type RepayHooks struct {
	Svc *Service
}

func (h RepayHooks) OnClaimed(ctx context.Context, loan loans.Record) error {
	return h.Svc.NotifyRepaymentSubmitted(ctx, loan.LenderID, loan.ID, loan.ReferenceCode)
}

func (h RepayHooks) OnConfirmed(ctx context.Context, loan loans.Record) error {
	if loan.Status == loans.StatusCompleted {
		_ = h.Svc.CancelLoanReminders(ctx, loan.ID)
	}
	return h.Svc.NotifyRepaymentConfirmed(ctx, loan.BorrowerID, loan.ID, loan.ReferenceCode)
}

func (h RepayHooks) OnRejected(ctx context.Context, loan loans.Record) error {
	return h.Svc.NotifyRepaymentRejected(ctx, loan.BorrowerID, loan.ID, loan.ReferenceCode)
}
