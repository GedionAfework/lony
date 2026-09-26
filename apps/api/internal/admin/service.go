package admin

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"equilend/api/internal/httpx"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type Service struct {
	store Store
}

func NewService(store Store) *Service {
	return &Service{store: store}
}

func (s *Service) BootstrapAdmins(ctx context.Context, emails []string) (int, error) {
	if len(emails) == 0 {
		return 0, nil
	}
	return s.store.PromoteAdmins(ctx, emails)
}

func (s *Service) IsAdmin(ctx context.Context, userID uuid.UUID) (bool, error) {
	role, err := s.store.UserRole(ctx, userID)
	if err != nil {
		return false, err
	}
	return role == RoleAdmin, nil
}

func (s *Service) Overview(ctx context.Context) (Overview, error) {
	return s.store.Overview(ctx)
}

func (s *Service) ListUsers(ctx context.Context, q, status string, limit, offset int) ([]UserListItem, int, error) {
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	if offset < 0 {
		offset = 0
	}
	status = strings.ToLower(strings.TrimSpace(status))
	if status != "" && status != "active" && status != "suspended" && status != "deletion_pending" && status != "deleted" {
		return nil, 0, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"status": "must be active, suspended, deletion_pending, or deleted",
		})
	}
	return s.store.ListUsers(ctx, strings.TrimSpace(q), status, limit, offset)
}

func (s *Service) GetUser(ctx context.Context, id uuid.UUID) (UserDetail, error) {
	out, err := s.store.GetUser(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return UserDetail{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "user not found")
	}
	return out, err
}

func (s *Service) Suspend(ctx context.Context, actor, target uuid.UUID) (UserDetail, error) {
	if actor == target {
		return UserDetail{}, httpx.E(http.StatusConflict, "CONFLICT", "you cannot suspend your own account")
	}
	detail, err := s.store.GetUser(ctx, target)
	if errors.Is(err, pgx.ErrNoRows) {
		return UserDetail{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "user not found")
	}
	if err != nil {
		return UserDetail{}, err
	}
	if detail.Role == RoleAdmin {
		return UserDetail{}, httpx.E(http.StatusForbidden, "FORBIDDEN", "cannot suspend another admin")
	}
	if err := s.store.SetUserStatus(ctx, target, "suspended"); err != nil {
		return UserDetail{}, err
	}
	_ = s.store.RevokeUserSessions(ctx, target)
	meta, _ := json.Marshal(map[string]any{"previous_status": detail.Status})
	_ = s.store.InsertAudit(ctx, actor, ActionSuspend, &target, meta)
	return s.store.GetUser(ctx, target)
}

func (s *Service) Unsuspend(ctx context.Context, actor, target uuid.UUID) (UserDetail, error) {
	detail, err := s.store.GetUser(ctx, target)
	if errors.Is(err, pgx.ErrNoRows) {
		return UserDetail{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "user not found")
	}
	if err != nil {
		return UserDetail{}, err
	}
	if err := s.store.SetUserStatus(ctx, target, "active"); err != nil {
		return UserDetail{}, err
	}
	meta, _ := json.Marshal(map[string]any{"previous_status": detail.Status})
	_ = s.store.InsertAudit(ctx, actor, ActionUnsuspend, &target, meta)
	return s.store.GetUser(ctx, target)
}

func (s *Service) ListAudit(ctx context.Context, limit int) ([]AuditEntry, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	return s.store.ListAudit(ctx, limit)
}

func (s *Service) AIDisabled(ctx context.Context) (bool, error) {
	v, err := s.store.GetSetting(ctx, "ai_disabled")
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return strings.EqualFold(strings.TrimSpace(v), "true") || v == "1", nil
}

func (s *Service) SetAIDisabled(ctx context.Context, actor uuid.UUID, disabled bool) (bool, error) {
	val := "false"
	action := ActionAIEnable
	if disabled {
		val = "true"
		action = ActionAIDisable
	}
	if err := s.store.SetSetting(ctx, "ai_disabled", val); err != nil {
		return false, err
	}
	meta, _ := json.Marshal(map[string]any{"ai_disabled": disabled})
	_ = s.store.InsertAudit(ctx, actor, action, nil, meta)
	return disabled, nil
}

func validCatalogKind(kind string) bool {
	return kind == KindAccountType || kind == KindInstitutionType
}

func slugCode(raw string) string {
	s := strings.ToLower(strings.TrimSpace(raw))
	var b strings.Builder
	prevUnderscore := false
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			prevUnderscore = false
			continue
		}
		if !prevUnderscore {
			b.WriteByte('_')
			prevUnderscore = true
		}
	}
	out := strings.Trim(b.String(), "_")
	if len(out) > 64 {
		out = out[:64]
	}
	return out
}

func (s *Service) ListCatalogTypes(ctx context.Context, kind string, activeOnly bool) ([]CatalogType, error) {
	kind = strings.TrimSpace(kind)
	if kind != "" && !validCatalogKind(kind) {
		return nil, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"kind": "must be account_type or institution_type",
		})
	}
	return s.store.ListCatalogTypes(ctx, kind, activeOnly)
}

