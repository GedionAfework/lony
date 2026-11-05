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


func (s *Service) SignupsByDay(ctx context.Context, days int) ([]DayCount, error) {
	if days <= 0 || days > 90 {
		days = 14
	}
	return s.store.SignupsByDay(ctx, days)
}

func (s *Service) ListPermissions(ctx context.Context) ([]Permission, error) {
	perms, err := s.store.ListPermissions(ctx)
	if err != nil {
		return nil, err
	}
	for i := range perms {
		perms[i].Requires = append([]string{}, permRequires[perms[i].Code]...)
	}
	return perms, nil
}

// normalizePerms drops unknown codes and duplicates and adds the permissions
// each selected permission depends on (e.g. users.suspend needs users.read).
func (s *Service) normalizePerms(ctx context.Context, perms []string) ([]string, error) {
	all, err := s.store.ListPermissions(ctx)
	if err != nil {
		return nil, err
	}
	known := map[string]bool{}
	for _, p := range all {
		known[p.Code] = true
	}
	picked := map[string]bool{}
	var add func(code string)
	add = func(code string) {
		if !known[code] || picked[code] {
			return
		}
		picked[code] = true
		for _, dep := range permRequires[code] {
			add(dep)
		}
	}
	for _, p := range sanitizePerms(perms) {
		add(p)
	}
	out := make([]string, 0, len(picked))
	for _, p := range all { // keep catalog order
		if picked[p.Code] {
			out = append(out, p.Code)
		}
	}
	return out, nil
}

// actorScope reports whether the actor has full access and which permissions
// they hold. Admins without a role are legacy full-access accounts.
func (s *Service) actorScope(ctx context.Context, actor uuid.UUID) (super bool, perms []string, err error) {
	perms, roleName, err := s.store.UserPermissions(ctx, actor)
	if err != nil {
		return false, nil, err
	}
	return roleName == SuperAdminRole || roleName == "", perms, nil
}

// checkGrant stops admins from handing out access they don't have themselves.
func (s *Service) checkGrant(ctx context.Context, actor uuid.UUID, roleName string, perms []string) error {
	super, mine, err := s.actorScope(ctx, actor)
	if err != nil {
		return err
	}
	if super {
		return nil
	}
	if roleName == SuperAdminRole {
		return httpx.E(http.StatusForbidden, "FORBIDDEN", "only a Super Admin can grant the Super Admin role")
	}
	for _, p := range perms {
		if !contains(mine, p) {
			return httpx.E(http.StatusForbidden, "FORBIDDEN", "you can't grant a permission you don't have: "+p)
		}
	}
	return nil
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
	norm, err := s.normalizePerms(ctx, perms)
	if err != nil {
		return Role{}, err
	}
	if err := s.checkGrant(ctx, actor, name, norm); err != nil {
		return Role{}, err
	}
	out, err := s.store.CreateRole(ctx, name, description, norm)
	if err != nil {
		if isUniqueViolation(err) {
			return Role{}, httpx.E(http.StatusConflict, "CONFLICT", "role name already exists")
		}
		return Role{}, err
	}
	meta, _ := json.Marshal(map[string]any{"role_id": out.ID, "name": name, "permissions": norm})
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
		permArg, err = s.normalizePerms(ctx, perms)
		if err != nil {
			return Role{}, err
		}
		if permArg == nil {
			permArg = []string{}
		}
		if !(role.IsSystem && role.Name == SuperAdminRole) {
			if err := s.checkGrant(ctx, actor, role.Name, permArg); err != nil {
				return Role{}, err
			}
		}
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
	m := map[string]any{"role_id": id, "name": out.Name}
	if permArg != nil {
		var added, removed []string
		for _, p := range permArg {
			if !contains(role.Permissions, p) {
				added = append(added, p)
			}
		}
		for _, p := range role.Permissions {
			if !contains(permArg, p) {
				removed = append(removed, p)
			}
		}
		m["added"], m["removed"] = added, removed
	}
	if name != nil && *name != role.Name {
		m["renamed_from"] = role.Name
	}
	meta, _ := json.Marshal(m)
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
		if err := s.checkGrant(ctx, actor, role.Name, role.Permissions); err != nil {
			return UserDetail{}, err
		}
	}
	if wasSuper && actor != target {
		if super, _, err := s.actorScope(ctx, actor); err != nil {
			return UserDetail{}, err
		} else if !super {
			return UserDetail{}, httpx.E(http.StatusForbidden, "FORBIDDEN", "only a Super Admin can change another Super Admin")
		}
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
		if !contains(actorPerms, PermRolesAssign) {
			return UserDetail{}, httpx.E(http.StatusForbidden, "FORBIDDEN", "missing roles.assign")
		}
		if roleID != nil {
			role, err := s.store.GetRole(ctx, *roleID)
			if err != nil {
				return UserDetail{}, err
			}
			if !contains(role.Permissions, PermRolesAssign) {
				n, err := s.store.CountSuperAdmins(ctx)
				if err != nil {
					return UserDetail{}, err
				}
				if n <= 1 {
					return UserDetail{}, httpx.E(http.StatusConflict, "CONFLICT", "cannot remove roles.assign from yourself without another Super Admin")
				}
			}
		}
	}

	if err := s.store.SetUserAdminRole(ctx, target, roleID); err != nil {
		return UserDetail{}, err
	}
	prev := ""
	if detail.AdminRoleName != nil {
		prev = *detail.AdminRoleName
	}
	meta, _ := json.Marshal(map[string]any{"admin_role_id": roleID, "admin_role_name": nextName, "previous_role": prev})
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

