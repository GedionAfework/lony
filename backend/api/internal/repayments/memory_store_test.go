package repayments

import (
	"context"
	"errors"
	"sync"
	"time"

	"equilend/api/internal/httpx"
	"equilend/api/internal/loans"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
)

type memoryStore struct {
	mu       sync.Mutex
	loans    map[uuid.UUID]loans.Record
	reps     map[uuid.UUID]Record
	byLoan   map[uuid.UUID][]uuid.UUID
	events   map[uuid.UUID][]loans.Event
	entries  map[uuid.UUID]EntryInfo
	accounts map[uuid.UUID]memAccount
	// failInsert simulates the database failing inside the claim transaction.
	failInsert bool
}

type memAccount struct {
	owner    uuid.UUID
	currency string
	balance  decimal.Decimal
	archived bool
}

func (m *memoryStore) addAccount(owner uuid.UUID, currency, balance string) uuid.UUID {
	id := uuid.New()
	m.accounts[id] = memAccount{owner: owner, currency: currency, balance: decimal.RequireFromString(balance)}
	return id
}

func (m *memoryStore) addEntry(owner uuid.UUID, kind, amount, currency string) uuid.UUID {
	id := uuid.New()
	m.entries[id] = EntryInfo{ID: id, UserID: owner, Kind: kind, Status: "confirmed", Amount: decimal.RequireFromString(amount), CurrencyCode: currency}
	return id
}

func (m *memoryStore) balance(id uuid.UUID) string {
	return m.accounts[id].balance.StringFixed(2)
}

// writeEntry mirrors the SQL store: insert the entry and move the account balance.
func (m *memoryStore) writeEntry(e EntryWrite) uuid.UUID {
	id := uuid.New()
	acct := e.AccountID
	m.entries[id] = EntryInfo{ID: id, UserID: e.UserID, Kind: e.Kind, Status: "confirmed", Amount: e.Amount, CurrencyCode: e.CurrencyCode, AccountID: &acct}
	a := m.accounts[e.AccountID]
	if e.Kind == KindExpense {
		a.balance = a.balance.Sub(e.Amount)
	} else {
		a.balance = a.balance.Add(e.Amount)
	}
	m.accounts[e.AccountID] = a
	return id
}

func newMemoryStore(loanRows ...loans.Record) *memoryStore {
	m := &memoryStore{
		loans:    map[uuid.UUID]loans.Record{},
		reps:     map[uuid.UUID]Record{},
		byLoan:   map[uuid.UUID][]uuid.UUID{},
		events:   map[uuid.UUID][]loans.Event{},
		entries:  map[uuid.UUID]EntryInfo{},
		accounts: map[uuid.UUID]memAccount{},
	}
	for _, row := range loanRows {
		m.loans[row.ID] = row
	}
	return m
}

func (m *memoryStore) InsertRepayment(_ context.Context, rec Record, loan loans.Record, events []loans.Event, entry *EntryWrite) (Record, loans.Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, id := range m.byLoan[loan.ID] {
		if m.reps[id].Status == StatusPending {
			return Record{}, loans.Record{}, httpx.E(409, "PENDING_EXISTS", "a repayment claim is already waiting for confirmation")
		}
	}
	if m.failInsert {
		return Record{}, loans.Record{}, errors.New("db down")
	}
	now := time.Now()
	if rec.ID == uuid.Nil {
		rec.ID = uuid.New()
	}
	rec.CreatedAt = now
	rec.UpdatedAt = now
	if rec.SubmittedAt.IsZero() {
		rec.SubmittedAt = now
	}
	if entry != nil {
		id := m.writeEntry(*entry)
		rec.PaidEntryID = &id
	}
	if rec.PaidEntryID != nil {
		for id, other := range m.reps {
			if other.PaidEntryID != nil && *other.PaidEntryID == *rec.PaidEntryID {
				other.PaidEntryID = nil
				m.reps[id] = other
			}
		}
	}
	m.reps[rec.ID] = rec
	m.byLoan[loan.ID] = append(m.byLoan[loan.ID], rec.ID)
	loan.UpdatedAt = now
	m.loans[loan.ID] = loan
	for _, event := range events {
		event.LoanID = loan.ID
		m.events[loan.ID] = append(m.events[loan.ID], event)
	}
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

func (m *memoryStore) FinishRepayment(_ context.Context, rec Record, loan loans.Record, event loans.Event, entry *EntryWrite) (Record, loans.Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.reps[rec.ID]; !ok {
		return Record{}, loans.Record{}, pgx.ErrNoRows
	}
	if entry != nil {
		id := m.writeEntry(*entry)
		rec.ReceivedEntryID = &id
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

func (m *memoryStore) ResolveRejected(_ context.Context, rec Record, undo bool) (Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if undo && rec.PaidEntryID != nil {
		e := m.entries[*rec.PaidEntryID]
		if e.AccountID != nil {
			a := m.accounts[*e.AccountID]
			a.balance = a.balance.Add(e.Amount)
			m.accounts[*e.AccountID] = a
		}
		delete(m.entries, *rec.PaidEntryID)
	}
	rec.PaidEntryID = nil
	m.reps[rec.ID] = rec
	return rec, nil
}

func (m *memoryStore) RepaymentEntryInfo(_ context.Context, entryID uuid.UUID) (EntryInfo, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.entries[entryID]
	if !ok {
		return EntryInfo{}, pgx.ErrNoRows
	}
	return e, nil
}

func (m *memoryStore) RepaymentAccountInfo(_ context.Context, userID, accountID uuid.UUID) (AccountInfo, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	a, ok := m.accounts[accountID]
	if !ok || a.owner != userID {
		return AccountInfo{}, pgx.ErrNoRows
	}
	return AccountInfo{ID: accountID, CurrencyCode: a.currency, Archived: a.archived}, nil
}

func (m *memoryStore) RepaymentForEntry(_ context.Context, entryID uuid.UUID) (Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, r := range m.reps {
		if (r.PaidEntryID != nil && *r.PaidEntryID == entryID) || (r.ReceivedEntryID != nil && *r.ReceivedEntryID == entryID) {
			return r, nil
		}
	}
	return Record{}, pgx.ErrNoRows
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
