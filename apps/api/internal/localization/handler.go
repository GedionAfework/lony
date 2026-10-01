package localization

import (
	"context"
	_ "embed"
	"encoding/json"
	"net/http"
	"strings"
	"unicode/utf8"

	"equilend/api/internal/auth"
	"equilend/api/internal/httpx"

	"github.com/go-chi/chi/v5"
)

//go:embed en.json
var englishCatalog []byte

//go:embed am-ET.json
var amharicCatalog []byte

//go:embed fr.json
var frenchCatalog []byte

type Service struct {
	store Store
	audit func(ctx context.Context, actorID string, action string, meta map[string]any)
}

func NewService(store Store) *Service {
	return &Service{store: store}
}

func (s *Service) SetAudit(fn func(ctx context.Context, actorID string, action string, meta map[string]any)) {
	s.audit = fn
}

func (s *Service) emitAudit(ctx context.Context, actorID, action string, meta map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit(ctx, actorID, action, meta)
}

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (s *Service) ListLocales(ctx context.Context, enabledOnly bool) ([]Locale, error) {
	return s.store.ListLocales(ctx, enabledOnly)
}

func (s *Service) GetLocale(ctx context.Context, code string) (Locale, error) {
	return s.store.GetLocale(ctx, code)
}

func (s *Service) ListCalendars(ctx context.Context, enabledOnly bool) ([]Calendar, error) {
	return s.store.ListCalendars(ctx, enabledOnly)
}

func (s *Service) EnglishCatalog() json.RawMessage {
	return json.RawMessage(englishCatalog)
}

func (s *Service) seedPackIfEmpty(ctx context.Context, raw []byte, fallbackCode string) error {
	var pack PackUpload
	if err := json.Unmarshal(raw, &pack); err != nil {
		return err
	}
	if pack.Locale == "" {
		pack.Locale = fallbackCode
	}
	loc, err := s.store.GetLocale(ctx, pack.Locale)
	if err != nil {
		// insert fresh
		enabled := true
		pack.Enabled = &enabled
		_, err = s.UpsertFromUpload(ctx, pack)
		return err
	}
	var msgs map[string]string
	_ = json.Unmarshal(loc.Messages, &msgs)
	if len(msgs) > 0 {
		return nil
	}
	enabled := loc.Enabled
	pack.Enabled = &enabled
	_, err = s.UpsertFromUpload(ctx, pack)
	return err
}

func (s *Service) SeedEnglishIfEmpty(ctx context.Context) error {
	_ = s.seedPackIfEmpty(ctx, englishCatalog, "en")
	_ = s.seedPackIfEmpty(ctx, amharicCatalog, "am-ET")
	_ = s.seedPackIfEmpty(ctx, frenchCatalog, "fr")
	return nil
}

func (s *Service) UpsertFromUpload(ctx context.Context, in PackUpload) (Locale, error) {
	code := strings.TrimSpace(in.Locale)
	name := strings.TrimSpace(in.Name)
	dir := strings.ToLower(strings.TrimSpace(in.Dir))
	if code == "" || utf8.RuneCountInString(code) > 32 {
		return Locale{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"locale": "required BCP-47 code",
		})
	}
	if name == "" {
		return Locale{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"name": "required",
		})
	}
	if dir != "ltr" && dir != "rtl" {
		dir = "ltr"
	}
	if in.Messages == nil {
		in.Messages = map[string]string{}
	}
	raw, err := json.Marshal(in.Messages)
	if err != nil {
		return Locale{}, err
	}
	enabled := true
	if in.Enabled != nil {
		enabled = *in.Enabled
	}
	existing, err := s.store.GetLocale(ctx, code)
	sortOrder := 100
	if err == nil {
		sortOrder = existing.SortOrder
		if in.Enabled == nil {
			enabled = existing.Enabled
		}
	}
	return s.store.UpsertLocale(ctx, code, name, dir, enabled, sortOrder, raw)
}

func (s *Service) SetLocaleEnabled(ctx context.Context, code string, enabled bool) (Locale, error) {
	code = strings.TrimSpace(code)
	if code == "en" && !enabled {
		return Locale{}, httpx.E(http.StatusUnprocessableEntity, "VALIDATION", "English cannot be disabled")
	}
	return s.store.SetLocaleEnabled(ctx, code, enabled)
}

