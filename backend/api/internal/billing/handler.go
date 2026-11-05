package billing

import (
	"errors"
	"io"
	"log"
	"net/http"
	"strconv"

	"equilend/api/internal/auth"
	"equilend/api/internal/httpx"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Catalog lists tiers, their limits and the plans that can be bought.
func (h *Handler) Catalog(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, h.svc.Catalog(r.Context()))
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.Me(r.Context(), auth.UserIDFrom(r.Context()))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) Checkout(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Plan string `json:"plan"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	url, err := h.svc.Checkout(r.Context(), auth.UserIDFrom(r.Context()), body.Plan)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"url": url})
}

func (h *Handler) Portal(w http.ResponseWriter, r *http.Request) {
	url, err := h.svc.Portal(r.Context(), auth.UserIDFrom(r.Context()))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"url": url})
}

// PolarWebhook is public; the signature is the authentication.
func (h *Handler) PolarWebhook(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		httpx.Error(w, httpx.E(http.StatusBadRequest, "BAD_BODY", "could not read body"))
		return
	}
	if err := h.svc.HandleWebhook(r.Context(), r.Header, body); err != nil {
		if errors.Is(err, ErrBadSignature) {
			httpx.Error(w, httpx.E(http.StatusUnauthorized, "BAD_SIGNATURE", "invalid signature"))
			return
		}
		log.Printf("polar webhook %s failed: %v", r.Header.Get("webhook-id"), err)
		httpx.Error(w, httpx.E(http.StatusInternalServerError, "WEBHOOK_FAILED", "webhook processing failed"))
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

// ---------------------------------------------------------------- admin

func (h *Handler) AdminOverview(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.AdminOverview(r.Context())
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) AdminSubscriptions(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	out, err := h.svc.ListSubscriptions(r.Context(), r.URL.Query().Get("status"), limit)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	if out == nil {
		out = []Subscription{}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"subscriptions": out})
}

func (h *Handler) AdminUpdateSettings(w http.ResponseWriter, r *http.Request) {
	var body SettingsUpdate
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	if err := h.svc.UpdateSettings(r.Context(), auth.UserIDFrom(r.Context()), body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.AdminOverview(r.Context())
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, out)
}
