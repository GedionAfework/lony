package expenses

import (
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

// ISO 4217 codes. ALL/TOP/CUP and similar English words only count next to a number.
var smsISOCodes = func() map[string]bool {
	codes := strings.Fields(
		"AED AFN AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD " +
			"CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP " +
			"GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KRW KWD KYD " +
			"KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO " +
			"NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE " +
			"SLL SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND " +
			"VUV WST XAF XCD XOF XPF YER ZAR ZMW ZWL",
	)
	m := make(map[string]bool, len(codes))
	for _, c := range codes {
		m[c] = true
	}
	return m
}()

var smsISOWords = map[string]bool{
	"ALL": true, "TOP": true, "CUP": true, "BOB": true, "SOS": true,
	"PEN": true, "GEL": true, "TRY": true, "MAD": true, "MOP": true, "CAD": true,
}

// Local symbols and names. Longer aliases win ("US$" before "$").
var smsAliases = []struct {
	token string
	code  string
}{
	{"US$", "USD"}, {"USD$", "USD"}, {"CA$", "CAD"}, {"C$", "CAD"}, {"A$", "AUD"}, {"AU$", "AUD"},
	{"NZ$", "NZD"}, {"HK$", "HKD"}, {"S$", "SGD"}, {"MX$", "MXN"}, {"R$", "BRL"}, {"NT$", "TWD"},
	{"J$", "JMD"}, {"TT$", "TTD"}, {"GH₵", "GHS"}, {"GH¢", "GHS"}, {"₵", "GHS"},
	{"Kshs", "KES"}, {"KSh", "KES"}, {"Ksh", "KES"}, {"USh", "UGX"}, {"Ush", "UGX"},
	{"TSh", "TZS"}, {"Tsh", "TZS"}, {"Birr", "ETB"}, {"ብር", "ETB"}, {"Br", "ETB"},
	{"₦", "NGN"}, {"Naira", "NGN"}, {"₹", "INR"}, {"Rs.", "INR"}, {"Rs", "INR"},
	{"₨", "PKR"}, {"₱", "PHP"}, {"Rp", "IDR"}, {"RM", "MYR"}, {"₩", "KRW"}, {"¥", "JPY"},
	{"RMB", "CNY"}, {"元", "CNY"}, {"₫", "VND"}, {"฿", "THB"}, {"₺", "TRY"}, {"TL", "TRY"},
	{"zł", "PLN"}, {"₽", "RUB"}, {"₴", "UAH"}, {"₪", "ILS"}, {"€", "EUR"}, {"£", "GBP"},
	{"Dhs", "AED"}, {"Dh", "AED"}, {"FCFA", "XOF"}, {"CFA", "XOF"},
	{"Kwacha", "ZMW"}, {"Cedis", "GHS"}, {"$", "USD"},
}

var (
	reISOToken = regexp.MustCompile(`\b[A-Z]{3}\b`)
	smsNumPat  = `(?:\d{1,3}(?:[,.\x{00a0} ]\d{3})+(?:[.,]\d{1,3})?|\d+(?:[.,]\d{1,3})?)`
	reSMSNum   = regexp.MustCompile(smsNumPat)
)

func aliasIsWord(token string) bool {
	for _, r := range token {
		if r != '.' && !unicode.IsLetter(r) {
			return false
		}
	}
	return token != ""
}

func lookNearNumberSimple(raw string, start, end int) bool {
	pad := func(s string) string { return strings.TrimSpace(s) }
	after := pad(raw[end:])
	if len(after) > 16 {
		after = after[:16]
	}
	before := pad(raw[:start])
	if len(before) > 16 {
		before = before[len(before)-16:]
	}
	if reSMSNum.FindStringIndex(after) != nil && reSMSNum.FindStringIndex(after)[0] <= 2 {
		return true
	}
	if loc := reSMSNum.FindAllStringIndex(before, -1); len(loc) > 0 {
		last := loc[len(loc)-1]
		return last[1] >= len(before)-2
	}
	return false
}

// detectSMSCurrency returns the ISO code of the first money figure, or the first currency mentioned.
func detectSMSCurrency(raw string) string {
	type hit struct {
		index int
		code  string
		near  bool
	}
	var hits []hit
	for _, m := range reISOToken.FindAllStringIndex(raw, -1) {
		code := raw[m[0]:m[1]]
		if !smsISOCodes[code] {
			continue
		}
		near := lookNearNumberSimple(raw, m[0], m[1])
		if smsISOWords[code] && !near {
			continue
		}
		hits = append(hits, hit{m[0], code, near})
	}
	low := strings.ToLower(raw)
	for _, a := range smsAliases {
		needle := strings.ToLower(a.token)
		from := 0
		for from < len(low) {
			i := strings.Index(low[from:], needle)
			if i < 0 {
				break
			}
			i += from
			end := i + len(needle)
			// Word aliases must not sit inside another word ("Rs" vs "Rsvp").
			if aliasIsWord(a.token) {
				if i > 0 && isLetterByte(low[i-1]) {
					from = i + 1
					continue
				}
				if end < len(low) && isLetterByte(low[end]) {
					from = i + 1
					continue
				}
			}
			hits = append(hits, hit{i, a.code, lookNearNumberSimple(raw, i, end)})
			from = i + 1
		}
	}
	if len(hits) == 0 {
		return ""
	}
	best := hits[0]
	for _, h := range hits[1:] {
		if h.near && !best.near {
			best = h
			continue
		}
		if h.near == best.near && h.index < best.index {
			best = h
		}
	}
	return best.code
}

func isLetterByte(b byte) bool {
	return b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z'
}

func currencyTokens(code string) []string {
	out := []string{code}
	for _, a := range smsAliases {
		if a.code == code {
			out = append(out, a.token)
		}
	}
	return out
}

func escapeRegex(s string) string {
	return regexp.QuoteMeta(s)
}

func amountBesideCurrency(raw, code string) string {
	alt := currencyAlt(code)
	for _, re := range []*regexp.Regexp{
		regexp.MustCompile(`(?i)` + alt + `\s*(` + smsNumPat + `)`),
		regexp.MustCompile(`(?i)(` + smsNumPat + `)\s*` + alt),
	} {
		if m := re.FindStringSubmatch(raw); len(m) > 1 {
			if amt := normalizeSMSAmount(m[1]); amt != "" {
				return amt
			}
		}
	}
	return ""
}

func currencyAlt(code string) string {
	parts := make([]string, 0, 8)
	for _, t := range currencyTokens(code) {
		if aliasIsWord(t) {
			// "Ksh1,200" is valid; don't require a boundary after the letters.
			parts = append(parts, `\b`+escapeRegex(t))
		} else {
			parts = append(parts, escapeRegex(t))
		}
	}
	return `(?:` + strings.Join(parts, "|") + `)`
}

var anyCurrencyAlt = func() string {
	parts := []string{`(?-i:[A-Z]{3})`}
	for _, a := range smsAliases {
		if aliasIsWord(a.token) {
			parts = append(parts, `\b`+escapeRegex(a.token))
		} else {
			parts = append(parts, escapeRegex(a.token))
		}
	}
	return `(?:` + strings.Join(parts, "|") + `)`
}()

// normalizeSMSAmount accepts 1,234.56 · 1.234,56 · 1 234,56 · 1234.
func normalizeSMSAmount(raw string) string {
	s := strings.TrimSpace(raw)
	s = strings.ReplaceAll(s, "\u00a0", "")
	s = strings.ReplaceAll(s, " ", "")
	if s == "" {
		return ""
	}
	lastDot := strings.LastIndex(s, ".")
	lastComma := strings.LastIndex(s, ",")
	if lastDot >= 0 && lastComma >= 0 {
		dec, thou := ".", ","
		if lastComma > lastDot {
			dec, thou = ",", "."
		}
		s = strings.ReplaceAll(s, thou, "")
		s = strings.Replace(s, dec, ".", 1)
	} else if lastComma >= 0 {
		tail := len(s) - lastComma - 1
		groups := strings.Count(s, ",")
		if groups == 1 && tail <= 2 {
			s = strings.Replace(s, ",", ".", 1)
		} else {
			s = strings.ReplaceAll(s, ",", "")
		}
	} else if lastDot >= 0 {
		tail := len(s) - lastDot - 1
		groups := strings.Count(s, ".")
		if groups > 1 || tail == 3 {
			s = strings.ReplaceAll(s, ".", "")
		}
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil || f <= 0 {
		return ""
	}
	return strconv.FormatFloat(f, 'f', 2, 64)
}
