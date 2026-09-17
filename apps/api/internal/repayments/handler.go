package repayments

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

type claimBody struct {
	Amount *string `json:"amount"`
	Note   *string `json:"note"`
}

type rejectBody struct {
	Reason string `json:"reason"`
}

func (h *Handler) Claim(w http.ResponseWriter, r *http.Request) {
	loanID, err := parseID(r, "id")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var body claimBody
	if r.Body != nil && r.ContentLength != 0 {
		if err := httpx.Decode(r, &body); err != nil {
			httpx.Error(w, err)
			return
		}
	}
	out, err := h.svc.Claim(r.Context(), auth.UserIDFrom(r.Context()), loanID, ClaimInput(body))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"repayment": out})
}

func (h *Handler) ListForLoan(w http.ResponseWriter, r *http.Request) {
	loanID, err := parseID(r, "id")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.ListForLoan(r.Context(), auth.UserIDFrom(r.Context()), loanID)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"repayments": out})
}

func (h *Handler) Confirm(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r, "id")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.Confirm(r.Context(), auth.UserIDFrom(r.Context()), id)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"repayment": out})
}

func (h *Handler) Reject(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r, "id")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var body rejectBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.Reject(r.Context(), auth.UserIDFrom(r.Context()), id, RejectInput(body))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"repayment": out})
}

func parseID(r *http.Request, name string) (uuid.UUID, error) {
	id, err := uuid.Parse(chi.URLParam(r, name))
	if err != nil {
		return uuid.Nil, httpx.E(http.StatusBadRequest, "MALFORMED_ID", "invalid id")
	}
	return id, nil
}
