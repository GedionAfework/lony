package auth

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type memoryStore struct {
	mu         sync.Mutex
	users      map[uuid.UUID]UserRecord
	byEmail    map[string]uuid.UUID
	sessions   map[uuid.UUID]SessionRecord
	byRefresh  map[string]uuid.UUID
	challenges map[uuid.UUID]ChallengeRecord
}

func newMemoryStore() *memoryStore {
	return &memoryStore{
		users:      map[uuid.UUID]UserRecord{},
		byEmail:    map[string]uuid.UUID{},
		sessions:   map[uuid.UUID]SessionRecord{},
		byRefresh:  map[string]uuid.UUID{},
		challenges: map[uuid.UUID]ChallengeRecord{},
	}
}

func (m *memoryStore) CreateUser(_ context.Context, email, passwordHash, displayName, timezone, locale string) (UserRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.byEmail[email]; ok {
		return UserRecord{}, errors.New("duplicate email")
	}
	user := UserRecord{
		ID:           uuid.New(),
		Email:        email,
		DisplayName:  displayName,
		PasswordHash: passwordHash,
		Status:       "active",
		Timezone:     timezone,
		Locale:       locale,
		CreatedAt:    time.Now(),
	}
	m.users[user.ID] = user
	m.byEmail[email] = user.ID
	return user, nil
}

func (m *memoryStore) GetUserByEmail(_ context.Context, email string) (UserRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	id, ok := m.byEmail[email]
	if !ok {
		return UserRecord{}, pgx.ErrNoRows
	}
	return m.users[id], nil
}

func (m *memoryStore) GetUserByID(_ context.Context, id uuid.UUID) (UserRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	user, ok := m.users[id]
	if !ok {
		return UserRecord{}, pgx.ErrNoRows
	}
	return user, nil
}

func (m *memoryStore) MarkEmailVerified(_ context.Context, id uuid.UUID) (UserRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	user, ok := m.users[id]
	if !ok {
		return UserRecord{}, pgx.ErrNoRows
	}
	now := time.Now()
	user.EmailVerifiedAt = &now
	m.users[id] = user
	return user, nil
}

func (m *memoryStore) UpdateUserProfile(_ context.Context, id uuid.UUID, displayName, timezone, locale, currency *string) (UserRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	user, ok := m.users[id]
	if !ok {
		return UserRecord{}, pgx.ErrNoRows
	}
	if displayName != nil {
		user.DisplayName = *displayName
	}
	if timezone != nil {
		user.Timezone = *timezone
	}
	if locale != nil {
		user.Locale = *locale
	}
	if currency != nil {
		user.DefaultCurrencyCode = currency
	}
	m.users[id] = user
	return user, nil
}

func (m *memoryStore) CreateSession(_ context.Context, userID uuid.UUID, refreshHash string, _ *string, expiresAt time.Time) (SessionRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	session := SessionRecord{
		ID:               uuid.New(),
		UserID:           userID,
		RefreshTokenHash: refreshHash,
		ExpiresAt:        expiresAt,
	}
	m.sessions[session.ID] = session
	m.byRefresh[refreshHash] = session.ID
	return session, nil
}

func (m *memoryStore) GetSessionByID(_ context.Context, id uuid.UUID) (SessionRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	session, ok := m.sessions[id]
	if !ok {
		return SessionRecord{}, pgx.ErrNoRows
	}
	return session, nil
}

func (m *memoryStore) GetSessionByRefreshHash(_ context.Context, hash string) (SessionRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	id, ok := m.byRefresh[hash]
	if !ok {
		return SessionRecord{}, pgx.ErrNoRows
	}
	return m.sessions[id], nil
}

func (m *memoryStore) RotateSession(_ context.Context, id uuid.UUID, newHash string) (SessionRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	session, ok := m.sessions[id]
	if !ok {
		return SessionRecord{}, pgx.ErrNoRows
	}
	delete(m.byRefresh, session.RefreshTokenHash)
	session.RefreshTokenHash = newHash
	m.sessions[id] = session
	m.byRefresh[newHash] = id
	return session, nil
}

func (m *memoryStore) RevokeSession(_ context.Context, id uuid.UUID) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	session, ok := m.sessions[id]
	if !ok {
		return nil
	}
	now := time.Now()
	session.RevokedAt = &now
	m.sessions[id] = session
	return nil
}

func (m *memoryStore) InvalidateOpenChallenges(_ context.Context, userID uuid.UUID) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	for id, c := range m.challenges {
		if c.UserID == userID {
			c.ExpiresAt = now.Add(-time.Second)
			m.challenges[id] = c
		}
	}
	return nil
}

func (m *memoryStore) CreateChallenge(_ context.Context, userID uuid.UUID, _, _, codeHash string, expiresAt time.Time) (ChallengeRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c := ChallengeRecord{
		ID:          uuid.New(),
		UserID:      userID,
		CodeHash:    codeHash,
		MaxAttempts: 5,
		ExpiresAt:   expiresAt,
	}
	m.challenges[c.ID] = c
	return c, nil
}

func (m *memoryStore) GetLatestOpenChallenge(_ context.Context, userID uuid.UUID) (ChallengeRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var latest *ChallengeRecord
	for _, c := range m.challenges {
		if c.UserID == userID && time.Now().Before(c.ExpiresAt) {
			cp := c
			latest = &cp
		}
	}
	if latest == nil {
		return ChallengeRecord{}, pgx.ErrNoRows
	}
	return *latest, nil
}

func (m *memoryStore) IncrementChallengeAttempts(_ context.Context, id uuid.UUID) (ChallengeRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, ok := m.challenges[id]
	if !ok {
		return ChallengeRecord{}, pgx.ErrNoRows
	}
	c.Attempts++
	m.challenges[id] = c
	return c, nil
}

func (m *memoryStore) ConsumeChallenge(_ context.Context, id uuid.UUID) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, ok := m.challenges[id]
	if !ok {
		return nil
	}
	c.ExpiresAt = time.Now().Add(-time.Second)
	m.challenges[id] = c
	return nil
}
