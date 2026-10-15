package localization

import (
	"context"
	"encoding/json"
	"time"
)

type Locale struct {
	Code      string          `json:"code"`
	Name      string          `json:"name"`
	Dir       string          `json:"dir"`
	Enabled   bool            `json:"enabled"`
	SortOrder int             `json:"sort_order"`
	Messages  json.RawMessage `json:"messages,omitempty"`
	CreatedAt time.Time       `json:"created_at"`
	UpdatedAt time.Time       `json:"updated_at"`
}

type Calendar struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Enabled   bool            `json:"enabled"`
	SortOrder int             `json:"sort_order"`
	Config    json.RawMessage `json:"config,omitempty"`
	CreatedAt time.Time       `json:"created_at"`
	UpdatedAt time.Time       `json:"updated_at"`
}

type PackUpload struct {
	Locale   string            `json:"locale"`
	Name     string            `json:"name"`
	Dir      string            `json:"dir"`
	Messages map[string]string `json:"messages"`
	Enabled  *bool             `json:"enabled,omitempty"`
}

type Store interface {
	ListLocales(ctx context.Context, enabledOnly bool) ([]Locale, error)
	GetLocale(ctx context.Context, code string) (Locale, error)
	UpsertLocale(ctx context.Context, code, name, dir string, enabled bool, sortOrder int, messages json.RawMessage) (Locale, error)
	SetLocaleEnabled(ctx context.Context, code string, enabled bool) (Locale, error)
	DeleteLocale(ctx context.Context, code string) error
	ListCalendars(ctx context.Context, enabledOnly bool) ([]Calendar, error)
	SetCalendarEnabled(ctx context.Context, id string, enabled bool) (Calendar, error)
}
