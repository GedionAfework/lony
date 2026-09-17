-- name: InsertLoan :one
INSERT INTO loans (
  reference_code, borrower_id, lender_id, initiator_id, status
) VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetLoanByID :one
SELECT * FROM loans
WHERE id = $1;

-- name: ListLoansForUser :many
SELECT * FROM loans
WHERE (borrower_id = $1 OR lender_id = $1)
  AND ($2::text IS NULL OR status = $2)
  AND (
    $3::text IS NULL
    OR ($3 = 'borrower' AND borrower_id = $1)
    OR ($3 = 'lender' AND lender_id = $1)
  )
ORDER BY created_at DESC;

-- name: UpdateLoan :one
UPDATE loans
SET
  status = $2,
  principal_amount = $3,
  currency_code = $4,
  interest_rate_percent = $5,
  interest_amount = $6,
  expected_total = $7,
  outstanding_amount = $8,
  due_at = $9,
  note = $10,
  current_terms_id = $11,
  accepted_terms_id = $12,
  terms_version = $13,
  proposed_by_user_id = $14,
  accepted_at = $15,
  updated_at = now()
WHERE id = $1
RETURNING *;

-- name: InsertLoanTerms :one
INSERT INTO loan_terms (
  loan_id, version, principal_amount, currency_code, interest_rate_percent,
  interest_amount, expected_total, due_at, note, proposed_by_user_id, status
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
)
RETURNING *;

-- name: ListLoanTerms :many
SELECT * FROM loan_terms
WHERE loan_id = $1
ORDER BY version;

-- name: SupersedeProposedLoanTerms :exec
UPDATE loan_terms
SET status = 'superseded'
WHERE loan_id = $1 AND status = 'proposed';

-- name: AcceptLoanTerms :one
UPDATE loan_terms
SET status = 'accepted'
WHERE id = $1 AND status = 'proposed'
RETURNING *;

-- name: InsertLoanEvent :one
INSERT INTO loan_events (loan_id, actor_id, event_type, payload)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListLoanEvents :many
SELECT * FROM loan_events
WHERE loan_id = $1
ORDER BY created_at ASC, id ASC;

-- name: MarkLoansOverdue :many
UPDATE loans
SET status = 'overdue', updated_at = now()
WHERE status = 'active'
  AND due_at < $1
  AND COALESCE(outstanding_amount, 0) > 0
RETURNING *;
