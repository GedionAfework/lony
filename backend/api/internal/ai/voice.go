package ai

import (
	"context"
	"net/http"
	"strings"

	"equilend/api/internal/ai/llm"
	"equilend/api/internal/expenses"
	"equilend/api/internal/httpx"

	"github.com/google/uuid"
)

const voiceUserPrompt = `Parse a spoken money log into JSON.
Return keys:
kind ("expense" or "income"),
title (short what-for, not the amount),
amount (decimal string like "12.50"),
currency_code (3-letter ISO if said, else ""),
category_hint (best category name from the provided list, else a short guess),
account_hint (account/wallet/bank name or last4 if said, else ""),
occurred_at (YYYY-MM-DD if said, else ""),
note (optional),
confidence (0-1).
Prefer expense unless they clearly said income, salary, refund, or got paid.
JSON only.`

func (s *Service) TranscribeAudio(ctx context.Context, userID uuid.UUID, mime string, data []byte) (string, error) {
	if err := s.ensureCaptureReady(ctx); err != nil {
		return "", err
	}
	if err := s.allowLLM(ctx, userID); err != nil {
		return "", err
	}
	text, err := s.llm.Transcribe(ctx, mime, data)
	if err != nil {
		return "", httpx.E(http.StatusBadGateway, "AI_ERROR", err.Error())
	}
	return text, nil
}

func (s *Service) ParseVoiceText(ctx context.Context, userID uuid.UUID, transcript string, categories []string) (expenses.VoiceExtract, error) {
	if err := s.ensureCaptureReady(ctx); err != nil {
		return expenses.ParseVoiceFallback(transcript), nil
	}
	if err := s.allowLLM(ctx, userID); err != nil {
		return expenses.ParseVoiceFallback(transcript), nil
	}
	prompt := voiceUserPrompt + "\nToday is " + s.now().Format("Monday 2006-01-02") + "; turn words like yesterday or last Friday into a date."
	if len(categories) > 0 {
		prompt += "\nKnown categories: " + strings.Join(categories, ", ")
	}
	prompt += "\nUtterance: " + strings.TrimSpace(transcript)
	res, err := s.llm.Chat(ctx, []llm.Message{
		{Role: "user", Content: prompt},
	}, 400)
	if err != nil {
		return expenses.ParseVoiceFallback(transcript), nil
	}
	raw := llm.StripThinking(strings.TrimSpace(res.Content))
	if i := strings.Index(raw, "{"); i >= 0 {
		if j := strings.LastIndex(raw, "}"); j > i {
			raw = raw[i : j+1]
		}
	}
	var out expenses.VoiceExtract
	if !decodeLoose(raw, &out, "confidence") {
		return expenses.ParseVoiceFallback(transcript), nil
	}
	out.Transcript = strings.TrimSpace(transcript)
	if out.Kind != expenses.KindIncome && out.Kind != expenses.KindExpense {
		out.Kind = expenses.KindExpense
	}
	out.Title = strings.TrimSpace(out.Title)
	if out.Title == "" {
		out.Title = expenses.ParseVoiceFallback(transcript).Title
	}
	out.CurrencyCode = strings.ToUpper(strings.TrimSpace(out.CurrencyCode))
	if len(out.CurrencyCode) != 3 {
		out.CurrencyCode = expenses.ParseVoiceFallback(transcript).CurrencyCode
	}
	out.Amount = normalizeAmount(out.Amount)
	if out.Amount == "" {
		fb := expenses.ParseVoiceFallback(transcript)
		out.Amount = fb.Amount
	}
	// Account and category ids come from the server's own matching, never from the model.
	out.AccountID, out.CategoryID = nil, nil
	if out.Confidence <= 0 {
		out.Confidence = 0.7
	}
	return out, nil
}
