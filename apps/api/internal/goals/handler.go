package goals

import (
	"net/http"
	"strings"

	"equilend/api/internal/auth"
	"equilend/api/internal/httpx"
	"equilend/api/internal/media"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type Handler struct {
	svc       *Service
	disk      *media.DiskStore
	mediaRepo MediaRepo
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// MediaRepo is defined in cover.go

type createBody struct {
	Title           string     `json:"title"`
	GoalType        string     `json:"goal_type"`
	CurrencyCode    string     `json:"currency_code"`
	TargetAmount    string     `json:"target_amount"`
	CurrentAmount   *string    `json:"current_amount"`
	TargetDate      *string    `json:"target_date"`
	LinkedAccountID *uuid.UUID `json:"linked_account_id"`
	LinkedLoanID    *uuid.UUID `json:"linked_loan_id"`
	Note            *string    `json:"note"`
	TypeLabel       *string    `json:"type_label"`
}

type updateBody struct {
	Title           *string    `json:"title"`
	GoalType        *string    `json:"goal_type"`
	CurrencyCode    *string    `json:"currency_code"`
	TargetAmount    *string    `json:"target_amount"`
	TargetDate      *string    `json:"target_date"`
	ClearTargetDate bool       `json:"clear_target_date"`
	LinkedAccountID *uuid.UUID `json:"linked_account_id"`
	ClearAccount    bool       `json:"clear_account"`
	LinkedLoanID    *uuid.UUID `json:"linked_loan_id"`
	ClearLoan       bool       `json:"clear_loan"`
	Note            *string    `json:"note"`
	TypeLabel       *string    `json:"type_label"`
	Status          *string    `json:"status"`
}

type contributeBody struct {
	Amount       string     `json:"amount"`
	AccountID    *uuid.UUID `json:"account_id"`
	Note         *string    `json:"note"`
	DebitAccount *bool      `json:"debit_account"`
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	include := strings.EqualFold(r.URL.Query().Get("include_archived"), "true") || r.URL.Query().Get("include_archived") == "1"
	out, err := h.svc.List(r.Context(), auth.UserIDFrom(r.Context()), include)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"goals": out})
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
	httpx.JSON(w, http.StatusCreated, map[string]any{"goal": out})
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
	httpx.JSON(w, http.StatusOK, map[string]any{"goal": out})
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
	httpx.JSON(w, http.StatusOK, map[string]any{"goal": out})
}

func (h *Handler) Contribute(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var body contributeBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	debit := true
	if body.DebitAccount != nil {
		debit = *body.DebitAccount
	}
	goal, contrib, err := h.svc.Contribute(r.Context(), auth.UserIDFrom(r.Context()), id, ContributeInput{
		Amount:       body.Amount,
		AccountID:    body.AccountID,
		Note:         body.Note,
		DebitAccount: debit,
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"goal": goal, "contribution": contrib})
}

func (h *Handler) ListContributions(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.ListContributions(r.Context(), auth.UserIDFrom(r.Context()), id)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"contributions": out})
}

func (h *Handler) Projection(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.Projection(r.Context(), auth.UserIDFrom(r.Context()), id)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"projection": out})
}

func parseID(r *http.Request) (uuid.UUID, error) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		return uuid.Nil, httpx.E(http.StatusBadRequest, "MALFORMED_ID", "invalid goal id")
	}
	return id, nil
}
