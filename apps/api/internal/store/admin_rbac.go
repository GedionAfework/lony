package store

import (
	"context"
	"encoding/json"
	"strings"

	"equilend/api/internal/admin"

	"github.com/google/uuid"
)

func (a adminStoreAdapter) ListPermissions(ctx context.Context) ([]admin.Permission, error) {
	return a.Inner.AdminListPermissions(ctx)
}
func (a adminStoreAdapter) ListRoles(ctx context.Context) ([]admin.Role, error) {
	return a.Inner.AdminListRoles(ctx)
}
func (a adminStoreAdapter) GetRole(ctx context.Context, id uuid.UUID) (admin.Role, error) {
	return a.Inner.AdminGetRole(ctx, id)
}
func (a adminStoreAdapter) CreateRole(ctx context.Context, name, description string, perms []string) (admin.Role, error) {
	return a.Inner.AdminCreateRole(ctx, name, description, perms)
}
func (a adminStoreAdapter) UpdateRole(ctx context.Context, id uuid.UUID, name, description *string, perms []string) (admin.Role, error) {
	return a.Inner.AdminUpdateRole(ctx, id, name, description, perms)
}
func (a adminStoreAdapter) SetUserAdminRole(ctx context.Context, userID uuid.UUID, roleID *uuid.UUID) error {
	return a.Inner.AdminSetUserRole(ctx, userID, roleID)
}
func (a adminStoreAdapter) UserPermissions(ctx context.Context, userID uuid.UUID) ([]string, string, error) {
	return a.Inner.AdminUserPermissions(ctx, userID)
}
func (a adminStoreAdapter) CountSuperAdmins(ctx context.Context) (int, error) {
	return a.Inner.AdminCountSuperAdmins(ctx)
}
func (a adminStoreAdapter) ListAuditFiltered(ctx context.Context, q, action string, limit, offset int) ([]admin.AuditEntry, int, error) {
	return a.Inner.AdminListAuditFiltered(ctx, q, action, limit, offset)
}
func (a adminStoreAdapter) SignupsByDay(ctx context.Context, days int) ([]admin.DayCount, error) {
	return a.Inner.AdminSignupsByDay(ctx, days)
}

func (s *SQLStore) AdminListPermissions(ctx context.Context) ([]admin.Permission, error) {
	rows, err := s.pool.Query(ctx, `SELECT code, label, sort_order FROM admin_permissions ORDER BY sort_order, code`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []admin.Permission
	for rows.Next() {
		var p admin.Permission
		if err := rows.Scan(&p.Code, &p.Label, &p.SortOrder); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *SQLStore) AdminListRoles(ctx context.Context) ([]admin.Role, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT r.id, r.name, COALESCE(r.description,''), r.is_system, r.created_at, r.updated_at,
		       COALESCE(array_agg(rp.permission_code ORDER BY rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL), '{}')
		FROM admin_roles r
		LEFT JOIN admin_role_permissions rp ON rp.role_id = r.id
		GROUP BY r.id
		ORDER BY r.is_system DESC, r.name
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []admin.Role
	for rows.Next() {
		var r admin.Role
		var perms []string
		if err := rows.Scan(&r.ID, &r.Name, &r.Description, &r.IsSystem, &r.CreatedAt, &r.UpdatedAt, &perms); err != nil {
			return nil, err
		}
		r.Permissions = perms
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *SQLStore) AdminGetRole(ctx context.Context, id uuid.UUID) (admin.Role, error) {
	var r admin.Role
	var perms []string
	err := s.pool.QueryRow(ctx, `
		SELECT r.id, r.name, COALESCE(r.description,''), r.is_system, r.created_at, r.updated_at,
		       COALESCE(array_agg(rp.permission_code ORDER BY rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL), '{}')
		FROM admin_roles r
		LEFT JOIN admin_role_permissions rp ON rp.role_id = r.id
		WHERE r.id = $1
		GROUP BY r.id
	`, id).Scan(&r.ID, &r.Name, &r.Description, &r.IsSystem, &r.CreatedAt, &r.UpdatedAt, &perms)
	if err != nil {
		return r, err
	}
	r.Permissions = perms
	return r, nil
}

func (s *SQLStore) AdminCreateRole(ctx context.Context, name, description string, perms []string) (admin.Role, error) {
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `
		INSERT INTO admin_roles (name, description) VALUES ($1, $2)
		RETURNING id
	`, strings.TrimSpace(name), strings.TrimSpace(description)).Scan(&id)
	if err != nil {
		return admin.Role{}, err
	}
	if err := s.replaceRolePerms(ctx, id, perms); err != nil {
		return admin.Role{}, err
	}
	return s.AdminGetRole(ctx, id)
}

func (s *SQLStore) AdminUpdateRole(ctx context.Context, id uuid.UUID, name, description *string, perms []string) (admin.Role, error) {
	_, err := s.pool.Exec(ctx, `
		UPDATE admin_roles SET
		  name = COALESCE($2, name),
		  description = COALESCE($3, description),
		  updated_at = now()
		WHERE id = $1
	`, id, name, description)
	if err != nil {
		return admin.Role{}, err
	}
	if perms != nil {
		if err := s.replaceRolePerms(ctx, id, perms); err != nil {
			return admin.Role{}, err
		}
	}
	return s.AdminGetRole(ctx, id)
}

func (s *SQLStore) replaceRolePerms(ctx context.Context, roleID uuid.UUID, perms []string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM admin_role_permissions WHERE role_id = $1`, roleID); err != nil {
		return err
	}
	for _, p := range perms {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO admin_role_permissions (role_id, permission_code) VALUES ($1, $2)
			ON CONFLICT DO NOTHING
		`, roleID, p); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *SQLStore) AdminSetUserRole(ctx context.Context, userID uuid.UUID, roleID *uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `UPDATE users SET admin_role_id = $2, updated_at = now() WHERE id = $1 AND deleted_at IS NULL`, userID, roleID)
	return err
}

