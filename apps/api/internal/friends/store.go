package friends

import (
	"context"
	"time"

	"github.com/google/uuid"
)

const (
	StatusPending  = "pending"
	StatusAccepted = "accepted"
	StatusRejected = "rejected"
	StatusRemoved  = "removed"
	StatusBlocked  = "blocked"
)

type UserRef struct {
	ID          uuid.UUID
	Email       string
	Username    *string
	DisplayName string
	Status      string
	Verified    bool
}

type SearchHit struct {
	ID          uuid.UUID `json:"id"`
	DisplayName string    `json:"display_name"`
	Username    *string   `json:"username"`
}

type Record struct {
	ID               uuid.UUID
	RequesterID      uuid.UUID
	AddresseeID      uuid.UUID
	UserLowID        uuid.UUID
	UserHighID       uuid.UUID
	Status           string
	RequestedAt      time.Time
	AcceptedAt       *time.Time
	RemovedAt        *time.Time
	BlockedByUserID  *uuid.UUID
	InteractionCount int
	LastInteractedAt *time.Time
}

type FriendDTO struct {
	ID               uuid.UUID  `json:"id"`
	Status           string     `json:"status"`
	RequestedAt      time.Time  `json:"requested_at"`
	AcceptedAt       *time.Time `json:"accepted_at,omitempty"`
	InteractionCount int        `json:"interaction_count"`
	Bond             string     `json:"bond"` // acquaintance | friend | close
	Peer             SearchHit  `json:"peer"`
}

// PeerHit is someone the viewer has interacted with (loans/splits/chats) and/or is bonded to.
type PeerHit struct {
	ID               uuid.UUID `json:"id"`
	DisplayName      string    `json:"display_name"`
	Username         *string   `json:"username,omitempty"`
	InteractionCount int       `json:"interaction_count"`
	Bond             string    `json:"bond"`
	IsBonded         bool      `json:"is_bonded"`
}

type Store interface {
	LookupUser(ctx context.Context, id uuid.UUID) (UserRef, error)
	LookupByEmail(ctx context.Context, email string) (UserRef, error)
	LookupByUsername(ctx context.Context, username string) (UserRef, error)
	LookupByPhone(ctx context.Context, phoneE164 string) (UserRef, error)
	SearchUsers(ctx context.Context, viewer uuid.UUID, query string) ([]SearchHit, error)

	InsertFriendship(ctx context.Context, rec Record) (Record, error)
	GetFriendshipByID(ctx context.Context, id uuid.UUID) (Record, error)
	GetFriendshipByPair(ctx context.Context, low, high uuid.UUID) (Record, error)
	UpdateFriendship(ctx context.Context, rec Record) (Record, error)
	ListAccepted(ctx context.Context, userID uuid.UUID) ([]Record, error)
	ListIncoming(ctx context.Context, userID uuid.UUID) ([]Record, error)
	ListOutgoing(ctx context.Context, userID uuid.UUID) ([]Record, error)
	EnsureBond(ctx context.Context, a, b uuid.UUID, bump int) (Record, error)
	ListInteractedPeers(ctx context.Context, userID uuid.UUID, query string, limit int) ([]PeerHit, error)

	UpsertPhoneInvite(ctx context.Context, inviterID uuid.UUID, phoneE164 string) error
	ListOpenInvitesByPhone(ctx context.Context, phoneE164 string) ([]PhoneInvite, error)
	MarkPhoneInviteResolved(ctx context.Context, id, resolvedUserID uuid.UUID) error
}

type PhoneInvite struct {
	ID        uuid.UUID
	InviterID uuid.UUID
	PhoneE164 string
}
