package auth

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type UserRecord struct {
	ID                  uuid.UUID
	Email               string
	DisplayName         string
	PasswordHash        string
	EmailVerifiedAt     *time.Time
	Status              string
	Timezone            string
	Locale              string
	DefaultCurrencyCode *string
	CreatedAt           time.Time
}

type SessionRecord struct {
	ID               uuid.UUID
	UserID           uuid.UUID
	RefreshTokenHash string
	ExpiresAt        time.Time
	RevokedAt        *time.Time
}

type ChallengeRecord struct {
	ID          uuid.UUID
	UserID      uuid.UUID
	CodeHash    string
	Attempts    int32
	MaxAttempts int32
	ExpiresAt   time.Time
}

type Store interface {
	CreateUser(ctx context.Context, email, passwordHash, displayName, timezone, locale string) (UserRecord, error)
	GetUserByEmail(ctx context.Context, email string) (UserRecord, error)
	GetUserByID(ctx context.Context, id uuid.UUID) (UserRecord, error)
	MarkEmailVerified(ctx context.Context, id uuid.UUID) (UserRecord, error)
	UpdateUserProfile(ctx context.Context, id uuid.UUID, displayName, timezone, locale, currency *string) (UserRecord, error)

	CreateSession(ctx context.Context, userID uuid.UUID, refreshHash string, device *string, expiresAt time.Time) (SessionRecord, error)
	GetSessionByID(ctx context.Context, id uuid.UUID) (SessionRecord, error)
	GetSessionByRefreshHash(ctx context.Context, hash string) (SessionRecord, error)
	RotateSession(ctx context.Context, id uuid.UUID, newHash string) (SessionRecord, error)
	RevokeSession(ctx context.Context, id uuid.UUID) error

	InvalidateOpenChallenges(ctx context.Context, userID uuid.UUID) error
	CreateChallenge(ctx context.Context, userID uuid.UUID, channel, destination, codeHash string, expiresAt time.Time) (ChallengeRecord, error)
	GetLatestOpenChallenge(ctx context.Context, userID uuid.UUID) (ChallengeRecord, error)
	IncrementChallengeAttempts(ctx context.Context, id uuid.UUID) (ChallengeRecord, error)
	ConsumeChallenge(ctx context.Context, id uuid.UUID) error
}
