package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"equilend/api/internal/ai/llm"
	"equilend/api/internal/goals"
	"equilend/api/internal/httpx"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// PlanDraft is a suggested Plan goal extracted from text or a product page.
type PlanDraft = goals.PlanDraft

// GoalPriceRefresher re-checks source prices of Plan goals (implemented by goals.Service).
type GoalPriceRefresher interface {
	RefreshSourcePrices(ctx context.Context, userID uuid.UUID) (goals.RefreshResult, error)
}

const planExtractSystemPrompt = `You turn a short note into a structured savings goal ("Plan") for a personal finance app.
Return ONLY compact JSON with keys:
title (max 80 chars), goal_type (one of: travel, purchase, savings, debt_payoff, custom), currency_code (3-letter, uppercase, empty if unknown),
target_amount (positive decimal string without separators, empty if unknown), target_date (YYYY-MM-DD when stated), note (optional, max 200 chars), type_label (optional short label such as "Laptop" or "Trip to Dubai").
Rules:
- Use "purchase" for things to buy, "travel" for trips, "savings" for generic saving or emergency funds, "debt_payoff" for paying off debt.
- If the user (or prompt) asks to estimate a price, or gives a product/model/year without a stated price, you MUST fill target_amount with a realistic market estimate (no currency symbols, no commas). Put "Estimated price" in note.
- Only leave target_amount empty when there is truly not enough detail to estimate (e.g. just "I want something").
- Prefer the user's currency_code when mentioned; otherwise leave currency_code empty.
If a draft JSON is provided, keep its URL/image; you may update title, goal_type, note, type_label, target_date, and target_amount when estimating.`}

// ExtractPlan implements goals.PlanExtractor.
func (s *Service) ExtractPlan(ctx context.Context, userID uuid.UUID, text string, base *PlanDraft) (PlanDraft, error) {
	if err := s.ensureAIEnabled(ctx, userID); err != nil {
		return PlanDraft{}, err
	}
	if s.llm == nil || !s.llm.Available() {
		return PlanDraft{}, httpx.E(http.StatusServiceUnavailable, "AI_UNAVAILABLE", "AI is not configured")
	}
	if err := s.allowLLM(ctx, userID); err != nil {
		return PlanDraft{}, err
	}
	text = strings.TrimSpace(text)
	user := "Note: " + text
	if base != nil {
		b, _ := json.Marshal(base)
		user = fmt.Sprintf("Draft: %s\nNote: %s", b, text)
	}
	res, err := s.llm.Chat(ctx, []llm.Message{
		{Role: "system", Content: planExtractSystemPrompt},
		{Role: "user", Content: user},
	}, 400)
	if err != nil {
		return PlanDraft{}, httpx.E(http.StatusBadGateway, "AI_ERROR", err.Error())
	}
	raw := strings.TrimSpace(res.Content)
	if i := strings.Index(raw, "{"); i >= 0 {
		if j := strings.LastIndex(raw, "}"); j > i {
			raw = raw[i : j+1]
		}
	}
	var out PlanDraft
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return PlanDraft{}, httpx.E(http.StatusUnprocessableEntity, "NO_DRAFT", "could not extract a plan from the text")
	}
	out.Title = strings.TrimSpace(out.Title)
	out.GoalType = strings.ToLower(strings.TrimSpace(out.GoalType))
	switch out.GoalType {
	case goals.TypeTravel, goals.TypePurchase, goals.TypeSavings, goals.TypeDebtPayoff, goals.TypeCustom:
	default:
		out.GoalType = goals.TypeCustom
	}
	out.CurrencyCode = strings.ToUpper(strings.TrimSpace(out.CurrencyCode))
	if len(out.CurrencyCode) != 3 {
		out.CurrencyCode = ""
	}
	amt := strings.TrimSpace(strings.ReplaceAll(out.TargetAmount, ",", ""))
	if d, err := decimal.NewFromString(amt); err == nil && d.GreaterThan(decimal.Zero) {
		out.TargetAmount = d.Round(goals.Scale).StringFixed(goals.Scale)
	} else {
		out.TargetAmount = ""
	}
	out.Note = strings.TrimSpace(out.Note)
	out.TypeLabel = strings.TrimSpace(out.TypeLabel)
	out.TargetDate = strings.TrimSpace(out.TargetDate)
	if base != nil {
		// Scraped facts win over model guesses.
		if base.TargetAmount != "" {
			out.TargetAmount = base.TargetAmount
		}
		if base.CurrencyCode != "" {
			out.CurrencyCode = base.CurrencyCode
		}
		out.SourceURL = base.SourceURL
		out.ImageURL = base.ImageURL
	}
	if out.Title == "" && (base == nil || base.Title == "") {
		return PlanDraft{}, httpx.E(http.StatusUnprocessableEntity, "NO_DRAFT", "could not extract a plan from the text")
	}
	return out, nil
}

// refreshGoalPrices re-checks Plan source prices (best effort) and returns any changes.
func (s *Service) refreshGoalPrices(ctx context.Context, userID uuid.UUID) []goals.PriceChange {
	if s.prices == nil {
		return nil
	}
	res, err := s.prices.RefreshSourcePrices(ctx, userID)
	if err != nil {
		return nil
	}
	return res.Changes
}

// priceChangeInsight summarizes price changes as a single insight card.
func priceChangeInsight(changes []goals.PriceChange) (severity, title, body string) {
	title = "Plan prices updated"
	if len(changes) == 1 {
		title = "Plan price updated"
	}
	severity = "info"
	allDown := true
	parts := make([]string, 0, len(changes))
	for i, c := range changes {
		if c.Direction != goals.DirectionDown {
			allDown = false
		}
		if i >= 3 {
			continue
		}
		parts = append(parts, fmt.Sprintf("%s went %s from %s to %s %s",
			c.Title, c.Direction, c.OldPrice, c.NewPrice, c.CurrencyCode))
	}
	if allDown {
		severity = "positive"
	}
	body = strings.Join(parts, "; ") + "."
	if len(changes) > 3 {
		body += fmt.Sprintf(" Plus %d more.", len(changes)-3)
	}
	body += " Goal targets were adjusted to the latest price."
	return severity, title, body
}
