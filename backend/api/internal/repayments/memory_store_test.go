package repayments

import (
	"context"
	"sync"
	"time"

	"equilend/api/internal/httpx"
	"equilend/api/internal/loans"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
)

type memoryStore struct {
	mu     sync.Mutex
	loans  map[uuid.UUID]loans.Record
	reps   map[uuid.UUID]Record
	byLoan map[uuid.UUID][]uuid.UUID
	events map[uuid.UUID][]loans.Event
}

func newMemoryStore(loanRows ...loans.Record) *memoryStore {
	m := &memoryStore{
		loans:  map[uuid.UUID]loans.Record{},
		reps:   map[uuid.UUID]Record{},
		byLoan: map[uuid.UUID][]uuid.UUID{},
		events: map[uuid.UUID][]loans.Event{},
	}
	for _, row := range loanRows {
		m.loans[row.ID] = row
	}
	return m
}

func (m *memoryStore) Insert(_ context.Context, rec Record, loan loans.Record, event loans.Event) (Record, loans.Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, id := range m.byLoan[loan.ID] {
		if m.reps[id].Status == StatusPending {
			return Record{}, loans.Record{}, httpx.E(409, "PENDING_EXISTS", "a repayment claim is already waiting for confirmation")
		}
	}
	now := time.Now()
	rec.ID = uuid.New()
	rec.CreatedAt = now
	rec.UpdatedAt = now
	if rec.SubmittedAt.IsZero() {
		rec.SubmittedAt = now
	}
	m.reps[rec.ID] = rec
	m.byLoan[loan.ID] = append(m.byLoan[loan.ID], rec.ID)
	loan.UpdatedAt = now
	m.loans[loan.ID] = loan
	event.LoanID = loan.ID
	event.Payload = claimPayload(rec)
	m.events[loan.ID] = append(m.events[loan.ID], event)
	return rec, loan, nil
}

func (m *memoryStore) Get(_ context.Context, id uuid.UUID) (Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	row, ok := m.reps[id]
	if !ok {
		return Record{}, pgx.ErrNoRows
	}
	return row, nil
}

func (m *memoryStore) ListForLoan(_ context.Context, loanID uuid.UUID) ([]Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Record
	for _, id := range m.byLoan[loanID] {
		out = append(out, m.reps[id])
	}
	return out, nil
}

func (m *memoryStore) GetPendingForLoan(_ context.Context, loanID uuid.UUID) (Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, id := range m.byLoan[loanID] {
		if m.reps[id].Status == StatusPending {
			return m.reps[id], nil
		}
	}
	return Record{}, pgx.ErrNoRows
}

func (m *memoryStore) SumClaimed(_ context.Context, loanID uuid.UUID) (decimal.Decimal, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	sum := decimal.Zero
	for _, id := range m.byLoan[loanID] {
		row := m.reps[id]
		if row.Status == StatusPending || row.Status == StatusConfirmed {
			sum = sum.Add(row.Amount)
		}
	}
	return sum, nil
}

func (m *memoryStore) Confirm(_ context.Context, rec Record, loan loans.Record, event loans.Event) (Record, loans.Record, error) {
	return m.finish(rec, loan, event)
}

func (m *memoryStore) Reject(_ context.Context, rec Record, loan loans.Record, event loans.Event) (Record, loans.Record, error) {
	return m.finish(rec, loan, event)
}

func (m *memoryStore) finish(rec Record, loan loans.Record, event loans.Event) (Record, loans.Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.reps[rec.ID]; !ok {
		return Record{}, loans.Record{}, pgx.ErrNoRows
	}
	now := time.Now()
	rec.UpdatedAt = now
	m.reps[rec.ID] = rec
	loan.UpdatedAt = now
	m.loans[loan.ID] = loan
	event.LoanID = loan.ID
	m.events[loan.ID] = append(m.events[loan.ID], event)
	return rec, loan, nil
}

type loanAccess struct {
	m *memoryStore
}

func (a loanAccess) Record(_ context.Context, actor, id uuid.UUID) (loans.Record, error) {
	a.m.mu.Lock()
	defer a.m.mu.Unlock()
	row, ok := a.m.loans[id]
	if !ok || !row.IsParty(actor) {
		return loans.Record{}, httpx.E(404, "NOT_FOUND", "loan not found")
	}
	return row, nil
}

func (a loanAccess) MarkOverdue(context.Context) (int, error) { return 0, nil }
