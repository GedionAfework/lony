package sqlc

import (
	"context"
	"time"

	"github.com/google/uuid"
)

func scanLoan(scan func(dest ...any) error) (Loan, error) {
	var i Loan
	err := scan(
		&i.ID,
		&i.ReferenceCode,
		&i.BorrowerID,
		&i.LenderID,
		&i.InitiatorID,
		&i.Status,
		&i.PrincipalAmount,
		&i.CurrencyCode,
		&i.InterestRatePercent,
		&i.InterestAmount,
		&i.ExpectedTotal,
		&i.OutstandingAmount,
		&i.DueAt,
		&i.Note,
		&i.CurrentTermsID,
		&i.AcceptedTermsID,
		&i.TermsVersion,
		&i.ProposedByUserID,
		&i.AcceptedAt,
		&i.CreatedAt,
		&i.UpdatedAt,
	)
	return i, err
}

func scanLoanTerm(scan func(dest ...any) error) (LoanTerm, error) {
	var i LoanTerm
	err := scan(
		&i.ID,
		&i.LoanID,
		&i.Version,
		&i.PrincipalAmount,
		&i.CurrencyCode,
		&i.InterestRatePercent,
		&i.InterestAmount,
		&i.ExpectedTotal,
		&i.DueAt,
		&i.Note,
		&i.ProposedByUserID,
		&i.Status,
		&i.CreatedAt,
	)
	return i, err
}

func scanLoanEvent(scan func(dest ...any) error) (LoanEvent, error) {
	var i LoanEvent
	err := scan(&i.ID, &i.LoanID, &i.ActorID, &i.EventType, &i.Payload, &i.CreatedAt)
	return i, err
}

const insertLoan = `-- name: InsertLoan :one
INSERT INTO loans (reference_code, borrower_id, lender_id, initiator_id, status)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, reference_code, borrower_id, lender_id, initiator_id, status, principal_amount, currency_code, interest_rate_percent, interest_amount, expected_total, outstanding_amount, due_at, note, current_terms_id, accepted_terms_id, terms_version, proposed_by_user_id, accepted_at, created_at, updated_at
`

type InsertLoanParams struct {
	ReferenceCode string    `json:"reference_code"`
	BorrowerID    uuid.UUID `json:"borrower_id"`
	LenderID      uuid.UUID `json:"lender_id"`
	InitiatorID   uuid.UUID `json:"initiator_id"`
	Status        string    `json:"status"`
}

func (q *Queries) InsertLoan(ctx context.Context, arg InsertLoanParams) (Loan, error) {
	row := q.db.QueryRow(ctx, insertLoan, arg.ReferenceCode, arg.BorrowerID, arg.LenderID, arg.InitiatorID, arg.Status)
	return scanLoan(row.Scan)
}

const getLoanByID = `-- name: GetLoanByID :one
SELECT id, reference_code, borrower_id, lender_id, initiator_id, status, principal_amount, currency_code, interest_rate_percent, interest_amount, expected_total, outstanding_amount, due_at, note, current_terms_id, accepted_terms_id, terms_version, proposed_by_user_id, accepted_at, created_at, updated_at FROM loans
WHERE id = $1
`

func (q *Queries) GetLoanByID(ctx context.Context, id uuid.UUID) (Loan, error) {
	row := q.db.QueryRow(ctx, getLoanByID, id)
	return scanLoan(row.Scan)
}

const listLoansForUser = `-- name: ListLoansForUser :many
SELECT id, reference_code, borrower_id, lender_id, initiator_id, status, principal_amount, currency_code, interest_rate_percent, interest_amount, expected_total, outstanding_amount, due_at, note, current_terms_id, accepted_terms_id, terms_version, proposed_by_user_id, accepted_at, created_at, updated_at FROM loans
WHERE (borrower_id = $1 OR lender_id = $1)
  AND ($2::text IS NULL OR status = $2)
  AND (
    $3::text IS NULL
    OR ($3 = 'borrower' AND borrower_id = $1)
    OR ($3 = 'lender' AND lender_id = $1)
  )
ORDER BY created_at DESC
`

