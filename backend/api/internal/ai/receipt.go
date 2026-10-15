package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"equilend/api/internal/ai/llm"
	"equilend/api/internal/expenses"
	"equilend/api/internal/httpx"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

const receiptUserPrompt = `Extract payment details from this receipt/invoice/statement image.
Return a JSON object with keys:
kind ("expense" or "income"),
title (short merchant or item name),
amount (decimal string like "12.50", no currency symbol),
currency_code (3-letter ISO if visible, else ""),
merchant,
occurred_at (YYYY-MM-DD if visible, else ""),
note (optional one line),
account_hint (optional),
confidence (0-1 number).
Prefer kind "expense" for store receipts. If amount is unclear, still return best guess with low confidence.
JSON only — no markdown.`

// ExtractReceipt implements expenses.ReceiptExtractor.
// Receipt OCR is a core cashflow feature (not Premium personas).
func (s *Service) ExtractReceipt(ctx context.Context, userID uuid.UUID, mime, b64 string) (expenses.ReceiptExtract, error) {
	if err := s.ensureAICoreAvailable(ctx); err != nil {
		return expenses.ReceiptExtract{}, err
	}
	if err := s.allowLLM(ctx, userID); err != nil {
		return expenses.ReceiptExtract{}, err
	}
	mime = strings.TrimSpace(mime)
	if mime == "" {
		mime = "image/jpeg"
	}
	b64 = strings.TrimSpace(b64)
	// Strip data-URL prefix if the client already included it.
	if i := strings.Index(b64, "base64,"); i >= 0 {
		b64 = b64[i+len("base64,"):]
	}
	if b64 == "" {
		return expenses.ReceiptExtract{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"image_base64": "required",
		})
	}
	dataURL := fmt.Sprintf("data:%s;base64,%s", mime, b64)
	img := &struct {
		URL string `json:"url"`
	}{URL: dataURL}
	// Single user message (Groq vision examples); JSON mode; enough tokens for thinking models.
	res, err := s.llm.ChatVisionOpts(ctx, []llm.VisionMessage{
		{Role: "user", Content: []llm.VisionPart{
			{Type: "text", Text: receiptUserPrompt},
			{Type: "image_url", ImageURL: img},
		}},
	}, 2048, &llm.VisionOpts{JSONObject: true})
	if err != nil {
		return expenses.ReceiptExtract{}, httpx.E(http.StatusBadGateway, "AI_ERROR", err.Error())
	}
	raw := llm.StripThinking(strings.TrimSpace(res.Content))
	if i := strings.Index(raw, "{"); i >= 0 {
		if j := strings.LastIndex(raw, "}"); j > i {
			raw = raw[i : j+1]
		}
	}
	var out expenses.ReceiptExtract
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		// Last resort: pull a money-like token from free text.
		out = expenses.ReceiptExtract{
			Kind:       expenses.KindExpense,
			Title:      "Receipt",
			Note:       strings.TrimSpace(res.Content),
			Confidence: 0.2,
		}
		if amt := findAmountInText(raw); amt != "" {
			out.Amount = amt
			out.Confidence = 0.35
		}
	}
	if out.Kind != expenses.KindIncome && out.Kind != expenses.KindExpense {
		out.Kind = expenses.KindExpense
	}
	out.Title = strings.TrimSpace(out.Title)
	if out.Title == "" {
		out.Title = strings.TrimSpace(out.Merchant)
	}
	if out.Title == "" {
		out.Title = "Receipt"
	}
	out.CurrencyCode = strings.ToUpper(strings.TrimSpace(out.CurrencyCode))
	if len(out.CurrencyCode) != 3 {
		out.CurrencyCode = ""
	}
	out.Amount = normalizeAmount(out.Amount)
	return out, nil
}

// ensureAICoreAvailable checks global kill-switch + LLM config only (no Premium gate).
func (s *Service) ensureAICoreAvailable(ctx context.Context) error {
	if s.llm == nil || !s.llm.Available() {
		return httpx.E(http.StatusServiceUnavailable, "AI_UNAVAILABLE", "AI is not configured")
	}
	if s.gate != nil {
		off, err := s.gate.AIDisabled(ctx)
		if err != nil {
			return err
		}
		if off {
			return httpx.E(http.StatusServiceUnavailable, "AI_DISABLED", "AI features are temporarily disabled")
		}
	}
	return nil
}

var amountToken = regexp.MustCompile(`(?i)(?:[$€£]|ETB|USD|EUR|GBP)?\s*(\d{1,7}(?:[.,]\d{2})?)`)

func findAmountInText(s string) string {
	m := amountToken.FindStringSubmatch(s)
	if len(m) < 2 {
		return ""
	}
	return normalizeAmount(m[1])
}

func normalizeAmount(raw string) string {
	raw = strings.TrimSpace(strings.ReplaceAll(raw, ",", ""))
	raw = strings.TrimPrefix(raw, "$")
	if raw == "" {
		return ""
	}
	d, err := decimal.NewFromString(raw)
	if err != nil || !d.GreaterThan(decimal.Zero) {
		return strings.TrimSpace(raw)
	}
	return d.StringFixed(2)
}
