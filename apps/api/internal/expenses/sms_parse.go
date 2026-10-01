package expenses

import (
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"strconv"
	"strings"
)

// ParsedSMS is a best-effort extraction from bank / wallet SMS text.
type ParsedSMS struct {
	Kind          string  `json:"kind,omitempty"` // income | expense
	Amount        string  `json:"amount,omitempty"`
	CurrencyCode  string  `json:"currency_code,omitempty"`
	AccountLast4  string  `json:"account_last4,omitempty"`
	AccountNumber string  `json:"account_number,omitempty"`
	Counterparty  string  `json:"counterparty,omitempty"`
	Confidence    float64 `json:"confidence"`
}

var (
	reCredit = regexp.MustCompile(`(?i)\b(received|credited|credit|deposit|deposited|incoming|you (?:have )?received|sent to you|transfer(?:red)? (?:to|into) (?:your|you)|payment received|inflow)\b`)
	reDebit  = regexp.MustCompile(`(?i)\b(sent|debited|debit|withdrawn|withdrawal|paid|payment (?:of|to)|transfer(?:red)? (?:from|out)|outgoing|you (?:have )?sent|charged)\b`)
	reAmt1   = regexp.MustCompile(`(?i)(?:(?:ETB|USD|EUR|GBP|KES|GHS|NGN|ZAR|AED|Br|\$|€|£|¥|₹|₦)\s*)([\d]{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)`)
	reAmt2   = regexp.MustCompile(`(?i)([\d]{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(?:ETB|USD|EUR|GBP|KES|GHS|NGN|ZAR|AED|Br)`)
	reAmt3   = regexp.MustCompile(`(?i)\b(?:amount|amt|sum)[:\s]+([\d,]+\.?\d*)`)
	reAcct1  = regexp.MustCompile(`(?i)\b(?:a/c|acct|account|acc)(?:\s*(?:no|number|#)?)?[:\s.*-]*([0-9]{4,20})\b`)
	reAcct2  = regexp.MustCompile(`\b([0-9]{10,16})\b`)
	reAcct3  = regexp.MustCompile(`\*{2,}([0-9]{4})\b`)
	reAcct4  = regexp.MustCompile(`(?i)\bend(?:ing)?(?:\s*in)?\s*([0-9]{4})\b`)
	reFromTo = regexp.MustCompile(`(?i)\b(?:from|to|by)\s+([A-Za-z][A-Za-z0-9 .&'\-]{2,40})`)
	reParty  = regexp.MustCompile(`(?i)\b(?:sender|receiver|beneficiary)[:\s]+([A-Za-z][A-Za-z0-9 .&'\-]{2,40})`)
)

func normalizeSMSAmount(raw string) string {
	cleaned := strings.ReplaceAll(strings.TrimSpace(raw), ",", "")
	cleaned = strings.ReplaceAll(cleaned, " ", "")
	f, err := strconv.ParseFloat(cleaned, 64)
	if err != nil || f <= 0 {
		return ""
	}
	return strconv.FormatFloat(f, 'f', 2, 64)
}

// ParseTransferSMS extracts amount / account / direction from free-form SMS.
func ParseTransferSMS(text string) ParsedSMS {
	raw := strings.TrimSpace(text)
	out := ParsedSMS{}
	if raw == "" {
		return out
	}
	score := 0.0
	if reCredit.MatchString(raw) {
		out.Kind = KindIncome
		score += 0.35
	} else if reDebit.MatchString(raw) {
		out.Kind = KindExpense
		score += 0.35
	}
	var amt string
	if m := reAmt1.FindStringSubmatch(raw); len(m) > 1 {
		amt = normalizeSMSAmount(m[1])
	} else if m := reAmt2.FindStringSubmatch(raw); len(m) > 1 {
		amt = normalizeSMSAmount(m[1])
	} else if m := reAmt3.FindStringSubmatch(raw); len(m) > 1 {
		amt = normalizeSMSAmount(m[1])
	}
	if amt != "" {
		out.Amount = amt
		score += 0.4
	}
	upper := strings.ToUpper(raw)
	for _, code := range []string{"ETB", "USD", "EUR", "GBP", "KES", "GHS", "NGN", "ZAR", "AED"} {
		if strings.Contains(upper, code) {
			out.CurrencyCode = code
			score += 0.1
			break
		}
	}
	if out.CurrencyCode == "" {
		switch {
		case strings.Contains(raw, "$"):
			out.CurrencyCode = "USD"
		case strings.Contains(raw, "€"):
			out.CurrencyCode = "EUR"
		case strings.Contains(raw, "£"):
			out.CurrencyCode = "GBP"
		case strings.Contains(raw, "Br"):
			out.CurrencyCode = "ETB"
		}
		if out.CurrencyCode != "" {
			score += 0.05
		}
	}
	var digits string
	for _, re := range []*regexp.Regexp{reAcct1, reAcct3, reAcct4, reAcct2} {
		if m := re.FindStringSubmatch(raw); len(m) > 1 {
			digits = regexp.MustCompile(`\D`).ReplaceAllString(m[1], "")
			if len(digits) >= 4 {
				break
			}
			digits = ""
		}
	}
	if len(digits) >= 4 {
		out.AccountLast4 = digits[len(digits)-4:]
		if len(digits) > 4 {
			out.AccountNumber = digits
		}
		score += 0.15
	}
	if m := reFromTo.FindStringSubmatch(raw); len(m) > 1 {
		out.Counterparty = strings.TrimSpace(m[1])
		score += 0.05
	} else if m := reParty.FindStringSubmatch(raw); len(m) > 1 {
		out.Counterparty = strings.TrimSpace(m[1])
		score += 0.05
	}
	if out.Confidence = score; out.Confidence > 1 {
		out.Confidence = 1
	}
	return out
}

// SMSFingerprint is a stable dedupe key for an SMS body.
func SMSFingerprint(text string) string {
	norm := strings.ToLower(strings.Join(strings.Fields(text), " "))
	if len(norm) > 500 {
		norm = norm[:500]
	}
	sum := sha256.Sum256([]byte(norm))
	return hex.EncodeToString(sum[:16])
}
