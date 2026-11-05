package store

import (
	"context"
	"time"

	"equilend/api/internal/admin"

	"github.com/google/uuid"
)

func (a adminStoreAdapter) ListSettings(ctx context.Context) (map[string]string, error) {
	return a.Inner.AdminListSettings(ctx)
}
func (a adminStoreAdapter) SystemSnapshot(ctx context.Context) (admin.DBInfo, admin.JobsInfo, admin.SessionInfo, error) {
	return a.Inner.AdminSystemSnapshot(ctx)
}
func (a adminStoreAdapter) RetryFailedJobs(ctx context.Context) (int, error) {
	return a.Inner.AdminRetryFailedJobs(ctx)
}
func (a adminStoreAdapter) DeleteRole(ctx context.Context, id uuid.UUID) error {
	return a.Inner.AdminDeleteRole(ctx, id)
}
func (a adminStoreAdapter) ListAdmins(ctx context.Context) ([]admin.AdminMember, error) {
	return a.Inner.AdminListAdmins(ctx)
}
func (a adminStoreAdapter) SetUserAccess(ctx context.Context, userID uuid.UUID, role string, roleID *uuid.UUID) error {
	return a.Inner.AdminSetUserAccess(ctx, userID, role, roleID)
}

func (s *SQLStore) AdminListSettings(ctx context.Context) (map[string]string, error) {
	rows, err := s.pool.Query(ctx, `SELECT key, value FROM platform_settings`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, rows.Err()
}

// AdminSystemSnapshot gathers database, job queue and session facts. Each
// part is best effort so one failing query doesn't blank the whole page.
func (s *SQLStore) AdminSystemSnapshot(ctx context.Context) (admin.DBInfo, admin.JobsInfo, admin.SessionInfo, error) {
	var db admin.DBInfo
	var jobs admin.JobsInfo
	var sess admin.SessionInfo

	st := s.pool.Stat()
	db.Pool = admin.PoolInfo{Total: st.TotalConns(), Idle: st.IdleConns(), Acquired: st.AcquiredConns(), Max: st.MaxConns()}

	start := time.Now()
	if err := s.pool.Ping(ctx); err != nil {
		db.Error = err.Error()
		return db, jobs, sess, nil
	}
	db.LatencyMs = float64(time.Since(start).Microseconds()) / 1000
	db.OK = true

	_ = s.pool.QueryRow(ctx, `SELECT current_setting('server_version'), pg_database_size(current_database())`).Scan(&db.Version, &db.SizeBytes)
	_ = s.pool.QueryRow(ctx, `
		SELECT version, applied_at, (SELECT COUNT(*)::int FROM schema_migrations)
		FROM schema_migrations ORDER BY version DESC LIMIT 1
	`).Scan(&db.Migration, &db.MigrationAt, &db.MigrationsCount)

	db.Tables = []admin.TableInfo{}
	if rows, err := s.pool.Query(ctx, `
		SELECT c.relname, GREATEST(c.reltuples, 0)::bigint, pg_total_relation_size(c.oid)
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE c.relkind = 'r' AND n.nspname = 'public'
		ORDER BY pg_total_relation_size(c.oid) DESC
		LIMIT 12
	`); err == nil {
		for rows.Next() {
			var t admin.TableInfo
			if rows.Scan(&t.Name, &t.Rows, &t.Bytes) == nil {
				db.Tables = append(db.Tables, t)
			}
		}
		rows.Close()
	}

	_ = s.pool.QueryRow(ctx, `
		SELECT
		  COUNT(*) FILTER (WHERE status = 'pending')::int,
		  COUNT(*) FILTER (WHERE status = 'pending' AND run_at <= now())::int,
		  COUNT(*) FILTER (WHERE status = 'failed')::int,
		  COUNT(*) FILTER (WHERE status = 'completed' AND completed_at >= now() - interval '24 hours')::int,
		  COUNT(*) FILTER (WHERE status = 'cancelled')::int,
		  MIN(run_at) FILTER (WHERE status = 'pending' AND run_at <= now())
		FROM notification_jobs
	`).Scan(&jobs.Pending, &jobs.Due, &jobs.Failed, &jobs.Completed24h, &jobs.Cancelled, &jobs.OldestDueAt)

	jobs.RecentFailures = []admin.JobFailure{}
	if rows, err := s.pool.Query(ctx, `
		SELECT id, kind, attempts, COALESCE(last_error, ''), run_at
		FROM notification_jobs
		WHERE status = 'failed'
		ORDER BY run_at DESC
		LIMIT 8
	`); err == nil {
		for rows.Next() {
			var j admin.JobFailure
			if rows.Scan(&j.ID, &j.Kind, &j.Attempts, &j.LastError, &j.RunAt) == nil {
				jobs.RecentFailures = append(jobs.RecentFailures, j)
			}
		}
		rows.Close()
	}

	_ = s.pool.QueryRow(ctx, `
		SELECT
		  COUNT(*) FILTER (WHERE s.expires_at > now())::int,
		  COUNT(DISTINCT s.user_id) FILTER (WHERE s.last_used_at >= now() - interval '24 hours')::int,
		  COUNT(DISTINCT s.user_id) FILTER (WHERE s.last_used_at >= now() - interval '1 hour')::int,
		  COUNT(DISTINCT s.user_id) FILTER (WHERE u.role = 'admin' AND s.last_used_at >= now() - interval '1 hour')::int
		FROM user_sessions s
		JOIN users u ON u.id = s.user_id
		WHERE s.revoked_at IS NULL
	`).Scan(&sess.Active, &sess.Used24h, &sess.Used1h, &sess.AdminsLive)

	return db, jobs, sess, nil
}

func (s *SQLStore) AdminRetryFailedJobs(ctx context.Context) (int, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE notification_jobs
		SET status = 'pending', attempts = 0, last_error = NULL, run_at = now()
		WHERE status = 'failed'
	`)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

func (s *SQLStore) AdminDeleteRole(ctx context.Context, id uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM admin_roles WHERE id = $1 AND is_system = false`, id)
	return err
}

func (s *SQLStore) AdminListAdmins(ctx context.Context) ([]admin.AdminMember, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT u.id, u.email::text, u.display_name, u.status, u.admin_role_id, r.name, u.created_at,
		       (SELECT COUNT(*)::int FROM user_sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now()),
		       (SELECT MAX(s.last_used_at) FROM user_sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL),
		       (SELECT MAX(a.created_at) FROM admin_audit_log a WHERE a.actor_id = u.id),
		       (SELECT COUNT(*)::int FROM admin_audit_log a WHERE a.actor_id = u.id AND a.created_at >= now() - interval '30 days')
		FROM users u
		LEFT JOIN admin_roles r ON r.id = u.admin_role_id
		WHERE u.role = 'admin' AND u.deleted_at IS NULL
		ORDER BY (r.name = 'Super Admin') DESC NULLS LAST, r.name NULLS LAST, u.display_name
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []admin.AdminMember{}
	for rows.Next() {
		var m admin.AdminMember
		if err := rows.Scan(&m.ID, &m.Email, &m.DisplayName, &m.Status, &m.AdminRoleID, &m.AdminRoleName, &m.CreatedAt,
			&m.ActiveSessions, &m.LastActiveAt, &m.LastActionAt, &m.Actions30d); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *SQLStore) AdminSetUserAccess(ctx context.Context, userID uuid.UUID, role string, roleID *uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE users SET role = $2, admin_role_id = $3, updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL
	`, userID, role, roleID)
	return err
}
