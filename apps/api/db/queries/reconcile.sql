-- name: ListOpenLoansForReconcile :many
SELECT id, reference_code, status, expected_total, outstanding_amount
FROM loans
WHERE status IN ('active', 'overdue', 'repayment_pending');

-- name: SumConfirmedRepayments :one
SELECT COALESCE(SUM(amount), 0)::text AS total
FROM repayments
WHERE loan_id = $1 AND status = 'confirmed';
