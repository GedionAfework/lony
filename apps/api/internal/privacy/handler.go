package privacy

import (
	"net/http"
	"strings"

	"equilend/api/internal/auth"
	"equilend/api/internal/httpx"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) Export(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFrom(r.Context())
	format := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("format")))
	if format == "json" {
		bundle, err := h.svc.ExportJSON(r.Context(), userID)
		if err != nil {
			httpx.Error(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"export": bundle})
		return
	}
	raw, err := h.svc.ExportZip(r.Context(), userID)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="`+Filename(userID)+`"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(raw)
}

func (h *Handler) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Confirm string `json:"confirm"`
	}
	_ = httpx.Decode(r, &body)
	if !strings.EqualFold(strings.TrimSpace(body.Confirm), "DELETE") {
		httpx.Error(w, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"confirm": "type DELETE to confirm account deletion",
		}))
		return
	}
	if err := h.svc.DeleteAccount(r.Context(), auth.UserIDFrom(r.Context())); err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true, "status": "deleted"})
}
