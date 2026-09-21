package users

import (
	"time"

	"github.com/google/uuid"
)

type PublicUser struct {
	ID                    uuid.UUID  `json:"id"`
	Email                 string     `json:"email"`
	Username              *string    `json:"username,omitempty"`
	PhoneE164             *string    `json:"phone_e164,omitempty"`
	DisplayName           string     `json:"display_name"`
	FirstName             *string    `json:"first_name,omitempty"`
	MiddleName            *string    `json:"middle_name,omitempty"`
	LastName              *string    `json:"last_name,omitempty"`
	CountryCode           *string    `json:"country_code,omitempty"`
	PreferredAuthProvider *string    `json:"preferred_auth_provider,omitempty"`
	TOSVersion            *string    `json:"tos_version,omitempty"`
	TOSAcceptedAt         *time.Time `json:"tos_accepted_at,omitempty"`
	AvatarURL             *string    `json:"avatar_url,omitempty"`
	Timezone              string     `json:"timezone"`
	Locale                string     `json:"locale"`
	DefaultCurrencyCode   *string    `json:"default_currency_code"`
	EmailVerified         bool       `json:"email_verified"`
	Status                string     `json:"status"`
	CreatedAt             time.Time  `json:"created_at"`
	ProfileComplete       bool       `json:"profile_complete"`
}
