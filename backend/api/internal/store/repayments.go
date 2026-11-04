package store

import (
	"context"
	"errors"
	"net/http"
	"time"

	"equilend/api/internal/httpx"
	"equilend/api/internal/loans"
	"equilend/api/internal/repayments"
	"equilend/api/internal/store/sqlc"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
)

const repaymentSelect = `
	id, loan_id, submitted_by_user_id, amount::text, status, note, proof_attachment_id, submitted_at,
	confirmed_by_user_id, confirmed_at, rejected_at, rejection_reason, paid_entry_id, received_entry_id,
	created_at, updated_at
`

func scanRepayment(row scannable) (repayments.Record, error) {
	var rec repayments.Record
	var amount string
	if err := row.Scan(
		&rec.ID, &rec.LoanID, &rec.SubmittedByUserID, &amount, &rec.Status, &rec.Note, &rec.ProofAttachmentID, &rec.SubmittedAt,
		&rec.ConfirmedByUserID, &rec.ConfirmedAt, &rec.RejectedAt, &rec.RejectionReason, &rec.PaidEntryID, &rec.ReceivedEntryID,
		&rec.CreatedAt, &rec.UpdatedAt,
	); err != nil {
		return repayments.Record{}, err
	}
	rec.Amount, _ = decimal.NewFromString(amount)
	return rec, nil
}

