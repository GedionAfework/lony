package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"unicode"

	"equilend/api/internal/ai/llm"
	"equilend/api/internal/httpx"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

const accountExtractPrompt = `Extract bank/mobile-money account details from this statement or account screenshot.
Return a JSON object with keys:
full_name (account holder name as printed),
account_number (full number if visible; keep masking characters like * or X if some digits are hidden),
account_number_masked (true if any digits are hidden/obscured),
profit_percent_yearly (annual interest or profit rate as a decimal string like "7.5", empty if unknown),
institution_name (bank or wallet name if visible),
currency_code (3-letter ISO if visible, else ""),
confidence (0-1 number).
JSON only — no markdown.`

// AccountExtract is AI output for accepting a payment account.
type AccountExtract struct {
	FullName             string  `json:"full_name"`
	AccountNumber        string  `json:"account_number"`
	AccountNumberMasked  bool    `json:"account_number_masked"`
	ProfitPercentYearly  string  `json:"profit_percent_yearly"`
	InstitutionName      string  `json:"institution_name"`
	CurrencyCode         string  `json:"currency_code"`
	Confidence           float64 `json:"confidence"`
}

// ExtractAccountDetails reads holder name, account number, and yearly profit % from an image.
func (s *Service) ExtractAccountDetails(ctx context.Context, userID uuid.UUID, mime, b64 string) (AccountExtract, error) {
	if err := s.ensureAICoreAvailable(ctx); err != nil {
		return AccountExtract{}, err
	}
	if err := s.allowLLM(ctx, userID); err != nil {
		return AccountExtract{}, err
	}
	mime = strings.TrimSpace(mime)
	if mime == "" {
		mime = "image/jpeg"
	}
	b64 = strings.TrimSpace(b64)
	if i := strings.Index(b64, "base64,"); i >= 0 {
		b64 = b64[i+len("base64,"):]
	}
	if b64 == "" {
		return AccountExtract{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"image_base64": "required",
		})
	}
	dataURL := fmt.Sprintf("data:%s;base64,%s", mime, b64)
	img := &struct {
		URL string `json:"url"`
	}{URL: dataURL}
	res, err := s.llm.ChatVisionOpts(ctx, []llm.VisionMessage{
		{Role: "user", Content: []llm.VisionPart{
			{Type: "text", Text: accountExtractPrompt},
			{Type: "image_url", ImageURL: img},
		}},
	}, 2048, &llm.VisionOpts{JSONObject: true})
	if err != nil {
		return AccountExtract{}, httpx.E(http.StatusBadGateway, "AI_ERROR", err.Error())
	}
	raw := llm.StripThinking(strings.TrimSpace(res.Content))
	if i := strings.Index(raw, "{"); i >= 0 {
		if j := strings.LastIndex(raw, "}"); j > i {
			raw = raw[i : j+1]
		}
	}
	var out AccountExtract
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		out = AccountExtract{Confidence: 0.2}
	}
	out.FullName = strings.TrimSpace(out.FullName)
	out.AccountNumber = strings.TrimSpace(out.AccountNumber)
	out.InstitutionName = strings.TrimSpace(out.InstitutionName)
	out.CurrencyCode = strings.ToUpper(strings.TrimSpace(out.CurrencyCode))
	if len(out.CurrencyCode) != 3 {
		out.CurrencyCode = ""
	}
	out.ProfitPercentYearly = normalizeProfitPercent(out.ProfitPercentYearly)
	if !out.AccountNumberMasked {
		out.AccountNumberMasked = looksMaskedAccount(out.AccountNumber)
	}
	return out, nil
}

func normalizeProfitPercent(raw string) string {
	raw = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(raw), "%"))
	raw = strings.ReplaceAll(raw, ",", ".")
	if raw == "" {
		return ""
	}
	d, err := decimal.NewFromString(raw)
	if err != nil || d.IsNegative() {
		return ""
	}
	return d.StringFixed(2)
}

var maskChar = regexp.MustCompile(`[xX*•●…]`)

func looksMaskedAccount(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return true
	}
	if maskChar.MatchString(s) {
		return true
	}
	digits := 0
	for _, r := range s {
		if unicode.IsDigit(r) {
			digits++
		}
	}
	return digits > 0 && digits < 6
}
