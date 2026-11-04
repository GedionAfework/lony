package goals

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"

	"equilend/api/internal/auth"
	"equilend/api/internal/httpx"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

const (
	maxExtractTextLen  = 4000
	maxRefreshPerCycle = 25

	DirectionUp   = "up"
	DirectionDown = "down"
	DirectionSame = "same"
)

// PlanDraft is a suggested goal pre-filled from free text or a product URL.
type PlanDraft struct {
	Title        string `json:"title"`
	GoalType     string `json:"goal_type"` // travel|purchase|savings|debt_payoff|custom
	CurrencyCode string `json:"currency_code"`
	TargetAmount string `json:"target_amount"`
	TargetDate   string `json:"target_date,omitempty"`
	Note         string `json:"note,omitempty"`
	SourceURL    string `json:"source_url,omitempty"`
	ImageURL     string `json:"image_url,omitempty"`
	TypeLabel    string `json:"type_label,omitempty"`
	// SourcePrice/SourceCurrency: the listing's own price when it is in another currency
	// than CurrencyCode (TargetAmount is then the converted figure). Sent back on create so
	// price tracking compares like with like.
	SourcePrice    string `json:"source_price,omitempty"`
	SourceCurrency string `json:"source_currency,omitempty"`
	// CurrencyUnknown: the page showed a price without saying which currency.
	CurrencyUnknown bool `json:"currency_unknown,omitempty"`
	// Estimated: the price is the assistant's estimate, not read from the page.
	Estimated bool `json:"estimated,omitempty"`
}

// PlanExtractor turns free text into a goal draft (implemented by the AI service).
// When base is non-nil it is a partially filled draft (e.g. from a URL preview)
// that the extractor should refine using the surrounding text.
type PlanExtractor interface {
	ExtractPlan(ctx context.Context, userID uuid.UUID, text string, base *PlanDraft) (PlanDraft, error)
}

// PriceChange describes a source price movement found during a refresh.
type PriceChange struct {
	GoalID       uuid.UUID `json:"goal_id"`
	Title        string    `json:"title"`
	CurrencyCode string    `json:"currency_code"`
	OldPrice     string    `json:"old_price"`
	NewPrice     string    `json:"new_price"`
	Delta        string    `json:"delta"`
	Direction    string    `json:"direction"` // up | down
}

// RefreshResult is returned by RefreshSourcePrices.
type RefreshResult struct {
	Updated []GoalDTO     `json:"updated"`
	Changes []PriceChange `json:"changes"`
}

func (s *Service) SetPlanExtractor(e PlanExtractor) {
	s.extractor = e
}

var planURLRe = regexp.MustCompile(`(?i)\b(?:https?://|www\.)[^\s<>"'()\[\]]+`)

// findURL returns the first URL in text and the text with that URL removed.
func findURL(text string) (string, string) {
	loc := planURLRe.FindStringIndex(text)
	if loc == nil {
		return "", text
	}
	raw := strings.TrimRight(text[loc[0]:loc[1]], ".,;:!?")
	rest := strings.TrimSpace(text[:loc[0]] + " " + text[loc[0]+len(raw):])
	return raw, strings.Join(strings.Fields(rest), " ")
}

