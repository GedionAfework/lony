package dashboard

import (
	"context"
	"time"

	"equilend/api/internal/loans"

	"github.com/google/uuid"
)

type LoanReader interface {
	AllForUser(ctx context.Context, actor uuid.UUID) ([]loans.Record, error)
	Party(ctx context.Context, id uuid.UUID) (loans.Party, error)
}

type Service struct {
	loans LoanReader
	now   func() time.Time
}

func NewService(loans LoanReader) *Service {
	return &Service{loans: loans, now: time.Now}
}

func (s *Service) Get(ctx context.Context, actor uuid.UUID) (Summary, error) {
	rows, err := s.loans.AllForUser(ctx, actor)
	if err != nil {
		return Summary{}, err
	}
	parties := map[uuid.UUID]loans.Party{}
	for _, row := range rows {
		for _, id := range []uuid.UUID{row.BorrowerID, row.LenderID} {
			if id == actor {
				continue
			}
			if _, ok := parties[id]; ok {
				continue
			}
			p, err := s.loans.Party(ctx, id)
			if err != nil {
				return Summary{}, err
			}
			parties[id] = p
		}
	}
	return Build(actor, s.now(), rows, parties), nil
}
