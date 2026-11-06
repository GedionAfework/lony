package ai

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"

	"github.com/shopspring/decimal"
)

// decodeLoose fills dst from a model's JSON reply even when the model mixes up types:
// "amount": 12.5 instead of "12.50", "confidence": "0.9" instead of 0.9, or null values.
// numberKeys are the fields dst expects as numbers; every other scalar becomes a string.
func decodeLoose(raw string, dst any, numberKeys ...string) bool {
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return false
	}
	isNum := map[string]bool{}
	for _, k := range numberKeys {
		isNum[k] = true
	}
	for k, v := range m {
		switch t := v.(type) {
		case nil:
			delete(m, k)
		case float64:
			if !isNum[k] {
				m[k] = strconv.FormatFloat(t, 'f', -1, 64)
			}
		case bool:
			if !isNum[k] {
				m[k] = strconv.FormatBool(t)
			}
		case string:
			if isNum[k] {
				if f, err := strconv.ParseFloat(strings.TrimSpace(strings.TrimSuffix(t, "%")), 64); err == nil {
					if strings.HasSuffix(t, "%") {
						f /= 100
					}
					m[k] = f
				} else {
					delete(m, k)
				}
			}
		case map[string]any, []any:
			if !isNum[k] {
				delete(m, k)
			}
		}
	}
	fixed, err := json.Marshal(m)
	if err != nil {
		return false
	}
	return json.Unmarshal(fixed, dst) == nil
}

var (
	amountDigitsRe = regexp.MustCompile(`[0-9][0-9.,\s']*`)
	// "12,50" or "1.234,56": comma is the decimal mark.
	commaDecimalRe = regexp.MustCompile(`^[0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{1,2}$`)
)

// normalizeAmount turns what a model or a receipt says ("ETB 1,250.00", "$12.5",
// "12,50 €", "1 250") into "1250.00". It returns "" when there is no positive number.
func normalizeAmount(raw string) string {
	tok := strings.TrimSpace(amountDigitsRe.FindString(raw))
	tok = strings.NewReplacer(" ", "", " ", "", "'", "").Replace(tok)
	tok = strings.TrimRight(tok, ".,")
	if tok == "" {
		return ""
	}
	if commaDecimalRe.MatchString(tok) {
		tok = strings.ReplaceAll(tok, ".", "")
		tok = strings.Replace(tok, ",", ".", 1)
	} else {
		tok = strings.ReplaceAll(tok, ",", "")
	}
	d, err := decimal.NewFromString(tok)
	if err != nil || !d.GreaterThan(decimal.Zero) {
		return ""
	}
	return d.StringFixed(2)
}
