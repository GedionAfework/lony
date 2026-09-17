package store

import (
	"context"
	"errors"
	"time"

	"equilend/api/internal/notifications"
	"equilend/api/internal/store/sqlc"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s *SQLStore) InsertNotification(ctx context.Context, n notifications.Notification) (notifications.Notification, error) {
	payload := n.Payload
	if len(payload) == 0 {
		payload = []byte("{}")
	}
	row, err := s.q.InsertNotification(ctx, sqlc.InsertNotificationParams{
		UserID: n.UserID, Type: n.Type, LoanID: n.LoanID,
		Title: n.Title, Body: n.Body, Payload: payload,
		PushStatus: n.PushStatus, PushError: n.PushError,
	})
	if err != nil {
		return notifications.Notification{}, err
	}
	return mapNotification(row), nil
}

func (s *SQLStore) ListNotifications(ctx context.Context, userID uuid.UUID, unreadOnly bool, limit int32) ([]notifications.Notification, error) {
	rows, err := s.q.ListNotificationsForUser(ctx, sqlc.ListNotificationsForUserParams{
		UserID: userID, UnreadOnly: unreadOnly, Limit: limit,
	})
	if err != nil {
		return nil, err
	}
	out := make([]notifications.Notification, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapNotification(row))
	}
	return out, nil
}

func (s *SQLStore) GetNotification(ctx context.Context, id uuid.UUID) (notifications.Notification, error) {
	row, err := s.q.GetNotificationByID(ctx, id)
	if err != nil {
		return notifications.Notification{}, err
	}
	return mapNotification(row), nil
}

func (s *SQLStore) MarkRead(ctx context.Context, userID, id uuid.UUID) (notifications.Notification, error) {
	row, err := s.q.MarkNotificationRead(ctx, sqlc.MarkNotificationReadParams{ID: id, UserID: userID})
	if err != nil {
		return notifications.Notification{}, err
	}
	return mapNotification(row), nil
}

func (s *SQLStore) MarkAllRead(ctx context.Context, userID uuid.UUID) error {
	return s.q.MarkAllNotificationsRead(ctx, userID)
}

func (s *SQLStore) CountUnread(ctx context.Context, userID uuid.UUID) (int32, error) {
	return s.q.CountUnreadNotifications(ctx, userID)
}

func (s *SQLStore) UpsertDeviceToken(ctx context.Context, userID uuid.UUID, platform, token string) (notifications.DeviceToken, error) {
	row, err := s.q.UpsertDeviceToken(ctx, sqlc.UpsertDeviceTokenParams{
		UserID: userID, Platform: platform, Token: token,
	})
	if err != nil {
		return notifications.DeviceToken{}, err
	}
	return mapDeviceToken(row), nil
}

func (s *SQLStore) ListEnabledTokens(ctx context.Context, userID uuid.UUID) ([]notifications.DeviceToken, error) {
	rows, err := s.q.ListEnabledDeviceTokens(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]notifications.DeviceToken, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapDeviceToken(row))
	}
	return out, nil
}

func (s *SQLStore) DisableDeviceToken(ctx context.Context, userID uuid.UUID, token string) (notifications.DeviceToken, error) {
	row, err := s.q.DisableDeviceToken(ctx, sqlc.DisableDeviceTokenParams{UserID: userID, Token: token})
	if err != nil {
		return notifications.DeviceToken{}, err
	}
	return mapDeviceToken(row), nil
}

