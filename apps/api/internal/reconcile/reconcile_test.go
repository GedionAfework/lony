package reconcile

import (
	"context"
	"testing"

	"equilend/api/internal/loans"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

type mem struct {
	loans      []LoanRow
	confirmed  map[uuid.UUID]decimal.Decimal
}

func (m mem) ListOpenLoans(context.Context) ([]LoanRow, error) { return m.loans, nil }
func (m mem) SumConfirmedRepayments(_ context.Context, id uuid.UUID) (decimal.Decimal, error) {
	if v, ok := m.confirmed[id]; ok {
		return v, nil
	}
	return decimal.Zero, nil
}

func TestReportFindsMismatchWithoutFixing(t *testing.T) {
	loanID := uuid.New()
	expected := decimal.RequireFromString("1050.0000")
	stored := decimal.RequireFromString("900.0000")
	svc := New(mem{
		loans: []LoanRow{{
			ID: loanID, ReferenceCode: "LN-TEST", Status: loans.StatusActive,
			ExpectedTotal: &expected, OutstandingAmount: &stored,
		}},
		confirmed: map[uuid.UUID]decimal.Decimal{
			loanID: decimal.RequireFromString("50.0000"),
		},
	})
	out, err := svc.Report(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 1 {
		t.Fatalf("got %d", len(out))
	}
	if out[0].ComputedOutstanding != "1000.0000" || out[0].StoredOutstanding != "900.0000" {
		t.Fatalf("%+v", out[0])
	}
}

func TestReportCleanWhenMatched(t *testing.T) {
	loanID := uuid.New()
	expected := decimal.RequireFromString("1050.0000")
	stored := decimal.RequireFromString("1050.0000")
	svc := New(mem{
		loans: []LoanRow{{
			ID: loanID, ReferenceCode: "LN-OK", Status: loans.StatusActive,
			ExpectedTotal: &expected, OutstandingAmount: &stored,
		}},
		confirmed: map[uuid.UUID]decimal.Decimal{},
	})
	out, err := svc.Report(context.Background())
	if err != nil || len(out) != 0 {
		t.Fatalf("%v %+v", err, out)
	}
}