func (s *SQLStore) AdminUserPermissions(ctx context.Context, userID uuid.UUID) ([]string, string, error) {
	var roleName *string
	var roleID *uuid.UUID
	var role string
	err := s.pool.QueryRow(ctx, `
		SELECT u.role, u.admin_role_id, r.name
		FROM users u
		LEFT JOIN admin_roles r ON r.id = u.admin_role_id
		WHERE u.id = $1 AND u.deleted_at IS NULL
	`, userID).Scan(&role, &roleID, &roleName)
	if err != nil {
		return nil, "", err
	}
	if role != "admin" {
		return nil, "", nil
	}
	name := ""
	if roleName != nil {
		name = *roleName
	}
	if roleID == nil {
		// Legacy admin without role — treat as full access
		rows, err := s.pool.Query(ctx, `SELECT code FROM admin_permissions ORDER BY sort_order`)
		if err != nil {
			return nil, name, err
		}
		defer rows.Close()
		var all []string
		for rows.Next() {
			var c string
			if err := rows.Scan(&c); err != nil {
				return nil, name, err
			}
			all = append(all, c)
		}
		return all, name, rows.Err()
	}
	rows, err := s.pool.Query(ctx, `
		SELECT permission_code FROM admin_role_permissions WHERE role_id = $1 ORDER BY permission_code
	`, *roleID)
	if err != nil {
		return nil, name, err
	}
	defer rows.Close()
	var perms []string
	for rows.Next() {
		var c string
		if err := rows.Scan(&c); err != nil {
			return nil, name, err
		}
		perms = append(perms, c)
	}
	return perms, name, rows.Err()
}

func (s *SQLStore) AdminCountSuperAdmins(ctx context.Context) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM users u
		JOIN admin_roles r ON r.id = u.admin_role_id
		WHERE u.role = 'admin' AND u.deleted_at IS NULL AND u.status = 'active'
		  AND r.name = 'Super Admin'
	`).Scan(&n)
	return n, err
}

func (s *SQLStore) AdminListAuditFiltered(ctx context.Context, q, action string, limit, offset int) ([]admin.AuditEntry, int, error) {
	q = strings.TrimSpace(strings.ToLower(q))
	action = strings.TrimSpace(action)
	like := "%" + q + "%"
	var total int
	err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM admin_audit_log a
		LEFT JOIN users u ON u.id = a.actor_id
		WHERE ($1 = '' OR a.action = $1)
		  AND ($2 = '' OR lower(COALESCE(u.email::text,'')) LIKE $2 OR lower(a.action) LIKE $2)
	`, action, like).Scan(&total)
	if err != nil {
		return nil, 0, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT a.id, a.actor_id, COALESCE(u.email::text,''), a.action, a.target_user_id, a.meta, a.created_at
		FROM admin_audit_log a
		LEFT JOIN users u ON u.id = a.actor_id
		WHERE ($1 = '' OR a.action = $1)
		  AND ($2 = '' OR lower(COALESCE(u.email::text,'')) LIKE $2 OR lower(a.action) LIKE $2)
		ORDER BY a.created_at DESC
		LIMIT $3 OFFSET $4
	`, action, like, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []admin.AuditEntry
	for rows.Next() {
		var e admin.AuditEntry
		var meta []byte
		if err := rows.Scan(&e.ID, &e.ActorID, &e.ActorEmail, &e.Action, &e.TargetUserID, &meta, &e.CreatedAt); err != nil {
			return nil, 0, err
		}
		if meta == nil {
			meta = []byte(`{}`)
		}
		e.Meta = json.RawMessage(meta)
		out = append(out, e)
	}
	return out, total, rows.Err()
}

func (s *SQLStore) AdminSignupsByDay(ctx context.Context, days int) ([]admin.DayCount, error) {
	if days <= 0 || days > 90 {
		days = 14
	}
	rows, err := s.pool.Query(ctx, `
		SELECT to_char(d::date, 'YYYY-MM-DD'), COALESCE(c.cnt, 0)::int
		FROM generate_series((now() AT TIME ZONE 'UTC')::date - ($1::int - 1), (now() AT TIME ZONE 'UTC')::date, '1 day') d
		LEFT JOIN (
		  SELECT created_at::date AS day, COUNT(*)::int AS cnt
		  FROM users
		  WHERE deleted_at IS NULL AND created_at >= now() - ($1::int || ' days')::interval
		  GROUP BY 1
		) c ON c.day = d::date
		ORDER BY 1
	`, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []admin.DayCount
	for rows.Next() {
		var d admin.DayCount
		if err := rows.Scan(&d.Day, &d.Count); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}