// Extract builds a goal draft from free text and/or a product URL. currency is the user's
// planning currency: a listing priced in another currency is converted into it.
// Reading a link needs no AI; AI only refines extra words around the link, or estimates
// when the page cannot be read.
func (s *Service) Extract(ctx context.Context, userID uuid.UUID, text, currency string) (PlanDraft, error) {
	text = strings.TrimSpace(text)
	if text == "" || utf8.RuneCountInString(text) > maxExtractTextLen {
		return PlanDraft{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"text": "required, max 4000 characters",
		})
	}
	currency = strings.ToUpper(strings.TrimSpace(currency))
	if len(currency) != 3 {
		currency = ""
	}
	rawURL, rest := findURL(text)
	if rawURL == "" {
		if s.extractor == nil {
			return PlanDraft{}, httpx.E(http.StatusServiceUnavailable, "AI_UNAVAILABLE", "AI is not configured")
		}
		prompt := text
		if currency != "" {
			prompt = "The user's currency is " + currency + ".\n" + text
		}
		draft, err := s.extractor.ExtractPlan(ctx, userID, prompt, nil)
		if err == nil && draft.TargetAmount != "" {
			draft.Estimated = true
		}
		return draft, err
	}

	prev, err := PreviewProductURL(ctx, rawURL)
	if err != nil {
		// Page could not be read: estimate from the words when AI can help, and say so.
		if s.extractor != nil {
			draft, aerr := s.extractor.ExtractPlan(ctx, userID, text, &PlanDraft{GoalType: TypePurchase, SourceURL: rawURL, CurrencyCode: currency})
			if aerr == nil && strings.TrimSpace(draft.Title) != "" {
				draft.SourceURL = rawURL
				draft.Estimated = draft.TargetAmount != ""
				draft.Note = "The page could not be read; this is an estimate. Check the price on the site."
				return draft, nil
			}
		}
		return PlanDraft{}, err
	}

	draft := PlanDraft{
		Title:     prev.Title,
		GoalType:  TypePurchase,
		SourceURL: prev.URL,
		ImageURL:  prev.ImageURL,
	}
	if prev.Description != "" {
		draft.Note = truncateRunes(prev.Description, 200)
	}
	if p, err := parsePositive(prev.Price); err == nil {
		s.priceDraft(ctx, &draft, p, prev.Currency, currency, prev.SiteName)
	}

	if s.extractor != nil && rest != "" {
		if refined, err := s.extractor.ExtractPlan(ctx, userID, rest, &draft); err == nil {
			draft = mergeDraft(draft, refined)
		}
	}
	return draft, nil
}

// priceDraft fills the draft's amount from a listing price, converting to the user's
// currency when the listing uses another one.
func (s *Service) priceDraft(ctx context.Context, draft *PlanDraft, price decimal.Decimal, pageCurrency, userCurrency, site string) {
	pageCurrency = strings.ToUpper(strings.TrimSpace(pageCurrency))
	if site == "" {
		site = strings.TrimPrefix(hostOf(draft.SourceURL), "www.")
	}
	switch {
	case pageCurrency == "":
		// A number with no currency: never assume it is the user's money.
		draft.TargetAmount = price.StringFixed(2)
		draft.CurrencyUnknown = true
		draft.Note = joinNote(fmt.Sprintf("Price %s from %s; the page did not say the currency.", price.StringFixed(2), site), draft.Note)
	case userCurrency == "" || pageCurrency == userCurrency:
		draft.TargetAmount = price.StringFixed(2)
		draft.CurrencyCode = pageCurrency
		draft.Note = joinNote(fmt.Sprintf("Live price %s %s from %s.", price.StringFixed(2), pageCurrency, site), draft.Note)
	default:
		if converted, ok := s.convert(ctx, price, pageCurrency, userCurrency); ok {
			draft.TargetAmount = converted.StringFixed(2)
			draft.CurrencyCode = userCurrency
			draft.SourcePrice = price.StringFixed(2)
			draft.SourceCurrency = pageCurrency
			draft.Note = joinNote(fmt.Sprintf("Live price %s %s from %s (≈ %s %s at today's rate).",
				price.StringFixed(2), pageCurrency, site, converted.StringFixed(2), userCurrency), draft.Note)
		} else {
			// No rate today: keep the page's own currency rather than a wrong number.
			draft.TargetAmount = price.StringFixed(2)
			draft.CurrencyCode = pageCurrency
			draft.Note = joinNote(fmt.Sprintf("Live price %s %s from %s (could not convert to %s right now).",
				price.StringFixed(2), pageCurrency, site, userCurrency), draft.Note)
		}
	}
}

func joinNote(line, rest string) string {
	rest = strings.TrimSpace(rest)
	if rest == "" {
		return line
	}
	return truncateRunes(line+" "+rest, 400)
}

