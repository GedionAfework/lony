-- name: InsertNotification :one
INSERT INTO notifications (
  user_id, type, loan_id, title, body, payload, push_status, push_error
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: ListNotificationsForUser :many
SELECT * FROM notifications
WHERE user_id = $1
  AND ($2::boolean = false OR read_at IS NULL)
ORDER BY created_at DESC
LIMIT $3;

-- name: GetNotificationByID :one
SELECT * FROM notifications
WHERE id = $1;

-- name: MarkNotificationRead :one
UPDATE notifications
SET read_at = COALESCE(read_at, now())
WHERE id = $1 AND user_id = $2
RETURNING *;

-- name: MarkAllNotificationsRead :exec
UPDATE notifications
SET read_at = now()
WHERE user_id = $1 AND read_at IS NULL;

-- name: CountUnreadNotifications :one
SELECT COUNT(*)::int AS count
FROM notifications
WHERE user_id = $1 AND read_at IS NULL;

-- name: UpsertDeviceToken :one
INSERT INTO device_tokens (user_id, platform, token, enabled, last_seen_at)
VALUES ($1, $2, $3, true, now())
ON CONFLICT (user_id, token) DO UPDATE
SET platform = EXCLUDED.platform,
    enabled = true,
    last_seen_at = now()
RETURNING *;

-- name: ListEnabledDeviceTokens :many
SELECT * FROM device_tokens
WHERE user_id = $1 AND enabled = true;

-- name: DisableDeviceToken :one
UPDATE device_tokens
SET enabled = false, last_seen_at = now()
WHERE user_id = $1 AND token = $2
RETURNING *;

-- name: InsertNotificationJob :one
INSERT INTO notification_jobs (
  job_key, user_id, loan_id, kind, run_at, status
) VALUES ($1, $2, $3, $4, $5, 'pending')
ON CONFLICT (job_key) DO NOTHING
RETURNING *;

-- name: GetNotificationJobByKey :one
SELECT * FROM notification_jobs
WHERE job_key = $1;

-- name: ListPendingNotificationJobs :many
SELECT * FROM notification_jobs
WHERE status = 'pending' AND run_at <= $1
ORDER BY run_at
LIMIT $2;


-- name: CompleteNotificationJob :one
UPDATE notification_jobs
SET status = 'completed', completed_at = now(), attempts = attempts + 1
WHERE id = $1
RETURNING *;

-- name: FailNotificationJob :one
UPDATE notification_jobs
SET status = 'failed', last_error = $2, attempts = attempts + 1, completed_at = now()
WHERE id = $1
RETURNING *;

-- name: CancelPendingJobsForLoan :exec
UPDATE notification_jobs
SET status = 'cancelled', completed_at = now()
WHERE loan_id = $1 AND status = 'pending';

-- name: ListOpenLoansForReminders :many
SELECT id, reference_code, borrower_id, lender_id, status, due_at, currency_code
FROM loans
WHERE status IN ('active', 'overdue', 'repayment_pending')
  AND due_at IS NOT NULL;
