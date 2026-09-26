package ai

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

type coachBody struct {
	Message      string `json:"message"`
	CurrencyCode string `json:"currency_code"`
}

type reportBody struct {
	CurrencyCode string `json:"currency_code"`
	Months       int    `json:"months"`
}

func (h *Handler) ListInsights(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.ListInsights(r.Context(), auth.UserIDFrom(r.Context()))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"insights": out, "disclaimer": Disclaimer})
}

func (h *Handler) RefreshInsights(w http.ResponseWriter, r *http.Request) {
	currency := strings.TrimSpace(r.URL.Query().Get("currency"))
	if currency == "" {
		var body struct {
			CurrencyCode string `json:"currency_code"`
		}
		_ = httpx.Decode(r, &body)
		currency = body.CurrencyCode
	}
	out, err := h.svc.RefreshInsights(r.Context(), auth.UserIDFrom(r.Context()), currency)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"insights": out, "disclaimer": Disclaimer})
}

func (h *Handler) DismissInsight(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, httpx.E(http.StatusBadRequest, "MALFORMED_ID", "invalid insight id"))
		return
	}
	if err := h.svc.Dismiss(r.Context(), auth.UserIDFrom(r.Context()), id); err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) ClearHistory(w http.ResponseWriter, r *http.Request) {
	n, err := h.svc.ClearHistory(r.Context(), auth.UserIDFrom(r.Context()))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true, "dismissed": n, "disclaimer": Disclaimer})
}

func (h *Handler) Report(w http.ResponseWriter, r *http.Request) {
	var body reportBody
	_ = httpx.Decode(r, &body)
	currency := body.CurrencyCode
	if currency == "" {
		currency = r.URL.Query().Get("currency")
	}
	months := body.Months
	out, err := h.svc.Report(r.Context(), auth.UserIDFrom(r.Context()), currency, months)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"report": out})
}

func (h *Handler) Coach(w http.ResponseWriter, r *http.Request) {
	var body coachBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.Coach(r.Context(), auth.UserIDFrom(r.Context()), body.CurrencyCode, body.Message)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"coach": out})
}
