-- name: InsertRepayment :one
INSERT INTO repayments (
  loan_id, submitted_by_user_id, amount, status, note, proof_attachment_id, submitted_at
) VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: GetRepaymentByID :one
SELECT * FROM repayments
WHERE id = $1;

-- name: ListRepaymentsForLoan :many
SELECT * FROM repayments
WHERE loan_id = $1
ORDER BY submitted_at DESC;

-- name: GetPendingRepaymentForLoan :one
SELECT * FROM repayments
WHERE loan_id = $1 AND status = 'pending'
LIMIT 1;

-- name: UpdateRepayment :one
UPDATE repayments
SET
  status = $2,
  confirmed_by_user_id = $3,
  confirmed_at = $4,
  rejected_at = $5,
  rejection_reason = $6,
  updated_at = now()
WHERE id = $1
RETURNING *;

-- name: SumClaimedAgainstOutstanding :one
SELECT COALESCE(SUM(amount), 0)::text AS total
FROM repayments
WHERE loan_id = $1
  AND status IN ('pending', 'confirmed');
