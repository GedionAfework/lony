package store

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"equilend/api/internal/admin"

	"github.com/google/uuid"
)

type adminStoreAdapter struct{ Inner *SQLStore }

func AdminAdapter(s *SQLStore) admin.Store { return adminStoreAdapter{Inner: s} }

func (a adminStoreAdapter) Overview(ctx context.Context) (admin.Overview, error) {
	return a.Inner.AdminOverview(ctx)
}
func (a adminStoreAdapter) ListUsers(ctx context.Context, q, status string, limit, offset int) ([]admin.UserListItem, int, error) {
	return a.Inner.AdminListUsers(ctx, q, status, limit, offset)
}
func (a adminStoreAdapter) GetUser(ctx context.Context, id uuid.UUID) (admin.UserDetail, error) {
	return a.Inner.AdminGetUser(ctx, id)
}
func (a adminStoreAdapter) SetUserStatus(ctx context.Context, id uuid.UUID, status string) error {
	return a.Inner.AdminSetUserStatus(ctx, id, status)
}
func (a adminStoreAdapter) RevokeUserSessions(ctx context.Context, id uuid.UUID) error {
	return a.Inner.AdminRevokeUserSessions(ctx, id)
}
func (a adminStoreAdapter) InsertAudit(ctx context.Context, actorID uuid.UUID, action string, target *uuid.UUID, meta json.RawMessage) error {
	return a.Inner.AdminInsertAudit(ctx, actorID, action, target, meta)
}
func (a adminStoreAdapter) ListAudit(ctx context.Context, limit int) ([]admin.AuditEntry, error) {
	return a.Inner.AdminListAudit(ctx, limit)
}
func (a adminStoreAdapter) PromoteAdmins(ctx context.Context, emails []string) (int, error) {
	return a.Inner.AdminPromoteEmails(ctx, emails)
}
func (a adminStoreAdapter) UserRole(ctx context.Context, id uuid.UUID) (string, error) {
	return a.Inner.AdminUserRole(ctx, id)
}
func (a adminStoreAdapter) GetSetting(ctx context.Context, key string) (string, error) {
	return a.Inner.GetPlatformSetting(ctx, key)
}
func (a adminStoreAdapter) SetSetting(ctx context.Context, key, value string) error {
	return a.Inner.SetPlatformSetting(ctx, key, value)
}
func (a adminStoreAdapter) ListCatalogTypes(ctx context.Context, kind string, activeOnly bool) ([]admin.CatalogType, error) {
	return a.Inner.ListCatalogTypes(ctx, kind, activeOnly)
}
func (a adminStoreAdapter) CreateCatalogType(ctx context.Context, kind, code, label string, sortOrder int) (admin.CatalogType, error) {
	return a.Inner.CreateCatalogType(ctx, kind, code, label, sortOrder)
}
func (a adminStoreAdapter) UpdateCatalogType(ctx context.Context, id uuid.UUID, label *string, sortOrder *int, active *bool) (admin.CatalogType, error) {
	return a.Inner.UpdateCatalogType(ctx, id, label, sortOrder, active)
}
func (a adminStoreAdapter) ListCatalogInstitutions(ctx context.Context, typeKind, typeCode string, activeOnly bool) ([]admin.CatalogInstitution, error) {
	return a.Inner.ListCatalogInstitutions(ctx, typeKind, typeCode, activeOnly)
}
func (a adminStoreAdapter) CreateCatalogInstitution(ctx context.Context, code, label, typeKind, typeCode string, country *string, sortOrder int) (admin.CatalogInstitution, error) {
	return a.Inner.CreateCatalogInstitution(ctx, code, label, typeKind, typeCode, country, sortOrder)
}
func (a adminStoreAdapter) UpdateCatalogInstitution(ctx context.Context, id uuid.UUID, label *string, typeKind, typeCode *string, country *string, sortOrder *int, active *bool) (admin.CatalogInstitution, error) {
	return a.Inner.UpdateCatalogInstitution(ctx, id, label, typeKind, typeCode, country, sortOrder, active)
}

func (s *SQLStore) AdminUserRole(ctx context.Context, id uuid.UUID) (string, error) {
	var role string
	err := s.pool.QueryRow(ctx, `SELECT COALESCE(role, 'user') FROM users WHERE id=$1 AND deleted_at IS NULL`, id).Scan(&role)
	return role, err
}