// mergeDraft overlays non-empty refined fields on base; scraped price, URL and image win.
func mergeDraft(base, refined PlanDraft) PlanDraft {
	if v := strings.TrimSpace(refined.Title); v != "" {
		base.Title = v
	}
	if v := strings.TrimSpace(refined.GoalType); v != "" {
		if t, err := normalizeType(v); err == nil {
			base.GoalType = t
		}
	}
	if v := strings.TrimSpace(refined.Note); v != "" {
		base.Note = v
	}
	if v := strings.TrimSpace(refined.TypeLabel); v != "" {
		base.TypeLabel = v
	}
	if v := strings.TrimSpace(refined.TargetDate); v != "" {
		base.TargetDate = v
	}
	if base.TargetAmount == "" {
		base.TargetAmount = strings.TrimSpace(refined.TargetAmount)
	}
	if base.CurrencyCode == "" {
		base.CurrencyCode = strings.ToUpper(strings.TrimSpace(refined.CurrencyCode))
	}
	return base
}

func truncateRunes(s string, max int) string {
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	return string([]rune(s)[:max])
}

// applyScrapedPrice records a fresh listing price. The movement is judged in the listing's
// own currency (so exchange-rate noise is not a "price change"), the target follows in the
// goal's currency, and the goal's currency never changes: saved money stays meaningful.
func (s *Service) applyScrapedPrice(ctx context.Context, rec Goal, prev PreviewURLResult) (GoalDTO, *PriceChange, error) {
	newPrice, err := parsePositive(prev.Price)
	if err != nil {
		return GoalDTO{}, nil, err
	}
	srcCur := listingCurrency(rec)
	if c := strings.ToUpper(strings.TrimSpace(prev.Currency)); len(c) == 3 {
		srcCur = c
	}
	old := rec.TargetAmount
	if rec.LastSeenPrice != nil && strings.EqualFold(listingCurrency(rec), srcCur) {
		old = *rec.LastSeenPrice
	} else if !strings.EqualFold(srcCur, rec.CurrencyCode) {
		// First reading in this currency: nothing to compare against yet.
		old = newPrice
	}
	now := s.now().UTC()
	rec.LastSeenPrice = &newPrice
	rec.LastPriceCheckedAt = &now
	if strings.EqualFold(srcCur, rec.CurrencyCode) {
		rec.SourceCurrency = nil
	} else {
		rec.SourceCurrency = &srcCur
	}
	moved := !newPrice.Equal(old)
	dir := DirectionSame
	if moved {
		if newPrice.GreaterThan(old) {
			dir = DirectionUp
		} else {
			dir = DirectionDown
		}
	}
	// The target is the listing price in the goal's currency; without a rate it stays put.
	if target, ok := s.convert(ctx, newPrice, srcCur, rec.CurrencyCode); ok && !target.Equal(rec.TargetAmount) {
		rec.TargetAmount = target
		if rec.CurrentAmount.GreaterThanOrEqual(rec.TargetAmount) {
			rec.CurrentAmount = rec.TargetAmount
			rec.Status = StatusCompleted
		}
		rec.UpdatedAt = now
	}
	saved, err := s.store.Update(ctx, rec)
	if err != nil {
		return GoalDTO{}, nil, err
	}
	source := ""
	if saved.SourceURL != nil {
		source = *saved.SourceURL
	}
	_, _ = s.store.InsertPriceHistory(ctx, PriceHistory{
		GoalID:       saved.ID,
		UserID:       saved.UserID,
		Price:        newPrice,
		CurrencyCode: srcCur,
		SourceURL:    source,
		Direction:    dir,
		CreatedAt:    now,
	})
	dto := toDTO(saved, nil)
	delta := newPrice.Sub(old)
	deltaStr := delta.StringFixed(Scale)
	dto.PriceDelta = &deltaStr
	dto.PriceDirection = &dir
	change := &PriceChange{
		GoalID:       saved.ID,
		Title:        saved.Title,
		CurrencyCode: srcCur,
		OldPrice:     old.StringFixed(Scale),
		NewPrice:     newPrice.StringFixed(Scale),
		Delta:        deltaStr,
		Direction:    dir,
	}
	if moved && s.prices != nil {
		_ = s.prices.OnGoalPriceChange(ctx, saved.UserID, saved.ID, saved.Title, change.OldPrice, change.NewPrice, srcCur, dir)
	}
	if !moved {
		return dto, nil, nil
	}
	return dto, change, nil
}

