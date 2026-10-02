package notifications

import (
	"context"
	"fmt"

	"equilend/api/internal/loans"

	"github.com/google/uuid"
)

// LoanHooks schedules reminders and emits loan lifecycle inbox items.
type LoanHooks struct {
	Svc *Service
}

func (h LoanHooks) AfterCreate(ctx context.Context, loan loans.Record) error {
	if loan.IsInstitutional() || loan.Status == loans.StatusActive {
		return nil
	}
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
	if loan.IsInstitutional() {
		return nil
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

type BankHooks struct {
	Svc  *Service
	Chat ChatPoster
}

// ChatPoster posts a ledger note into the peer DM when a payment profile is shared.
type ChatPoster interface {
	NotifyBankSharedInChat(ctx context.Context, owner, recipient uuid.UUID, ref, last4, label string) error
}

func (h BankHooks) OnBankShared(ctx context.Context, owner, recipient uuid.UUID, loanID *uuid.UUID, ref, last4, label string) error {
	if h.Chat != nil {
		_ = h.Chat.NotifyBankSharedInChat(ctx, owner, recipient, ref, last4, label)
	}
	if loanID != nil {
		return h.Svc.NotifyBankShared(ctx, recipient, *loanID, ref)
	}
	return h.Svc.Notify(ctx, recipient, TypeBankProfileShared, nil, "Payment profile shared", "A payment profile was shared with you.", map[string]any{})
}

type GoalHooks struct {
	Svc *Service
}

func (h GoalHooks) OnGoalMilestone(ctx context.Context, userID, goalID uuid.UUID, title string, threshold int, progressPercent float64) error {
	if h.Svc == nil {
		return nil
	}
	body := fmt.Sprintf("You've reached %d%% on “%s”.", threshold, title)
	if threshold >= 100 {
		body = fmt.Sprintf("Goal complete: “%s”. Nice work.", title)
	}
	return h.Svc.Notify(ctx, userID, TypeGoalMilestone, nil,
		fmt.Sprintf("Goal %d%%", threshold),
		body,
		map[string]any{
			"goal_id":          goalID.String(),
			"title":            title,
			"threshold":        threshold,
			"progress_percent": progressPercent,
		},
	)
}

// CashflowHooks notifies users about recurring bills / SMS imports.
type CashflowHooks struct {
	Svc *Service
}

func (h CashflowHooks) NotifyBillDue(ctx context.Context, userID uuid.UUID, entryID uuid.UUID, title, amount, currency, kind string) error {
	if h.Svc == nil {
		return nil
	}
	label := "Bill due"
	body := fmt.Sprintf("%s — %s %s is due. Did you pay it?", title, amount, currency)
	if kind == "income" {
		label = "Income today"
		body = fmt.Sprintf("%s — %s %s should arrive today. Did you receive it?", title, amount, currency)
	}
	return h.Svc.Notify(ctx, userID, TypeBillDue, nil, label, body, map[string]any{
		"cashflow_id": entryID.String(),
		"title":       title,
		"amount":      amount,
		"currency":    currency,
		"kind":        kind,
	})
}

func (h CashflowHooks) NotifyBillUpcoming(ctx context.Context, userID uuid.UUID, entryID uuid.UUID, title, amount, currency string, days int) error {
	if h.Svc == nil {
		return nil
	}
	return h.Svc.Notify(ctx, userID, TypeBillUpcoming, nil, "Upcoming bill",
		fmt.Sprintf("%s — %s %s in %d day(s).", title, amount, currency, days),
		map[string]any{
			"cashflow_id": entryID.String(),
			"title":       title,
			"amount":      amount,
			"currency":    currency,
			"days":        days,
		},
	)
}
