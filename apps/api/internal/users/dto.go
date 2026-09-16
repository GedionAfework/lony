package users

import (
	"time"

	"github.com/google/uuid"
)

type PublicUser struct {
	ID                   uuid.UUID `json:"id"`
	Email                string    `json:"email"`
	DisplayName          string    `json:"display_name"`
	Timezone             string    `json:"timezone"`
	Locale               string    `json:"locale"`
	DefaultCurrencyCode  *string   `json:"default_currency_code"`
	EmailVerified        bool      `json:"email_verified"`
	Status               string    `json:"status"`
	CreatedAt            time.Time `json:"created_at"`
}
