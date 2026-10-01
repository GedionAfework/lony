package store

import (
	"context"
	"encoding/json"

	"equilend/api/internal/localization"

	"github.com/jackc/pgx/v5"
)

type localizationStoreAdapter struct{ Inner *SQLStore }

func LocalizationAdapter(s *SQLStore) localization.Store {
	return localizationStoreAdapter{Inner: s}
}

func (a localizationStoreAdapter) ListLocales(ctx context.Context, enabledOnly bool) ([]localization.Locale, error) {
	return a.Inner.ListAppLocales(ctx, enabledOnly)
}
func (a localizationStoreAdapter) GetLocale(ctx context.Context, code string) (localization.Locale, error) {
	return a.Inner.GetAppLocale(ctx, code)
}
func (a localizationStoreAdapter) UpsertLocale(ctx context.Context, code, name, dir string, enabled bool, sortOrder int, messages json.RawMessage) (localization.Locale, error) {
	return a.Inner.UpsertAppLocale(ctx, code, name, dir, enabled, sortOrder, messages)
}
func (a localizationStoreAdapter) SetLocaleEnabled(ctx context.Context, code string, enabled bool) (localization.Locale, error) {
	return a.Inner.SetAppLocaleEnabled(ctx, code, enabled)
}
func (a localizationStoreAdapter) DeleteLocale(ctx context.Context, code string) error {
	return a.Inner.DeleteAppLocale(ctx, code)
}
func (a localizationStoreAdapter) ListCalendars(ctx context.Context, enabledOnly bool) ([]localization.Calendar, error) {
	return a.Inner.ListAppCalendars(ctx, enabledOnly)
}
func (a localizationStoreAdapter) SetCalendarEnabled(ctx context.Context, id string, enabled bool) (localization.Calendar, error) {
	return a.Inner.SetAppCalendarEnabled(ctx, id, enabled)
}

func (s *SQLStore) ListAppLocales(ctx context.Context, enabledOnly bool) ([]localization.Locale, error) {
	q := `SELECT code, name, dir, enabled, sort_order, messages, created_at, updated_at FROM app_locales`
	if enabledOnly {
		q += ` WHERE enabled = true`
	}
	q += ` ORDER BY sort_order, name`
	rows, err := s.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []localization.Locale
	for rows.Next() {
		var loc localization.Locale
		var msg []byte
		if err := rows.Scan(&loc.Code, &loc.Name, &loc.Dir, &loc.Enabled, &loc.SortOrder, &msg, &loc.CreatedAt, &loc.UpdatedAt); err != nil {
			return nil, err
		}
		if msg == nil {
			msg = []byte(`{}`)
		}
		loc.Messages = json.RawMessage(msg)
		out = append(out, loc)
	}
	return out, rows.Err()
}

func (s *SQLStore) GetAppLocale(ctx context.Context, code string) (localization.Locale, error) {
	var loc localization.Locale
	var msg []byte
	err := s.pool.QueryRow(ctx, `
		SELECT code, name, dir, enabled, sort_order, messages, created_at, updated_at
		FROM app_locales WHERE code=$1`, code).Scan(
		&loc.Code, &loc.Name, &loc.Dir, &loc.Enabled, &loc.SortOrder, &msg, &loc.CreatedAt, &loc.UpdatedAt,
	)
	if err != nil {
		return loc, err
	}
	if msg == nil {
		msg = []byte(`{}`)
	}
	loc.Messages = json.RawMessage(msg)
	return loc, nil
}

func (s *SQLStore) UpsertAppLocale(ctx context.Context, code, name, dir string, enabled bool, sortOrder int, messages json.RawMessage) (localization.Locale, error) {
	if messages == nil {
		messages = json.RawMessage(`{}`)
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO app_locales (code, name, dir, enabled, sort_order, messages, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6::jsonb, now())
		ON CONFLICT (code) DO UPDATE SET
		  name=EXCLUDED.name, dir=EXCLUDED.dir, enabled=EXCLUDED.enabled,
		  sort_order=EXCLUDED.sort_order, messages=EXCLUDED.messages, updated_at=now()`,
		code, name, dir, enabled, sortOrder, []byte(messages),
	)
	if err != nil {
		return localization.Locale{}, err
	}
	return s.GetAppLocale(ctx, code)
}

func (s *SQLStore) SetAppLocaleEnabled(ctx context.Context, code string, enabled bool) (localization.Locale, error) {
	tag, err := s.pool.Exec(ctx, `UPDATE app_locales SET enabled=$2, updated_at=now() WHERE code=$1`, code, enabled)
	if err != nil {
		return localization.Locale{}, err
	}
	if tag.RowsAffected() == 0 {
		return localization.Locale{}, pgx.ErrNoRows
	}
	return s.GetAppLocale(ctx, code)
}

func (s *SQLStore) DeleteAppLocale(ctx context.Context, code string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM app_locales WHERE code=$1`, code)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *SQLStore) ListAppCalendars(ctx context.Context, enabledOnly bool) ([]localization.Calendar, error) {
	q := `SELECT id, name, enabled, sort_order, config, created_at, updated_at FROM app_calendars`
	if enabledOnly {
		q += ` WHERE enabled = true`
	}
	q += ` ORDER BY sort_order, name`
	rows, err := s.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []localization.Calendar
	for rows.Next() {
		var c localization.Calendar
		var cfg []byte
		if err := rows.Scan(&c.ID, &c.Name, &c.Enabled, &c.SortOrder, &cfg, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		if cfg == nil {
			cfg = []byte(`{}`)
		}
		c.Config = json.RawMessage(cfg)
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *SQLStore) SetAppCalendarEnabled(ctx context.Context, id string, enabled bool) (localization.Calendar, error) {
	tag, err := s.pool.Exec(ctx, `UPDATE app_calendars SET enabled=$2, updated_at=now() WHERE id=$1`, id, enabled)
	if err != nil {
		return localization.Calendar{}, err
	}
	if tag.RowsAffected() == 0 {
		return localization.Calendar{}, pgx.ErrNoRows
	}
	var c localization.Calendar
	var cfg []byte
	err = s.pool.QueryRow(ctx, `
		SELECT id, name, enabled, sort_order, config, created_at, updated_at FROM app_calendars WHERE id=$1`, id).Scan(
		&c.ID, &c.Name, &c.Enabled, &c.SortOrder, &cfg, &c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		return c, err
	}
	if cfg == nil {
		cfg = []byte(`{}`)
	}
	c.Config = json.RawMessage(cfg)
	return c, nil
}
