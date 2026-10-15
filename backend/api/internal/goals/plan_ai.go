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

// Extract builds a goal draft from free text and/or a product URL.
func (s *Service) Extract(ctx context.Context, userID uuid.UUID, text string) (PlanDraft, error) {
	text = strings.TrimSpace(text)
	if text == "" || utf8.RuneCountInString(text) > maxExtractTextLen {
		return PlanDraft{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"text": "required, max 4000 characters",
		})
	}
	rawURL, rest := findURL(text)
	if rawURL == "" {
		if s.extractor == nil {
			return PlanDraft{}, httpx.E(http.StatusServiceUnavailable, "AI_UNAVAILABLE", "AI is not configured")
		}
		return s.extractor.ExtractPlan(ctx, userID, text, nil)
	}

	prev, err := PreviewProductURL(ctx, rawURL)
	if err != nil {
		// Page could not be read: fall back to the text alone when AI can help.
		if s.extractor != nil {
			draft, aerr := s.extractor.ExtractPlan(ctx, userID, text, &PlanDraft{GoalType: TypePurchase, SourceURL: rawURL})
			if aerr == nil && strings.TrimSpace(draft.Title) != "" {
				draft.SourceURL = rawURL
				return draft, nil
			}
		}
		return PlanDraft{}, err
	}

	draft := PlanDraft{
		Title:        prev.Title,
		GoalType:     TypePurchase,
		CurrencyCode: strings.ToUpper(prev.Currency),
		SourceURL:    prev.URL,
		ImageURL:     prev.ImageURL,
	}
	if p, err := parsePositive(prev.Price); err == nil {
		draft.TargetAmount = p.StringFixed(Scale)
	}
	if prev.Description != "" {
		draft.Note = truncateRunes(prev.Description, 200)
	}

	if s.extractor != nil && rest != "" {
		if refined, err := s.extractor.ExtractPlan(ctx, userID, rest, &draft); err == nil {
			draft = mergeDraft(draft, refined)
		}
	}
	if draft.TargetAmount != "" && draft.SourceURL != "" {
		line := fmt.Sprintf("Scraped live price %s %s from %s", draft.TargetAmount, draft.CurrencyCode, draft.SourceURL)
		if strings.TrimSpace(draft.Note) == "" {
			draft.Note = line
		} else if !strings.Contains(strings.ToLower(draft.Note), "scraped") {
			draft.Note = line + " · " + draft.Note
		}
	}
	return draft, nil
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

func (s *Service) applyScrapedPrice(ctx context.Context, rec Goal, prev PreviewURLResult) (GoalDTO, *PriceChange, error) {
	newPrice, err := parsePositive(prev.Price)
	if err != nil {
		return GoalDTO{}, nil, err
	}
	if prev.Currency != "" && !strings.EqualFold(prev.Currency, rec.CurrencyCode) {
		rec.CurrencyCode = strings.ToUpper(prev.Currency)
	}
	old := rec.TargetAmount
	if rec.LastSeenPrice != nil {
		old = *rec.LastSeenPrice
	}
	now := s.now().UTC()
	rec.LastSeenPrice = &newPrice
	rec.LastPriceCheckedAt = &now
	moved := !newPrice.Equal(old)
	dir := DirectionSame
	if moved {
		if newPrice.GreaterThan(old) {
			dir = DirectionUp
		} else {
			dir = DirectionDown
		}
		rec.TargetAmount = newPrice
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
		CurrencyCode: saved.CurrencyCode,
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
		CurrencyCode: saved.CurrencyCode,
		OldPrice:     old.StringFixed(Scale),
		NewPrice:     newPrice.StringFixed(Scale),
		Delta:        deltaStr,
		Direction:    dir,
	}
	if moved && s.prices != nil {
		_ = s.prices.OnGoalPriceChange(ctx, saved.UserID, saved.ID, saved.Title, change.OldPrice, change.NewPrice, saved.CurrencyCode, dir)
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
}

func (h *Handler) Extract(w http.ResponseWriter, r *http.Request) {
	var body extractBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	draft, err := h.svc.Extract(r.Context(), auth.UserIDFrom(r.Context()), body.Text)
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