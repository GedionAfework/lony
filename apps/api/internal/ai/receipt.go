package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"equilend/api/internal/ai/llm"
	"equilend/api/internal/expenses"
	"equilend/api/internal/httpx"

	"github.com/google/uuid"
)

const receiptSystemPrompt = `You extract structured data from photos of receipts, invoices, or bank statements.
Return ONLY compact JSON with keys:
kind ("expense" or "income"), title, amount (decimal string), currency_code (3-letter), merchant, occurred_at (YYYY-MM-DD if known), note, account_hint, confidence (0-1).
If unclear, guess conservatively and lower confidence. Prefer expense for receipts.`

// ExtractReceipt implements expenses.ReceiptExtractor.
func (s *Service) ExtractReceipt(ctx context.Context, userID uuid.UUID, mime, b64 string) (expenses.ReceiptExtract, error) {
	if err := s.ensureAIEnabled(ctx, userID); err != nil {
		return expenses.ReceiptExtract{}, err
	}
	if err := s.allowLLM(ctx, userID); err != nil {
		return expenses.ReceiptExtract{}, err
	}
	if s.llm == nil || !s.llm.Available() {
		return expenses.ReceiptExtract{}, httpx.E(http.StatusServiceUnavailable, "AI_UNAVAILABLE", "AI is not configured")
	}
	mime = strings.TrimSpace(mime)
	if mime == "" {
		mime = "image/jpeg"
	}
	dataURL := fmt.Sprintf("data:%s;base64,%s", mime, strings.TrimSpace(b64))
	img := &struct {
		URL string `json:"url"`
	}{URL: dataURL}
	res, err := s.llm.ChatVision(ctx, []llm.VisionMessage{
		{Role: "system", Content: receiptSystemPrompt},
		{Role: "user", Content: []llm.VisionPart{
			{Type: "text", Text: "Extract the payment details from this image for cashflow reconciliation."},
			{Type: "image_url", ImageURL: img},
		}},
	}, 500)
	if err != nil {
		return expenses.ReceiptExtract{}, httpx.E(http.StatusBadGateway, "AI_ERROR", err.Error())
	}
	raw := strings.TrimSpace(res.Content)
	if i := strings.Index(raw, "{"); i >= 0 {
		if j := strings.LastIndex(raw, "}"); j > i {
			raw = raw[i : j+1]
		}
	}
	var out expenses.ReceiptExtract
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return expenses.ReceiptExtract{
			Kind:       expenses.KindExpense,
			Title:      "Receipt scan",
			Note:       strings.TrimSpace(res.Content),
			Confidence: 0.2,
		}, nil
	}
	if out.Kind != expenses.KindIncome && out.Kind != expenses.KindExpense {
		out.Kind = expenses.KindExpense
	}
	out.CurrencyCode = strings.ToUpper(strings.TrimSpace(out.CurrencyCode))
	return out, nil
}
