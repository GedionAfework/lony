package banks

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type memoryStore struct {
	mu       sync.Mutex
	profiles map[uuid.UUID]Profile
	shares   map[uuid.UUID]Share
	events   map[uuid.UUID][]Event
}

func newMemoryStore() *memoryStore {
	return &memoryStore{
		profiles: map[uuid.UUID]Profile{},
		shares:   map[uuid.UUID]Share{},
		events:   map[uuid.UUID][]Event{},
	}
}

func (m *memoryStore) InsertProfile(_ context.Context, rec Profile, event Event) (Profile, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	rec.ID = uuid.New()
	rec.CreatedAt = now
	rec.UpdatedAt = now
	if rec.IsPreferred {
		m.clearPreferredLocked(rec.UserID)
	}
	m.profiles[rec.ID] = rec
	event.BankProfileID = rec.ID
	m.appendEventLocked(event)
	return rec, nil
}

func (m *memoryStore) GetProfile(_ context.Context, id uuid.UUID) (Profile, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	row, ok := m.profiles[id]
	if !ok {
		return Profile{}, pgx.ErrNoRows
	}
	return row, nil
}

func (m *memoryStore) ListProfiles(_ context.Context, userID uuid.UUID, includeArchived bool) ([]Profile, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Profile
	for _, row := range m.profiles {
		if row.UserID != userID {
			continue
		}
		if !includeArchived && row.ArchivedAt != nil {
			continue
		}
		out = append(out, row)
	}
	return out, nil
}

func (m *memoryStore) UpdateProfile(_ context.Context, rec Profile, event Event) (Profile, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.profiles[rec.ID]; !ok {
		return Profile{}, pgx.ErrNoRows
	}
	rec.UpdatedAt = time.Now()
	m.profiles[rec.ID] = rec
	m.appendEventLocked(event)
	return rec, nil
}

func (m *memoryStore) SetPreferred(_ context.Context, userID, profileID uuid.UUID, event Event) (Profile, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	row, ok := m.profiles[profileID]
	if !ok || row.UserID != userID {
		return Profile{}, pgx.ErrNoRows
	}
	m.clearPreferredLocked(userID)
	row.IsPreferred = true
	row.UpdatedAt = time.Now()
	m.profiles[profileID] = row
	m.appendEventLocked(event)
	return row, nil
}

func (m *memoryStore) InsertShare(_ context.Context, rec Share, event Event) (Share, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	rec.ID = uuid.New()
	rec.CreatedAt = time.Now()
	m.shares[rec.ID] = rec
	event.ShareID = &rec.ID
	m.appendEventLocked(event)
	return rec, nil
}

func (m *memoryStore) GetShare(_ context.Context, id uuid.UUID) (Share, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	row, ok := m.shares[id]
	if !ok {
		return Share{}, pgx.ErrNoRows
	}
	return row, nil
}

func (m *memoryStore) GetActiveShare(_ context.Context, profileID, recipientID uuid.UUID, loanID *uuid.UUID) (Share, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, row := range m.shares {
		if row.BankProfileID != profileID || row.RecipientID != recipientID || row.RevokedAt != nil {
			continue
		}
		if loanID == nil && row.LoanID == nil {
			return row, nil
		}
		if loanID != nil && row.LoanID != nil && *loanID == *row.LoanID {
			return row, nil
		}
	}
	return Share{}, pgx.ErrNoRows
}

func (m *memoryStore) ListSharesForOwner(_ context.Context, ownerID uuid.UUID) ([]Share, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Share
	for _, row := range m.shares {
		if row.OwnerID == ownerID {
			out = append(out, row)
		}
	}
	return out, nil
}

func (m *memoryStore) ListSharesForRecipient(_ context.Context, recipientID uuid.UUID) ([]Share, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Share
	for _, row := range m.shares {
		if row.RecipientID == recipientID && row.RevokedAt == nil {
			out = append(out, row)
		}
	}
	return out, nil
}

func (m *memoryStore) ActiveShareForLoan(_ context.Context, loanID, recipientID uuid.UUID) (Share, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var found *Share
	for _, row := range m.shares {
		if row.LoanID == nil || *row.LoanID != loanID || row.RecipientID != recipientID || row.RevokedAt != nil {
			continue
		}
		profile := m.profiles[row.BankProfileID]
		if profile.ArchivedAt != nil {
			continue
		}
		if found == nil || profile.IsPreferred {
			copy := row
			found = &copy
		}
	}
	if found == nil {
		return Share{}, pgx.ErrNoRows
	}
	return *found, nil
}

func (m *memoryStore) RevokeShare(_ context.Context, id uuid.UUID, event Event) (Share, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	row, ok := m.shares[id]
	if !ok || row.RevokedAt != nil {
		return Share{}, pgx.ErrNoRows
	}
	now := time.Now()
	row.RevokedAt = &now
	m.shares[id] = row
	m.appendEventLocked(event)
	return row, nil
}

func (m *memoryStore) ListProfileEvents(_ context.Context, profileID uuid.UUID) ([]Event, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := append([]Event{}, m.events[profileID]...)
	return out, nil
}

func (m *memoryStore) InsertProfileEvent(_ context.Context, event Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.appendEventLocked(event)
	return nil
}

func (m *memoryStore) clearPreferredLocked(userID uuid.UUID) {
	for id, row := range m.profiles {
		if row.UserID == userID && row.ArchivedAt == nil && row.IsPreferred {
			row.IsPreferred = false
			m.profiles[id] = row
		}
	}
}

func (m *memoryStore) appendEventLocked(event Event) {
	if event.ID == uuid.Nil {
		event.ID = uuid.New()
	}
	event.CreatedAt = time.Now()
	m.events[event.BankProfileID] = append(m.events[event.BankProfileID], event)
}
