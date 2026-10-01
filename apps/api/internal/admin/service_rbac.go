package admin

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"

	"equilend/api/internal/appaudit"
	"equilend/api/internal/httpx"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s *Service) audit(ctx context.Context, actor uuid.UUID, action string, target *uuid.UUID, meta json.RawMessage) {
	if err := s.store.InsertAudit(ctx, actor, action, target, meta); err != nil {
		log.Printf("admin audit insert failed action=%s actor=%s: %v", action, actor, err)
	}
	appaudit.Emit(ctx, actor, action, target, meta)
}

// RecordAudit persists an admin audit row and emits via axonops/audit.
func (s *Service) RecordAudit(ctx context.Context, actor uuid.UUID, action string, target *uuid.UUID, meta json.RawMessage) {
	s.audit(ctx, actor, action, target, meta)
}

func (s *Service) HasPermission(ctx context.Context, userID uuid.UUID, code string) (bool, error) {
	ok, err := s.IsAdmin(ctx, userID)
	if err != nil || !ok {
		return false, err
	}
	perms, _, err := s.store.UserPermissions(ctx, userID)
	if err != nil {
		return false, err
	}
	for _, p := range perms {
		if p == code {
			return true, nil
		}
	}
	return false, nil
}

func (s *Service) PermissionsFor(ctx context.Context, userID uuid.UUID) (perms []string, roleName string, err error) {
	ok, err := s.IsAdmin(ctx, userID)
	if err != nil {
		return nil, "", err
	}
	if !ok {
		return nil, "", nil
	}
	return s.store.UserPermissions(ctx, userID)
}

func (s *Service) ListAuditFiltered(ctx context.Context, q, action string, limit, offset int) ([]AuditEntry, int, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	return s.store.ListAuditFiltered(ctx, strings.TrimSpace(q), strings.TrimSpace(action), limit, offset)
}

func (s *Service) SignupsByDay(ctx context.Context, days int) ([]DayCount, error) {
	if days <= 0 || days > 90 {
		days = 14
	}
	return s.store.SignupsByDay(ctx, days)
}

func (s *Service) ListPermissions(ctx context.Context) ([]Permission, error) {
	return s.store.ListPermissions(ctx)
}

func (s *Service) ListRoles(ctx context.Context) ([]Role, error) {
	return s.store.ListRoles(ctx)
}

func (s *Service) CreateRole(ctx context.Context, actor uuid.UUID, name, description string, perms []string) (Role, error) {
	name = strings.TrimSpace(name)
	description = strings.TrimSpace(description)
	if name == "" {
		return Role{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"name": "required",
		})
	}
	if strings.EqualFold(name, "Super Admin") {
		return Role{}, httpx.E(http.StatusConflict, "CONFLICT", "cannot create another Super Admin role")
	}
	out, err := s.store.CreateRole(ctx, name, description, sanitizePerms(perms))
	if err != nil {
		if isUniqueViolation(err) {
			return Role{}, httpx.E(http.StatusConflict, "CONFLICT", "role name already exists")
		}
		return Role{}, err
	}
	meta, _ := json.Marshal(map[string]any{"role_id": out.ID, "name": name})
	s.audit(ctx, actor, ActionRoleCreate, nil, meta)
	return out, nil
}

func (s *Service) UpdateRole(ctx context.Context, actor, id uuid.UUID, name, description *string, perms []string) (Role, error) {
	role, err := s.store.GetRole(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return Role{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "role not found")
	}
	if err != nil {
		return Role{}, err
	}
	if role.IsSystem && role.Name == "Super Admin" && perms != nil {
		// Super Admin always keeps all permissions
		all, err := s.store.ListPermissions(ctx)
		if err != nil {
			return Role{}, err
		}
		codes := make([]string, 0, len(all))
		for _, p := range all {
			codes = append(codes, p.Code)
		}
		perms = codes
	}
	if name != nil {
		v := strings.TrimSpace(*name)
		name = &v
		if v == "" {
			return Role{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"name": "cannot be empty",
			})
		}
		if role.IsSystem && v != role.Name {
			return Role{}, httpx.E(http.StatusForbidden, "FORBIDDEN", "cannot rename system role")
		}
	}
	var permArg []string
	if perms != nil {
		permArg = sanitizePerms(perms)
	}
	out, err := s.store.UpdateRole(ctx, id, name, description, permArg)
	if errors.Is(err, pgx.ErrNoRows) {
		return Role{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "role not found")
	}
	if err != nil {
		if isUniqueViolation(err) {
			return Role{}, httpx.E(http.StatusConflict, "CONFLICT", "role name already exists")
		}
		return Role{}, err
	}
	meta, _ := json.Marshal(map[string]any{"role_id": id})
	s.audit(ctx, actor, ActionRoleUpdate, nil, meta)
	return out, nil
}

func (s *Service) SetUserAdminRole(ctx context.Context, actor, target uuid.UUID, roleID *uuid.UUID) (UserDetail, error) {
	detail, err := s.store.GetUser(ctx, target)
	if errors.Is(err, pgx.ErrNoRows) {
		return UserDetail{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "user not found")
	}
	if err != nil {
		return UserDetail{}, err
	}
	if detail.Role != RoleAdmin {
		return UserDetail{}, httpx.E(http.StatusUnprocessableEntity, "VALIDATION", "user is not an admin")
	}

	wasSuper := detail.AdminRoleName != nil && *detail.AdminRoleName == "Super Admin"
	var nextName string
	if roleID != nil {
		role, err := s.store.GetRole(ctx, *roleID)
		if errors.Is(err, pgx.ErrNoRows) {
			return UserDetail{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "role not found")
		}
		if err != nil {
			return UserDetail{}, err
		}
		nextName = role.Name
	}

	if wasSuper && nextName != "Super Admin" {
		n, err := s.store.CountSuperAdmins(ctx)
		if err != nil {
			return UserDetail{}, err
		}
		if n <= 1 {
			return UserDetail{}, httpx.E(http.StatusConflict, "CONFLICT", "cannot demote the last Super Admin")
		}
	}

	if actor == target {
		actorPerms, _, err := s.store.UserPermissions(ctx, actor)
		if err != nil {
			return UserDetail{}, err
		}
		if !contains(actorPerms, PermRolesManage) {
			return UserDetail{}, httpx.E(http.StatusForbidden, "FORBIDDEN", "missing roles.manage")
		}
		if roleID != nil {
			role, err := s.store.GetRole(ctx, *roleID)
			if err != nil {
				return UserDetail{}, err
			}
			if !contains(role.Permissions, PermRolesManage) {
				n, err := s.store.CountSuperAdmins(ctx)
				if err != nil {
					return UserDetail{}, err
				}
				if n <= 1 {
					return UserDetail{}, httpx.E(http.StatusConflict, "CONFLICT", "cannot remove roles.manage from yourself without another Super Admin")
				}
			}
		}
	}

	if err := s.store.SetUserAdminRole(ctx, target, roleID); err != nil {
		return UserDetail{}, err
	}
	meta, _ := json.Marshal(map[string]any{"admin_role_id": roleID, "admin_role_name": nextName})
	s.audit(ctx, actor, ActionRoleAssign, &target, meta)
	return s.store.GetUser(ctx, target)
}

func sanitizePerms(perms []string) []string {
	seen := map[string]struct{}{}
	var out []string
	for _, p := range perms {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if _, ok := seen[p]; ok {
			continue
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}
	return out
}

func contains(ss []string, want string) bool {
	for _, s := range ss {
		if s == want {
			return true
		}
	}
	return false
}
