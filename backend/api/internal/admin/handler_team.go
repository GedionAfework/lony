package admin

import (
	"net/http"
	"strings"

	"equilend/api/internal/auth"
	"equilend/api/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// RequireAnyPerm passes when the caller holds at least one of the codes.
func RequireAnyPerm(svc *Service, codes ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			uid := auth.UserIDFrom(r.Context())
			for _, code := range codes {
				ok, err := svc.HasPermission(r.Context(), uid, code)
				if err != nil {
					httpx.Error(w, err)
					return
				}
				if ok {
					next.ServeHTTP(w, r)
					return
				}
			}
			httpx.Error(w, httpx.E(http.StatusForbidden, "FORBIDDEN", "missing permission: "+strings.Join(codes, " or ")))
		})
	}
}

func (h *Handler) ListAdmins(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.ListAdmins(r.Context())
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"admins": out})
}

func (h *Handler) SetAdminAccess(w http.ResponseWriter, r *http.Request) {
	id, err := parseUserID(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var body struct {
		Admin  bool       `json:"admin"`
		RoleID *uuid.UUID `json:"role_id"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.SetAdminAccess(r.Context(), auth.UserIDFrom(r.Context()), id, body.Admin, body.RoleID)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"user": out})
}

func (h *Handler) RevokeSessions(w http.ResponseWriter, r *http.Request) {
	id, err := parseUserID(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.RevokeSessions(r.Context(), auth.UserIDFrom(r.Context()), id)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"user": out})
}

func (h *Handler) DeleteRole(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(strings.TrimSpace(chi.URLParam(r, "roleID")))
	if err != nil {
		httpx.Error(w, httpx.E(http.StatusBadRequest, "MALFORMED_ID", "invalid role id"))
		return
	}
	if err := h.svc.DeleteRole(r.Context(), auth.UserIDFrom(r.Context()), id); err != nil {
		httpx.Error(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) GetControls(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.Controls(r.Context())
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"controls": out})
}

func (h *Handler) SetControls(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Values map[string]string `json:"values"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	if _, ok := body.Values["ai_disabled"]; ok {
		httpx.Error(w, httpx.E(http.StatusUnprocessableEntity, "VALIDATION", "use /admin/settings/ai for the AI switch"))
		return
	}
	out, err := h.svc.SetControls(r.Context(), auth.UserIDFrom(r.Context()), body.Values)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"controls": out})
}

func (h *Handler) System(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.System(r.Context())
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"system": out})
}

func (h *Handler) RetryFailedJobs(w http.ResponseWriter, r *http.Request) {
	n, err := h.svc.RetryFailedJobs(r.Context(), auth.UserIDFrom(r.Context()))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"retried": n})
}