// InsertRepayment writes the claim, the optional expense with its balance change, the
// loan update and events in one transaction: either all of it happens or none.
func (s *SQLStore) InsertRepayment(ctx context.Context, rec repayments.Record, loan loans.Record, events []loans.Event, entry *repayments.EntryWrite) (repayments.Record, loans.Record, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return repayments.Record{}, loans.Record{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	// Serialize claims per loan so two requests cannot both pass the "no pending claim" check.
	if _, err := tx.Exec(ctx, `SELECT 1 FROM loans WHERE id = $1 FOR UPDATE`, loan.ID); err != nil {
		return repayments.Record{}, loans.Record{}, err
	}
	var pending int
	if err := tx.QueryRow(ctx, `SELECT COUNT(*)::int FROM repayments WHERE loan_id = $1 AND status = 'pending'`, loan.ID).Scan(&pending); err != nil {
		return repayments.Record{}, loans.Record{}, err
	}
	if pending > 0 {
		return repayments.Record{}, loans.Record{}, httpx.E(http.StatusConflict, "PENDING_EXISTS", "a repayment claim is already waiting for confirmation")
	}

	if entry != nil {
		id, err := writeRepaymentEntry(ctx, tx, *entry)
		if err != nil {
			return repayments.Record{}, loans.Record{}, err
		}
		rec.PaidEntryID = &id
	} else if rec.PaidEntryID != nil {
		// Resubmitting: take the expense over from the rejected claim that held it.
		if _, err := tx.Exec(ctx, `
			UPDATE repayments SET paid_entry_id = NULL, updated_at = now()
			WHERE paid_entry_id = $1 AND status = 'rejected'
		`, *rec.PaidEntryID); err != nil {
			return repayments.Record{}, loans.Record{}, err
		}
	}

	saved, err := scanRepayment(tx.QueryRow(ctx, `
		INSERT INTO repayments (
			id, loan_id, submitted_by_user_id, amount, status, note, proof_attachment_id, submitted_at,
			confirmed_by_user_id, confirmed_at, paid_entry_id
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		RETURNING `+repaymentSelect,
		rec.ID, rec.LoanID, rec.SubmittedByUserID, rec.Amount.StringFixed(loans.Scale), rec.Status, rec.Note, rec.ProofAttachmentID, rec.SubmittedAt,
		rec.ConfirmedByUserID, rec.ConfirmedAt, rec.PaidEntryID,
	))
	if err != nil {
		return repayments.Record{}, loans.Record{}, linkConflict(err)
	}
	saved.ProofObjectKey = rec.ProofObjectKey
	saved.ProofName = rec.ProofName

	updated, err := q.UpdateLoan(ctx, updateLoanParams(loan))
	if err != nil {
		return repayments.Record{}, loans.Record{}, err
	}
	if err := insertEvents(ctx, q, loan.ID, events); err != nil {
		return repayments.Record{}, loans.Record{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return repayments.Record{}, loans.Record{}, err
	}
	out := mapLoan(updated)
	copySchedule(&out, loan)
	return saved, out, nil
}

func (s *SQLStore) Get(ctx context.Context, id uuid.UUID) (repayments.Record, error) {
	rec, err := scanRepayment(s.pool.QueryRow(ctx, `SELECT `+repaymentSelect+` FROM repayments WHERE id = $1`, id))
	if err != nil {
		return repayments.Record{}, err
	}
	return s.hydrateProof(ctx, rec), nil
}

func (s *SQLStore) ListForLoan(ctx context.Context, loanID uuid.UUID) ([]repayments.Record, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+repaymentSelect+` FROM repayments WHERE loan_id = $1 ORDER BY submitted_at DESC`, loanID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []repayments.Record
	for rows.Next() {
		rec, err := scanRepayment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		out[i] = s.hydrateProof(ctx, out[i])
	}
	return out, nil
}

func (s *SQLStore) GetPendingForLoan(ctx context.Context, loanID uuid.UUID) (repayments.Record, error) {
	rec, err := scanRepayment(s.pool.QueryRow(ctx, `
		SELECT `+repaymentSelect+` FROM repayments WHERE loan_id = $1 AND status = 'pending' LIMIT 1
	`, loanID))
	if err != nil {
		return repayments.Record{}, err
	}
	return s.hydrateProof(ctx, rec), nil
}

func (s *SQLStore) SumClaimed(ctx context.Context, loanID uuid.UUID) (decimal.Decimal, error) {
	raw, err := s.q.SumClaimedAgainstOutstanding(ctx, loanID)
	if err != nil {
		return decimal.Zero, err
	}
	return decimal.NewFromString(raw)
}

// FinishRepayment confirms or rejects a pending claim. On confirm it may also write the
// lender's income and balance change, or link income the lender already recorded.
func (s *SQLStore) FinishRepayment(ctx context.Context, rec repayments.Record, loan loans.Record, event loans.Event, entry *repayments.EntryWrite) (repayments.Record, loans.Record, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return repayments.Record{}, loans.Record{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	if entry != nil {
		id, err := writeRepaymentEntry(ctx, tx, *entry)
		if err != nil {
			return repayments.Record{}, loans.Record{}, err
		}
		rec.ReceivedEntryID = &id
	}
	// Only a still-pending claim can be finished; a concurrent confirm/reject loses here.
	saved, err := scanRepayment(tx.QueryRow(ctx, `
		UPDATE repayments SET
			status = $2, confirmed_by_user_id = $3, confirmed_at = $4, rejected_at = $5,
			rejection_reason = $6, received_entry_id = $7, updated_at = now()
		WHERE id = $1 AND status = 'pending'
		RETURNING `+repaymentSelect,
		rec.ID, rec.Status, rec.ConfirmedByUserID, rec.ConfirmedAt, rec.RejectedAt, rec.RejectionReason, rec.ReceivedEntryID,
	))
	if errors.Is(err, pgx.ErrNoRows) {
		return repayments.Record{}, loans.Record{}, httpx.E(http.StatusConflict, "INVALID_STATE", "this repayment is no longer pending")
	}
	if err != nil {
		return repayments.Record{}, loans.Record{}, linkConflict(err)
	}
	updated, err := q.UpdateLoan(ctx, updateLoanParams(loan))
	if err != nil {
		return repayments.Record{}, loans.Record{}, err
	}
	if err := insertEvents(ctx, q, loan.ID, []loans.Event{event}); err != nil {
		return repayments.Record{}, loans.Record{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return repayments.Record{}, loans.Record{}, err
	}
	out := mapLoan(updated)
	copySchedule(&out, loan)
	return s.hydrateProof(ctx, saved), out, nil
}

// ResolveRejected unlinks the expense of a rejected claim; with undo it deletes the
// expense and reverses its balance change in the same transaction.
func (s *SQLStore) ResolveRejected(ctx context.Context, rec repayments.Record, undo bool) (repayments.Record, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return repayments.Record{}, err
	}
	defer tx.Rollback(ctx)

	var entryID *uuid.UUID
	if err := tx.QueryRow(ctx, `
		SELECT paid_entry_id FROM repayments WHERE id = $1 AND status = 'rejected' FOR UPDATE
	`, rec.ID).Scan(&entryID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return repayments.Record{}, httpx.E(http.StatusConflict, "INVALID_STATE", "nothing to resolve on this repayment")
		}
		return repayments.Record{}, err
	}
	if entryID == nil {
		return repayments.Record{}, httpx.E(http.StatusConflict, "INVALID_STATE", "nothing to resolve on this repayment")
	}
	if _, err := tx.Exec(ctx, `UPDATE repayments SET paid_entry_id = NULL, updated_at = now() WHERE id = $1`, rec.ID); err != nil {
		return repayments.Record{}, err
	}
	if undo {
		if err := reverseEntryBalance(ctx, tx, rec.SubmittedByUserID, *entryID, "Undo rejected loan payment"); err != nil {
			return repayments.Record{}, err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM cashflow_entries WHERE id = $1 AND user_id = $2`, *entryID, rec.SubmittedByUserID); err != nil {
			return repayments.Record{}, err
		}
	}
	saved, err := scanRepayment(tx.QueryRow(ctx, `SELECT `+repaymentSelect+` FROM repayments WHERE id = $1`, rec.ID))
	if err != nil {
		return repayments.Record{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return repayments.Record{}, err
	}
	return s.hydrateProof(ctx, saved), nil
}

func (s *SQLStore) RepaymentEntryInfo(ctx context.Context, entryID uuid.UUID) (repayments.EntryInfo, error) {
	var info repayments.EntryInfo
	var amount string
	err := s.pool.QueryRow(ctx, `
		SELECT id, user_id, kind, COALESCE(status, 'confirmed'), COALESCE(is_template, false), amount::text, currency_code, account_id
		FROM cashflow_entries WHERE id = $1
	`, entryID).Scan(&info.ID, &info.UserID, &info.Kind, &info.Status, &info.IsTemplate, &amount, &info.CurrencyCode, &info.AccountID)
	if err != nil {
		return repayments.EntryInfo{}, err
	}
	info.Amount, _ = decimal.NewFromString(amount)
	return info, nil
}

func (s *SQLStore) RepaymentAccountInfo(ctx context.Context, userID, accountID uuid.UUID) (repayments.AccountInfo, error) {
	var info repayments.AccountInfo
	var archivedAt *time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT id, currency_code, archived_at FROM money_accounts WHERE id = $1 AND user_id = $2
	`, accountID, userID).Scan(&info.ID, &info.CurrencyCode, &archivedAt)
	if err != nil {
		return repayments.AccountInfo{}, err
	}
	info.Archived = archivedAt != nil
	return info, nil
}

func (s *SQLStore) RepaymentForEntry(ctx context.Context, entryID uuid.UUID) (repayments.Record, error) {
	return scanRepayment(s.pool.QueryRow(ctx, `
		SELECT `+repaymentSelect+` FROM repayments
		WHERE paid_entry_id = $1 OR received_entry_id = $1
		ORDER BY created_at DESC LIMIT 1
	`, entryID))
}

// writeRepaymentEntry inserts a loan payment/receipt entry and moves the account balance.
func writeRepaymentEntry(ctx context.Context, tx pgx.Tx, e repayments.EntryWrite) (uuid.UUID, error) {
	var id uuid.UUID
	now := time.Now().UTC()
	err := tx.QueryRow(ctx, `
		INSERT INTO cashflow_entries (
			user_id, kind, title, amount, currency_code, category, category_id, occurred_at,
			is_template, linked_loan_id, account_id, status, paused, created_at, updated_at, balance_applied_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,$9,$10,'confirmed',false,$11,$11,$11)
		RETURNING id
	`, e.UserID, e.Kind, e.Title, e.Amount.StringFixed(loans.Scale), e.CurrencyCode, e.Category, e.CategoryID, e.OccurredAt,
		e.LoanID, e.AccountID, now).Scan(&id)
	if err != nil {
		return uuid.Nil, err
	}
	if err := adjustForEntry(ctx, tx, e.UserID, e.AccountID, e.Kind, e.Amount, e.Title, true); err != nil {
		return uuid.Nil, err
	}
	return id, nil
}

// adjustForEntry applies a cashflow entry to an account balance. Credit cards hold what
// is owed, so an expense raises them and income lowers them.
func adjustForEntry(ctx context.Context, tx pgx.Tx, userID, accountID uuid.UUID, kind string, amount decimal.Decimal, note string, activeOnly bool) error {
	sign := "1"
	if kind == "expense" {
		sign = "-1"
	}
	var balance string
	err := tx.QueryRow(ctx, `
		UPDATE money_accounts SET
			balance = balance + (CASE WHEN account_type = 'credit_card' THEN -1 ELSE 1 END) * `+sign+` * $3::numeric,
			balance_as_of = now(), updated_at = now()
		WHERE id = $1 AND user_id = $2 AND ($4 = false OR archived_at IS NULL)
		RETURNING balance::text
	`, accountID, userID, amount.StringFixed(loans.Scale), activeOnly).Scan(&balance)
	if errors.Is(err, pgx.ErrNoRows) {
		if !activeOnly {
			return nil // account was deleted since; nothing left to reverse
		}
		return httpx.E(http.StatusUnprocessableEntity, "VALIDATION", "account not found")
	}
	if err != nil {
		return err
	}
	var n *string
	if note != "" {
		n = &note
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO money_account_balance_events (account_id, user_id, balance, source, note, created_at)
		VALUES ($1,$2,$3,'adjust',$4,now())
	`, accountID, userID, balance, n)
	return err
}

// linkConflict turns a unique-index violation on the entry links into a clear API error.
func linkConflict(err error) error {
	var pgErr interface{ SQLState() string }
	if errors.As(err, &pgErr) && pgErr.SQLState() == "23505" {
		return httpx.E(http.StatusConflict, "ENTRY_LINKED", "this entry already backs another repayment")
	}
	return err
}

func mapRepayment(row sqlc.Repayment) repayments.Record {
	amt, _ := decimal.NewFromString(row.Amount)
	return repayments.Record{
		ID:                row.ID,
		LoanID:            row.LoanID,
		SubmittedByUserID: row.SubmittedByUserID,
		Amount:            amt,
		Status:            row.Status,
		Note:              row.Note,
		ProofAttachmentID: row.ProofAttachmentID,
		SubmittedAt:       row.SubmittedAt,
		ConfirmedByUserID: row.ConfirmedByUserID,
		ConfirmedAt:       row.ConfirmedAt,
		RejectedAt:        row.RejectedAt,
		RejectionReason:   row.RejectionReason,
		CreatedAt:         row.CreatedAt,
		UpdatedAt:         row.UpdatedAt,
	}
}

func (s *SQLStore) hydrateProof(ctx context.Context, rec repayments.Record) repayments.Record {
	if rec.ProofAttachmentID == nil {
		return rec
	}
	media, err := s.GetMediaObject(ctx, *rec.ProofAttachmentID)
	if err != nil {
		return rec
	}
	key := media.ObjectKey
	rec.ProofObjectKey = &key
	rec.ProofName = media.OriginalName
	return rec
}
