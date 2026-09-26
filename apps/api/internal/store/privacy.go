package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"equilend/api/internal/privacy"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type privacyStoreAdapter struct{ Inner *SQLStore }

func PrivacyAdapter(s *SQLStore) privacy.Store { return privacyStoreAdapter{Inner: s} }

func (a privacyStoreAdapter) BuildExport(ctx context.Context, userID uuid.UUID) (privacy.ExportBundle, error) {
	return a.Inner.BuildUserExport(ctx, userID)
}
func (a privacyStoreAdapter) SoftDeleteUser(ctx context.Context, userID uuid.UUID) error {
	return a.Inner.SoftDeleteUser(ctx, userID)
}
func (a privacyStoreAdapter) RevokeAllSessions(ctx context.Context, userID uuid.UUID) error {
	return a.Inner.AdminRevokeUserSessions(ctx, userID)
}
func (a privacyStoreAdapter) GetSetting(ctx context.Context, key string) (string, error) {
	return a.Inner.GetPlatformSetting(ctx, key)
}
func (a privacyStoreAdapter) SetSetting(ctx context.Context, key, value string) error {
	return a.Inner.SetPlatformSetting(ctx, key, value)
}

func (s *SQLStore) GetPlatformSetting(ctx context.Context, key string) (string, error) {
	var v string
	err := s.pool.QueryRow(ctx, `SELECT value FROM platform_settings WHERE key=$1`, key).Scan(&v)
	return v, err
}

func (s *SQLStore) SetPlatformSetting(ctx context.Context, key, value string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO platform_settings (key, value, updated_at) VALUES ($1,$2,now())
		ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()
	`, key, value)
	return err
}

func (s *SQLStore) SoftDeleteUser(ctx context.Context, userID uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE users SET
			status = 'deleted',
			deleted_at = now(),
			updated_at = now(),
			email = ('deleted+' || id::text || '@deleted.lony')::citext,
			phone_e164 = NULL,
			username = NULL,
			display_name = 'Deleted user',
			first_name = NULL,
			middle_name = NULL,
			last_name = NULL,
			avatar_object_key = NULL,
			password_hash = '!',
			preferred_auth_provider = NULL
		WHERE id = $1 AND deleted_at IS NULL
	`, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	// Drop OAuth identities so the email/subject cannot re-link to this row.
	_, _ = s.pool.Exec(ctx, `DELETE FROM user_identities WHERE user_id=$1`, userID)
	return nil
}