func (s *Service) scrapeAndApply(ctx context.Context, rec Goal) (GoalDTO, *PriceChange, error) {
	if rec.SourceURL == nil || strings.TrimSpace(*rec.SourceURL) == "" {
		return GoalDTO{}, nil, httpx.E(http.StatusUnprocessableEntity, "NO_SOURCE", "goal has no product URL to scrape")
	}
	prev, err := PreviewProductURL(ctx, *rec.SourceURL)
	if err != nil {
		return GoalDTO{}, nil, err
	}
	return s.applyScrapedPrice(ctx, rec, prev)
}

// RefreshSourcePrices re-fetches the source URL of each active goal, updating the
// target amount when the price moved. Failures for individual goals are skipped.
func (s *Service) RefreshSourcePrices(ctx context.Context, userID uuid.UUID) (RefreshResult, error) {
	out := RefreshResult{Updated: []GoalDTO{}, Changes: []PriceChange{}}
	rows, err := s.store.List(ctx, userID, false)
	if err != nil {
		return out, err
	}
	checked := 0
	for _, rec := range rows {
		if rec.Status != StatusActive || rec.SourceURL == nil || strings.TrimSpace(*rec.SourceURL) == "" {
			continue
		}
		if checked >= maxRefreshPerCycle || ctx.Err() != nil {
			break
		}
		checked++
		dto, change, err := s.scrapeAndApply(ctx, rec)
		if err != nil {
			continue
		}
		if change != nil {
			out.Updated = append(out.Updated, dto)
			out.Changes = append(out.Changes, *change)
		}
	}
	return out, nil
}

func (s *Service) RefreshOneSourcePrice(ctx context.Context, userID, goalID uuid.UUID) (GoalDTO, *PriceChange, error) {
	rec, err := s.store.Get(ctx, userID, goalID)
	if err != nil {
		return GoalDTO{}, nil, err
	}
	return s.scrapeAndApply(ctx, rec)
}

func (s *Service) ListPriceHistory(ctx context.Context, userID, goalID uuid.UUID) ([]PriceHistoryDTO, error) {
	if _, err := s.store.Get(ctx, userID, goalID); err != nil {
		return nil, err
	}
	rows, err := s.store.ListPriceHistory(ctx, userID, goalID, 50)
	if err != nil {
		return nil, err
	}
	out := make([]PriceHistoryDTO, 0, len(rows))
	for _, rec := range rows {
		out = append(out, PriceHistoryDTO{
			ID:           rec.ID,
			GoalID:       rec.GoalID,
			Price:        rec.Price.StringFixed(Scale),
			CurrencyCode: rec.CurrencyCode,
			SourceURL:    rec.SourceURL,
			Direction:    rec.Direction,
			CreatedAt:    rec.CreatedAt,
		})
	}
	return out, nil
}

// TickTrackedPrices is the worker cron: scrape every active listing URL and record history.
func (s *Service) TickTrackedPrices(ctx context.Context) (int, error) {
	rows, err := s.store.ListActiveWithSource(ctx, 80)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, rec := range rows {
		if ctx.Err() != nil {
			break
		}
		if _, _, err := s.scrapeAndApply(ctx, rec); err == nil {
			n++
		}
	}
	return n, nil
}

type extractBody struct {
	Text string `json:"text"`
	// Currency is the user's planning currency (optional).
	Currency string `json:"currency"`
}

func (h *Handler) Extract(w http.ResponseWriter, r *http.Request) {
	var body extractBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	draft, err := h.svc.Extract(r.Context(), auth.UserIDFrom(r.Context()), body.Text, body.Currency)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"draft": draft})
}

func (h *Handler) RefreshPrices(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.RefreshSourcePrices(r.Context(), auth.UserIDFrom(r.Context()))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) RefreshOnePrice(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	goal, change, err := h.svc.RefreshOneSourcePrice(r.Context(), auth.UserIDFrom(r.Context()), id)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"goal": goal, "change": change})
}

func (h *Handler) ListPriceHistory(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.ListPriceHistory(r.Context(), auth.UserIDFrom(r.Context()), id)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	if out == nil {
		out = []PriceHistoryDTO{}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"history": out})
}