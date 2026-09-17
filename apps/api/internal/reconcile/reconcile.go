package reconcile

import (
	"context"

	"equilend/api/internal/loans"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

type LoanRow struct {
	ID                uuid.UUID
	ReferenceCode     string
	Status            string
	ExpectedTotal     *decimal.Decimal
	OutstandingAmount *decimal.Decimal
}

type Store interface {
	ListOpenLoans(ctx context.Context) ([]LoanRow, error)
	SumConfirmedRepayments(ctx context.Context, loanID uuid.UUID) (decimal.Decimal, error)
}

type Mismatch struct {
	LoanID               uuid.UUID `json:"loan_id"`
	ReferenceCode        string    `json:"reference_code"`
	Status               string    `json:"status"`
	StoredOutstanding    string    `json:"stored_outstanding"`
	ComputedOutstanding  string    `json:"computed_outstanding"`
}

type Service struct {
	store Store
}

func New(store Store) *Service {
	return &Service{store: store}
}

// Report compares stored outstanding to expected_total minus confirmed repayments.
// It never mutates loan balances.
func (s *Service) Report(ctx context.Context) ([]Mismatch, error) {
	rows, err := s.store.ListOpenLoans(ctx)
	if err != nil {
		return nil, err
	}
	var out []Mismatch
	for _, row := range rows {
		if row.ExpectedTotal == nil {
			continue
		}
		confirmed, err := s.store.SumConfirmedRepayments(ctx, row.ID)
		if err != nil {
			return nil, err
		}
		computed := row.ExpectedTotal.Sub(confirmed)
		if computed.IsNegative() {
			computed = decimal.Zero
		}
		stored := decimal.Zero
		if row.OutstandingAmount != nil {
			stored = *row.OutstandingAmount
		}
		if !stored.Equal(computed) {
			out = append(out, Mismatch{
				LoanID:              row.ID,
				ReferenceCode:       row.ReferenceCode,
				Status:              row.Status,
				StoredOutstanding:   stored.StringFixed(loans.Scale),
				ComputedOutstanding: computed.StringFixed(loans.Scale),
			})
		}
	}
	return out, nil
}
