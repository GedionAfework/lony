package score

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

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	currency := strings.TrimSpace(r.URL.Query().Get("currency"))
	refresh := r.URL.Query().Get("refresh") == "1" || strings.EqualFold(r.URL.Query().Get("refresh"), "true")
	out, err := h.svc.Get(r.Context(), auth.UserIDFrom(r.Context()), currency, refresh)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"score": out})
}

func (h *Handler) History(w http.ResponseWriter, r *http.Request) {
	limit := 12
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			limit = n
		}
	}
	out, err := h.svc.History(r.Context(), auth.UserIDFrom(r.Context()), limit)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"scores": out})
}

func (h *Handler) PeerTrust(w http.ResponseWriter, r *http.Request) {
	peerID, err := uuid.Parse(strings.TrimSpace(chi.URLParam(r, "userID")))
	if err != nil {
		httpx.Error(w, httpx.E(http.StatusBadRequest, "MALFORMED_ID", "invalid user id"))
		return
	}
	out, err := h.svc.PeerTrust(r.Context(), auth.UserIDFrom(r.Context()), peerID)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"trust": out})
}
