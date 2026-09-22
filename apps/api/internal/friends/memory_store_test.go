package friends

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type memoryStore struct {
	mu    sync.Mutex
	users map[uuid.UUID]UserRef
	byE   map[string]uuid.UUID
	byU   map[string]uuid.UUID
	rows  map[uuid.UUID]Record
	pairs map[string]uuid.UUID
}

func newMemoryStore(users ...UserRef) *memoryStore {
	m := &memoryStore{
		users: map[uuid.UUID]UserRef{},
		byE:   map[string]uuid.UUID{},
		byU:   map[string]uuid.UUID{},
		rows:  map[uuid.UUID]Record{},
		pairs: map[string]uuid.UUID{},
	}
	for _, u := range users {
		m.users[u.ID] = u
		m.byE[u.Email] = u.ID
		if u.Username != nil {
			m.byU[*u.Username] = u.ID
		}
	}
	return m
}

func pairKey(low, high uuid.UUID) string { return low.String() + ":" + high.String() }

func (m *memoryStore) LookupUser(_ context.Context, id uuid.UUID) (UserRef, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	u, ok := m.users[id]
	if !ok {
		return UserRef{}, pgx.ErrNoRows
	}
	return u, nil
}

func (m *memoryStore) LookupByEmail(_ context.Context, email string) (UserRef, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	id, ok := m.byE[email]
	if !ok {
		return UserRef{}, pgx.ErrNoRows
	}
	return m.users[id], nil
}

func (m *memoryStore) LookupByUsername(_ context.Context, username string) (UserRef, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	id, ok := m.byU[username]
	if !ok {
		return UserRef{}, pgx.ErrNoRows
	}
	return m.users[id], nil
}

func (m *memoryStore) LookupByPhone(_ context.Context, phone string) (UserRef, error) {
	return UserRef{}, pgx.ErrNoRows
}

func (m *memoryStore) SearchUsers(_ context.Context, viewer uuid.UUID, query string) ([]SearchHit, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []SearchHit
	for _, u := range m.users {
		if u.ID == viewer || !u.Verified {
			continue
		}
		if u.Email == query || (u.Username != nil && *u.Username == query) || containsFold(u.DisplayName, query) {
			out = append(out, SearchHit{ID: u.ID, DisplayName: u.DisplayName, Username: u.Username})
		}
	}
	return out, nil
}

func containsFold(s, q string) bool {
	return len(q) >= 2 && (s == q || (len(s) >= len(q) && (s[:len(q)] == q || s == q)))
}

func (m *memoryStore) InsertFriendship(_ context.Context, rec Record) (Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	rec.ID = uuid.New()
	if rec.RequestedAt.IsZero() {
		rec.RequestedAt = time.Now()
	}
	m.rows[rec.ID] = rec
	m.pairs[pairKey(rec.UserLowID, rec.UserHighID)] = rec.ID
	return rec, nil
}

func (m *memoryStore) GetFriendshipByID(_ context.Context, id uuid.UUID) (Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	row, ok := m.rows[id]
	if !ok {
		return Record{}, pgx.ErrNoRows
	}
	return row, nil
}

func (m *memoryStore) GetFriendshipByPair(_ context.Context, low, high uuid.UUID) (Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	id, ok := m.pairs[pairKey(low, high)]
	if !ok {
		return Record{}, pgx.ErrNoRows
	}
	return m.rows[id], nil
}

func (m *memoryStore) UpdateFriendship(_ context.Context, rec Record) (Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.rows[rec.ID]; !ok {
		return Record{}, pgx.ErrNoRows
	}
	m.rows[rec.ID] = rec
	return rec, nil
}

func (m *memoryStore) ListAccepted(_ context.Context, userID uuid.UUID) ([]Record, error) {
	return m.list(userID, StatusAccepted, false)
}

func (m *memoryStore) ListIncoming(_ context.Context, userID uuid.UUID) ([]Record, error) {
	return m.list(userID, StatusPending, true)
}

func (m *memoryStore) ListOutgoing(_ context.Context, userID uuid.UUID) ([]Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Record
	for _, row := range m.rows {
		if row.RequesterID == userID && row.Status == StatusPending {
			out = append(out, row)
		}
	}
	return out, nil
}

func (m *memoryStore) list(userID uuid.UUID, status string, incoming bool) ([]Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Record
	for _, row := range m.rows {
		if row.Status != status {
			continue
		}
		if incoming {
			if row.AddresseeID == userID {
				out = append(out, row)
			}
			continue
		}
		if row.RequesterID == userID || row.AddresseeID == userID {
			out = append(out, row)
		}
	}
	return out, nil
}

func (m *memoryStore) UpsertPhoneInvite(context.Context, uuid.UUID, string) error { return nil }
func (m *memoryStore) ListOpenInvitesByPhone(context.Context, string) ([]PhoneInvite, error) {
	return nil, nil
}
func (m *memoryStore) MarkPhoneInviteResolved(context.Context, uuid.UUID, uuid.UUID) error {
	return nil
}