func (s *SQLStore) BuildUserExport(ctx context.Context, userID uuid.UUID) (privacy.ExportBundle, error) {
	out := privacy.ExportBundle{
		Accounts:   []map[string]any{},
		Cashflow:   []map[string]any{},
		Transfers:  []map[string]any{},
		Budgets:    []map[string]any{},
		Goals:      []map[string]any{},
		Loans:      []map[string]any{},
		Repayments: []map[string]any{},
		AIInsights: []map[string]any{},
	}

	var email, display, status, role, locale, tz string
	var username, phone, country, currency *string
	var created time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT email::text, display_name, COALESCE(username::text, NULL), phone_e164, country_code,
		       default_currency_code, status, COALESCE(role,'user'), locale, timezone, created_at
		FROM users WHERE id=$1 AND deleted_at IS NULL
	`, userID).Scan(&email, &display, &username, &phone, &country, &currency, &status, &role, &locale, &tz, &created)
	if err != nil {
		return out, err
	}
	out.Profile = map[string]any{
		"id": userID.String(), "email": email, "display_name": display, "username": username,
		"phone_e164": phone, "country_code": country, "default_currency_code": currency,
		"status": status, "role": role, "locale": locale, "timezone": tz, "created_at": created,
	}

	out.Accounts, _ = s.scanMaps(ctx, `
		SELECT id, name, account_type, currency_code, balance::text, balance_as_of, interest_rate_percent::text,
		       compounding, institution_label, created_at
		FROM money_accounts WHERE user_id=$1 AND archived_at IS NULL ORDER BY created_at
	`, userID)
	out.Cashflow, _ = s.scanMaps(ctx, `
		SELECT id, kind, amount::text, currency_code, category, category_id, account_id, title, note,
		       occurred_at, COALESCE(status,'confirmed') AS status, created_at
		FROM cashflow_entries WHERE user_id=$1 AND COALESCE(is_template,false)=false
		ORDER BY occurred_at DESC LIMIT 5000
	`, userID)
	out.Transfers, _ = s.scanMaps(ctx, `
		SELECT id, from_account_id, to_account_id, amount::text, currency_code, note, occurred_at, created_at
		FROM money_transfers WHERE user_id=$1 ORDER BY occurred_at DESC LIMIT 2000
	`, userID)
	out.Budgets, _ = s.scanMaps(ctx, `
		SELECT id, category_id, category_name, currency_code, period_month, limit_amount::text, created_at
		FROM budgets WHERE user_id=$1 ORDER BY period_month DESC LIMIT 500
	`, userID)
	out.Goals, _ = s.scanMaps(ctx, `
		SELECT id, title, goal_type, currency_code, target_amount::text, current_amount::text,
		       status, target_date, linked_account_id, created_at
		FROM goals WHERE user_id=$1 ORDER BY created_at DESC
	`, userID)
	out.Loans, _ = s.scanMaps(ctx, `
		SELECT id, reference_code, title, status, principal::text, currency_code, interest_rate_percent::text,
		       borrower_id, lender_id, due_at, created_at
		FROM loans WHERE borrower_id=$1 OR lender_id=$1 ORDER BY created_at DESC LIMIT 2000
	`, userID)
	out.Repayments, _ = s.scanMaps(ctx, `
		SELECT r.id, r.loan_id, r.amount::text, r.status, r.submitted_at
		FROM repayments r
		JOIN loans l ON l.id = r.loan_id
		WHERE l.borrower_id=$1 OR l.lender_id=$1 OR r.submitted_by_user_id=$1
		ORDER BY r.submitted_at DESC LIMIT 2000
	`, userID)
	out.AIInsights, _ = s.scanMaps(ctx, `
		SELECT id, theme, severity, title, body, source, created_at, dismissed_at
		FROM ai_insights WHERE user_id=$1 ORDER BY created_at DESC LIMIT 500
	`, userID)

	var grade string
	var points float64
	var thin bool
	var computed time.Time
	err = s.pool.QueryRow(ctx, `
		SELECT COALESCE(grade,'C'), COALESCE(points,50)::float8, COALESCE(thin_history,false), computed_at
		FROM lony_scores WHERE user_id=$1 ORDER BY computed_at DESC LIMIT 1
	`, userID).Scan(&grade, &points, &thin, &computed)
	if err == nil {
		out.Trust = map[string]any{
			"grade": grade, "points": points, "thin_history": thin, "computed_at": computed,
		}
	}
	return out, nil
}

func (s *SQLStore) scanMaps(ctx context.Context, q string, userID uuid.UUID) ([]map[string]any, error) {
	rows, err := s.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	fds := rows.FieldDescriptions()
	names := make([]string, len(fds))
	for i, f := range fds {
		names[i] = string(f.Name)
	}
	var out []map[string]any
	for rows.Next() {
		vals := make([]any, len(names))
		ptrs := make([]any, len(names))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return out, err
		}
		m := map[string]any{}
		for i, name := range names {
			m[name] = normalizeExportVal(vals[i])
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func normalizeExportVal(v any) any {
	switch t := v.(type) {
	case []byte:
		return string(t)
	case time.Time:
		return t.UTC().Format(time.RFC3339)
	case *time.Time:
		if t == nil {
			return nil
		}
		return t.UTC().Format(time.RFC3339)
	case uuid.UUID:
		return t.String()
	case [16]byte:
		id, err := uuid.FromBytes(t[:])
		if err != nil {
			return fmt.Sprintf("%x", t)
		}
		return id.String()
	case json.RawMessage:
		return json.RawMessage(t)
	default:
		return v
	}
}

func (s *SQLStore) DismissAllAIInsights(ctx context.Context, userID uuid.UUID) (int64, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE ai_insights SET dismissed_at = now()
		WHERE user_id=$1 AND dismissed_at IS NULL
	`, userID)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