func (s *SQLStore) InsertJob(ctx context.Context, job notifications.Job) (notifications.Job, bool, error) {
	row, err := s.q.InsertNotificationJob(ctx, sqlc.InsertNotificationJobParams{
		JobKey: job.JobKey, UserID: job.UserID, LoanID: job.LoanID, Kind: job.Kind, RunAt: job.RunAt,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		existing, getErr := s.q.GetNotificationJobByKey(ctx, job.JobKey)
		if getErr != nil {
			return notifications.Job{}, false, getErr
		}
		return mapJob(existing), false, nil
	}
	if err != nil {
		return notifications.Job{}, false, err
	}
	return mapJob(row), true, nil
}

func (s *SQLStore) GetJobByKey(ctx context.Context, key string) (notifications.Job, error) {
	row, err := s.q.GetNotificationJobByKey(ctx, key)
	if err != nil {
		return notifications.Job{}, err
	}
	return mapJob(row), nil
}

func (s *SQLStore) ClaimDueJobs(ctx context.Context, now time.Time, limit int32) ([]notifications.Job, error) {
	rows, err := s.q.ListPendingNotificationJobs(ctx, sqlc.ListPendingNotificationJobsParams{RunAt: now, Limit: limit})
	if err != nil {
		return nil, err
	}
	out := make([]notifications.Job, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapJob(row))
	}
	return out, nil
}

func (s *SQLStore) CompleteJob(ctx context.Context, id uuid.UUID) error {
	_, err := s.q.CompleteNotificationJob(ctx, id)
	return err
}

func (s *SQLStore) FailJob(ctx context.Context, id uuid.UUID, errMsg string) error {
	_, err := s.q.FailNotificationJob(ctx, sqlc.FailNotificationJobParams{ID: id, LastError: &errMsg})
	return err
}

func (s *SQLStore) CancelPendingJobsForLoan(ctx context.Context, loanID uuid.UUID) error {
	return s.q.CancelPendingJobsForLoan(ctx, loanID)
}

func (s *SQLStore) ListOpenLoansForReminders(ctx context.Context) ([]notifications.OpenLoan, error) {
	rows, err := s.q.ListOpenLoansForReminders(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]notifications.OpenLoan, 0, len(rows))
	for _, row := range rows {
		out = append(out, notifications.OpenLoan{
			ID: row.ID, ReferenceCode: row.ReferenceCode,
			BorrowerID: row.BorrowerID, LenderID: row.LenderID,
			Status: row.Status, DueAt: row.DueAt, CurrencyCode: row.CurrencyCode,
		})
	}
	return out, nil
}

func (s *SQLStore) GetLoanRef(ctx context.Context, loanID uuid.UUID) (notifications.OpenLoan, error) {
	row, err := s.q.GetLoanByID(ctx, loanID)
	if err != nil {
		return notifications.OpenLoan{}, err
	}
	if row.DueAt == nil {
		return notifications.OpenLoan{
			ID: row.ID, ReferenceCode: row.ReferenceCode,
			BorrowerID: row.BorrowerID, LenderID: row.LenderID, Status: row.Status, CurrencyCode: row.CurrencyCode,
		}, nil
	}
	return notifications.OpenLoan{
		ID: row.ID, ReferenceCode: row.ReferenceCode,
		BorrowerID: row.BorrowerID, LenderID: row.LenderID,
		Status: row.Status, DueAt: *row.DueAt, CurrencyCode: row.CurrencyCode,
	}, nil
}

func mapNotification(row sqlc.Notification) notifications.Notification {
	return notifications.Notification{
		ID: row.ID, UserID: row.UserID, Type: row.Type, LoanID: row.LoanID,
		Title: row.Title, Body: row.Body, Payload: row.Payload,
		PushStatus: row.PushStatus, PushError: row.PushError,
		ReadAt: row.ReadAt, CreatedAt: row.CreatedAt,
	}
}

func mapDeviceToken(row sqlc.DeviceToken) notifications.DeviceToken {
	return notifications.DeviceToken{
		ID: row.ID, UserID: row.UserID, Platform: row.Platform, Token: row.Token,
		Enabled: row.Enabled, LastSeenAt: row.LastSeenAt, CreatedAt: row.CreatedAt,
	}
}

func mapJob(row sqlc.NotificationJob) notifications.Job {
	return notifications.Job{
		ID: row.ID, JobKey: row.JobKey, UserID: row.UserID, LoanID: row.LoanID,
		Kind: row.Kind, RunAt: row.RunAt, Status: row.Status, Attempts: row.Attempts,
		LastError: row.LastError, CompletedAt: row.CompletedAt, CreatedAt: row.CreatedAt,
	}
}
