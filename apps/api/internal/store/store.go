package store

import (
	"context"
	"time"

	"equilend/api/internal/auth"
	"equilend/api/internal/store/sqlc"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type SQLStore struct {
	pool *pgxpool.Pool
	q    *sqlc.Queries
}

func New(pool *pgxpool.Pool) *SQLStore {
	return &SQLStore{pool: pool, q: sqlc.New(pool)}
}

func (s *SQLStore) CreateUser(ctx context.Context, email, passwordHash, displayName, timezone, locale string) (auth.UserRecord, error) {
	row, err := s.q.CreateUser(ctx, sqlc.CreateUserParams{
		Email:        email,
		PasswordHash: passwordHash,
		DisplayName:  displayName,
		Timezone:     timezone,
		Locale:       locale,
	})
	if err != nil {
		return auth.UserRecord{}, err
	}
	return mapUser(row), nil
}

func (s *SQLStore) GetUserByEmail(ctx context.Context, email string) (auth.UserRecord, error) {
	row, err := s.q.GetUserByEmail(ctx, email)
	if err != nil {
		return auth.UserRecord{}, err
	}
	return mapUser(row), nil
}

func (s *SQLStore) GetUserByID(ctx context.Context, id uuid.UUID) (auth.UserRecord, error) {
	row, err := s.q.GetUserByID(ctx, id)
	if err != nil {
		return auth.UserRecord{}, err
	}
	return mapUser(row), nil
}

func (s *SQLStore) MarkEmailVerified(ctx context.Context, id uuid.UUID) (auth.UserRecord, error) {
	row, err := s.q.MarkEmailVerified(ctx, id)
	if err != nil {
		return auth.UserRecord{}, err
	}
	return mapUser(row), nil
}

func (s *SQLStore) UpdateUserProfile(ctx context.Context, id uuid.UUID, displayName, timezone, locale, currency *string) (auth.UserRecord, error) {
	row, err := s.q.UpdateUserProfile(ctx, sqlc.UpdateUserProfileParams{
		ID:                  id,
		DisplayName:         displayName,
		Timezone:            timezone,
		Locale:              locale,
		DefaultCurrencyCode: currency,
	})
	if err != nil {
		return auth.UserRecord{}, err
	}
	return mapUser(row), nil
}

func (s *SQLStore) CreateSession(ctx context.Context, userID uuid.UUID, refreshHash string, device *string, expiresAt time.Time) (auth.SessionRecord, error) {
	row, err := s.q.CreateSession(ctx, sqlc.CreateSessionParams{
		UserID:           userID,
		RefreshTokenHash: refreshHash,
		DeviceLabel:      device,
		ExpiresAt:        expiresAt,
	})
	if err != nil {
		return auth.SessionRecord{}, err
	}
	return mapSession(row), nil
}

func (s *SQLStore) GetSessionByID(ctx context.Context, id uuid.UUID) (auth.SessionRecord, error) {
	row, err := s.q.GetSessionByID(ctx, id)
	if err != nil {
		return auth.SessionRecord{}, err
	}
	return mapSession(row), nil
}

func (s *SQLStore) GetSessionByRefreshHash(ctx context.Context, hash string) (auth.SessionRecord, error) {
	row, err := s.q.GetSessionByRefreshHash(ctx, hash)
	if err != nil {
		return auth.SessionRecord{}, err
	}
	return mapSession(row), nil
}

func (s *SQLStore) RotateSession(ctx context.Context, id uuid.UUID, newHash string) (auth.SessionRecord, error) {
	row, err := s.q.RotateSession(ctx, sqlc.RotateSessionParams{
		ID:               id,
		RefreshTokenHash: newHash,
	})
	if err != nil {
		return auth.SessionRecord{}, err
	}
	return mapSession(row), nil
}

func (s *SQLStore) RevokeSession(ctx context.Context, id uuid.UUID) error {
	return s.q.RevokeSession(ctx, id)
}

func (s *SQLStore) InvalidateOpenChallenges(ctx context.Context, userID uuid.UUID) error {
	return s.q.InvalidateOpenChallenges(ctx, userID)
}

func (s *SQLStore) CreateChallenge(ctx context.Context, userID uuid.UUID, channel, destination, codeHash string, expiresAt time.Time) (auth.ChallengeRecord, error) {
	row, err := s.q.CreateVerificationChallenge(ctx, sqlc.CreateVerificationChallengeParams{
		UserID:      userID,
		Channel:     channel,
		Destination: destination,
		CodeHash:    codeHash,
		ExpiresAt:   expiresAt,
	})
	if err != nil {
		return auth.ChallengeRecord{}, err
	}
	return mapChallenge(row), nil
}

func (s *SQLStore) GetLatestOpenChallenge(ctx context.Context, userID uuid.UUID) (auth.ChallengeRecord, error) {
	row, err := s.q.GetLatestOpenChallenge(ctx, userID)
	if err != nil {
		return auth.ChallengeRecord{}, err
	}
	return mapChallenge(row), nil
}

func (s *SQLStore) IncrementChallengeAttempts(ctx context.Context, id uuid.UUID) (auth.ChallengeRecord, error) {
	row, err := s.q.IncrementChallengeAttempts(ctx, id)
	if err != nil {
		return auth.ChallengeRecord{}, err
	}
	return mapChallenge(row), nil
}

func (s *SQLStore) ConsumeChallenge(ctx context.Context, id uuid.UUID) error {
	return s.q.ConsumeChallenge(ctx, id)
}

func mapUser(row sqlc.User) auth.UserRecord {
	return auth.UserRecord{
		ID:                  row.ID,
		Email:               row.Email,
		DisplayName:         row.DisplayName,
		PasswordHash:        row.PasswordHash,
		EmailVerifiedAt:     row.EmailVerifiedAt,
		Status:              row.Status,
		Timezone:            row.Timezone,
		Locale:              row.Locale,
		DefaultCurrencyCode: row.DefaultCurrencyCode,
		CreatedAt:           row.CreatedAt,
	}
}

func mapSession(row sqlc.UserSession) auth.SessionRecord {
	return auth.SessionRecord{
		ID:               row.ID,
		UserID:           row.UserID,
		RefreshTokenHash: row.RefreshTokenHash,
		ExpiresAt:        row.ExpiresAt,
		RevokedAt:        row.RevokedAt,
	}
}

func mapChallenge(row sqlc.VerificationChallenge) auth.ChallengeRecord {
	return auth.ChallengeRecord{
		ID:          row.ID,
		UserID:      row.UserID,
		CodeHash:    row.CodeHash,
		Attempts:    row.Attempts,
		MaxAttempts: row.MaxAttempts,
		ExpiresAt:   row.ExpiresAt,
	}
}
