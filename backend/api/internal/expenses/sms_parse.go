package expenses

import (
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"strconv"
	"strings"
	"time"
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
	SummaryTitle  string  `json:"summary_title,omitempty"`
	StatedBalance string  `json:"stated_balance,omitempty"` // remaining balance printed by the bank
}

var (
	reOTP       = regexp.MustCompile(`(?i)\b(otp|one[-\s]?time|verification code|pin code)\b`)
	reIncome    = regexp.MustCompile(`(?i)\b(you have (?:received|been credited)|has been credited|received|credited|money received|deposit(?:ed)?|payment received)|re[cç]u|cr[eé]dit[eé]|recibid[oa]|recebeu`)
	reExpense   = regexp.MustCompile(`(?i)\b(you have (?:transfered|transferred|sent|paid|been debited|bought)|has been debited|transfered|transferred|debited|money sent|paid|sent|purchase(?:d)?|transaction of|withdraw(?:n|al)?)|d[eé]bit[eé]|envoy[eé]|pagaste|pagou`)
	reBalAny    = regexp.MustCompile(`(?i)\b(?:avail(?:able)?\.?\s*bal(?:ance)?|(?:new|current|available|ledger|remaining|closing|updated|account|e-?money)?\s*balance|solde|saldo)\b[^\d]{0,40}?` + anyCurrencyAlt + `?\s*` + smsNumPat)
	reStatedBal = regexp.MustCompile(`(?i)\b(?:your\s+)?(?:current\s+)?(?:e-?money\s+)?(?:account\s+)?balance\s+is\s+` + anyCurrencyAlt + `?\s*(` + smsNumPat + `)`)
	reAvailBal  = regexp.MustCompile(`(?i)\bAvail(?:able)?\.?\s*Bal(?:ance)?\s*[:.]?\s*` + anyCurrencyAlt + `?\s*(` + smsNumPat + `)`)
	reNewBal    = regexp.MustCompile(`(?i)\b(?:new|remaining|updated|closing|available|current|ledger)\s+balance\s*[:.]?\s*` + anyCurrencyAlt + `?\s*(` + smsNumPat + `)`)
	reVerbAmt   = regexp.MustCompile(`(?i)\b(?:transfered|transferred|received|paid|sent|debited|credited|deposited|withdrawn|withdrew|purchase(?:d)?|bought|spent|charged)\s+(?:with\s+|of\s+|for\s+)?(?:` + anyCurrencyAlt + `\s*)?(` + smsNumPat + `)`)
	reAmtCur    = regexp.MustCompile(`(?i)(?:` + anyCurrencyAlt + `)\s*(` + smsNumPat + `)`)
	reCurAfter  = regexp.MustCompile(`(?i)(` + smsNumPat + `)\s*(?:` + anyCurrencyAlt + `)`)
	reOwnAcct   = regexp.MustCompile(`(?i)\b(?:from your account|your account)\s+([0-9*xX]{4,24})\b`)
	reOwnDebit  = regexp.MustCompile(`(?i)\byour account\s+([0-9*xX]{4,24})\s+has been\s+(?:debited|credited)\b`)
	reOwnMasked = regexp.MustCompile(`(?i)\byour account\s+[0-9]\*{3,}([0-9]{4})\b`)
	reEndingIn  = regexp.MustCompile(`(?i)\b(?:card|account|acct|a/c)\s+ending(?:\s+in)?\s+(\d{4})\b`)
	reEndingIn2 = regexp.MustCompile(`(?i)\bending(?:\s+in)?\s+(\d{4})\b`)
	reToParty   = regexp.MustCompile(`(?i)\b(?:transfered|transferred|sent|paid)\s+(?:` + anyCurrencyAlt + `)?\s*` + smsNumPat + `\s+to\s+([+\dA-Za-z*][+\dA-Za-z0-9 *().'-]{1,50}?)(?:\s+on\b|\s+from\b|\s+Ref\b|\.|,|$)`)
	reFromParty = regexp.MustCompile(`(?i)\breceived\s+(?:` + anyCurrencyAlt + `)?\s*` + smsNumPat + `\s+from\s+([+\dA-Za-z*][+\dA-Za-z0-9 *().'-]{1,50}?)(?:\s+on\b|\.|,|$)`)
	reFromPhone = regexp.MustCompile(`(?i)\bfrom\s+(\+?\d[\d*]{7,14})`)
	rePaidFor   = regexp.MustCompile(`(?i)\bpaid\s+(?:` + anyCurrencyAlt + `)?\s*` + smsNumPat + `\s+for\s+([A-Za-z0-9][A-Za-z0-9 .'-]{1,40}?)(?:\s+on\b|\.|,|$)`)
)

