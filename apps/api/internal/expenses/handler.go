package expenses

import (
	"net/http"
	"strconv"
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
	Kind         string     `json:"kind"`
	Title        string     `json:"title"`
	Amount       string     `json:"amount"`
	CurrencyCode string     `json:"currency_code"`
	Category     string     `json:"category"`
	CategoryID   *uuid.UUID `json:"category_id"`
	AccountID    *uuid.UUID `json:"account_id"`
	Note         *string    `json:"note"`
	OccurredAt   *time.Time `json:"occurred_at"`
	Recurrence   *string    `json:"recurrence"`
	IsTemplate   bool       `json:"is_template"`
}

type updateBody struct {
	Title        *string    `json:"title"`
	Amount       *string    `json:"amount"`
	CurrencyCode *string    `json:"currency_code"`
	Category     *string    `json:"category"`
	CategoryID   *uuid.UUID `json:"category_id"`
	AccountID    *uuid.UUID `json:"account_id"`
	Note         *string    `json:"note"`
	OccurredAt   *time.Time `json:"occurred_at"`
	Recurrence   *string    `json:"recurrence"`
}

type shareBody struct {
	FriendID     uuid.UUID  `json:"friend_id"`
	SharePercent *float64   `json:"share_percent"`
	ShareAmount  *string    `json:"share_amount"`
	DueAt        *time.Time `json:"due_at"`
}

type receiveBody struct {
	AccountID *uuid.UUID `json:"account_id"`
}

type categoryBody struct {
	Kind string `json:"kind"`
	Name string `json:"name"`
}

type budgetBody struct {
	CategoryID   *uuid.UUID `json:"category_id"`
	CategoryName string     `json:"category_name"`
	CurrencyCode string     `json:"currency_code"`
	LimitAmount  string     `json:"limit_amount"`
	PeriodMonth  string     `json:"period_month"`
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	q := ListQuery{
		Kind:     r.URL.Query().Get("kind"),
		Currency: r.URL.Query().Get("currency"),
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			q.Limit = n
		}
	}
	if v := strings.TrimSpace(r.URL.Query().Get("templates")); v != "" {
		b := v == "1" || strings.EqualFold(v, "true")
		q.Templates = &b
	}
	from, err := parseTime(r.URL.Query().Get("from"))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	q.From = from
	to, err := parseTime(r.URL.Query().Get("to"))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	q.To = to
	out, err := h.svc.List(r.Context(), auth.UserIDFrom(r.Context()), q)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"entries": out})
}

func (h *Handler) Summary(w http.ResponseWriter, r *http.Request) {
	from, err := parseTime(r.URL.Query().Get("from"))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	to, err := parseTime(r.URL.Query().Get("to"))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.Summary(r.Context(), auth.UserIDFrom(r.Context()), from, to)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"summary": out})
}

func (h *Handler) CategoryBreakdown(w http.ResponseWriter, r *http.Request) {
	from, err := parseTime(r.URL.Query().Get("from"))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	to, err := parseTime(r.URL.Query().Get("to"))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.CategoryBreakdown(r.Context(), auth.UserIDFrom(r.Context()), r.URL.Query().Get("kind"), from, to)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"breakdown": out})
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var body createBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	occurred := time.Time{}
	if body.OccurredAt != nil {
		occurred = *body.OccurredAt
	}
	out, err := h.svc.Create(r.Context(), auth.UserIDFrom(r.Context()), CreateInput{
		Kind:         body.Kind,
		Title:        body.Title,
		Amount:       body.Amount,
		CurrencyCode: body.CurrencyCode,
		Category:     body.Category,
		CategoryID:   body.CategoryID,
		AccountID:    body.AccountID,
		Note:         body.Note,
		OccurredAt:   occurred,
		Recurrence:   body.Recurrence,
		IsTemplate:   body.IsTemplate,
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"entry": out})
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := parseEntryID(r)
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
	httpx.JSON(w, http.StatusOK, map[string]any{"entry": out})
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := parseEntryID(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	if err := h.svc.Delete(r.Context(), auth.UserIDFrom(r.Context()), id); err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) Share(w http.ResponseWriter, r *http.Request) {
	id, err := parseEntryID(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var body shareBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	entry, loan, err := h.svc.Share(r.Context(), auth.UserIDFrom(r.Context()), id, ShareInput(body))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"entry": entry, "loan": loan})
}

func (h *Handler) Receive(w http.ResponseWriter, r *http.Request) {
	id, err := parseEntryID(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var body receiveBody
	_ = httpx.Decode(r, &body) // optional body
	out, err := h.svc.Receive(r.Context(), auth.UserIDFrom(r.Context()), id, body.AccountID)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"entry": out})
}

func (h *Handler) ListCategories(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.ListCategories(r.Context(), auth.UserIDFrom(r.Context()), r.URL.Query().Get("kind"))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"categories": out})
}

func (h *Handler) CreateCategory(w http.ResponseWriter, r *http.Request) {
	var body categoryBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.CreateCategory(r.Context(), auth.UserIDFrom(r.Context()), body.Kind, body.Name)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"category": out})
}

func (h *Handler) ListBudgets(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.ListBudgets(r.Context(), auth.UserIDFrom(r.Context()), r.URL.Query().Get("period"))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"budgets": out})
}

func (h *Handler) UpsertBudget(w http.ResponseWriter, r *http.Request) {
	var body budgetBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.UpsertBudget(r.Context(), auth.UserIDFrom(r.Context()), BudgetInput{
		CategoryID:   body.CategoryID,
		CategoryName: body.CategoryName,
		CurrencyCode: body.CurrencyCode,
		LimitAmount:  body.LimitAmount,
		PeriodMonth:  body.PeriodMonth,
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"budget": out})
}

func (h *Handler) DeleteBudget(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, httpx.E(http.StatusBadRequest, "MALFORMED_ID", "invalid budget id"))
		return
	}
	if err := h.svc.DeleteBudget(r.Context(), auth.UserIDFrom(r.Context()), id); err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func parseEntryID(r *http.Request) (uuid.UUID, error) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		return uuid.Nil, httpx.E(http.StatusBadRequest, "MALFORMED_ID", "invalid entry id")
	}
	return id, nil
}

func parseTime(raw string) (*time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		u := t.UTC()
		return &u, nil
	}
	if t, err := time.Parse("2006-01-02", raw); err == nil {
		u := t.UTC()
		return &u, nil
	}
	return nil, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
		"time": "must be YYYY-MM-DD or RFC3339",
	})
}
