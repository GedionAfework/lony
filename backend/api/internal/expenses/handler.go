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
	"github.com/shopspring/decimal"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

type createBody struct {
	Kind         string          `json:"kind"`
	Title        string          `json:"title"`
	Amount       string          `json:"amount"`
	CurrencyCode string          `json:"currency_code"`
	Category     string          `json:"category"`
	CategoryID   *uuid.UUID      `json:"category_id"`
	AccountID    *uuid.UUID      `json:"account_id"`
	Note         *string         `json:"note"`
	OccurredAt   *time.Time      `json:"occurred_at"`
	Recurrence   *string         `json:"recurrence"`
	IsTemplate   bool            `json:"is_template"`
	Legs         []createLegBody `json:"legs"`
	TripID       *uuid.UUID      `json:"trip_id"`
}

type createLegBody struct {
	Amount     string     `json:"amount"`
	Title      string     `json:"title"`
	Category   string     `json:"category"`
	CategoryID *uuid.UUID `json:"category_id"`
	AccountID  *uuid.UUID `json:"account_id"`
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
	TripID       *uuid.UUID `json:"trip_id"`
	ClearTrip    bool       `json:"clear_trip"`
}

type shareBody struct {
	FriendID     uuid.UUID  `json:"friend_id"`
	SharePercent *float64   `json:"share_percent"`
	ShareAmount  *string    `json:"share_amount"`
	DueAt        *time.Time `json:"due_at"`
}

type receiveBody struct {
	AccountID *uuid.UUID `json:"account_id"`
	Amount    *string    `json:"amount"`
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

func (h *Handler) Calendar(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.Calendar(
		r.Context(),
		auth.UserIDFrom(r.Context()),
		r.URL.Query().Get("from"),
		r.URL.Query().Get("to"),
		r.URL.Query().Get("currency"),
		r.URL.Query().Get("tz"),
	)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"calendar": out})
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
	legs := make([]SplitLegInput, 0, len(body.Legs))
	for _, leg := range body.Legs {
		legs = append(legs, SplitLegInput{
			Amount:     leg.Amount,
			Title:      leg.Title,
			Category:   leg.Category,
			CategoryID: leg.CategoryID,
			AccountID:  leg.AccountID,
		})
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
		Legs:         legs,
		TripID:       body.TripID,
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
	var amountOverride *decimal.Decimal
	if body.Amount != nil {
		raw := strings.TrimSpace(strings.ReplaceAll(*body.Amount, ",", ""))
		if raw != "" {
			d, err := decimal.NewFromString(raw)
			if err != nil || !d.GreaterThan(decimal.Zero) {
				httpx.Error(w, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
					"amount": "must be a positive number",
				}))
				return
			}
			d = d.Round(Scale)
			amountOverride = &d
		}
	}
	out, err := h.svc.Receive(r.Context(), auth.UserIDFrom(r.Context()), id, body.AccountID, amountOverride)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"entry": out})
}

func (h *Handler) ListBills(w http.ResponseWriter, r *http.Request) {
	days := 60
	if raw := strings.TrimSpace(r.URL.Query().Get("days")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			days = n
		}
	}
	out, err := h.svc.ListBills(r.Context(), auth.UserIDFrom(r.Context()), days)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"bills": out})
}

type postponeBody struct {
	Days int `json:"days"`
}

func (h *Handler) Skip(w http.ResponseWriter, r *http.Request) {
	id, err := parseEntryID(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.Skip(r.Context(), auth.UserIDFrom(r.Context()), id)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"bill": out})
}

func (h *Handler) Postpone(w http.ResponseWriter, r *http.Request) {
	id, err := parseEntryID(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var body postponeBody
	_ = httpx.Decode(r, &body)
	out, err := h.svc.Postpone(r.Context(), auth.UserIDFrom(r.Context()), id, body.Days)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"bill": out})
}

func (h *Handler) Pause(w http.ResponseWriter, r *http.Request) {
	h.setPaused(w, r, true)
}

func (h *Handler) Resume(w http.ResponseWriter, r *http.Request) {
	h.setPaused(w, r, false)
}

func (h *Handler) setPaused(w http.ResponseWriter, r *http.Request, paused bool) {
	id, err := parseEntryID(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.SetPaused(r.Context(), auth.UserIDFrom(r.Context()), id, paused)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"bill": out})
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
	out, payday, err := h.svc.ListBudgets(r.Context(), auth.UserIDFrom(r.Context()), r.URL.Query().Get("period"))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"budgets": out, "payday": payday})
}