func (s *SQLStore) AdminPromoteEmails(ctx context.Context, emails []string) (int, error) {
	if len(emails) == 0 {
		return 0, nil
	}
	tag, err := s.pool.Exec(ctx, `
		UPDATE users SET role = 'admin', updated_at = now()
		WHERE lower(email::text) = ANY($1::text[]) AND deleted_at IS NULL AND COALESCE(role,'user') <> 'admin'
	`, emails)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

func (s *SQLStore) AdminOverview(ctx context.Context) (admin.Overview, error) {
	var out admin.Overview
	err := s.pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE deleted_at IS NULL)::int,
			COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'active')::int,
			COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'suspended')::int,
			COUNT(*) FILTER (WHERE deleted_at IS NULL AND created_at >= now() - interval '7 days')::int,
			COUNT(*) FILTER (WHERE deleted_at IS NULL AND created_at >= now() - interval '30 days')::int
		FROM users
	`).Scan(&out.TotalUsers, &out.ActiveUsers, &out.SuspendedUsers, &out.Signups7d, &out.Signups30d)
	if err != nil {
		return out, err
	}
	_ = s.pool.QueryRow(ctx, `
		SELECT COUNT(DISTINCT user_id)::int FROM user_sessions
		WHERE revoked_at IS NULL AND last_used_at >= now() - interval '1 day'
	`).Scan(&out.DAU)
	_ = s.pool.QueryRow(ctx, `
		SELECT COUNT(DISTINCT user_id)::int FROM user_sessions
		WHERE revoked_at IS NULL AND last_used_at >= now() - interval '7 days'
	`).Scan(&out.WAU)
	_ = s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM loans
		WHERE status IN ('active','repayment_pending','overdue')
	`).Scan(&out.OpenLoans)
	_ = s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM loans WHERE status = 'overdue'
	`).Scan(&out.OverdueLoans)
	_ = s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM cashflow_entries
		WHERE created_at >= now() - interval '7 days' AND COALESCE(is_template,false) = false
	`).Scan(&out.CashflowEntries7d)
	_ = s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM ai_insights WHERE created_at >= now() - interval '7 days'
	`).Scan(&out.AIInsights7d)
	return out, nil
}

func (s *SQLStore) AdminListUsers(ctx context.Context, q, status string, limit, offset int) ([]admin.UserListItem, int, error) {
	q = strings.TrimSpace(q)
	like := "%" + strings.ToLower(q) + "%"
	var total int
	err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM users u
		WHERE u.deleted_at IS NULL
		  AND ($1 = '' OR u.status = $1)
		  AND (
		    $2 = '%%'
		    OR lower(u.email::text) LIKE $2
		    OR lower(u.display_name) LIKE $2
		    OR lower(COALESCE(u.username::text,'')) LIKE $2
		  )
	`, status, like).Scan(&total)
	if err != nil {
		return nil, 0, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT u.id, u.email::text, u.display_name, u.username, u.status, COALESCE(u.role,'user'),
		       u.country_code, u.created_at,
		       (
		         SELECT MAX(s.last_used_at) FROM user_sessions s
		         WHERE s.user_id = u.id AND s.revoked_at IS NULL
		       ) AS last_active_at
		FROM users u
		WHERE u.deleted_at IS NULL
		  AND ($1 = '' OR u.status = $1)
		  AND (
		    $2 = '%%'
		    OR lower(u.email::text) LIKE $2
		    OR lower(u.display_name) LIKE $2
		    OR lower(COALESCE(u.username::text,'')) LIKE $2
		  )
		ORDER BY u.created_at DESC
		LIMIT $3 OFFSET $4
	`, status, like, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []admin.UserListItem
	for rows.Next() {
		var item admin.UserListItem
		if err := rows.Scan(
			&item.ID, &item.Email, &item.DisplayName, &item.Username, &item.Status, &item.Role,
			&item.CountryCode, &item.CreatedAt, &item.LastActiveAt,
		); err != nil {
			return nil, 0, err
		}
		out = append(out, item)
	}
	return out, total, rows.Err()
}

func (s *SQLStore) AdminGetUser(ctx context.Context, id uuid.UUID) (admin.UserDetail, error) {
	var d admin.UserDetail
	var verifiedAt *time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT u.id, u.email::text, u.display_name, u.username, u.status, COALESCE(u.role,'user'),
		       u.country_code, u.created_at, u.phone_e164, u.locale, u.timezone, u.default_currency_code,
		       u.email_verified_at,
		       (
		         SELECT MAX(s.last_used_at) FROM user_sessions s
		         WHERE s.user_id = u.id AND s.revoked_at IS NULL
		       )
		FROM users u
		WHERE u.id = $1 AND u.deleted_at IS NULL
	`, id).Scan(
		&d.ID, &d.Email, &d.DisplayName, &d.Username, &d.Status, &d.Role,
		&d.CountryCode, &d.CreatedAt, &d.PhoneE164, &d.Locale, &d.Timezone, &d.DefaultCurrencyCode,
		&verifiedAt, &d.LastActiveAt,
	)
	if err != nil {
		return d, err
	}
	d.EmailVerified = verifiedAt != nil

	_ = s.pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM loans WHERE borrower_id=$1`, id).Scan(&d.LoansAsBorrower)
	_ = s.pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM loans WHERE lender_id=$1`, id).Scan(&d.LoansAsLender)
	_ = s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM loans
		WHERE (borrower_id=$1 OR lender_id=$1) AND status IN ('active','repayment_pending','overdue')
	`, id).Scan(&d.OpenLoans)
	_ = s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM loans
		WHERE (borrower_id=$1 OR lender_id=$1) AND status='overdue'
	`, id).Scan(&d.OverdueLoans)
	_ = s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::int,
		       COALESCE(SUM(amount),0)::text
		FROM cashflow_entries
		WHERE user_id=$1 AND COALESCE(is_template,false)=false
		  AND occurred_at >= now() - interval '30 days'
	`, id).Scan(&d.CashflowEntries30d, &d.CashflowVolume30d)
	_ = s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM friendships
		WHERE status='accepted' AND (user_low_id=$1 OR user_high_id=$1)
	`, id).Scan(&d.FriendsCount)

	var grade string
	var thin bool
	var points float64
	err = s.pool.QueryRow(ctx, `
		SELECT COALESCE(grade,'C'), COALESCE(thin_history,false), COALESCE(points,50)::float8
		FROM lony_scores WHERE user_id=$1
		ORDER BY computed_at DESC LIMIT 1
	`, id).Scan(&grade, &thin, &points)
	if err == nil {
		d.TrustGrade = &grade
		band := map[string]string{"A": "Strong", "B": "Good", "C": "Fair", "D": "Watch", "E": "High risk"}[grade]
		if thin && grade != "E" {
			band += " · thin history"
		}
		d.TrustBand = &band
		d.TrustThinHistory = &thin
	}
	return d, nil
}