func (s *Service) CreateCatalogType(ctx context.Context, actor uuid.UUID, kind, code, label string, sortOrder int) (CatalogType, error) {
	kind = strings.TrimSpace(kind)
	label = strings.TrimSpace(label)
	code = slugCode(code)
	if code == "" {
		code = slugCode(label)
	}
	if !validCatalogKind(kind) {
		return CatalogType{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"kind": "must be account_type or institution_type",
		})
	}
	if label == "" || code == "" {
		return CatalogType{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"label": "required",
			"code":  "required",
		})
	}
	out, err := s.store.CreateCatalogType(ctx, kind, code, label, sortOrder)
	if err != nil {
		if isUniqueViolation(err) {
			return CatalogType{}, httpx.E(http.StatusConflict, "CONFLICT", "type code already exists")
		}
		return CatalogType{}, err
	}
	meta, _ := json.Marshal(map[string]any{"entity": "type", "id": out.ID, "kind": kind, "code": code})
	_ = s.store.InsertAudit(ctx, actor, ActionCatalogCreate, nil, meta)
	return out, nil
}

func (s *Service) UpdateCatalogType(ctx context.Context, actor, id uuid.UUID, label *string, sortOrder *int, active *bool) (CatalogType, error) {
	if label != nil {
		v := strings.TrimSpace(*label)
		label = &v
		if v == "" {
			return CatalogType{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"label": "cannot be empty",
			})
		}
	}
	out, err := s.store.UpdateCatalogType(ctx, id, label, sortOrder, active)
	if errors.Is(err, pgx.ErrNoRows) {
		return CatalogType{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "catalog type not found")
	}
	if err != nil {
		return CatalogType{}, err
	}
	meta, _ := json.Marshal(map[string]any{"entity": "type", "id": id})
	_ = s.store.InsertAudit(ctx, actor, ActionCatalogUpdate, nil, meta)
	return out, nil
}

func (s *Service) ListCatalogInstitutions(ctx context.Context, typeKind, typeCode string, activeOnly bool) ([]CatalogInstitution, error) {
	typeKind = strings.TrimSpace(typeKind)
	typeCode = strings.TrimSpace(typeCode)
	if typeKind != "" && !validCatalogKind(typeKind) {
		return nil, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"type_kind": "must be account_type or institution_type",
		})
	}
	return s.store.ListCatalogInstitutions(ctx, typeKind, typeCode, activeOnly)
}

func (s *Service) CreateCatalogInstitution(ctx context.Context, actor uuid.UUID, code, label, typeKind, typeCode string, country *string, sortOrder int) (CatalogInstitution, error) {
	label = strings.TrimSpace(label)
	typeKind = strings.TrimSpace(typeKind)
	typeCode = slugCode(typeCode)
	code = slugCode(code)
	if code == "" {
		code = slugCode(label)
	}
	if !validCatalogKind(typeKind) {
		return CatalogInstitution{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"type_kind": "must be account_type or institution_type",
		})
	}
	if label == "" || code == "" || typeCode == "" {
		return CatalogInstitution{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"label":     "required",
			"code":      "required",
			"type_code": "required",
		})
	}
	if country != nil {
		c := strings.ToUpper(strings.TrimSpace(*country))
		if c == "" {
			country = nil
		} else if len(c) != 2 {
			return CatalogInstitution{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"country_code": "must be ISO-3166 alpha-2 or empty",
			})
		} else {
			country = &c
		}
	}
	out, err := s.store.CreateCatalogInstitution(ctx, code, label, typeKind, typeCode, country, sortOrder)
	if err != nil {
		if isUniqueViolation(err) {
			return CatalogInstitution{}, httpx.E(http.StatusConflict, "CONFLICT", "institution code already exists")
		}
		return CatalogInstitution{}, err
	}
	meta, _ := json.Marshal(map[string]any{"entity": "institution", "id": out.ID, "code": code})
	_ = s.store.InsertAudit(ctx, actor, ActionCatalogCreate, nil, meta)
	return out, nil
}

func (s *Service) UpdateCatalogInstitution(ctx context.Context, actor, id uuid.UUID, label *string, typeKind, typeCode *string, country *string, sortOrder *int, active *bool) (CatalogInstitution, error) {
	if label != nil {
		v := strings.TrimSpace(*label)
		label = &v
		if v == "" {
			return CatalogInstitution{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"label": "cannot be empty",
			})
		}
	}
	if typeKind != nil {
		v := strings.TrimSpace(*typeKind)
		typeKind = &v
		if !validCatalogKind(v) {
			return CatalogInstitution{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"type_kind": "must be account_type or institution_type",
			})
		}
	}
	if typeCode != nil {
		v := slugCode(*typeCode)
		typeCode = &v
		if v == "" {
			return CatalogInstitution{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"type_code": "required",
			})
		}
	}
	if country != nil {
		c := strings.ToUpper(strings.TrimSpace(*country))
		if c == "" {
			empty := ""
			country = &empty // store interprets empty as clear
		} else if len(c) != 2 {
			return CatalogInstitution{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"country_code": "must be ISO-3166 alpha-2 or empty",
			})
		} else {
			country = &c
		}
	}
	out, err := s.store.UpdateCatalogInstitution(ctx, id, label, typeKind, typeCode, country, sortOrder, active)
	if errors.Is(err, pgx.ErrNoRows) {
		return CatalogInstitution{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "institution not found")
	}
	if err != nil {
		return CatalogInstitution{}, err
	}
	meta, _ := json.Marshal(map[string]any{"entity": "institution", "id": id})
	_ = s.store.InsertAudit(ctx, actor, ActionCatalogUpdate, nil, meta)
	return out, nil
}

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "duplicate key") || strings.Contains(msg, "unique constraint")
}