type ListLoansForUserParams struct {
	UserID uuid.UUID `json:"user_id"`
	Status *string   `json:"status"`
	Role   *string   `json:"role"`
}

func (q *Queries) ListLoansForUser(ctx context.Context, arg ListLoansForUserParams) ([]Loan, error) {
	rows, err := q.db.Query(ctx, listLoansForUser, arg.UserID, arg.Status, arg.Role)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Loan{}
	for rows.Next() {
		item, err := scanLoan(rows.Scan)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

const updateLoan = `-- name: UpdateLoan :one
UPDATE loans
SET status = $2, principal_amount = $3, currency_code = $4, interest_rate_percent = $5, interest_amount = $6, expected_total = $7, outstanding_amount = $8, due_at = $9, note = $10, current_terms_id = $11, accepted_terms_id = $12, terms_version = $13, proposed_by_user_id = $14, accepted_at = $15, updated_at = now()
WHERE id = $1
RETURNING id, reference_code, borrower_id, lender_id, initiator_id, status, principal_amount, currency_code, interest_rate_percent, interest_amount, expected_total, outstanding_amount, due_at, note, current_terms_id, accepted_terms_id, terms_version, proposed_by_user_id, accepted_at, created_at, updated_at
`

type UpdateLoanParams struct {
	ID                  uuid.UUID  `json:"id"`
	Status              string     `json:"status"`
	PrincipalAmount     *string    `json:"principal_amount"`
	CurrencyCode        *string    `json:"currency_code"`
	InterestRatePercent *string    `json:"interest_rate_percent"`
	InterestAmount      *string    `json:"interest_amount"`
	ExpectedTotal       *string    `json:"expected_total"`
	OutstandingAmount   *string    `json:"outstanding_amount"`
	DueAt               *time.Time `json:"due_at"`
	Note                *string    `json:"note"`
	CurrentTermsID      *uuid.UUID `json:"current_terms_id"`
	AcceptedTermsID     *uuid.UUID `json:"accepted_terms_id"`
	TermsVersion        *int32     `json:"terms_version"`
	ProposedByUserID    *uuid.UUID `json:"proposed_by_user_id"`
	AcceptedAt          *time.Time `json:"accepted_at"`
}

func (q *Queries) UpdateLoan(ctx context.Context, arg UpdateLoanParams) (Loan, error) {
	row := q.db.QueryRow(ctx, updateLoan,
		arg.ID, arg.Status, arg.PrincipalAmount, arg.CurrencyCode, arg.InterestRatePercent, arg.InterestAmount, arg.ExpectedTotal, arg.OutstandingAmount, arg.DueAt, arg.Note, arg.CurrentTermsID, arg.AcceptedTermsID, arg.TermsVersion, arg.ProposedByUserID, arg.AcceptedAt,
	)
	return scanLoan(row.Scan)
}

const insertLoanTerms = `-- name: InsertLoanTerms :one
INSERT INTO loan_terms (
  loan_id, version, principal_amount, currency_code, interest_rate_percent,
  interest_amount, expected_total, due_at, note, proposed_by_user_id, status
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING id, loan_id, version, principal_amount, currency_code, interest_rate_percent, interest_amount, expected_total, due_at, note, proposed_by_user_id, status, created_at
`

type InsertLoanTermsParams struct {
	LoanID              uuid.UUID `json:"loan_id"`
	Version             int32     `json:"version"`
	PrincipalAmount     string    `json:"principal_amount"`
	CurrencyCode        string    `json:"currency_code"`
	InterestRatePercent string    `json:"interest_rate_percent"`
	InterestAmount      string    `json:"interest_amount"`
	ExpectedTotal       string    `json:"expected_total"`
	DueAt               time.Time `json:"due_at"`
	Note                *string   `json:"note"`
	ProposedByUserID    uuid.UUID `json:"proposed_by_user_id"`
	Status              string    `json:"status"`
}

func (q *Queries) InsertLoanTerms(ctx context.Context, arg InsertLoanTermsParams) (LoanTerm, error) {
	row := q.db.QueryRow(ctx, insertLoanTerms,
		arg.LoanID, arg.Version, arg.PrincipalAmount, arg.CurrencyCode, arg.InterestRatePercent, arg.InterestAmount, arg.ExpectedTotal, arg.DueAt, arg.Note, arg.ProposedByUserID, arg.Status,
	)
	return scanLoanTerm(row.Scan)
}

const listLoanTerms = `-- name: ListLoanTerms :many
SELECT id, loan_id, version, principal_amount, currency_code, interest_rate_percent, interest_amount, expected_total, due_at, note, proposed_by_user_id, status, created_at FROM loan_terms
WHERE loan_id = $1
ORDER BY version
`

func (q *Queries) ListLoanTerms(ctx context.Context, loanID uuid.UUID) ([]LoanTerm, error) {
	rows, err := q.db.Query(ctx, listLoanTerms, loanID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []LoanTerm{}
	for rows.Next() {
		item, err := scanLoanTerm(rows.Scan)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

const supersedeProposedLoanTerms = `-- name: SupersedeProposedLoanTerms :exec
UPDATE loan_terms SET status = 'superseded' WHERE loan_id = $1 AND status = 'proposed'
`

func (q *Queries) SupersedeProposedLoanTerms(ctx context.Context, loanID uuid.UUID) error {
	_, err := q.db.Exec(ctx, supersedeProposedLoanTerms, loanID)
	return err
}

const acceptLoanTerms = `-- name: AcceptLoanTerms :one
UPDATE loan_terms SET status = 'accepted' WHERE id = $1 AND status = 'proposed'
RETURNING id, loan_id, version, principal_amount, currency_code, interest_rate_percent, interest_amount, expected_total, due_at, note, proposed_by_user_id, status, created_at
`

func (q *Queries) AcceptLoanTerms(ctx context.Context, id uuid.UUID) (LoanTerm, error) {
	row := q.db.QueryRow(ctx, acceptLoanTerms, id)
	return scanLoanTerm(row.Scan)
}

const insertLoanEvent = `-- name: InsertLoanEvent :one
INSERT INTO loan_events (loan_id, actor_id, event_type, payload)
VALUES ($1, $2, $3, $4)
RETURNING id, loan_id, actor_id, event_type, payload, created_at
`

type InsertLoanEventParams struct {
	LoanID    uuid.UUID  `json:"loan_id"`
	ActorID   *uuid.UUID `json:"actor_id"`
	EventType string     `json:"event_type"`
	Payload   []byte     `json:"payload"`
}

func (q *Queries) InsertLoanEvent(ctx context.Context, arg InsertLoanEventParams) (LoanEvent, error) {
	row := q.db.QueryRow(ctx, insertLoanEvent, arg.LoanID, arg.ActorID, arg.EventType, arg.Payload)
	return scanLoanEvent(row.Scan)
}

const listLoanEvents = `-- name: ListLoanEvents :many
SELECT id, loan_id, actor_id, event_type, payload, created_at FROM loan_events
WHERE loan_id = $1
ORDER BY created_at ASC, id ASC
`

func (q *Queries) ListLoanEvents(ctx context.Context, loanID uuid.UUID) ([]LoanEvent, error) {
	rows, err := q.db.Query(ctx, listLoanEvents, loanID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []LoanEvent{}
	for rows.Next() {
		item, err := scanLoanEvent(rows.Scan)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

const markLoansOverdue = `-- name: MarkLoansOverdue :many
UPDATE loans
SET status = 'overdue', updated_at = now()
WHERE status = 'active'
  AND due_at < $1
  AND COALESCE(outstanding_amount, 0) > 0
RETURNING id, reference_code, borrower_id, lender_id, initiator_id, status, principal_amount, currency_code, interest_rate_percent, interest_amount, expected_total, outstanding_amount, due_at, note, current_terms_id, accepted_terms_id, terms_version, proposed_by_user_id, accepted_at, created_at, updated_at
`

func (q *Queries) MarkLoansOverdue(ctx context.Context, dueBefore time.Time) ([]Loan, error) {
	rows, err := q.db.Query(ctx, markLoansOverdue, dueBefore)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Loan{}
	for rows.Next() {
		item, err := scanLoan(rows.Scan)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
