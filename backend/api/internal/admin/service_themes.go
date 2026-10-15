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

func (s *Service) ListSystemThemes(ctx context.Context, activeOnly bool) ([]SystemTheme, error) {
	return s.store.ListSystemThemes(ctx, activeOnly)
}

func (s *Service) CreateSystemTheme(ctx context.Context, actor uuid.UUID, slug, label string, colors json.RawMessage, sortOrder int) (SystemTheme, error) {
	label = strings.TrimSpace(label)
	slug = slugCode(slug)
	if slug == "" {
		slug = slugCode(label)
	}
	if label == "" || slug == "" {
		return SystemTheme{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"label": "required",
			"slug":  "required",
		})
	}
	if !json.Valid(colors) || len(colors) == 0 {
		return SystemTheme{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"colors": "must be a JSON object",
		})
	}
	out, err := s.store.CreateSystemTheme(ctx, slug, label, colors, sortOrder)
	if err != nil {
		if isUniqueViolation(err) {
			return SystemTheme{}, httpx.E(http.StatusConflict, "CONFLICT", "theme slug already exists")
		}
		return SystemTheme{}, err
	}
	meta, _ := json.Marshal(map[string]any{"theme_id": out.ID, "slug": slug})
	s.audit(ctx, actor, ActionThemeCreate, nil, meta)
	return out, nil
}

func (s *Service) UpdateSystemTheme(ctx context.Context, actor, id uuid.UUID, label *string, colors json.RawMessage, sortOrder *int, active *bool) (SystemTheme, error) {
	if label != nil {
		v := strings.TrimSpace(*label)
		label = &v
		if v == "" {
			return SystemTheme{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"label": "cannot be empty",
			})
		}
	}
	if colors != nil && (!json.Valid(colors) || len(colors) == 0) {
		return SystemTheme{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"colors": "must be a JSON object",
		})
	}
	out, err := s.store.UpdateSystemTheme(ctx, id, label, colors, sortOrder, active)
	if errors.Is(err, pgx.ErrNoRows) {
		return SystemTheme{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "theme not found")
	}
	if err != nil {
		return SystemTheme{}, err
	}
	meta, _ := json.Marshal(map[string]any{"theme_id": id})
	s.audit(ctx, actor, ActionThemeUpdate, nil, meta)
	return out, nil
}
