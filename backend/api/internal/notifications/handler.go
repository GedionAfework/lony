package notifications

import (
	"net/http"
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

type deviceBody struct {
	Platform string `json:"platform"`
	Token    string `json:"token"`
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	unread := r.URL.Query().Get("unread") == "1" || strings.EqualFold(r.URL.Query().Get("unread"), "true")
	out, err := h.svc.List(r.Context(), auth.UserIDFrom(r.Context()), unread)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	count, err := h.svc.UnreadCount(r.Context(), auth.UserIDFrom(r.Context()))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"notifications": out, "unread_count": count})
}

func (h *Handler) MarkRead(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, httpx.E(http.StatusBadRequest, "MALFORMED_ID", "invalid id"))
		return
	}
	out, err := h.svc.MarkRead(r.Context(), auth.UserIDFrom(r.Context()), id)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"notification": out})
}

func (h *Handler) MarkAllRead(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.MarkAllRead(r.Context(), auth.UserIDFrom(r.Context())); err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) RegisterDevice(w http.ResponseWriter, r *http.Request) {
	var body deviceBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.RegisterDevice(r.Context(), auth.UserIDFrom(r.Context()), body.Platform, body.Token)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"device_token": out})
}
