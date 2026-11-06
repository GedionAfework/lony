package goals

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"

	"github.com/shopspring/decimal"
)

// InstallmentPlan is a "pay X a month for N months" offer read from a product page.
type InstallmentPlan struct {
	Amount   decimal.Decimal
	Months   int
	Currency string
}

// Total is what the whole plan costs.
func (p InstallmentPlan) Total() decimal.Decimal {
	return p.Amount.Mul(decimal.NewFromInt(int64(p.Months)))
}

const (
	moneyAmt = `([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)`
	moneyCur = `(USD|EUR|GBP|ETB|CAD|AUD|INR|Br|\$|€|£)`
	perMonth = `\s*(?:/|per|a|each|every)\s*(?:mo|mos|mth|month)\b\.?`
	nMonths  = `([0-9]{1,3})\s*(?:-\s*)?(?:mo|mos|mths?|months?|monthly payments|payments|installments|instalments)\b`
)

var (
	scriptStyleRe = regexp.MustCompile(`(?is)<(script|style|noscript)[^>]*>.*?</(?:script|style|noscript)>`)
	// "$68/mo for 24 months", "$68 per month over 24 months", "$68/mo. x 24 mos"
	planMonthlyForRe = regexp.MustCompile(`(?i)` + moneyCur + `\s*` + moneyAmt + perMonth + `[^0-9$€£]{0,30}?(?:for|x|×|over|during|in)\s*` + nMonths)
	// "24 monthly payments of $68", "12 installments of $50"
	planCountOfRe = regexp.MustCompile(`(?i)([0-9]{1,3})\s*(?:equal\s+|interest[- ]free\s+)?(?:monthly\s+)?(?:payments|installments|instalments)\s+of\s+` + moneyCur + `\s*` + moneyAmt)
	// "$68 x 24 months"
	planTimesRe = regexp.MustCompile(`(?i)` + moneyCur + `\s*` + moneyAmt + `\s*(?:x|×)\s*` + nMonths)
	// "24 x $68/mo", "24 × $68 monthly"
	planCountTimesRe = regexp.MustCompile(`(?i)([0-9]{1,3})\s*(?:x|×)\s*` + moneyCur + `\s*` + moneyAmt + `\s*(?:/\s*mo|per month|a month|monthly)`)
	// A monthly price on its own: "$99/month".
	planMonthlyOnlyRe = regexp.MustCompile(`(?i)` + moneyCur + `\s*` + moneyAmt + perMonth)
	// A stated length for the whole programme: "12-month program", "6 month course".
	planLengthRe = regexp.MustCompile(`(?i)\b([0-9]{1,3})[- ]?months?\s+(?:long\s+)?(?:plan|program|programme|course|bootcamp|contract|term|membership|subscription|commitment|financing|payment plan)\b`)
	isoMonthsRe  = regexp.MustCompile(`(?i)^P(?:([0-9]+)Y)?(?:([0-9]+)M)?$`)
)

func curOf(tok string) string {
	switch strings.ToUpper(strings.TrimSpace(tok)) {
	case "$":
		return "USD"
	case "€":
		return "EUR"
	case "£":
		return "GBP"
	case "BR":
		return "ETB"
	default:
		return strings.ToUpper(strings.TrimSpace(tok))
	}
}

func planOf(amount, months, cur string) (InstallmentPlan, bool) {
	a, err := decimal.NewFromString(strings.ReplaceAll(amount, ",", ""))
	if err != nil || !a.IsPositive() {
		return InstallmentPlan{}, false
	}
	n, err := strconv.Atoi(months)
	if err != nil || n < 2 || n > 120 {
		return InstallmentPlan{}, false
	}
	return InstallmentPlan{Amount: a, Months: n, Currency: curOf(cur)}, true
}

