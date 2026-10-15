package sqlc

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type Notification struct {
	ID         uuid.UUID  `json:"id"`
	UserID     uuid.UUID  `json:"user_id"`
	Type       string     `json:"type"`
	LoanID     *uuid.UUID `json:"loan_id"`
	Title      string     `json:"title"`
	Body       string     `json:"body"`
	Payload    []byte     `json:"payload"`
	PushStatus string     `json:"push_status"`
	PushError  *string    `json:"push_error"`
	ReadAt     *time.Time `json:"read_at"`
	CreatedAt  time.Time  `json:"created_at"`
}

type DeviceToken struct {
	ID         uuid.UUID `json:"id"`
	UserID     uuid.UUID `json:"user_id"`
	Platform   string    `json:"platform"`
	Token      string    `json:"token"`
	Enabled    bool      `json:"enabled"`
	LastSeenAt time.Time `json:"last_seen_at"`
	CreatedAt  time.Time `json:"created_at"`
}

type NotificationJob struct {
	ID          uuid.UUID  `json:"id"`
	JobKey      string     `json:"job_key"`
	UserID      uuid.UUID  `json:"user_id"`
	LoanID      uuid.UUID  `json:"loan_id"`
	Kind        string     `json:"kind"`
	RunAt       time.Time  `json:"run_at"`
	Status      string     `json:"status"`
	Attempts    int32      `json:"attempts"`
	LastError   *string    `json:"last_error"`
	CompletedAt *time.Time `json:"completed_at"`
	CreatedAt   time.Time  `json:"created_at"`
}

type OpenLoanForReminder struct {
	ID            uuid.UUID `json:"id"`
	ReferenceCode string    `json:"reference_code"`
	BorrowerID    uuid.UUID `json:"borrower_id"`
	LenderID      uuid.UUID `json:"lender_id"`
	Status        string    `json:"status"`
	DueAt         time.Time `json:"due_at"`
	CurrencyCode  *string   `json:"currency_code"`
}

func scanNotification(scan func(dest ...any) error) (Notification, error) {
	var i Notification
	err := scan(&i.ID, &i.UserID, &i.Type, &i.LoanID, &i.Title, &i.Body, &i.Payload, &i.PushStatus, &i.PushError, &i.ReadAt, &i.CreatedAt)
	return i, err
}

func scanDeviceToken(scan func(dest ...any) error) (DeviceToken, error) {
	var i DeviceToken
	err := scan(&i.ID, &i.UserID, &i.Platform, &i.Token, &i.Enabled, &i.LastSeenAt, &i.CreatedAt)
	return i, err
}

func scanNotificationJob(scan func(dest ...any) error) (NotificationJob, error) {
	var i NotificationJob
	err := scan(&i.ID, &i.JobKey, &i.UserID, &i.LoanID, &i.Kind, &i.RunAt, &i.Status, &i.Attempts, &i.LastError, &i.CompletedAt, &i.CreatedAt)
	return i, err
}

const insertNotification = `-- name: InsertNotification :one
INSERT INTO notifications (
  user_id, type, loan_id, title, body, payload, push_status, push_error
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, user_id, type, loan_id, title, body, payload, push_status, push_error, read_at, created_at
`

type InsertNotificationParams struct {
	UserID     uuid.UUID  `json:"user_id"`
	Type       string     `json:"type"`
	LoanID     *uuid.UUID `json:"loan_id"`
	Title      string     `json:"title"`
	Body       string     `json:"body"`
	Payload    []byte     `json:"payload"`
	PushStatus string     `json:"push_status"`
	PushError  *string    `json:"push_error"`
}

func (q *Queries) InsertNotification(ctx context.Context, arg InsertNotificationParams) (Notification, error) {
	row := q.db.QueryRow(ctx, insertNotification, arg.UserID, arg.Type, arg.LoanID, arg.Title, arg.Body, arg.Payload, arg.PushStatus, arg.PushError)
	return scanNotification(row.Scan)
}

const listNotificationsForUser = `-- name: ListNotificationsForUser :many
SELECT id, user_id, type, loan_id, title, body, payload, push_status, push_error, read_at, created_at FROM notifications
WHERE user_id = $1
  AND ($2::boolean = false OR read_at IS NULL)
ORDER BY created_at DESC
LIMIT $3
`

type ListNotificationsForUserParams struct {
	UserID     uuid.UUID `json:"user_id"`
	UnreadOnly bool      `json:"unread_only"`
	Limit      int32     `json:"limit"`
}

