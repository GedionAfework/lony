package store

import (
	"context"

	"equilend/api/internal/reconcile"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

func (s *SQLStore) ListOpenLoans(ctx context.Context) ([]reconcile.LoanRow, error) {
	rows, err := s.q.ListOpenLoansForReconcile(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]reconcile.LoanRow, 0, len(rows))
	for _, row := range rows {
		item := reconcile.LoanRow{
			ID:            row.ID,
			ReferenceCode: row.ReferenceCode,
			Status:        row.Status,
		}
		if row.ExpectedTotal != nil {
			v, err := decimal.NewFromString(*row.ExpectedTotal)
			if err != nil {
				return nil, err
			}
			item.ExpectedTotal = &v
		}
		if row.OutstandingAmount != nil {
			v, err := decimal.NewFromString(*row.OutstandingAmount)
			if err != nil {
				return nil, err
			}
			item.OutstandingAmount = &v
		}
		out = append(out, item)
	}
	return out, nil
}

func (s *SQLStore) SumConfirmedRepayments(ctx context.Context, loanID uuid.UUID) (decimal.Decimal, error) {
	total, err := s.q.SumConfirmedRepayments(ctx, loanID)
	if err != nil {
		return decimal.Zero, err
	}
	return decimal.NewFromString(total)
}