// detectInstallmentPlan finds a monthly payment plan on a page: first in its product data,
// then in the visible text. The plan seen most often wins (the real offer is usually repeated).
func detectInstallmentPlan(html string) (InstallmentPlan, bool) {
	if p, ok := installmentFromJSONLD(html); ok {
		return p, true
	}
	text := strings.Join(strings.Fields(htmlUnescape(stripTags(scriptStyleRe.ReplaceAllString(html, " ")))), " ")

	type key struct {
		amount string
		months int
	}
	count := map[key]int{}
	plans := map[key]InstallmentPlan{}
	var order []key
	add := func(p InstallmentPlan, ok bool) {
		if !ok {
			return
		}
		k := key{p.Amount.String(), p.Months}
		if count[k] == 0 {
			order = append(order, k)
			plans[k] = p
		}
		count[k]++
	}
	for _, m := range planMonthlyForRe.FindAllStringSubmatch(text, 20) {
		add(planOf(m[2], m[3], m[1]))
	}
	for _, m := range planCountOfRe.FindAllStringSubmatch(text, 20) {
		add(planOf(m[3], m[1], m[2]))
	}
	for _, m := range planTimesRe.FindAllStringSubmatch(text, 20) {
		add(planOf(m[2], m[3], m[1]))
	}
	for _, m := range planCountTimesRe.FindAllStringSubmatch(text, 20) {
		add(planOf(m[3], m[1], m[2]))
	}
	if len(order) == 0 {
		// "$99/month" plus "12-month program" somewhere else on the page.
		monthly := planMonthlyOnlyRe.FindStringSubmatch(text)
		length := planLengthRe.FindStringSubmatch(text)
		if monthly != nil && length != nil {
			add(planOf(monthly[2], length[1], monthly[1]))
		}
	}
	if len(order) == 0 {
		return InstallmentPlan{}, false
	}
	best := order[0]
	for _, k := range order[1:] {
		if count[k] > count[best] {
			best = k
		}
	}
	return plans[best], true
}

// installmentFromJSONLD reads schema.org offers priced per month with a billing duration,
// e.g. {"price":"68","priceSpecification":{"billingDuration":24,"unitCode":"MON"}}.
func installmentFromJSONLD(html string) (InstallmentPlan, bool) {
	for _, m := range jsonLDRe.FindAllStringSubmatch(html, -1) {
		var v any
		if json.Unmarshal([]byte(strings.TrimSpace(m[1])), &v) != nil {
			continue
		}
		if p, ok := walkInstallment(v, "", ""); ok {
			return p, true
		}
	}
	return InstallmentPlan{}, false
}

func walkInstallment(v any, price, cur string) (InstallmentPlan, bool) {
	switch t := v.(type) {
	case []any:
		for _, item := range t {
			if p, ok := walkInstallment(item, price, cur); ok {
				return p, true
			}
		}
	case map[string]any:
		if s := asString(t["price"]); s != "" {
			price = s
		}
		if s := asString(t["priceCurrency"]); s != "" {
			cur = s
		}
		if months := durationMonths(t["billingDuration"]); months > 0 && price != "" && monthlyUnit(t) {
			if p, ok := planOf(price, strconv.Itoa(months), cur); ok {
				return p, true
			}
		}
		for _, child := range t {
			switch child.(type) {
			case map[string]any, []any:
				if p, ok := walkInstallment(child, price, cur); ok {
					return p, true
				}
			}
		}
	}
	return InstallmentPlan{}, false
}

// monthlyUnit: billed per month (unitCode MON), or no unit given at all.
func monthlyUnit(t map[string]any) bool {
	unit := strings.ToUpper(asString(t["unitCode"]))
	if ref, ok := t["referenceQuantity"].(map[string]any); ok && unit == "" {
		unit = strings.ToUpper(asString(ref["unitCode"]))
	}
	return unit == "" || unit == "MON"
}

// durationMonths reads 24, "24", "P24M" or "P2Y" as a number of months.
func durationMonths(v any) int {
	switch t := v.(type) {
	case float64:
		return int(t)
	case string:
		s := strings.TrimSpace(t)
		if n, err := strconv.Atoi(s); err == nil {
			return n
		}
		if m := isoMonthsRe.FindStringSubmatch(s); m != nil {
			y, _ := strconv.Atoi(m[1])
			mo, _ := strconv.Atoi(m[2])
			return y*12 + mo
		}
	case map[string]any:
		return durationMonths(t["value"])
	}
	return 0
}

// applyInstallmentPlan makes the target the whole plan when the page's price is only one
// payment (or missing). A real full price close to the plan total is kept as it is.
func applyInstallmentPlan(out *PreviewURLResult, plan InstallmentPlan) {
	total := plan.Total()
	out.MonthlyPayment = plan.Amount.StringFixed(2)
	out.PaymentMonths = plan.Months
	if out.Currency != "" && plan.Currency != "" && out.Currency != plan.Currency {
		return
	}
	if p, err := decimal.NewFromString(out.Price); err == nil && p.GreaterThanOrEqual(total.Mul(decimal.NewFromFloat(0.8))) {
		return
	}
	out.Price = total.StringFixed(2)
	if out.Currency == "" {
		out.Currency = plan.Currency
	}
	out.PlanTotal = true
}
