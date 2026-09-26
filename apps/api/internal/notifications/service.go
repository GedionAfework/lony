package notifications

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"equilend/api/internal/httpx"
	"equilend/api/internal/loans"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type Service struct {
	store Store
	push  Pusher
	now   func() time.Time
}

func NewService(store Store, push Pusher) *Service {
	if push == nil {
		push = LogPusher{}
	}
	return &Service{store: store, push: push, now: time.Now}
}

func (s *Service) List(ctx context.Context, userID uuid.UUID, unreadOnly bool) ([]DTO, error) {
	rows, err := s.store.ListNotifications(ctx, userID, unreadOnly, 100)
	if err != nil {
		return nil, err
	}
	out := make([]DTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, toDTO(row))
	}
	return out, nil
}

func (s *Service) UnreadCount(ctx context.Context, userID uuid.UUID) (int32, error) {
	return s.store.CountUnread(ctx, userID)
}

func (s *Service) MarkRead(ctx context.Context, userID, id uuid.UUID) (DTO, error) {
	row, err := s.store.MarkRead(ctx, userID, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return DTO{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "notification not found")
	}
	if err != nil {
		return DTO{}, err
	}
	return toDTO(row), nil
}

func (s *Service) MarkAllRead(ctx context.Context, userID uuid.UUID) error {
	return s.store.MarkAllRead(ctx, userID)
}

func (s *Service) RegisterDevice(ctx context.Context, userID uuid.UUID, platform, token string) (DeviceTokenDTO, error) {
	platform = strings.ToLower(strings.TrimSpace(platform))
	token = strings.TrimSpace(token)
	fields := map[string]string{}
	if platform != "ios" && platform != "android" && platform != "web" {
		fields["platform"] = "must be ios, android, or web"
	}
	if token == "" || utf8.RuneCountInString(token) > 512 {
		fields["token"] = "required, max 512 characters"
	}
	if len(fields) > 0 {
		return DeviceTokenDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", fields)
	}
	row, err := s.store.UpsertDeviceToken(ctx, userID, platform, token)
	if err != nil {
		return DeviceTokenDTO{}, err
	}
	return DeviceTokenDTO{
		ID: row.ID, Platform: row.Platform, Token: row.Token,
		Enabled: row.Enabled, LastSeenAt: row.LastSeenAt, CreatedAt: row.CreatedAt,
	}, nil
}

func (s *Service) Notify(ctx context.Context, userID uuid.UUID, typ string, loanID *uuid.UUID, title, body string, payload map[string]any) error {
	if payload == nil {
		payload = map[string]any{}
	}
	raw, _ := json.Marshal(payload)
	if raw == nil {
		raw = []byte("{}")
	}
	n := Notification{
		UserID: userID, Type: typ, LoanID: loanID,
		Title: title, Body: body, Payload: raw, PushStatus: PushPending,
	}
	tokens, err := s.store.ListEnabledTokens(ctx, userID)
	if err != nil {
		return err
	}
	result := s.push.Send(ctx, tokens, PushMessage{Title: title, Body: body, Data: stringMap(payload)})
	n.PushStatus = result.Status
	if result.Error != "" {
		errMsg := result.Error
		n.PushError = &errMsg
	}
	_, err = s.store.InsertNotification(ctx, n)
	return err
}

