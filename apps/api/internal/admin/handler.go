package admin

import (
	"net/http"
	"strconv"
	"strings"

	"equilend/api/internal/auth"
	"equilend/api/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// RequireAdmin must run after auth.Middleware.
func RequireAdmin(svc *Service) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ok, err := svc.IsAdmin(r.Context(), auth.UserIDFrom(r.Context()))
			if err != nil {
				httpx.Error(w, err)
				return
			}
			if !ok {
				httpx.Error(w, httpx.E(http.StatusForbidden, "FORBIDDEN", "admin access required"))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func (h *Handler) Overview(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.Overview(r.Context())
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"overview": out})
}

func (h *Handler) ListUsers(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	if offset < 0 {
		offset = 0
	}
	rows, total, err := h.svc.ListUsers(r.Context(), r.URL.Query().Get("q"), r.URL.Query().Get("status"), limit, offset)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"users": rows, "total": total, "limit": limit, "offset": offset})
}

func (h *Handler) GetUser(w http.ResponseWriter, r *http.Request) {
	id, err := parseUserID(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.GetUser(r.Context(), id)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"user": out})
}

func (h *Handler) Suspend(w http.ResponseWriter, r *http.Request) {
	id, err := parseUserID(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.Suspend(r.Context(), auth.UserIDFrom(r.Context()), id)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"user": out})
}

func (h *Handler) Unsuspend(w http.ResponseWriter, r *http.Request) {
	id, err := parseUserID(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.Unsuspend(r.Context(), auth.UserIDFrom(r.Context()), id)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"user": out})
}

func (h *Handler) ListAudit(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	out, err := h.svc.ListAudit(r.Context(), limit)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"audit": out})
}

func (h *Handler) GetSettings(w http.ResponseWriter, r *http.Request) {
	off, err := h.svc.AIDisabled(r.Context())
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"settings": map[string]any{"ai_disabled": off}})
}

func (h *Handler) SetAIDisabled(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Disabled bool `json:"ai_disabled"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	off, err := h.svc.SetAIDisabled(r.Context(), auth.UserIDFrom(r.Context()), body.Disabled)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"settings": map[string]any{"ai_disabled": off}})
}

func (h *Handler) ListCatalogTypes(w http.ResponseWriter, r *http.Request) {
	activeOnly := r.URL.Query().Get("all") != "1"
	rows, err := h.svc.ListCatalogTypes(r.Context(), r.URL.Query().Get("kind"), activeOnly)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"types": rows})
}

func (h *Handler) ListCatalogTypesAdmin(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.ListCatalogTypes(r.Context(), r.URL.Query().Get("kind"), false)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"types": rows})
}

func (h *Handler) CreateCatalogType(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Kind      string `json:"kind"`
		Code      string `json:"code"`
		Label     string `json:"label"`
		SortOrder int    `json:"sort_order"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.CreateCatalogType(r.Context(), auth.UserIDFrom(r.Context()), body.Kind, body.Code, body.Label, body.SortOrder)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"type": out})
}

func (h *Handler) UpdateCatalogType(w http.ResponseWriter, r *http.Request) {
	id, err := parseCatalogID(r, "typeID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var body struct {
		Label     *string `json:"label"`
		SortOrder *int    `json:"sort_order"`
		Active    *bool   `json:"active"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.UpdateCatalogType(r.Context(), auth.UserIDFrom(r.Context()), id, body.Label, body.SortOrder, body.Active)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"type": out})
}

func (h *Handler) ListCatalogInstitutions(w http.ResponseWriter, r *http.Request) {
	activeOnly := r.URL.Query().Get("all") != "1"
	rows, err := h.svc.ListCatalogInstitutions(r.Context(), r.URL.Query().Get("type_kind"), r.URL.Query().Get("type_code"), activeOnly)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"institutions": rows})
}

func (h *Handler) ListCatalogInstitutionsAdmin(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.ListCatalogInstitutions(r.Context(), r.URL.Query().Get("type_kind"), r.URL.Query().Get("type_code"), false)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"institutions": rows})
}

func (h *Handler) CreateCatalogInstitution(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Code        string  `json:"code"`
		Label       string  `json:"label"`
		TypeKind    string  `json:"type_kind"`
		TypeCode    string  `json:"type_code"`
		CountryCode *string `json:"country_code"`
		SortOrder   int     `json:"sort_order"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.CreateCatalogInstitution(
		r.Context(),
		auth.UserIDFrom(r.Context()),
		body.Code,
		body.Label,
		body.TypeKind,
		body.TypeCode,
		body.CountryCode,
		body.SortOrder,
	)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"institution": out})
}

func (h *Handler) UpdateCatalogInstitution(w http.ResponseWriter, r *http.Request) {
	id, err := parseCatalogID(r, "institutionID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var body struct {
		Label       *string `json:"label"`
		TypeKind    *string `json:"type_kind"`
		TypeCode    *string `json:"type_code"`
		CountryCode *string `json:"country_code"`
		SortOrder   *int    `json:"sort_order"`
		Active      *bool   `json:"active"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.UpdateCatalogInstitution(
		r.Context(),
		auth.UserIDFrom(r.Context()),
		id,
		body.Label,
		body.TypeKind,
		body.TypeCode,
		body.CountryCode,
		body.SortOrder,
		body.Active,
	)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"institution": out})
}

func parseCatalogID(r *http.Request, param string) (uuid.UUID, error) {
	id, err := uuid.Parse(strings.TrimSpace(chi.URLParam(r, param)))
	if err != nil {
		return uuid.Nil, httpx.E(http.StatusBadRequest, "MALFORMED_ID", "invalid id")
	}
	return id, nil
}

func parseUserID(r *http.Request) (uuid.UUID, error) {
	id, err := uuid.Parse(strings.TrimSpace(chi.URLParam(r, "userID")))
	if err != nil {
		return uuid.Nil, httpx.E(http.StatusBadRequest, "MALFORMED_ID", "invalid user id")
	}
	return id, nil
}
