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
	identities map[string]uuid.UUID
}

func newMemoryStore() *memoryStore {
	return &memoryStore{
		users:      map[uuid.UUID]UserRecord{},
		byEmail:    map[string]uuid.UUID{},
		sessions:   map[uuid.UUID]SessionRecord{},
		byRefresh:  map[string]uuid.UUID{},
		challenges: map[uuid.UUID]ChallengeRecord{},
		identities: map[string]uuid.UUID{},
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

func (m *memoryStore) UpdateUserAccount(_ context.Context, id uuid.UUID, in AccountUpdate) (UserRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	user, ok := m.users[id]
	if !ok {
		return UserRecord{}, pgx.ErrNoRows
	}
	if in.DisplayName != nil {
		user.DisplayName = *in.DisplayName
	}
	if in.Username != nil {
		user.Username = in.Username
	}
	if in.FirstName != nil {
		user.FirstName = in.FirstName
	}
	if in.MiddleName != nil {
		user.MiddleName = in.MiddleName
	}
	if in.LastName != nil {
		user.LastName = in.LastName
	}
	if in.PhoneE164 != nil {
		user.PhoneE164 = in.PhoneE164
	}
	if in.CountryCode != nil {
		user.CountryCode = in.CountryCode
	}
	if in.PreferredAuthProvider != nil {
		user.PreferredAuthProvider = in.PreferredAuthProvider
	}
	if in.Timezone != nil {
		user.Timezone = *in.Timezone
	}
	if in.Locale != nil {
		user.Locale = *in.Locale
	}
	if in.Currency != nil {
		user.DefaultCurrencyCode = in.Currency
	}
	if in.TOSVersion != nil {
		user.TOSVersion = in.TOSVersion
	}
	if in.TOSAcceptedAt != nil {
		user.TOSAcceptedAt = in.TOSAcceptedAt
	}
	m.users[id] = user
	return user, nil
}

func (m *memoryStore) AcceptTOS(_ context.Context, id uuid.UUID, version string) (UserRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	user, ok := m.users[id]
	if !ok {
		return UserRecord{}, pgx.ErrNoRows
	}
	user.TOSVersion = &version
	now := time.Now().UTC()
	user.TOSAcceptedAt = &now
	m.users[id] = user
	return user, nil
}

func (m *memoryStore) UpdateUserProfile(_ context.Context, id uuid.UUID, displayName, username, timezone, locale, currency *string) (UserRecord, error) {
	return m.UpdateUserAccount(context.Background(), id, AccountUpdate{
		DisplayName: displayName,
		Username:    username,
		Timezone:    timezone,
		Locale:      locale,
		Currency:    currency,
	})
}

func (m *memoryStore) SetUserAvatar(_ context.Context, userID uuid.UUID, objectKey string) (UserRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	user, ok := m.users[userID]
	if !ok {
		return UserRecord{}, pgx.ErrNoRows
	}
	user.AvatarObjectKey = &objectKey
	m.users[userID] = user
	return user, nil
}

func (m *memoryStore) FindIdentity(_ context.Context, provider, subject string) (uuid.UUID, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	id, ok := m.identities[provider+":"+subject]
	if !ok {
		return uuid.Nil, pgx.ErrNoRows
	}
	return id, nil
}

func (m *memoryStore) LinkIdentity(_ context.Context, userID uuid.UUID, provider, subject string, _ *string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.identities[provider+":"+subject] = userID
	return nil
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
