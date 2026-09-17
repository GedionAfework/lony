package banks

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

type createBody struct {
	Type            string  `json:"profile_type"`
	Label           string  `json:"label"`
	InstitutionName *string `json:"institution_name"`
	Identifier      string  `json:"account_identifier"`
	CurrencyCode    *string `json:"currency_code"`
	IsPreferred     bool    `json:"is_preferred"`
}

type patchBody struct {
	Type            *string `json:"profile_type"`
	Label           *string `json:"label"`
	InstitutionName *string `json:"institution_name"`
	Identifier      *string `json:"account_identifier"`
	CurrencyCode    *string `json:"currency_code"`
}

type shareBody struct {
	RecipientID uuid.UUID  `json:"recipient_id"`
	LoanID      *uuid.UUID `json:"loan_id"`
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	include := strings.EqualFold(r.URL.Query().Get("include_archived"), "true") || r.URL.Query().Get("include_archived") == "1"
	out, err := h.svc.List(r.Context(), auth.UserIDFrom(r.Context()), include)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"bank_profiles": out})
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var body createBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.Create(r.Context(), auth.UserIDFrom(r.Context()), CreateInput(body))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"bank_profile": out})
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r, "id")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	if wantsReveal(r) {
		out, err := h.svc.Reveal(r.Context(), auth.UserIDFrom(r.Context()), id, auth.IssuedAtFrom(r.Context()))
		if err != nil {
			httpx.Error(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"bank_profile": out})
		return
	}
	out, err := h.svc.Get(r.Context(), auth.UserIDFrom(r.Context()), id)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"bank_profile": out})
}

func (h *Handler) Patch(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r, "id")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var body patchBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.Patch(r.Context(), auth.UserIDFrom(r.Context()), id, PatchInput(body))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"bank_profile": out})
}

func (h *Handler) Archive(w http.ResponseWriter, r *http.Request) {
	h.withProfile(w, r, func(id uuid.UUID) (ProfileDTO, error) {
		return h.svc.Archive(r.Context(), auth.UserIDFrom(r.Context()), id)
	})
}

func (h *Handler) Preferred(w http.ResponseWriter, r *http.Request) {
	h.withProfile(w, r, func(id uuid.UUID) (ProfileDTO, error) {
		return h.svc.SetPreferred(r.Context(), auth.UserIDFrom(r.Context()), id)
	})
}

func (h *Handler) Share(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r, "id")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var body shareBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.Share(r.Context(), auth.UserIDFrom(r.Context()), id, ShareInput(body))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"share": out})
}

func (h *Handler) Events(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r, "id")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.Events(r.Context(), auth.UserIDFrom(r.Context()), id)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"events": out})
}

func (h *Handler) ListShares(w http.ResponseWriter, r *http.Request) {
	incoming := strings.EqualFold(r.URL.Query().Get("direction"), "incoming")
	out, err := h.svc.ListShares(r.Context(), auth.UserIDFrom(r.Context()), incoming)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"shares": out})
}

func (h *Handler) Revoke(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r, "id")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.Revoke(r.Context(), auth.UserIDFrom(r.Context()), id)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"share": out})
}

func (h *Handler) LoanPaymentProfile(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r, "id")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.LoanPaymentProfile(r.Context(), auth.UserIDFrom(r.Context()), id, wantsReveal(r), auth.IssuedAtFrom(r.Context()))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"bank_profile": out})
}

func (h *Handler) withProfile(w http.ResponseWriter, r *http.Request, fn func(uuid.UUID) (ProfileDTO, error)) {
	id, err := parseID(r, "id")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := fn(id)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"bank_profile": out})
}

func parseID(r *http.Request, name string) (uuid.UUID, error) {
	id, err := uuid.Parse(chi.URLParam(r, name))
	if err != nil {
		return uuid.Nil, httpx.E(http.StatusBadRequest, "MALFORMED_ID", "invalid id")
	}
	return id, nil
}

func wantsReveal(r *http.Request) bool {
	v := r.URL.Query().Get("reveal")
	return v == "1" || strings.EqualFold(v, "true")
}
