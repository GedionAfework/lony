package banks

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

const (
	TypeBankAccount   = "bank_account"
	TypeIBAN          = "iban"
	TypeMobileMoney   = "mobile_money"
	TypeMobileWallet  = "mobile_wallet"
	TypeCryptoWallet  = "crypto_wallet"
	TypeCard          = "card"
	TypePayPal        = "paypal"
	TypeWise          = "wise"
	TypeCashApp       = "cash_app"
	TypeVenmo         = "venmo"
	TypeUPI           = "upi"
	TypePix           = "pix"
	TypeSEPA          = "sepa"
	TypeSwift         = "swift"
	TypeOther         = "other"

	EventCreated   = "created"
	EventUpdated   = "updated"
	EventArchived  = "archived"
	EventPreferred = "preferred"
	EventShared    = "shared"
	EventRevoked   = "revoked"
	EventRevealed  = "revealed"

	RevealWindow = 5 * time.Minute
)

type Profile struct {
	ID               uuid.UUID
	UserID           uuid.UUID
	Type             string
	Label            string
	InstitutionName  *string
	IdentifierCipher []byte
	Last4            string
	CurrencyCode     *string
	CountryCode      *string
	RailCode         *string
	IsPreferred      bool
	ArchivedAt       *time.Time
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

type Share struct {
	ID            uuid.UUID
	BankProfileID uuid.UUID
	OwnerID       uuid.UUID
	RecipientID   uuid.UUID
	LoanID        *uuid.UUID
	CreatedAt     time.Time
	RevokedAt     *time.Time
}

type Event struct {
	ID            uuid.UUID
	BankProfileID uuid.UUID
	ShareID       *uuid.UUID
	ActorID       *uuid.UUID
	Type          string
	Payload       json.RawMessage
	CreatedAt     time.Time
}

type ProfileDTO struct {
	ID                uuid.UUID  `json:"id"`
	Type              string     `json:"profile_type"`
	Label             string     `json:"label"`
	InstitutionName   *string    `json:"institution_name,omitempty"`
	AccountLast4      string     `json:"account_last4"`
	CurrencyCode      *string    `json:"currency_code,omitempty"`
	CountryCode       *string    `json:"country_code,omitempty"`
	RailCode          *string    `json:"rail_code,omitempty"`
	IsPreferred       bool       `json:"is_preferred"`
	ArchivedAt        *time.Time `json:"archived_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	AccountIdentifier *string    `json:"account_identifier,omitempty"`
	CanReveal         bool       `json:"can_reveal"`
}

type ShareDTO struct {
	ID        uuid.UUID  `json:"id"`
	Profile   ProfileDTO `json:"profile"`
	OwnerID   uuid.UUID  `json:"owner_id"`
	Recipient uuid.UUID  `json:"recipient_id"`
	LoanID    *uuid.UUID `json:"loan_id,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
	RevokedAt *time.Time `json:"revoked_at,omitempty"`
}

type EventDTO struct {
	ID        uuid.UUID       `json:"id"`
	Type      string          `json:"event_type"`
	ShareID   *uuid.UUID      `json:"share_id,omitempty"`
	ActorID   *uuid.UUID      `json:"actor_id,omitempty"`
	Payload   json.RawMessage `json:"payload"`
	CreatedAt time.Time       `json:"created_at"`
}

type CreateInput struct {
	Type            string
	Label           string
	InstitutionName *string
	Identifier      string
	CurrencyCode    *string
	CountryCode     *string
	RailCode        *string
	IsPreferred     bool
}

type PatchInput struct {
	Type            *string
	Label           *string
	InstitutionName *string
	Identifier      *string
	CurrencyCode    *string
}

type ShareInput struct {
	RecipientID uuid.UUID
	LoanID      *uuid.UUID
}

type Store interface {
	InsertProfile(ctx context.Context, rec Profile, event Event) (Profile, error)
	GetProfile(ctx context.Context, id uuid.UUID) (Profile, error)
	ListProfiles(ctx context.Context, userID uuid.UUID, includeArchived bool) ([]Profile, error)
	UpdateProfile(ctx context.Context, rec Profile, event Event) (Profile, error)
	SetPreferred(ctx context.Context, userID, profileID uuid.UUID, event Event) (Profile, error)
	InsertShare(ctx context.Context, rec Share, event Event) (Share, error)
	GetShare(ctx context.Context, id uuid.UUID) (Share, error)
	GetActiveShare(ctx context.Context, profileID, recipientID uuid.UUID, loanID *uuid.UUID) (Share, error)
	ListSharesForOwner(ctx context.Context, ownerID uuid.UUID) ([]Share, error)
	ListSharesForRecipient(ctx context.Context, recipientID uuid.UUID) ([]Share, error)
	ActiveShareForLoan(ctx context.Context, loanID, recipientID uuid.UUID) (Share, error)
	RevokeShare(ctx context.Context, id uuid.UUID, event Event) (Share, error)
	ListProfileEvents(ctx context.Context, profileID uuid.UUID) ([]Event, error)
	InsertProfileEvent(ctx context.Context, event Event) error
}