var reSMSDate = regexp.MustCompile(`\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?`)

// extractSMSWhen reads a bank date out of the SMS. Ethiopian alerts are day/month/year.
func extractSMSWhen(raw string) (time.Time, bool) {
	m := reSMSDate.FindStringSubmatch(raw)
	if len(m) < 4 {
		return time.Time{}, false
	}
	day, _ := strconv.Atoi(m[1])
	month, _ := strconv.Atoi(m[2])
	year, _ := strconv.Atoi(m[3])
	if month > 12 && day <= 12 {
		day, month = month, day
	}
	hour, min, sec := 0, 0, 0
	if len(m) > 4 && m[4] != "" {
		hour, _ = strconv.Atoi(m[4])
	}
	if len(m) > 5 && m[5] != "" {
		min, _ = strconv.Atoi(m[5])
	}
	if len(m) > 6 && m[6] != "" {
		sec, _ = strconv.Atoi(m[6])
	}
	nowY := time.Now().Year()
	if year < 2000 || year > nowY+1 || month < 1 || month > 12 || day < 1 || day > 31 {
		return time.Time{}, false
	}
	t := time.Date(year, time.Month(month), day, hour, min, sec, 0, time.Local)
	if t.Day() != day || t.After(time.Now().Add(48*time.Hour)) {
		return time.Time{}, false
	}
	return t.UTC(), true
}

func extractStatedBalance(raw string) string {
	if m := reStatedBal.FindStringSubmatch(raw); len(m) > 1 {
		if amt := normalizeSMSAmount(m[1]); amt != "" {
			return amt
		}
	}
	if m := reAvailBal.FindStringSubmatch(raw); len(m) > 1 {
		if amt := normalizeSMSAmount(m[1]); amt != "" {
			return amt
		}
	}
	if m := reNewBal.FindStringSubmatch(raw); len(m) > 1 {
		if amt := normalizeSMSAmount(m[1]); amt != "" {
			return amt
		}
	}
	return ""
}

func cleanParty(raw string) string {
	s := strings.TrimSpace(raw)
	s = regexp.MustCompile(`\*+`).ReplaceAllString(s, "")
	s = regexp.MustCompile(`\(\s*251[\d*]+\s*\)`).ReplaceAllString(s, "")
	s = strings.Join(strings.Fields(s), " ")
	s = strings.TrimRight(s, ".,;:")
	if len(s) > 60 {
		s = s[:60]
	}
	return s
}

// IsTransferSMS rejects OTP / balance-only noise.
func IsTransferSMS(text string) bool {
	raw := strings.TrimSpace(text)
	if len(raw) < 24 {
		return false
	}
	if reOTP.MatchString(raw) {
		return false
	}
	if strings.Contains(strings.ToLower(raw), "balance is") && !reIncome.MatchString(raw) && !reExpense.MatchString(raw) {
		return false
	}
	low := strings.ToLower(raw)
	if strings.Contains(low, "purchase") || strings.Contains(low, "deposit") || strings.Contains(low, "withdraw") {
		return true
	}
	return reIncome.MatchString(raw) || reExpense.MatchString(raw)
}

