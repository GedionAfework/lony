package auth

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type UserRecord struct {
	ID                    uuid.UUID
	Email                 string
	Username              *string
	PhoneE164             *string
	DisplayName           string
	FirstName             *string
	MiddleName            *string
	LastName              *string
	CountryCode           *string
	PreferredAuthProvider *string
	TOSVersion            *string
	TOSAcceptedAt         *time.Time
	PasswordHash          string
	AvatarObjectKey       *string
	EmailVerifiedAt       *time.Time
	Status                string
	Timezone              string
	Locale                string
	DefaultCurrencyCode   *string
	CreatedAt             time.Time
}

// AccountUpdate is a partial profile update (nil fields are left unchanged).
type AccountUpdate struct {
	FirstName             *string
	MiddleName            *string
	LastName              *string
	DisplayName           *string
	Username              *string
	PhoneE164             *string
	CountryCode           *string
	PreferredAuthProvider *string
	Timezone              *string
	Locale                *string
	Currency              *string
	TOSVersion            *string
	TOSAcceptedAt         *time.Time
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
	UpdateUserProfile(ctx context.Context, id uuid.UUID, displayName, username, timezone, locale, currency *string) (UserRecord, error)
	UpdateUserAccount(ctx context.Context, id uuid.UUID, in AccountUpdate) (UserRecord, error)
	AcceptTOS(ctx context.Context, id uuid.UUID, version string) (UserRecord, error)
	SetUserAvatar(ctx context.Context, userID uuid.UUID, objectKey string) (UserRecord, error)
	FindIdentity(ctx context.Context, provider, subject string) (uuid.UUID, error)
	LinkIdentity(ctx context.Context, userID uuid.UUID, provider, subject string, email *string) error

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