func (s *Service) DeleteLocale(ctx context.Context, code string) error {
	code = strings.TrimSpace(code)
	if code == "en" {
		return httpx.E(http.StatusUnprocessableEntity, "VALIDATION", "English cannot be deleted")
	}
	return s.store.DeleteLocale(ctx, code)
}

func (s *Service) SetCalendarEnabled(ctx context.Context, id string, enabled bool) (Calendar, error) {
	id = strings.TrimSpace(id)
	if id == "gregorian" && !enabled {
		cals, err := s.store.ListCalendars(ctx, true)
		if err != nil {
			return Calendar{}, err
		}
		others := 0
		for _, c := range cals {
			if c.ID != "gregorian" && c.Enabled {
				others++
			}
		}
		if others == 0 {
			return Calendar{}, httpx.E(http.StatusUnprocessableEntity, "VALIDATION", "keep at least one calendar enabled")
		}
	}
	return s.store.SetCalendarEnabled(ctx, id, enabled)
}

// --- Public handlers ---

func (h *Handler) ListLocalesPublic(w http.ResponseWriter, r *http.Request) {
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	if code != "" {
		loc, err := h.svc.GetLocale(r.Context(), code)
		if err != nil {
			httpx.Error(w, err)
			return
		}
		if !loc.Enabled {
			httpx.Error(w, httpx.E(http.StatusNotFound, "NOT_FOUND", "locale not found"))
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"locale": loc})
		return
	}
	rows, err := h.svc.ListLocales(r.Context(), true)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"locales": rows})
}

func (h *Handler) ListCalendarsPublic(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.ListCalendars(r.Context(), true)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"calendars": rows})
}

// --- Admin handlers ---

func (h *Handler) ListLocalesAdmin(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.ListLocales(r.Context(), false)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"locales": rows})
}

func (h *Handler) UploadLocale(w http.ResponseWriter, r *http.Request) {
	var body PackUpload
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	loc, err := h.svc.UpsertFromUpload(r.Context(), body)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	keyCount := 0
	if loc.Messages != nil {
		var msgs map[string]string
		_ = json.Unmarshal(loc.Messages, &msgs)
		keyCount = len(msgs)
	}
	h.svc.emitAudit(r.Context(), auth.UserIDFrom(r.Context()).String(), "locale.upload", map[string]any{
		"code": loc.Code, "name": loc.Name, "keys": keyCount,
	})
	httpx.JSON(w, http.StatusOK, map[string]any{"locale": loc})
}

func (h *Handler) PatchLocale(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	var body struct {
		Enabled *bool `json:"enabled"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	if body.Enabled == nil {
		httpx.Error(w, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"enabled": "required",
		}))
		return
	}
	loc, err := h.svc.SetLocaleEnabled(r.Context(), code, *body.Enabled)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	h.svc.emitAudit(r.Context(), auth.UserIDFrom(r.Context()).String(), "locale.update", map[string]any{
		"code": loc.Code, "enabled": loc.Enabled,
	})
	httpx.JSON(w, http.StatusOK, map[string]any{"locale": loc})
}

func (h *Handler) DeleteLocale(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	if err := h.svc.DeleteLocale(r.Context(), code); err != nil {
		httpx.Error(w, err)
		return
	}
	h.svc.emitAudit(r.Context(), auth.UserIDFrom(r.Context()).String(), "locale.delete", map[string]any{
		"code": code,
	})
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) Catalog(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(h.svc.EnglishCatalog())
}

func (h *Handler) ListCalendarsAdmin(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.ListCalendars(r.Context(), false)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"calendars": rows})
}

func (h *Handler) PatchCalendar(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var body struct {
		Enabled *bool `json:"enabled"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	if body.Enabled == nil {
		httpx.Error(w, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"enabled": "required",
		}))
		return
	}
	cal, err := h.svc.SetCalendarEnabled(r.Context(), id, *body.Enabled)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	h.svc.emitAudit(r.Context(), auth.UserIDFrom(r.Context()).String(), "calendar.update", map[string]any{
		"id": cal.ID, "enabled": cal.Enabled,
	})
	httpx.JSON(w, http.StatusOK, map[string]any{"calendar": cal})
}
