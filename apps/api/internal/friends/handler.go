package friends

import (
	"net/http"

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

type requestBody struct {
	Email    string     `json:"email"`
	Username string     `json:"username"`
	UserID   *uuid.UUID `json:"user_id"`
}

func (h *Handler) Search(w http.ResponseWriter, r *http.Request) {
	hits, err := h.svc.Search(r.Context(), auth.UserIDFrom(r.Context()), r.URL.Query().Get("q"))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"users": hits})
}

func (h *Handler) Request(w http.ResponseWriter, r *http.Request) {
	var body requestBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.Request(r.Context(), auth.UserIDFrom(r.Context()), body.Email, body.Username, body.UserID)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"friendship": out})
}

func (h *Handler) ListFriends(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.ListFriends(r.Context(), auth.UserIDFrom(r.Context()))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"friends": out})
}

func (h *Handler) ListIncoming(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.ListIncoming(r.Context(), auth.UserIDFrom(r.Context()))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"requests": out})
}

func (h *Handler) ListOutgoing(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.ListOutgoing(r.Context(), auth.UserIDFrom(r.Context()))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"requests": out})
}

func (h *Handler) Accept(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.Accept(r.Context(), auth.UserIDFrom(r.Context()), id)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"friendship": out})
}

func (h *Handler) Reject(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.Reject(r.Context(), auth.UserIDFrom(r.Context()), id)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"friendship": out})
}

func (h *Handler) Remove(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.Remove(r.Context(), auth.UserIDFrom(r.Context()), id)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"friendship": out})
}

func (h *Handler) Block(w http.ResponseWriter, r *http.Request) {
	raw := chi.URLParam(r, "userID")
	id, err := uuid.Parse(raw)
	if err != nil {
		httpx.Error(w, httpx.E(http.StatusBadRequest, "MALFORMED_ID", "invalid user id"))
		return
	}
	out, err := h.svc.Block(r.Context(), auth.UserIDFrom(r.Context()), id)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"friendship": out})
}

func parseID(r *http.Request) (uuid.UUID, error) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		return uuid.Nil, httpx.E(http.StatusBadRequest, "MALFORMED_ID", "invalid friendship id")
	}
	return id, nil
}
