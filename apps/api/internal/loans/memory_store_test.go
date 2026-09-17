package loans

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
)

type memoryStore struct {
	mu     sync.Mutex
	users  map[uuid.UUID]Party
	loans  map[uuid.UUID]Record
	terms  map[uuid.UUID][]Terms
	events map[uuid.UUID][]Event
}

func newMemoryStore(users ...Party) *memoryStore {
	m := &memoryStore{
		users:  map[uuid.UUID]Party{},
		loans:  map[uuid.UUID]Record{},
		terms:  map[uuid.UUID][]Terms{},
		events: map[uuid.UUID][]Event{},
	}
	for _, u := range users {
		m.users[u.ID] = u
	}
	return m
}

func (m *memoryStore) GetParty(_ context.Context, id uuid.UUID) (Party, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	u, ok := m.users[id]
	if !ok {
		return Party{}, pgx.ErrNoRows
	}
	return u, nil
}

func (m *memoryStore) InsertLoan(_ context.Context, rec Record, terms *Terms, events []Event) (Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	rec.ID = uuid.New()
	now := time.Now()
	rec.CreatedAt = now
	rec.UpdatedAt = now
	if terms != nil {
		terms.ID = uuid.New()
		terms.LoanID = rec.ID
		terms.CreatedAt = now
		rec.CurrentTermsID = &terms.ID
		m.terms[rec.ID] = []Terms{*terms}
	}
	m.loans[rec.ID] = rec
	m.appendEvents(rec.ID, events)
	return rec, nil
}

func (m *memoryStore) GetLoan(_ context.Context, id uuid.UUID) (Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	rec, ok := m.loans[id]
	if !ok {
		return Record{}, pgx.ErrNoRows
	}
	return rec, nil
}

func (m *memoryStore) ListLoans(_ context.Context, userID uuid.UUID, status, role string) ([]Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Record
	for _, rec := range m.loans {
		if rec.BorrowerID != userID && rec.LenderID != userID {
			continue
		}
		if status != "" && rec.Status != status {
			continue
		}
		if role == RoleBorrower && rec.BorrowerID != userID {
			continue
		}
		if role == RoleLender && rec.LenderID != userID {
			continue
		}
		out = append(out, rec)
	}
	return out, nil
}

func (m *memoryStore) ListTerms(_ context.Context, loanID uuid.UUID) ([]Terms, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]Terms{}, m.terms[loanID]...), nil
}

func (m *memoryStore) ListEvents(_ context.Context, loanID uuid.UUID) ([]Event, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]Event{}, m.events[loanID]...), nil
}

func (m *memoryStore) ProposeTerms(_ context.Context, rec Record, terms Terms, event Event) (Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.loans[rec.ID]; !ok {
		return Record{}, pgx.ErrNoRows
	}
	for i := range m.terms[rec.ID] {
		if m.terms[rec.ID][i].Status == TermsProposed {
			m.terms[rec.ID][i].Status = TermsSuperseded
		}
	}
	terms.ID = uuid.New()
	terms.LoanID = rec.ID
	terms.CreatedAt = time.Now()
	m.terms[rec.ID] = append(m.terms[rec.ID], terms)
	rec.CurrentTermsID = &terms.ID
	rec.UpdatedAt = time.Now()
	m.loans[rec.ID] = rec
	m.appendEvents(rec.ID, []Event{event})
	return rec, nil
}

func (m *memoryStore) ApplyTransition(_ context.Context, rec Record, acceptedTermsID *uuid.UUID, event Event) (Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.loans[rec.ID]; !ok {
		return Record{}, pgx.ErrNoRows
	}
	if acceptedTermsID != nil {
		for i := range m.terms[rec.ID] {
			if m.terms[rec.ID][i].ID == *acceptedTermsID {
				m.terms[rec.ID][i].Status = TermsAccepted
			}
		}
	}
	rec.UpdatedAt = time.Now()
	m.loans[rec.ID] = rec
	m.appendEvents(rec.ID, []Event{event})
	return rec, nil
}

func (m *memoryStore) MarkOverdue(_ context.Context, now time.Time) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for id, rec := range m.loans {
		if rec.Status != StatusActive || rec.DueAt == nil || !rec.DueAt.Before(now) {
			continue
		}
		if rec.OutstandingAmount == nil || !rec.OutstandingAmount.GreaterThan(decimal.Zero) {
			continue
		}
		rec.Status = StatusOverdue
		rec.UpdatedAt = now
		m.loans[id] = rec
		m.appendEvents(id, []Event{{Type: EventOverdue, Payload: []byte(`{}`), CreatedAt: now}})
		n++
	}
	return n, nil
}

func (m *memoryStore) appendEvents(loanID uuid.UUID, events []Event) {
	for _, ev := range events {
		if ev.ID == uuid.Nil {
			ev.ID = uuid.New()
		}
		if ev.CreatedAt.IsZero() {
			ev.CreatedAt = time.Now()
		}
		ev.LoanID = loanID
		m.events[loanID] = append(m.events[loanID], ev)
	}
}

type staticGate struct {
	ok  bool
	err error
}

func (g staticGate) CanCreateLoan(context.Context, uuid.UUID, uuid.UUID) (bool, error) {
	return g.ok, g.err
}
