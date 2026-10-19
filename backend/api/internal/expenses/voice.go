package expenses

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"unicode"

	"equilend/api/internal/httpx"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

type VoiceExtract struct {
	Transcript   string     `json:"transcript"`
	Kind         string     `json:"kind"`
	Title        string     `json:"title"`
	Amount       string     `json:"amount"`
	CurrencyCode string     `json:"currency_code"`
	CategoryHint string     `json:"category_hint,omitempty"`
	AccountHint  string     `json:"account_hint,omitempty"`
	OccurredAt   string     `json:"occurred_at,omitempty"`
	Note         string     `json:"note,omitempty"`
	CategoryID   *uuid.UUID `json:"category_id,omitempty"`
	AccountID    *uuid.UUID `json:"account_id,omitempty"`
	Confidence   float64    `json:"confidence"`
}

type VoiceParser interface {
	TranscribeAudio(ctx context.Context, userID uuid.UUID, mime string, data []byte) (string, error)
	ParseVoiceText(ctx context.Context, userID uuid.UUID, transcript string, categories []string) (VoiceExtract, error)
}

func (s *Service) SetVoice(v VoiceParser) {
	s.voice = v
}

type VoiceParseInput struct {
	Text        string
	Mime        string
	AudioBase64 string
}

func (s *Service) ParseVoice(ctx context.Context, userID uuid.UUID, in VoiceParseInput) (VoiceExtract, error) {
	transcript := strings.TrimSpace(in.Text)
	if transcript == "" {
		raw, err := decodeVoiceAudio(in.Mime, in.AudioBase64)
		if err != nil {
			return VoiceExtract{}, err
		}
		if s.voice == nil {
			return VoiceExtract{}, httpx.E(http.StatusServiceUnavailable, "AI_UNAVAILABLE", "voice add requires AI")
		}
		text, err := s.voice.TranscribeAudio(ctx, userID, in.Mime, raw)
		if err != nil {
			return VoiceExtract{}, err
		}
		transcript = strings.TrimSpace(text)
	}
	if transcript == "" {
		return VoiceExtract{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"text": "could not understand that",
		})
	}

	cats, _ := s.store.ListCategories(ctx, userID, "")
	names := make([]string, 0, len(cats))
	for _, c := range cats {
		if !c.Active && !c.IsSystem {
			continue
		}
		names = append(names, c.Kind+":"+c.Name)
		if len(names) >= 40 {
			break
		}
	}

	out := ParseVoiceFallback(transcript)
	if s.voice != nil {
		refined, err := s.voice.ParseVoiceText(ctx, userID, transcript, names)
		if err != nil {
			var api *httpx.APIError
			if errors.As(err, &api) && api.Code == "AI_PREMIUM_REQUIRED" {
				return VoiceExtract{}, err
			}
		} else if refined.Amount != "" {
			refined.Transcript = transcript
			out = refined
		}
	}
	out.Transcript = transcript
	if out.Kind != KindIncome && out.Kind != KindExpense {
		out.Kind = KindExpense
	}
	if id := MatchVoiceCategory(cats, out.Kind, out.CategoryHint, out.Title); id != nil {
		out.CategoryID = id
	}
	if s.accounts != nil {
		if id, err := s.accounts.MatchAccount(ctx, userID, out.AccountHint, out.CurrencyCode); err == nil && id != nil {
			out.AccountID = id
		}
	}
	if out.Confidence == 0 {
		if out.Amount != "" {
			out.Confidence = 0.55
		} else {
			out.Confidence = 0.2
		}
	}
	return out, nil
}

func decodeVoiceAudio(mime, b64 string) ([]byte, error) {
	b64 = strings.TrimSpace(b64)
	if i := strings.Index(b64, "base64,"); i >= 0 {
		b64 = b64[i+len("base64,"):]
	}
	if b64 == "" {
		return nil, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"audio_base64": "required",
		})
	}
	if len(b64) > 16<<20 {
		return nil, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"audio_base64": "audio too large",
		})
	}
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"audio_base64": "invalid base64",
		})
	}
	if len(raw) == 0 {
		return nil, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"audio_base64": "required",
		})
	}
	_ = mime
	return raw, nil
}

var (
	voiceAmountToken = regexp.MustCompile(`(?i)(\d{1,9}(?:[.,]\d{1,2})?)`)
	voiceLast4       = regexp.MustCompile(`\d{4}`)
)

