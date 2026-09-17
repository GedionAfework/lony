package sqlc

import (
	"context"
	"time"

	"github.com/google/uuid"
)

func scanRepayment(scan func(dest ...any) error) (Repayment, error) {
	var i Repayment
	err := scan(
		&i.ID,
		&i.LoanID,
		&i.SubmittedByUserID,
		&i.Amount,
		&i.Status,
		&i.Note,
		&i.ProofAttachmentID,
		&i.SubmittedAt,
		&i.ConfirmedByUserID,
		&i.ConfirmedAt,
		&i.RejectedAt,
		&i.RejectionReason,
		&i.CreatedAt,
		&i.UpdatedAt,
	)
	return i, err
}

const insertRepayment = `-- name: InsertRepayment :one
INSERT INTO repayments (
  loan_id, submitted_by_user_id, amount, status, note, proof_attachment_id, submitted_at
) VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, loan_id, submitted_by_user_id, amount, status, note, proof_attachment_id, submitted_at, confirmed_by_user_id, confirmed_at, rejected_at, rejection_reason, created_at, updated_at
`

type InsertRepaymentParams struct {
	LoanID            uuid.UUID  `json:"loan_id"`
	SubmittedByUserID uuid.UUID  `json:"submitted_by_user_id"`
	Amount            string     `json:"amount"`
	Status            string     `json:"status"`
	Note              *string    `json:"note"`
	ProofAttachmentID *uuid.UUID `json:"proof_attachment_id"`
	SubmittedAt       time.Time  `json:"submitted_at"`
}

func (q *Queries) InsertRepayment(ctx context.Context, arg InsertRepaymentParams) (Repayment, error) {
	row := q.db.QueryRow(ctx, insertRepayment,
		arg.LoanID, arg.SubmittedByUserID, arg.Amount, arg.Status, arg.Note, arg.ProofAttachmentID, arg.SubmittedAt,
	)
	return scanRepayment(row.Scan)
}

const getRepaymentByID = `-- name: GetRepaymentByID :one
SELECT id, loan_id, submitted_by_user_id, amount, status, note, proof_attachment_id, submitted_at, confirmed_by_user_id, confirmed_at, rejected_at, rejection_reason, created_at, updated_at FROM repayments
WHERE id = $1
`

func (q *Queries) GetRepaymentByID(ctx context.Context, id uuid.UUID) (Repayment, error) {
	row := q.db.QueryRow(ctx, getRepaymentByID, id)
	return scanRepayment(row.Scan)
}

const listRepaymentsForLoan = `-- name: ListRepaymentsForLoan :many
SELECT id, loan_id, submitted_by_user_id, amount, status, note, proof_attachment_id, submitted_at, confirmed_by_user_id, confirmed_at, rejected_at, rejection_reason, created_at, updated_at FROM repayments
WHERE loan_id = $1
ORDER BY submitted_at DESC
`

func (q *Queries) ListRepaymentsForLoan(ctx context.Context, loanID uuid.UUID) ([]Repayment, error) {
	rows, err := q.db.Query(ctx, listRepaymentsForLoan, loanID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Repayment{}
	for rows.Next() {
		item, err := scanRepayment(rows.Scan)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

const getPendingRepaymentForLoan = `-- name: GetPendingRepaymentForLoan :one
SELECT id, loan_id, submitted_by_user_id, amount, status, note, proof_attachment_id, submitted_at, confirmed_by_user_id, confirmed_at, rejected_at, rejection_reason, created_at, updated_at FROM repayments
WHERE loan_id = $1 AND status = 'pending'
LIMIT 1
`

func (q *Queries) GetPendingRepaymentForLoan(ctx context.Context, loanID uuid.UUID) (Repayment, error) {
	row := q.db.QueryRow(ctx, getPendingRepaymentForLoan, loanID)
	return scanRepayment(row.Scan)
}

const updateRepayment = `-- name: UpdateRepayment :one
UPDATE repayments
SET
  status = $2,
  confirmed_by_user_id = $3,
  confirmed_at = $4,
  rejected_at = $5,
  rejection_reason = $6,
  updated_at = now()
WHERE id = $1
RETURNING id, loan_id, submitted_by_user_id, amount, status, note, proof_attachment_id, submitted_at, confirmed_by_user_id, confirmed_at, rejected_at, rejection_reason, created_at, updated_at
`

type UpdateRepaymentParams struct {
	ID                uuid.UUID  `json:"id"`
	Status            string     `json:"status"`
	ConfirmedByUserID *uuid.UUID `json:"confirmed_by_user_id"`
	ConfirmedAt       *time.Time `json:"confirmed_at"`
	RejectedAt        *time.Time `json:"rejected_at"`
	RejectionReason   *string    `json:"rejection_reason"`
}

func (q *Queries) UpdateRepayment(ctx context.Context, arg UpdateRepaymentParams) (Repayment, error) {
	row := q.db.QueryRow(ctx, updateRepayment,
		arg.ID, arg.Status, arg.ConfirmedByUserID, arg.ConfirmedAt, arg.RejectedAt, arg.RejectionReason,
	)
	return scanRepayment(row.Scan)
}

const sumClaimedAgainstOutstanding = `-- name: SumClaimedAgainstOutstanding :one
SELECT COALESCE(SUM(amount), 0)::text AS total
FROM repayments
WHERE loan_id = $1
  AND status IN ('pending', 'confirmed')
`

func (q *Queries) SumClaimedAgainstOutstanding(ctx context.Context, loanID uuid.UUID) (string, error) {
	row := q.db.QueryRow(ctx, sumClaimedAgainstOutstanding, loanID)
	var total string
	err := row.Scan(&total)
	return total, err
}
