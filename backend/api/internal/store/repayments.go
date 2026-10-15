package store

import (
	"context"

	"equilend/api/internal/loans"
	"equilend/api/internal/repayments"
	"equilend/api/internal/store/sqlc"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

func (s *SQLStore) Insert(ctx context.Context, rec repayments.Record, loan loans.Record, event loans.Event) (repayments.Record, loans.Record, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return repayments.Record{}, loans.Record{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	row, err := q.InsertRepayment(ctx, sqlc.InsertRepaymentParams{
		LoanID:            rec.LoanID,
		SubmittedByUserID: rec.SubmittedByUserID,
		Amount:            rec.Amount.StringFixed(loans.Scale),
		Status:            rec.Status,
		Note:              rec.Note,
		ProofAttachmentID: rec.ProofAttachmentID,
		SubmittedAt:       rec.SubmittedAt,
	})
	if err != nil {
		return repayments.Record{}, loans.Record{}, err
	}
	mapped := mapRepayment(row)
	mapped.ProofObjectKey = rec.ProofObjectKey
	mapped.ProofName = rec.ProofName
	event.Payload = repaymentsClaimPayload(mapped)
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
	return mapped, mapLoan(updated), nil
}

func (s *SQLStore) Get(ctx context.Context, id uuid.UUID) (repayments.Record, error) {
	row, err := s.q.GetRepaymentByID(ctx, id)
	if err != nil {
		return repayments.Record{}, err
	}
	return s.hydrateProof(ctx, mapRepayment(row)), nil
}

func (s *SQLStore) ListForLoan(ctx context.Context, loanID uuid.UUID) ([]repayments.Record, error) {
	rows, err := s.q.ListRepaymentsForLoan(ctx, loanID)
	if err != nil {
		return nil, err
	}
	out := make([]repayments.Record, 0, len(rows))
	for _, row := range rows {
		out = append(out, s.hydrateProof(ctx, mapRepayment(row)))
	}
	return out, nil
}

func (s *SQLStore) GetPendingForLoan(ctx context.Context, loanID uuid.UUID) (repayments.Record, error) {
	row, err := s.q.GetPendingRepaymentForLoan(ctx, loanID)
	if err != nil {
		return repayments.Record{}, err
	}
	return s.hydrateProof(ctx, mapRepayment(row)), nil
}

func (s *SQLStore) SumClaimed(ctx context.Context, loanID uuid.UUID) (decimal.Decimal, error) {
	raw, err := s.q.SumClaimedAgainstOutstanding(ctx, loanID)
	if err != nil {
		return decimal.Zero, err
	}
	return decimal.NewFromString(raw)
}

func (s *SQLStore) Confirm(ctx context.Context, rec repayments.Record, loan loans.Record, event loans.Event) (repayments.Record, loans.Record, error) {
	return s.finishRepayment(ctx, rec, loan, event)
}

func (s *SQLStore) Reject(ctx context.Context, rec repayments.Record, loan loans.Record, event loans.Event) (repayments.Record, loans.Record, error) {
	return s.finishRepayment(ctx, rec, loan, event)
}

func (s *SQLStore) finishRepayment(ctx context.Context, rec repayments.Record, loan loans.Record, event loans.Event) (repayments.Record, loans.Record, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return repayments.Record{}, loans.Record{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	row, err := q.UpdateRepayment(ctx, sqlc.UpdateRepaymentParams{
		ID:                rec.ID,
		Status:            rec.Status,
		ConfirmedByUserID: rec.ConfirmedByUserID,
		ConfirmedAt:       rec.ConfirmedAt,
		RejectedAt:        rec.RejectedAt,
		RejectionReason:   rec.RejectionReason,
	})
	if err != nil {
		return repayments.Record{}, loans.Record{}, err
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
	return mapRepayment(row), mapLoan(updated), nil
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

func repaymentsClaimPayload(rec repayments.Record) []byte {
	return []byte(`{"repayment_id":"` + rec.ID.String() + `","amount":"` + rec.Amount.StringFixed(loans.Scale) + `"}`)
}