func ParseVoiceFallback(text string) VoiceExtract {
	raw := strings.TrimSpace(text)
	out := VoiceExtract{Transcript: raw, Kind: KindExpense, Confidence: 0.4}
	lower := strings.ToLower(raw)
	if looksLikeIncome(lower) {
		out.Kind = KindIncome
	}
	out.CurrencyCode = currencyFromText(lower)
	amountRaw := ""
	if m := voiceAmountToken.FindStringSubmatch(raw); len(m) > 1 {
		amountRaw = m[1]
		out.Amount = normalizeVoiceAmount(m[1])
	}
	title := raw
	if amountRaw != "" {
		title = strings.Replace(title, amountRaw, " ", 1)
	}
	for _, w := range []string{"birr", "etb", "usd", "dollars", "dollar", "euro", "eur", "gbp", "pounds", "income", "expense", "spent", "paid", "salary"} {
		title = replaceWordCI(title, w)
	}
	out.Title = strings.TrimSpace(strings.Join(strings.Fields(title), " "))
	if out.Title == "" {
		if out.Kind == KindIncome {
			out.Title = "Income"
		} else {
			out.Title = "Expense"
		}
	}
	out.CategoryHint = out.Title
	if m := voiceLast4.FindString(lower); m != "" {
		out.AccountHint = m
	}
	for _, bank := range []string{"telebirr", "cbe", "dashen", "awash", "abyssinia", "boa", "coop", "wallet", "cash"} {
		if strings.Contains(lower, bank) {
			out.AccountHint = bank
			break
		}
	}
	if out.Amount != "" {
		out.Confidence = 0.6
	}
	return out
}

func looksLikeIncome(lower string) bool {
	for _, w := range []string{"income", "salary", "wage", "got paid", "received", "deposit", "refund"} {
		if strings.Contains(lower, w) {
			return true
		}
	}
	return false
}

func currencyFromText(lower string) string {
	switch {
	case strings.Contains(lower, "birr") || strings.Contains(lower, "etb"):
		return "ETB"
	case strings.Contains(lower, "euro") || strings.Contains(lower, "eur"):
		return "EUR"
	case strings.Contains(lower, "pound") || strings.Contains(lower, "gbp"):
		return "GBP"
	case strings.Contains(lower, "dollar") || strings.Contains(lower, "usd"):
		return "USD"
	default:
		return ""
	}
}

func replaceWordCI(s, word string) string {
	ls, lw := strings.ToLower(s), strings.ToLower(word)
	for {
		i := strings.Index(ls, lw)
		if i < 0 {
			return s
		}
		beforeOK := i == 0 || !unicode.IsLetter(rune(s[i-1]))
		after := i + len(word)
		afterOK := after >= len(s) || !unicode.IsLetter(rune(s[after]))
		if beforeOK && afterOK {
			s = strings.TrimSpace(s[:i] + " " + s[after:])
			ls = strings.ToLower(s)
			continue
		}
		ls = ls[:i] + strings.Repeat(" ", len(word)) + ls[i+len(word):]
	}
}

func normalizeVoiceAmount(raw string) string {
	raw = strings.TrimSpace(strings.ReplaceAll(raw, ",", ""))
	if raw == "" {
		return ""
	}
	d, err := decimal.NewFromString(raw)
	if err != nil || !d.GreaterThan(decimal.Zero) {
		return strings.TrimSpace(raw)
	}
	return d.StringFixed(2)
}

func MatchVoiceCategory(cats []Category, kind, hint, title string) *uuid.UUID {
	want := strings.ToLower(strings.TrimSpace(hint))
	if want == "" {
		want = strings.ToLower(strings.TrimSpace(title))
	}
	if want == "" {
		return nil
	}
	var fallback *uuid.UUID
	for i := range cats {
		c := cats[i]
		if kind != "" && c.Kind != kind {
			continue
		}
		name := strings.ToLower(c.Name)
		slug := strings.ToLower(c.Slug)
		if slug == "other" || name == "other" {
			id := c.ID
			fallback = &id
		}
		if name == want || slug == want || strings.Contains(want, name) || strings.Contains(name, want) {
			id := c.ID
			return &id
		}
		for _, part := range strings.Fields(want) {
			if len(part) >= 3 && (strings.Contains(name, part) || strings.Contains(slug, part)) {
				id := c.ID
				return &id
			}
		}
	}
	return fallback
}
