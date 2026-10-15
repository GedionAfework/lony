package store

import (
	"context"
	"encoding/json"

	"equilend/api/internal/admin"

	"github.com/google/uuid"
)

func (a adminStoreAdapter) ListSystemThemes(ctx context.Context, activeOnly bool) ([]admin.SystemTheme, error) {
	return a.Inner.AdminListSystemThemes(ctx, activeOnly)
}
func (a adminStoreAdapter) GetSystemTheme(ctx context.Context, id uuid.UUID) (admin.SystemTheme, error) {
	return a.Inner.AdminGetSystemTheme(ctx, id)
}
func (a adminStoreAdapter) CreateSystemTheme(ctx context.Context, slug, label string, colors json.RawMessage, sortOrder int) (admin.SystemTheme, error) {
	return a.Inner.AdminCreateSystemTheme(ctx, slug, label, colors, sortOrder)
}
func (a adminStoreAdapter) UpdateSystemTheme(ctx context.Context, id uuid.UUID, label *string, colors json.RawMessage, sortOrder *int, active *bool) (admin.SystemTheme, error) {
	return a.Inner.AdminUpdateSystemTheme(ctx, id, label, colors, sortOrder, active)
}

func (s *SQLStore) AdminListSystemThemes(ctx context.Context, activeOnly bool) ([]admin.SystemTheme, error) {
	q := `
		SELECT id, slug, label, colors, sort_order, active, created_at, updated_at
		FROM system_themes`
	if activeOnly {
		q += ` WHERE active = true`
	}
	q += ` ORDER BY sort_order, label`
	rows, err := s.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []admin.SystemTheme
	for rows.Next() {
		var t admin.SystemTheme
		var colors []byte
		if err := rows.Scan(&t.ID, &t.Slug, &t.Label, &colors, &t.SortOrder, &t.Active, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		if colors == nil {
			colors = []byte(`{}`)
		}
		t.Colors = json.RawMessage(colors)
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *SQLStore) AdminGetSystemTheme(ctx context.Context, id uuid.UUID) (admin.SystemTheme, error) {
	var t admin.SystemTheme
	var colors []byte
	err := s.pool.QueryRow(ctx, `
		SELECT id, slug, label, colors, sort_order, active, created_at, updated_at
		FROM system_themes WHERE id = $1
	`, id).Scan(&t.ID, &t.Slug, &t.Label, &colors, &t.SortOrder, &t.Active, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		return t, err
	}
	if colors == nil {
		colors = []byte(`{}`)
	}
	t.Colors = json.RawMessage(colors)
	return t, nil
}

func (s *SQLStore) AdminCreateSystemTheme(ctx context.Context, slug, label string, colors json.RawMessage, sortOrder int) (admin.SystemTheme, error) {
	if colors == nil {
		colors = json.RawMessage(`{}`)
	}
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `
		INSERT INTO system_themes (slug, label, colors, sort_order)
		VALUES ($1, $2, $3::jsonb, $4)
		RETURNING id
	`, slug, label, []byte(colors), sortOrder).Scan(&id)
	if err != nil {
		return admin.SystemTheme{}, err
	}
	return s.AdminGetSystemTheme(ctx, id)
}

func (s *SQLStore) AdminUpdateSystemTheme(ctx context.Context, id uuid.UUID, label *string, colors json.RawMessage, sortOrder *int, active *bool) (admin.SystemTheme, error) {
	var colorBytes []byte
	if colors != nil {
		colorBytes = []byte(colors)
	}
	_, err := s.pool.Exec(ctx, `
		UPDATE system_themes SET
		  label = COALESCE($2, label),
		  colors = COALESCE($3::jsonb, colors),
		  sort_order = COALESCE($4, sort_order),
		  active = COALESCE($5, active),
		  updated_at = now()
		WHERE id = $1
	`, id, label, colorBytes, sortOrder, active)
	if err != nil {
		return admin.SystemTheme{}, err
	}
	return s.AdminGetSystemTheme(ctx, id)
}
