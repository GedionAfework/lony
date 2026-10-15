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
	ActionSetPlanTier   = "user.set_plan_tier"
	ActionAIDisable     = "settings.ai_disable"
	ActionAIEnable      = "settings.ai_enable"
	ActionCatalogCreate = "catalog.create"
	ActionCatalogUpdate = "catalog.update"
	ActionCategoryCreate = "category.create"
	ActionCategoryUpdate = "category.update"
	ActionThemeCreate    = "theme.create"
	ActionThemeUpdate    = "theme.update"
	ActionRoleCreate     = "role.create"
	ActionRoleUpdate     = "role.update"
	ActionRoleAssign     = "role.assign"
	ActionLocaleUpload   = "locale.upload"
	ActionLocaleUpdate   = "locale.update"
	ActionLocaleDelete   = "locale.delete"
	ActionCalendarUpdate = "calendar.update"

	KindAccountType     = "account_type"
	KindInstitutionType = "institution_type"
	KindGoalType        = "goal_type"

	PermOverviewRead    = "overview.read"
	PermUsersRead       = "users.read"
	PermUsersWrite      = "users.write"
	PermCategoriesRead  = "categories.read"
	PermCategoriesWrite = "categories.write"
	PermThemesRead      = "themes.read"
	PermThemesWrite     = "themes.write"
	PermAuditRead       = "audit.read"
	PermSettingsAI      = "settings.ai"
	PermRolesManage     = "roles.manage"
	PermLocalization    = "localization.manage"
)

type Permission struct {
	Code      string `json:"code"`
	Label     string `json:"label"`
	SortOrder int    `json:"sort_order"`
}

type Role struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description,omitempty"`
	IsSystem    bool      `json:"is_system"`
	Permissions []string  `json:"permissions"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type DayCount struct {
	Day   string `json:"day"`
	Count int    `json:"count"`
}

type SystemTheme struct {
	ID        uuid.UUID       `json:"id"`
	Slug      string          `json:"slug"`
	Label     string          `json:"label"`
	Colors    json.RawMessage `json:"colors"`
	SortOrder int             `json:"sort_order"`
	Active    bool            `json:"active"`
	CreatedAt time.Time       `json:"created_at"`
	UpdatedAt time.Time       `json:"updated_at"`
}

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

type SystemCategory struct {
	ID        uuid.UUID `json:"id"`
	Kind      string    `json:"kind"`
	Name      string    `json:"name"`
	Slug      string    `json:"slug"`
	IsSystem  bool      `json:"is_system"`
	Active    bool      `json:"active"`
	CreatedAt time.Time `json:"created_at"`
}

type Overview struct {
	TotalUsers        int `json:"total_users"`
	ActiveUsers       int `json:"active_users"`
	SuspendedUsers    int `json:"suspended_users"`
	Signups7d         int `json:"signups_7d"`
	Signups30d        int `json:"signups_30d"`
	DAU               int `json:"dau"`
	WAU               int `json:"wau"`
	OpenLoans         int `json:"open_loans"`
	OverdueLoans      int `json:"overdue_loans"`
	CashflowEntries7d int `json:"cashflow_entries_7d"`
	AIInsights7d      int `json:"ai_insights_7d"`
	AIRuns7d          int `json:"ai_runs_7d"`
	AIUsers7d         int `json:"ai_users_7d"`
	AITokens7d        int `json:"ai_tokens_7d"`
	AIRequestsToday   int `json:"ai_requests_today"`
	JobsFailed        int `json:"jobs_failed"`
	JobsPending       int `json:"jobs_pending"`
	FXOK              bool   `json:"fx_ok"`
	FXBase            string `json:"fx_base,omitempty"`
	FXAsOf            string `json:"fx_as_of,omitempty"`
	FXError           string `json:"fx_error,omitempty"`
}

type UserListItem struct {
	ID            uuid.UUID  `json:"id"`
	Email         string     `json:"email"`
	DisplayName   string     `json:"display_name"`
	Username      *string    `json:"username,omitempty"`
	Status        string     `json:"status"`
	Role          string     `json:"role"`
	PlanTier      string     `json:"plan_tier"`
	AdminRoleID   *uuid.UUID `json:"admin_role_id,omitempty"`
	AdminRoleName *string    `json:"admin_role_name,omitempty"`
	CountryCode   *string    `json:"country_code,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	LastActiveAt  *time.Time `json:"last_active_at,omitempty"`
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
	SetUserPlanTier(ctx context.Context, id uuid.UUID, planTier string) error
	RevokeUserSessions(ctx context.Context, id uuid.UUID) error
	InsertAudit(ctx context.Context, actorID uuid.UUID, action string, target *uuid.UUID, meta json.RawMessage) error
	ListAudit(ctx context.Context, limit int) ([]AuditEntry, error)
	ListAuditFiltered(ctx context.Context, q, action string, limit, offset int) ([]AuditEntry, int, error)
	PromoteAdmins(ctx context.Context, emails []string) (int, error)
	UserRole(ctx context.Context, id uuid.UUID) (string, error)
	UserPermissions(ctx context.Context, userID uuid.UUID) (perms []string, roleName string, err error)
	GetSetting(ctx context.Context, key string) (string, error)
	SetSetting(ctx context.Context, key, value string) error
	SignupsByDay(ctx context.Context, days int) ([]DayCount, error)

	ListCatalogTypes(ctx context.Context, kind string, activeOnly bool) ([]CatalogType, error)
	CreateCatalogType(ctx context.Context, kind, code, label string, sortOrder int) (CatalogType, error)
	UpdateCatalogType(ctx context.Context, id uuid.UUID, label *string, sortOrder *int, active *bool) (CatalogType, error)
	ListCatalogInstitutions(ctx context.Context, typeKind, typeCode string, activeOnly bool) ([]CatalogInstitution, error)
	CreateCatalogInstitution(ctx context.Context, code, label, typeKind, typeCode string, country *string, sortOrder int) (CatalogInstitution, error)
	UpdateCatalogInstitution(ctx context.Context, id uuid.UUID, label *string, typeKind, typeCode *string, country *string, sortOrder *int, active *bool) (CatalogInstitution, error)

	ListSystemCategories(ctx context.Context, kind string) ([]SystemCategory, error)
	CreateSystemCategory(ctx context.Context, kind, name, slug string) (SystemCategory, error)
	UpdateSystemCategory(ctx context.Context, id uuid.UUID, name *string, active *bool) (SystemCategory, error)

	ListPermissions(ctx context.Context) ([]Permission, error)
	ListRoles(ctx context.Context) ([]Role, error)
	GetRole(ctx context.Context, id uuid.UUID) (Role, error)
	CreateRole(ctx context.Context, name, description string, perms []string) (Role, error)
	UpdateRole(ctx context.Context, id uuid.UUID, name, description *string, perms []string) (Role, error)
	SetUserAdminRole(ctx context.Context, userID uuid.UUID, roleID *uuid.UUID) error
	CountSuperAdmins(ctx context.Context) (int, error)

	ListSystemThemes(ctx context.Context, activeOnly bool) ([]SystemTheme, error)
	GetSystemTheme(ctx context.Context, id uuid.UUID) (SystemTheme, error)
	CreateSystemTheme(ctx context.Context, slug, label string, colors json.RawMessage, sortOrder int) (SystemTheme, error)
	UpdateSystemTheme(ctx context.Context, id uuid.UUID, label *string, colors json.RawMessage, sortOrder *int, active *bool) (SystemTheme, error)
}