type paydayBody struct {
	PaydayDay    *int    `json:"payday_day"`
	SpendLimit   *string `json:"spend_limit"`
	CurrencyCode *string `json:"currency_code"`
	ClearLimit   bool    `json:"clear_limit"`
}

func (h *Handler) UpsertPayday(w http.ResponseWriter, r *http.Request) {
	var body paydayBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.UpsertPayday(r.Context(), auth.UserIDFrom(r.Context()), PaydayInput{
		PaydayDay:    body.PaydayDay,
		SpendLimit:   body.SpendLimit,
		CurrencyCode: body.CurrencyCode,
		ClearLimit:   body.ClearLimit,
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"payday": out})
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

type tripBody struct {
	Title        string  `json:"title"`
	CurrencyCode string  `json:"currency_code"`
	LimitAmount  string  `json:"limit_amount"`
	StartsOn     string  `json:"starts_on"`
	EndsOn       string  `json:"ends_on"`
	Note         *string `json:"note"`
}

func (h *Handler) ListTrips(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.ListTrips(r.Context(), auth.UserIDFrom(r.Context()))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"trips": out})
}

func (h *Handler) CreateTrip(w http.ResponseWriter, r *http.Request) {
	var body tripBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.CreateTrip(r.Context(), auth.UserIDFrom(r.Context()), TripInput{
		Title:        body.Title,
		CurrencyCode: body.CurrencyCode,
		LimitAmount:  body.LimitAmount,
		StartsOn:     body.StartsOn,
		EndsOn:       body.EndsOn,
		Note:         body.Note,
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"trip": out})
}

func (h *Handler) UpdateTrip(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, httpx.E(http.StatusBadRequest, "MALFORMED_ID", "invalid trip id"))
		return
	}
	var body tripBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.UpdateTrip(r.Context(), auth.UserIDFrom(r.Context()), id, TripInput{
		Title:        body.Title,
		CurrencyCode: body.CurrencyCode,
		LimitAmount:  body.LimitAmount,
		StartsOn:     body.StartsOn,
		EndsOn:       body.EndsOn,
		Note:         body.Note,
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"trip": out})
}

func (h *Handler) DeleteTrip(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, httpx.E(http.StatusBadRequest, "MALFORMED_ID", "invalid trip id"))
		return
	}
	if err := h.svc.DeleteTrip(r.Context(), auth.UserIDFrom(r.Context()), id); err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
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

type smsIngestBody struct {
	Text          string     `json:"text"`
	AccountID     *uuid.UUID `json:"account_id"`
	Create        bool       `json:"create"`
	Kind          string     `json:"kind"`
	Amount        string     `json:"amount"`
	CurrencyCode  string     `json:"currency_code"`
	AccountLast4  string     `json:"account_last4"`
	Counterparty  string     `json:"counterparty"`
	Title         string     `json:"title"`
	Note          string     `json:"note"`
	StatedBalance string     `json:"stated_balance"`
	OccurredAt    *time.Time `json:"occurred_at"`
}

func (h *Handler) IngestSMS(w http.ResponseWriter, r *http.Request) {
	var body smsIngestBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.IngestSMS(r.Context(), auth.UserIDFrom(r.Context()), SMSIngestInput{
		Text:          body.Text,
		AccountID:     body.AccountID,
		Create:        body.Create,
		Kind:          body.Kind,
		Amount:        body.Amount,
		CurrencyCode:  body.CurrencyCode,
		AccountLast4:  body.AccountLast4,
		Counterparty:  body.Counterparty,
		Title:         body.Title,
		Note:          body.Note,
		StatedBalance: body.StatedBalance,
		OccurredAt:    body.OccurredAt,
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, out)
}

type receiptScanBody struct {
	Mime        string     `json:"mime"`
	ImageBase64 string     `json:"image_base64"`
	AccountID   *uuid.UUID `json:"account_id"`
	Create      bool       `json:"create"`
}

func (h *Handler) ScanReceipt(w http.ResponseWriter, r *http.Request) {
	var body receiptScanBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.ScanReceipt(r.Context(), auth.UserIDFrom(r.Context()), ReceiptScanInput{
		Mime: body.Mime, Base64: body.ImageBase64, AccountID: body.AccountID, Create: body.Create,
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, out)
}

type voiceParseBody struct {
	Text        string `json:"text"`
	Mime        string `json:"mime"`
	AudioBase64 string `json:"audio_base64"`
}

func (h *Handler) ParseVoice(w http.ResponseWriter, r *http.Request) {
	var body voiceParseBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.ParseVoice(r.Context(), auth.UserIDFrom(r.Context()), VoiceParseInput{
		Text: body.Text, Mime: body.Mime, AudioBase64: body.AudioBase64,
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"extract": out})
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