func fillOwnAccount(out *ParsedSMS, raw string) {
	if m := reOwnAcct.FindStringSubmatch(raw); len(m) > 1 {
		digits := regexp.MustCompile(`\D`).ReplaceAllString(m[1], "")
		if len(digits) >= 4 {
			out.AccountLast4 = digits[len(digits)-4:]
			if len(digits) > 4 {
				out.AccountNumber = digits
			}
			return
		}
	}
	if m := reOwnDebit.FindStringSubmatch(raw); len(m) > 1 {
		digits := regexp.MustCompile(`\D`).ReplaceAllString(m[1], "")
		if len(digits) >= 4 {
			out.AccountLast4 = digits[len(digits)-4:]
			if len(digits) > 4 {
				out.AccountNumber = digits
			}
			return
		}
	}
	if m := reOwnMasked.FindStringSubmatch(raw); len(m) > 1 {
		out.AccountLast4 = m[1]
		return
	}
	if m := reEndingIn.FindStringSubmatch(raw); len(m) > 1 {
		out.AccountLast4 = m[1]
		return
	}
	if m := reEndingIn2.FindStringSubmatch(raw); len(m) > 1 {
		out.AccountLast4 = m[1]
		return
	}
}

// ParseTransferSMS extracts amount / account / direction from free-form SMS.
func ParseTransferSMS(text string) ParsedSMS {
	raw := strings.TrimSpace(text)
	out := ParsedSMS{}
	if raw == "" {
		return out
	}
	out.StatedBalance = extractStatedBalance(raw)
	fillOwnAccount(&out, raw)
	out.CurrencyCode = detectSMSCurrency(raw)
	if !IsTransferSMS(raw) {
		return out
	}
	score := 0.2

	if reIncome.MatchString(raw) {
		out.Kind = KindIncome
		score += 0.35
	} else if reExpense.MatchString(raw) {
		out.Kind = KindExpense
		score += 0.35
	} else if regexp.MustCompile(`(?i)\b(purchase|withdraw)`).MatchString(raw) {
		out.Kind = KindExpense
		score += 0.35
	} else if regexp.MustCompile(`(?i)\bdeposit`).MatchString(raw) {
		out.Kind = KindIncome
		score += 0.35
	}

	stripped := reBalAny.ReplaceAllString(raw, " ")
	var amt string
	if out.CurrencyCode != "" {
		amt = amountBesideCurrency(stripped, out.CurrencyCode)
	}
	if amt == "" {
		if m := reVerbAmt.FindStringSubmatch(stripped); len(m) > 1 {
			amt = normalizeSMSAmount(m[1])
		} else if m := reAmtCur.FindStringSubmatch(stripped); len(m) > 1 {
			amt = normalizeSMSAmount(m[1])
		} else if m := reCurAfter.FindStringSubmatch(stripped); len(m) > 1 {
			amt = normalizeSMSAmount(m[1])
		}
	}
	if amt != "" {
		out.Amount = amt
		score += 0.4
	}
	if out.CurrencyCode != "" {
		score += 0.05
	}
	if out.AccountLast4 != "" {
		score += 0.15
	}

	if out.Kind == KindExpense {
		if m := reToParty.FindStringSubmatch(raw); len(m) > 1 {
			out.Counterparty = cleanParty(m[1])
		} else if m := rePaidFor.FindStringSubmatch(raw); len(m) > 1 {
			out.Counterparty = cleanParty(m[1])
		}
	} else if out.Kind == KindIncome {
		if m := reFromParty.FindStringSubmatch(raw); len(m) > 1 {
			p := cleanParty(m[1])
			if p != "" && !strings.EqualFold(p, "your") && !strings.EqualFold(p, "account") {
				out.Counterparty = p
			}
		}
		if out.Counterparty == "" {
			if m := reFromPhone.FindStringSubmatch(raw); len(m) > 1 {
				out.Counterparty = cleanParty(m[1])
			}
		}
	}
	if out.Counterparty != "" {
		score += 0.08
	}

	if out.Kind == KindIncome {
		if out.Counterparty != "" {
			out.SummaryTitle = "From " + out.Counterparty
		} else {
			out.SummaryTitle = "Money received"
		}
	} else if out.Kind == KindExpense {
		if out.Counterparty != "" {
			out.SummaryTitle = "To " + out.Counterparty
		} else {
			out.SummaryTitle = "Money sent"
		}
	}

	if out.Amount == "" || out.Kind == "" {
		score = min(score, 0.4)
	}
	if score > 1 {
		score = 1
	}
	out.Confidence = score
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