// DeleteRole removes a custom role that nobody holds.
func (s *Service) DeleteRole(ctx context.Context, actor, id uuid.UUID) error {
	role, err := s.store.GetRole(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.E(http.StatusNotFound, "NOT_FOUND", "role not found")
	}
	if err != nil {
		return err
	}
	if role.IsSystem {
		return httpx.E(http.StatusForbidden, "FORBIDDEN", "system roles can't be deleted")
	}
	if role.MemberCount > 0 {
		return httpx.E(http.StatusConflict, "CONFLICT", "move the admins holding this role to another role first")
	}
	if err := s.store.DeleteRole(ctx, id); err != nil {
		return err
	}
	meta, _ := json.Marshal(map[string]any{"role_id": id, "name": role.Name, "permissions": role.Permissions})
	s.audit(ctx, actor, ActionRoleDelete, nil, meta)
	return nil
}

func (s *Service) ListAdmins(ctx context.Context) ([]AdminMember, error) {
	out, err := s.store.ListAdmins(ctx)
	if out == nil {
		out = []AdminMember{}
	}
	return out, err
}

// SetAdminAccess grants admin access with a role, or removes it.
func (s *Service) SetAdminAccess(ctx context.Context, actor, target uuid.UUID, grant bool, roleID *uuid.UUID) (UserDetail, error) {
	detail, err := s.store.GetUser(ctx, target)
	if errors.Is(err, pgx.ErrNoRows) {
		return UserDetail{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "user not found")
	}
	if err != nil {
		return UserDetail{}, err
	}
	if actor == target {
		return UserDetail{}, httpx.E(http.StatusConflict, "CONFLICT", "you can't change your own admin access")
	}
	isSuper := detail.AdminRoleName != nil && *detail.AdminRoleName == SuperAdminRole

	if grant {
		if detail.Status != "active" {
			return UserDetail{}, httpx.E(http.StatusUnprocessableEntity, "VALIDATION", "only active accounts can become admins")
		}
		if roleID == nil {
			return UserDetail{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{"role_id": "required"})
		}
		role, err := s.store.GetRole(ctx, *roleID)
		if errors.Is(err, pgx.ErrNoRows) {
			return UserDetail{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "role not found")
		}
		if err != nil {
			return UserDetail{}, err
		}
		if err := s.checkGrant(ctx, actor, role.Name, role.Permissions); err != nil {
			return UserDetail{}, err
		}
		if detail.Role == RoleAdmin {
			return s.SetUserAdminRole(ctx, actor, target, roleID)
		}
		if err := s.store.SetUserAccess(ctx, target, RoleAdmin, roleID); err != nil {
			return UserDetail{}, err
		}
		meta, _ := json.Marshal(map[string]any{"admin_role_id": role.ID, "admin_role_name": role.Name})
		s.audit(ctx, actor, ActionAdminGrant, &target, meta)
		return s.store.GetUser(ctx, target)
	}

	if detail.Role != RoleAdmin {
		return detail, nil
	}
	if isSuper {
		if super, _, err := s.actorScope(ctx, actor); err != nil {
			return UserDetail{}, err
		} else if !super {
			return UserDetail{}, httpx.E(http.StatusForbidden, "FORBIDDEN", "only a Super Admin can remove another Super Admin")
		}
		n, err := s.store.CountSuperAdmins(ctx)
		if err != nil {
			return UserDetail{}, err
		}
		if n <= 1 {
			return UserDetail{}, httpx.E(http.StatusConflict, "CONFLICT", "cannot remove the last Super Admin")
		}
	}
	if err := s.store.SetUserAccess(ctx, target, RoleUser, nil); err != nil {
		return UserDetail{}, err
	}
	prev := ""
	if detail.AdminRoleName != nil {
		prev = *detail.AdminRoleName
	}
	meta, _ := json.Marshal(map[string]any{"previous_role": prev})
	s.audit(ctx, actor, ActionAdminRevoke, &target, meta)
	return s.store.GetUser(ctx, target)
}

// RevokeSessions signs a user out everywhere.
func (s *Service) RevokeSessions(ctx context.Context, actor, target uuid.UUID) (UserDetail, error) {
	detail, err := s.store.GetUser(ctx, target)
	if errors.Is(err, pgx.ErrNoRows) {
		return UserDetail{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "user not found")
	}
	if err != nil {
		return UserDetail{}, err
	}
	if actor == target {
		return UserDetail{}, httpx.E(http.StatusConflict, "CONFLICT", "use log out to end your own session")
	}
	if detail.Role == RoleAdmin {
		if super, _, err := s.actorScope(ctx, actor); err != nil {
			return UserDetail{}, err
		} else if !super {
			return UserDetail{}, httpx.E(http.StatusForbidden, "FORBIDDEN", "only a Super Admin can sign out another admin")
		}
	}
	if err := s.store.RevokeUserSessions(ctx, target); err != nil {
		return UserDetail{}, err
	}
	s.audit(ctx, actor, ActionSessionsRevoke, &target, json.RawMessage(`{}`))
	return s.store.GetUser(ctx, target)
}
