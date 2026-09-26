package accounts

import (
	"net/http"
	"strings"
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
	Name                string     `json:"name"`
	AccountType         string     `json:"account_type"`
	CurrencyCode        string     `json:"currency_code"`
	Balance             string     `json:"balance"`
	InterestRatePercent *string    `json:"interest_rate_percent"`
	Compounding         *string    `json:"compounding"`
	InstitutionLabel    *string    `json:"institution_label"`
	BankProfileID       *uuid.UUID `json:"bank_profile_id"`
}

type updateBody struct {
	Name                *string    `json:"name"`
	AccountType         *string    `json:"account_type"`
	CurrencyCode        *string    `json:"currency_code"`
	InterestRatePercent *string    `json:"interest_rate_percent"`
	Compounding         *string    `json:"compounding"`
	InstitutionLabel    *string    `json:"institution_label"`
	BankProfileID       *uuid.UUID `json:"bank_profile_id"`
	ClearInterest       bool       `json:"clear_interest"`
}

type balanceBody struct {
	Balance string  `json:"balance"`
	Note    *string `json:"note"`
}

type transferBody struct {
	FromAccountID uuid.UUID  `json:"from_account_id"`
	ToAccountID   uuid.UUID  `json:"to_account_id"`
	Amount        string     `json:"amount"`
	Note          *string    `json:"note"`
	OccurredAt    *time.Time `json:"occurred_at"`
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	include := strings.EqualFold(r.URL.Query().Get("include_archived"), "true") || r.URL.Query().Get("include_archived") == "1"
	out, err := h.svc.List(r.Context(), auth.UserIDFrom(r.Context()), include)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"accounts": out})
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
	httpx.JSON(w, http.StatusCreated, map[string]any{"account": out})
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.Get(r.Context(), auth.UserIDFrom(r.Context()), id)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"account": out})
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var body updateBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.Update(r.Context(), auth.UserIDFrom(r.Context()), id, UpdateInput(body))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"account": out})
}

func (h *Handler) SetBalance(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var body balanceBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.SetBalance(r.Context(), auth.UserIDFrom(r.Context()), id, SetBalanceInput(body))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"account": out})
}

func (h *Handler) Archive(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	if err := h.svc.Archive(r.Context(), auth.UserIDFrom(r.Context()), id); err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) ReconcileAll(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.ReconcileAll(r.Context(), auth.UserIDFrom(r.Context()))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"reconcile": out})
}

func (h *Handler) Reconcile(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.Reconcile(r.Context(), auth.UserIDFrom(r.Context()), id)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"reconcile": out})
}

func (h *Handler) Wealth(w http.ResponseWriter, r *http.Request) {
	preferred := r.URL.Query().Get("currency")
	out, err := h.svc.Wealth(r.Context(), auth.UserIDFrom(r.Context()), preferred)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"wealth": out})
}

func (h *Handler) Transfer(w http.ResponseWriter, r *http.Request) {
	var body transferBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.Transfer(r.Context(), auth.UserIDFrom(r.Context()), TransferInput{
		FromAccountID: body.FromAccountID,
		ToAccountID:   body.ToAccountID,
		Amount:        body.Amount,
		Note:          body.Note,
		OccurredAt:    body.OccurredAt,
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"transfer": out})
}

func parseID(r *http.Request) (uuid.UUID, error) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		return uuid.Nil, httpx.E(http.StatusBadRequest, "MALFORMED_ID", "invalid account id")
	}
	return id, nil
}
