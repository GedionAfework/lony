package insights

import (
	"net/http"
	"strconv"
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

func (h *Handler) Overview(w http.ResponseWriter, r *http.Request) {
	currency := strings.TrimSpace(r.URL.Query().Get("currency"))
	months := 1
	if raw := r.URL.Query().Get("months"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			months = n
		}
	}
	out, err := h.svc.Overview(r.Context(), auth.UserIDFrom(r.Context()), currency, months)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"overview": out})
}

func (h *Handler) CashflowSeries(w http.ResponseWriter, r *http.Request) {
	currency := strings.TrimSpace(r.URL.Query().Get("currency"))
	months := 6
	if raw := r.URL.Query().Get("months"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			months = n
		}
	}
	out, err := h.svc.CashflowSeries(r.Context(), auth.UserIDFrom(r.Context()), currency, months)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"series": out})
}

func (h *Handler) Categories(w http.ResponseWriter, r *http.Request) {
	currency := strings.TrimSpace(r.URL.Query().Get("currency"))
	months := 1
	if raw := r.URL.Query().Get("months"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			months = n
		}
	}
	out, err := h.svc.Categories(r.Context(), auth.UserIDFrom(r.Context()), currency, months)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"categories": out})
}

func (h *Handler) Debts(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.Debts(r.Context(), auth.UserIDFrom(r.Context()), r.URL.Query().Get("currency"))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"debts": out})
}

func (h *Handler) Goals(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.Goals(r.Context(), auth.UserIDFrom(r.Context()))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"goals": out})
}
