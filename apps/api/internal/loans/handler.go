package loans

import (
	"net/http"
	"time"

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
	CounterpartyID      uuid.UUID  `json:"counterparty_id"`
	Role                string     `json:"role"`
	Principal           *string    `json:"principal"`
	CurrencyCode        *string    `json:"currency_code"`
	InterestRatePercent *string    `json:"interest_rate_percent"`
	DueAt               *time.Time `json:"due_at"`
	Note                *string    `json:"note"`
}

type termsBody struct {
	Principal           string    `json:"principal"`
	CurrencyCode        string    `json:"currency_code"`
	InterestRatePercent string    `json:"interest_rate_percent"`
	DueAt               time.Time `json:"due_at"`
	Note                *string   `json:"note"`
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var body createBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.Create(r.Context(), auth.UserIDFrom(r.Context()), CreateInput{
		CounterpartyID:      body.CounterpartyID,
		Role:                body.Role,
		Principal:           body.Principal,
		CurrencyCode:        body.CurrencyCode,
		InterestRatePercent: body.InterestRatePercent,
		DueAt:               body.DueAt,
		Note:                body.Note,
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"loan": out})
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.List(r.Context(), auth.UserIDFrom(r.Context()), ListQuery{
		Status:   r.URL.Query().Get("status"),
		Role:     r.URL.Query().Get("role"),
		Currency: r.URL.Query().Get("currency"),
		Filter:   r.URL.Query().Get("filter"),
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"loans": out})
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	h.withID(w, r, func(id uuid.UUID) (LoanDTO, error) {
		return h.svc.Get(r.Context(), auth.UserIDFrom(r.Context()), id)
	})
}

func (h *Handler) ProposeTerms(w http.ResponseWriter, r *http.Request) {
	id, err := parseLoanID(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var body termsBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.Propose(r.Context(), auth.UserIDFrom(r.Context()), id, TermsInput(body))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"loan": out})
}

func (h *Handler) Accept(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AcceptedDisclaimer bool `json:"accepted_disclaimer"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	h.withID(w, r, func(id uuid.UUID) (LoanDTO, error) {
		return h.svc.Accept(r.Context(), auth.UserIDFrom(r.Context()), id, body.AcceptedDisclaimer)
	})
}

func (h *Handler) Reject(w http.ResponseWriter, r *http.Request) {
	h.withID(w, r, func(id uuid.UUID) (LoanDTO, error) {
		return h.svc.Reject(r.Context(), auth.UserIDFrom(r.Context()), id)
	})
}

func (h *Handler) Cancel(w http.ResponseWriter, r *http.Request) {
	h.withID(w, r, func(id uuid.UUID) (LoanDTO, error) {
		return h.svc.Cancel(r.Context(), auth.UserIDFrom(r.Context()), id)
	})
}

func (h *Handler) withID(w http.ResponseWriter, r *http.Request, fn func(uuid.UUID) (LoanDTO, error)) {
	id, err := parseLoanID(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := fn(id)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"loan": out})
}

func parseLoanID(r *http.Request) (uuid.UUID, error) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		return uuid.Nil, httpx.E(http.StatusBadRequest, "MALFORMED_ID", "invalid loan id")
	}
	return id, nil
}