func (s *Service) ScheduleLoanReminders(ctx context.Context, loan loans.Record) error {
	if loan.LoanKind == loans.KindLongTerm {
		return s.scheduleInstallmentReminders(ctx, loan)
	}
	if loan.DueAt == nil {
		return nil
	}
	due := loan.DueAt.UTC()
	users := reminderUsers(loan)
	kinds := []struct {
		kind string
		at   time.Time
	}{
		{KindDueSoon7d, due.Add(-7 * 24 * time.Hour)},
		{KindDueSoon3d, due.Add(-3 * 24 * time.Hour)},
		{KindDueSoon1d, due.Add(-24 * time.Hour)},
		{KindDueToday, due},
		{KindOverdue, due.Add(24 * time.Hour)},
	}
	for _, userID := range users {
		for _, k := range kinds {
			_, _, err := s.store.InsertJob(ctx, Job{
				JobKey: JobKey(loan.ID, userID, milestoneOf(k.kind)),
				UserID: userID,
				LoanID: loan.ID,
				Kind:   k.kind,
				RunAt:  k.at,
				Status: JobPending,
			})
			if err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Service) scheduleInstallmentReminders(ctx context.Context, loan loans.Record) error {
	users := reminderUsers(loan)
	dues := installmentDueDates(loan)
	if len(dues) == 0 && loan.DueAt != nil {
		dues = []struct {
			seq int
			at  time.Time
		}{{1, loan.DueAt.UTC()}}
	}
	limit := 60
	if len(dues) < limit {
		limit = len(dues)
	}
	for i := 0; i < limit; i++ {
		due := dues[i]
		seq := fmt.Sprintf("%d", due.seq)
		for _, userID := range users {
			for _, k := range []struct {
				kind string
				at   time.Time
				ms   string
			}{
				{KindInstallmentDue, due.at.Add(-24 * time.Hour), "inst-" + seq + "-1d"},
				{KindInstallmentDue, due.at, "inst-" + seq + "-due"},
				{KindInstallmentOverdue, due.at.Add(24 * time.Hour), "inst-" + seq + "-overdue"},
			} {
				_, _, err := s.store.InsertJob(ctx, Job{
					JobKey: JobKey(loan.ID, userID, k.ms),
					UserID: userID,
					LoanID: loan.ID,
					Kind:   k.kind,
					RunAt:  k.at,
					Status: JobPending,
				})
				if err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func installmentDueDates(loan loans.Record) []struct {
	seq int
	at  time.Time
} {
	if loan.InstallmentCount == nil || loan.Principal == nil || loan.InterestRatePercent == nil {
		return nil
	}
	months := int(*loan.InstallmentCount)
	start := time.Now().UTC()
	if loan.StartAt != nil {
		start = loan.StartAt.UTC()
	}
	emi := loans.ComputeEMI(*loan.Principal, *loan.InterestRatePercent, months)
	if loan.InstallmentAmount != nil {
		emi = *loan.InstallmentAmount
	}
	plan := loans.BuildInstallmentSchedule(*loan.Principal, *loan.InterestRatePercent, emi, months, start)
	out := make([]struct {
		seq int
		at  time.Time
	}, 0, len(plan))
	for _, p := range plan {
		out = append(out, struct {
			seq int
			at  time.Time
		}{p.Sequence, p.DueAt})
	}
	return out
}

func reminderUsers(loan loans.Record) []uuid.UUID {
	if loan.IsInstitutional() {
		return []uuid.UUID{loan.BorrowerID}
	}
	return []uuid.UUID{loan.BorrowerID, loan.LenderID}
}

func milestoneOf(kind string) string {
	switch kind {
	case KindDueSoon7d:
		return "due-7d"
	case KindDueSoon3d:
		return "due-3d"
	case KindDueSoon1d:
		return "due-1d"
	case KindDueToday:
		return "due-today"
	case KindOverdue:
		return "overdue"
	default:
		return kind
	}
}

func (s *Service) CancelLoanReminders(ctx context.Context, loanID uuid.UUID) error {
	return s.store.CancelPendingJobsForLoan(ctx, loanID)
}

func (s *Service) ProcessDueJobs(ctx context.Context) (int, error) {
	jobs, err := s.store.ClaimDueJobs(ctx, s.now().UTC(), 50)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, job := range jobs {
		if err := s.deliverJob(ctx, job); err != nil {
			_ = s.store.FailJob(ctx, job.ID, err.Error())
			continue
		}
		if err := s.store.CompleteJob(ctx, job.ID); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

func (s *Service) Reconcile(ctx context.Context) (int, error) {
	loansRows, err := s.store.ListOpenLoansForReminders(ctx)
	if err != nil {
		return 0, err
	}
	created := 0
	for _, loan := range loansRows {
		users := []uuid.UUID{loan.BorrowerID, loan.LenderID}
		milestones := []string{"due-7d", "due-3d", "due-1d", "due-today", "overdue"}
		kinds := []string{KindDueSoon7d, KindDueSoon3d, KindDueSoon1d, KindDueToday, KindOverdue}
		offsets := []time.Duration{-7 * 24 * time.Hour, -3 * 24 * time.Hour, -24 * time.Hour, 0, 24 * time.Hour}
		for _, userID := range users {
			for i, ms := range milestones {
				key := JobKey(loan.ID, userID, ms)
				if _, err := s.store.GetJobByKey(ctx, key); err == nil {
					continue
				} else if !errors.Is(err, pgx.ErrNoRows) {
					return created, err
				}
				_, inserted, err := s.store.InsertJob(ctx, Job{
					JobKey: key,
					UserID: userID,
					LoanID: loan.ID,
					Kind:   kinds[i],
					RunAt:  loan.DueAt.UTC().Add(offsets[i]),
					Status: JobPending,
				})
				if err != nil {
					return created, err
				}
				if inserted {
					created++
				}
			}
		}
	}
	return created, nil
}

func (s *Service) deliverJob(ctx context.Context, job Job) error {
	loan, err := s.store.GetLoanRef(ctx, job.LoanID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if loan.Status == loans.StatusCompleted || loan.Status == loans.StatusCancelled || loan.Status == loans.StatusRejected {
		return nil
	}
	title, body, typ := reminderCopy(job.Kind, loan.ReferenceCode)
	return s.Notify(ctx, job.UserID, typ, &job.LoanID, title, body, map[string]any{
		"reference_code": loan.ReferenceCode,
		"kind":           job.Kind,
	})
}

func reminderCopy(kind, ref string) (title, body, typ string) {
	switch kind {
	case KindDueSoon7d:
		return "Payment reminder", "Loan "+ref+" is due in 7 days.", TypeDueSoon
	case KindDueSoon3d:
		return "Payment reminder", "Loan "+ref+" is due in 3 days.", TypeDueSoon
	case KindDueSoon1d:
		return "Payment reminder", "Loan "+ref+" is due tomorrow.", TypeDueSoon
	case KindDueToday:
		return "Due today", "Loan "+ref+" is due today.", TypeDueToday
	case KindOverdue:
		return "Overdue", "Loan "+ref+" is overdue.", TypeOverdue
	case KindInstallmentDue:
		return "Installment due", "A monthly payment for "+ref+" is due.", TypeDueToday
	case KindInstallmentOverdue:
		return "Installment overdue", "A monthly payment for "+ref+" is overdue.", TypeOverdue
	default:
		return "Reminder", "Loan "+ref+" needs attention.", TypeDueSoon
	}
}

func stringMap(payload map[string]any) map[string]string {
	out := map[string]string{}
	for k, v := range payload {
		out[k] = strings.TrimSpace(strings.ReplaceAll(toString(v), "\n", " "))
	}
	return out
}

func toString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	default:
		b, _ := json.Marshal(t)
		return string(b)
	}
}

// Convenience hooks for other domains (safe copy only).

func (s *Service) NotifyLoanAccepted(ctx context.Context, recipient uuid.UUID, loanID uuid.UUID, ref string) error {
	return s.Notify(ctx, recipient, TypeLoanAccepted, &loanID, "Loan accepted", "Loan "+ref+" is now active.", map[string]any{
		"reference_code": ref,
	})
}

func (s *Service) NotifyLoanRequest(ctx context.Context, recipient uuid.UUID, loanID uuid.UUID, ref string) error {
	return s.Notify(ctx, recipient, TypeLoanRequest, &loanID, "New loan request", "You have a new loan request "+ref+".", map[string]any{
		"reference_code": ref,
	})
}

func (s *Service) NotifyRepaymentSubmitted(ctx context.Context, lender uuid.UUID, loanID uuid.UUID, ref string) error {
	return s.Notify(ctx, lender, TypeRepaymentSubmitted, &loanID, "Repayment claimed", "A repayment was claimed for "+ref+".", map[string]any{
		"reference_code": ref,
	})
}

func (s *Service) NotifyRepaymentConfirmed(ctx context.Context, borrower uuid.UUID, loanID uuid.UUID, ref string) error {
	return s.Notify(ctx, borrower, TypeRepaymentConfirmed, &loanID, "Repayment confirmed", "Your repayment for "+ref+" was confirmed.", map[string]any{
		"reference_code": ref,
	})
}

func (s *Service) NotifyRepaymentRejected(ctx context.Context, borrower uuid.UUID, loanID uuid.UUID, ref string) error {
	return s.Notify(ctx, borrower, TypeRepaymentRejected, &loanID, "Repayment rejected", "A repayment claim for "+ref+" was rejected.", map[string]any{
		"reference_code": ref,
	})
}

func (s *Service) NotifyFriendRequest(ctx context.Context, addressee uuid.UUID) error {
	// Legacy endpoint; product no longer surfaces friend requests.
	return s.Notify(ctx, addressee, TypeFriendRequest, nil, "New connection", "Someone wants to work with you on Lony.", map[string]any{})
}

func (s *Service) NotifyFriendAccepted(ctx context.Context, requester uuid.UUID) error {
	return s.Notify(ctx, requester, TypeFriendAccepted, nil, "Friend request accepted", "Your connection request was accepted.", map[string]any{})
}

func (s *Service) NotifyBankShared(ctx context.Context, recipient, loanID uuid.UUID, ref string) error {
	return s.Notify(ctx, recipient, TypeBankProfileShared, &loanID, "Payment profile shared", "A payment profile was shared for "+ref+".", map[string]any{
		"reference_code": ref,
	})
}