func (s *SQLStore) AdminSetUserStatus(ctx context.Context, id uuid.UUID, status string) error {
	_, err := s.pool.Exec(ctx, `UPDATE users SET status=$2, updated_at=now() WHERE id=$1 AND deleted_at IS NULL`, id, status)
	return err
}

func (s *SQLStore) AdminRevokeUserSessions(ctx context.Context, id uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, id)
	return err
}

func (s *SQLStore) AdminInsertAudit(ctx context.Context, actorID uuid.UUID, action string, target *uuid.UUID, meta json.RawMessage) error {
	if meta == nil {
		meta = json.RawMessage(`{}`)
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO admin_audit_log (actor_id, action, target_user_id, meta)
		VALUES ($1,$2,$3,$4)
	`, actorID, action, target, meta)
	return err
}

func (s *SQLStore) AdminListAudit(ctx context.Context, limit int) ([]admin.AuditEntry, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT a.id, a.actor_id, COALESCE(u.email::text,''), a.action, a.target_user_id, a.meta, a.created_at
		FROM admin_audit_log a
		LEFT JOIN users u ON u.id = a.actor_id
		ORDER BY a.created_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []admin.AuditEntry
	for rows.Next() {
		var e admin.AuditEntry
		var meta []byte
		if err := rows.Scan(&e.ID, &e.ActorID, &e.ActorEmail, &e.Action, &e.TargetUserID, &meta, &e.CreatedAt); err != nil {
			return nil, err
		}
		e.Meta = json.RawMessage(meta)
		out = append(out, e)
	}
	return out, rows.Err()
}