func (q *Queries) ListNotificationsForUser(ctx context.Context, arg ListNotificationsForUserParams) ([]Notification, error) {
	rows, err := q.db.Query(ctx, listNotificationsForUser, arg.UserID, arg.UnreadOnly, arg.Limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Notification{}
	for rows.Next() {
		item, err := scanNotification(rows.Scan)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

const getNotificationByID = `-- name: GetNotificationByID :one
SELECT id, user_id, type, loan_id, title, body, payload, push_status, push_error, read_at, created_at FROM notifications
WHERE id = $1
`

func (q *Queries) GetNotificationByID(ctx context.Context, id uuid.UUID) (Notification, error) {
	row := q.db.QueryRow(ctx, getNotificationByID, id)
	return scanNotification(row.Scan)
}

const markNotificationRead = `-- name: MarkNotificationRead :one
UPDATE notifications
SET read_at = COALESCE(read_at, now())
WHERE id = $1 AND user_id = $2
RETURNING id, user_id, type, loan_id, title, body, payload, push_status, push_error, read_at, created_at
`

type MarkNotificationReadParams struct {
	ID     uuid.UUID `json:"id"`
	UserID uuid.UUID `json:"user_id"`
}

func (q *Queries) MarkNotificationRead(ctx context.Context, arg MarkNotificationReadParams) (Notification, error) {
	row := q.db.QueryRow(ctx, markNotificationRead, arg.ID, arg.UserID)
	return scanNotification(row.Scan)
}

const markAllNotificationsRead = `-- name: MarkAllNotificationsRead :exec
UPDATE notifications
SET read_at = now()
WHERE user_id = $1 AND read_at IS NULL
`

func (q *Queries) MarkAllNotificationsRead(ctx context.Context, userID uuid.UUID) error {
	_, err := q.db.Exec(ctx, markAllNotificationsRead, userID)
	return err
}

const countUnreadNotifications = `-- name: CountUnreadNotifications :one
SELECT COUNT(*)::int AS count
FROM notifications
WHERE user_id = $1 AND read_at IS NULL
`

func (q *Queries) CountUnreadNotifications(ctx context.Context, userID uuid.UUID) (int32, error) {
	row := q.db.QueryRow(ctx, countUnreadNotifications, userID)
	var count int32
	err := row.Scan(&count)
	return count, err
}

const upsertDeviceToken = `-- name: UpsertDeviceToken :one
INSERT INTO device_tokens (user_id, platform, token, enabled, last_seen_at)
VALUES ($1, $2, $3, true, now())
ON CONFLICT (user_id, token) DO UPDATE
SET platform = EXCLUDED.platform,
    enabled = true,
    last_seen_at = now()
RETURNING id, user_id, platform, token, enabled, last_seen_at, created_at
`

type UpsertDeviceTokenParams struct {
	UserID   uuid.UUID `json:"user_id"`
	Platform string    `json:"platform"`
	Token    string    `json:"token"`
}

func (q *Queries) UpsertDeviceToken(ctx context.Context, arg UpsertDeviceTokenParams) (DeviceToken, error) {
	row := q.db.QueryRow(ctx, upsertDeviceToken, arg.UserID, arg.Platform, arg.Token)
	return scanDeviceToken(row.Scan)
}

const listEnabledDeviceTokens = `-- name: ListEnabledDeviceTokens :many
SELECT id, user_id, platform, token, enabled, last_seen_at, created_at FROM device_tokens
WHERE user_id = $1 AND enabled = true
`

func (q *Queries) ListEnabledDeviceTokens(ctx context.Context, userID uuid.UUID) ([]DeviceToken, error) {
	rows, err := q.db.Query(ctx, listEnabledDeviceTokens, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []DeviceToken{}
	for rows.Next() {
		item, err := scanDeviceToken(rows.Scan)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

const disableDeviceToken = `-- name: DisableDeviceToken :one
UPDATE device_tokens
SET enabled = false, last_seen_at = now()
WHERE user_id = $1 AND token = $2
RETURNING id, user_id, platform, token, enabled, last_seen_at, created_at
`

type DisableDeviceTokenParams struct {
	UserID uuid.UUID `json:"user_id"`
	Token  string    `json:"token"`
}

func (q *Queries) DisableDeviceToken(ctx context.Context, arg DisableDeviceTokenParams) (DeviceToken, error) {
	row := q.db.QueryRow(ctx, disableDeviceToken, arg.UserID, arg.Token)
	return scanDeviceToken(row.Scan)
}

const insertNotificationJob = `-- name: InsertNotificationJob :one
INSERT INTO notification_jobs (
  job_key, user_id, loan_id, kind, run_at, status
) VALUES ($1, $2, $3, $4, $5, 'pending')
ON CONFLICT (job_key) DO NOTHING
RETURNING id, job_key, user_id, loan_id, kind, run_at, status, attempts, last_error, completed_at, created_at
`

type InsertNotificationJobParams struct {
	JobKey string    `json:"job_key"`
	UserID uuid.UUID `json:"user_id"`
	LoanID uuid.UUID `json:"loan_id"`
	Kind   string    `json:"kind"`
	RunAt  time.Time `json:"run_at"`
}

func (q *Queries) InsertNotificationJob(ctx context.Context, arg InsertNotificationJobParams) (NotificationJob, error) {
	row := q.db.QueryRow(ctx, insertNotificationJob, arg.JobKey, arg.UserID, arg.LoanID, arg.Kind, arg.RunAt)
	return scanNotificationJob(row.Scan)
}

const getNotificationJobByKey = `-- name: GetNotificationJobByKey :one
SELECT id, job_key, user_id, loan_id, kind, run_at, status, attempts, last_error, completed_at, created_at FROM notification_jobs
WHERE job_key = $1
`

func (q *Queries) GetNotificationJobByKey(ctx context.Context, jobKey string) (NotificationJob, error) {
	row := q.db.QueryRow(ctx, getNotificationJobByKey, jobKey)
	return scanNotificationJob(row.Scan)
}

const listPendingNotificationJobs = `-- name: ListPendingNotificationJobs :many
SELECT id, job_key, user_id, loan_id, kind, run_at, status, attempts, last_error, completed_at, created_at FROM notification_jobs
WHERE status = 'pending' AND run_at <= $1
ORDER BY run_at
LIMIT $2
`

type ListPendingNotificationJobsParams struct {
	RunAt time.Time `json:"run_at"`
	Limit int32     `json:"limit"`
}

func (q *Queries) ListPendingNotificationJobs(ctx context.Context, arg ListPendingNotificationJobsParams) ([]NotificationJob, error) {
	rows, err := q.db.Query(ctx, listPendingNotificationJobs, arg.RunAt, arg.Limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []NotificationJob{}
	for rows.Next() {
		item, err := scanNotificationJob(rows.Scan)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

const completeNotificationJob = `-- name: CompleteNotificationJob :one
UPDATE notification_jobs
SET status = 'completed', completed_at = now(), attempts = attempts + 1
WHERE id = $1
RETURNING id, job_key, user_id, loan_id, kind, run_at, status, attempts, last_error, completed_at, created_at
`

func (q *Queries) CompleteNotificationJob(ctx context.Context, id uuid.UUID) (NotificationJob, error) {
	row := q.db.QueryRow(ctx, completeNotificationJob, id)
	return scanNotificationJob(row.Scan)
}

const failNotificationJob = `-- name: FailNotificationJob :one
UPDATE notification_jobs
SET status = 'failed', last_error = $2, attempts = attempts + 1, completed_at = now()
WHERE id = $1
RETURNING id, job_key, user_id, loan_id, kind, run_at, status, attempts, last_error, completed_at, created_at
`

type FailNotificationJobParams struct {
	ID        uuid.UUID `json:"id"`
	LastError *string   `json:"last_error"`
}

func (q *Queries) FailNotificationJob(ctx context.Context, arg FailNotificationJobParams) (NotificationJob, error) {
	row := q.db.QueryRow(ctx, failNotificationJob, arg.ID, arg.LastError)
	return scanNotificationJob(row.Scan)
}

const cancelPendingJobsForLoan = `-- name: CancelPendingJobsForLoan :exec
UPDATE notification_jobs
SET status = 'cancelled', completed_at = now()
WHERE loan_id = $1 AND status = 'pending'
`

func (q *Queries) CancelPendingJobsForLoan(ctx context.Context, loanID uuid.UUID) error {
	_, err := q.db.Exec(ctx, cancelPendingJobsForLoan, loanID)
	return err
}

const listOpenLoansForReminders = `-- name: ListOpenLoansForReminders :many
SELECT id, reference_code, borrower_id, lender_id, status, due_at, currency_code
FROM loans
WHERE status IN ('active', 'overdue', 'repayment_pending')
  AND due_at IS NOT NULL
`

func (q *Queries) ListOpenLoansForReminders(ctx context.Context) ([]OpenLoanForReminder, error) {
	rows, err := q.db.Query(ctx, listOpenLoansForReminders)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []OpenLoanForReminder{}
	for rows.Next() {
		var i OpenLoanForReminder
		if err := rows.Scan(&i.ID, &i.ReferenceCode, &i.BorrowerID, &i.LenderID, &i.Status, &i.DueAt, &i.CurrencyCode); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	return items, rows.Err()
}
