package admin

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

const (
	RoleUser  = "user"
	RoleAdmin = "admin"

	ActionSuspend       = "user.suspend"
	ActionUnsuspend     = "user.unsuspend"
	ActionAIDisable     = "settings.ai_disable"
	ActionAIEnable      = "settings.ai_enable"
	ActionCatalogCreate = "catalog.create"
	ActionCatalogUpdate = "catalog.update"

	KindAccountType     = "account_type"
	KindInstitutionType = "institution_type"
)

type CatalogType struct {
	ID        uuid.UUID `json:"id"`
	Kind      string    `json:"kind"`
	Code      string    `json:"code"`
	Label     string    `json:"label"`
	SortOrder int       `json:"sort_order"`
	Active    bool      `json:"active"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type CatalogInstitution struct {
	ID          uuid.UUID `json:"id"`
	Code        string    `json:"code"`
	Label       string    `json:"label"`
	TypeKind    string    `json:"type_kind"`
	TypeCode    string    `json:"type_code"`
	CountryCode *string   `json:"country_code,omitempty"`
	SortOrder   int       `json:"sort_order"`
	Active      bool      `json:"active"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type Overview struct {
	TotalUsers       int `json:"total_users"`
	ActiveUsers      int `json:"active_users"`
	SuspendedUsers   int `json:"suspended_users"`
	Signups7d        int `json:"signups_7d"`
	Signups30d       int `json:"signups_30d"`
	DAU              int `json:"dau"`
	WAU              int `json:"wau"`
	OpenLoans        int `json:"open_loans"`
	OverdueLoans     int `json:"overdue_loans"`
	CashflowEntries7d int `json:"cashflow_entries_7d"`
	AIInsights7d     int `json:"ai_insights_7d"`
}

type UserListItem struct {
	ID          uuid.UUID `json:"id"`
	Email       string    `json:"email"`
	DisplayName string    `json:"display_name"`
	Username    *string   `json:"username,omitempty"`
	Status      string    `json:"status"`
	Role        string    `json:"role"`
	CountryCode *string   `json:"country_code,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	LastActiveAt *time.Time `json:"last_active_at,omitempty"`
}

type UserDetail struct {
	UserListItem
	PhoneE164           *string    `json:"phone_e164,omitempty"`
	Locale              string     `json:"locale"`
	Timezone            string     `json:"timezone"`
	DefaultCurrencyCode *string    `json:"default_currency_code,omitempty"`
	EmailVerified       bool       `json:"email_verified"`
	LoansAsBorrower     int        `json:"loans_as_borrower"`
	LoansAsLender       int        `json:"loans_as_lender"`
	OpenLoans           int        `json:"open_loans"`
	OverdueLoans        int        `json:"overdue_loans"`
	CashflowEntries30d  int        `json:"cashflow_entries_30d"`
	CashflowVolume30d   string     `json:"cashflow_volume_30d"`
	TrustGrade          *string    `json:"trust_grade,omitempty"`
	TrustBand           *string    `json:"trust_band,omitempty"`
	TrustThinHistory    *bool      `json:"trust_thin_history,omitempty"`
	FriendsCount        int        `json:"friends_count"`
}

type AuditEntry struct {
	ID           uuid.UUID       `json:"id"`
	ActorID      uuid.UUID       `json:"actor_id"`
	ActorEmail   string          `json:"actor_email,omitempty"`
	Action       string          `json:"action"`
	TargetUserID *uuid.UUID      `json:"target_user_id,omitempty"`
	Meta         json.RawMessage `json:"meta"`
	CreatedAt    time.Time       `json:"created_at"`
}

type Store interface {
	Overview(ctx context.Context) (Overview, error)
	ListUsers(ctx context.Context, q, status string, limit, offset int) ([]UserListItem, int, error)
	GetUser(ctx context.Context, id uuid.UUID) (UserDetail, error)
	SetUserStatus(ctx context.Context, id uuid.UUID, status string) error
	RevokeUserSessions(ctx context.Context, id uuid.UUID) error
	InsertAudit(ctx context.Context, actorID uuid.UUID, action string, target *uuid.UUID, meta json.RawMessage) error
	ListAudit(ctx context.Context, limit int) ([]AuditEntry, error)
	PromoteAdmins(ctx context.Context, emails []string) (int, error)
	UserRole(ctx context.Context, id uuid.UUID) (string, error)
	GetSetting(ctx context.Context, key string) (string, error)
	SetSetting(ctx context.Context, key, value string) error

	ListCatalogTypes(ctx context.Context, kind string, activeOnly bool) ([]CatalogType, error)
	CreateCatalogType(ctx context.Context, kind, code, label string, sortOrder int) (CatalogType, error)
	UpdateCatalogType(ctx context.Context, id uuid.UUID, label *string, sortOrder *int, active *bool) (CatalogType, error)
	ListCatalogInstitutions(ctx context.Context, typeKind, typeCode string, activeOnly bool) ([]CatalogInstitution, error)
	CreateCatalogInstitution(ctx context.Context, code, label, typeKind, typeCode string, country *string, sortOrder int) (CatalogInstitution, error)
	UpdateCatalogInstitution(ctx context.Context, id uuid.UUID, label *string, typeKind, typeCode *string, country *string, sortOrder *int, active *bool) (CatalogInstitution, error)
}
