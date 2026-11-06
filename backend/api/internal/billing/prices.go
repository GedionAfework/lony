package billing

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"

	"equilend/api/internal/httpx"
)

// settingPrices holds the plan prices set in the admin console.
const settingPrices = "plan_prices"

const (
	DiscountPercent = "percent"
	DiscountFlat    = "flat"
)

// Discount lowers one plan price, as a percentage or a flat amount, optionally for a time.
type Discount struct {
	Kind string `json:"kind"` // percent | flat
	// Value: the percentage (e.g. 20) for percent, or cents off (e.g. 500) for flat.
	Value    float64    `json:"value"`
	Label    string     `json:"label,omitempty"`
	StartsAt *time.Time `json:"starts_at,omitempty"`
	EndsAt   *time.Time `json:"ends_at,omitempty"`
}

// PlanPrice is one price card row in the admin console: a tier, how often it bills, and the price.
type PlanPrice struct {
	Tier        string    `json:"tier"`
	Interval    string    `json:"interval"` // month | year
	AmountCents int       `json:"amount_cents"`
	Currency    string    `json:"currency"`
	Discount    *Discount `json:"discount,omitempty"`
}

// Key is the plan key used for checkout (pro_month, plus_year…).
func (p PlanPrice) Key() string { return p.Tier + "_" + p.Interval }

// ActiveDiscount is a discount running now, as the apps show it.
type ActiveDiscount struct {
	Kind     string     `json:"kind"`
	Value    float64    `json:"value"`
	Label    string     `json:"label,omitempty"`
	OffCents int        `json:"off_cents"`
	EndsAt   *time.Time `json:"ends_at,omitempty"`
}

// live reports whether the discount applies at now.
func (d *Discount) live(now time.Time) bool {
	if d == nil || d.Value <= 0 {
		return false
	}
	if d.StartsAt != nil && now.Before(*d.StartsAt) {
		return false
	}
	return d.EndsAt == nil || now.Before(*d.EndsAt)
}

// Apply returns the price to pay now and the discount that made it, if any.
func (p PlanPrice) Apply(now time.Time) (int, *ActiveDiscount) {
	d := p.Discount
	if !d.live(now) {
		return p.AmountCents, nil
	}
	off := 0
	switch d.Kind {
	case DiscountPercent:
		off = int(math.Round(float64(p.AmountCents) * d.Value / 100))
	case DiscountFlat:
		off = int(math.Round(d.Value))
	}
	if off <= 0 {
		return p.AmountCents, nil
	}
	if off > p.AmountCents {
		off = p.AmountCents
	}
	return p.AmountCents - off, &ActiveDiscount{Kind: d.Kind, Value: d.Value, Label: d.Label, OffCents: off, EndsAt: d.EndsAt}
}

// adminPrices returns the prices saved in the admin console, or nil when none were saved.
func (s *Service) adminPrices(ctx context.Context) []PlanPrice {
	raw, err := s.store.GetSetting(ctx, settingPrices)
	if err != nil || strings.TrimSpace(raw) == "" {
		return nil
	}
	var out []PlanPrice
	if json.Unmarshal([]byte(raw), &out) != nil {
		return nil
	}
	return out
}

// EffectivePrices are the prices the admin console starts from: saved ones, else the defaults.
func (s *Service) EffectivePrices(ctx context.Context) ([]PlanPrice, bool) {
	if saved := s.adminPrices(ctx); saved != nil {
		return saved, true
	}
	list := s.cfg.ListPrices
	if len(list) == 0 {
		list = DefaultListPrices
	}
	cur := strings.ToLower(strings.TrimSpace(s.cfg.ListCurrency))
	if cur == "" {
		cur = "usd"
	}
	var out []PlanPrice
	for _, k := range StandardPlans {
		if cents, ok := list[k]; ok && cents > 0 {
			out = append(out, PlanPrice{Tier: TierOfPlanKey(k), Interval: IntervalOfPlanKey(k), AmountCents: cents, Currency: cur})
		}
	}
	return out, false
}

// ValidatePrices checks and tidies prices from the admin console.
func ValidatePrices(in []PlanPrice) ([]PlanPrice, error) {
	bad := func(field, msg string) error {
		return httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{field: msg})
	}
	seen := map[string]bool{}
	out := make([]PlanPrice, 0, len(in))
	for i, p := range in {
		f := fmt.Sprintf("prices[%d]", i)
		p.Tier = strings.ToLower(strings.TrimSpace(p.Tier))
		p.Interval = strings.ToLower(strings.TrimSpace(p.Interval))
		p.Currency = strings.ToLower(strings.TrimSpace(p.Currency))
		if p.Currency == "" {
			p.Currency = "usd"
		}
		if p.Tier != TierPlus && p.Tier != TierPro {
			return nil, bad(f+".tier", "plus or pro")
		}
		if p.Interval != "month" && p.Interval != "year" {
			return nil, bad(f+".interval", "month or year")
		}
		if seen[p.Key()] {
			return nil, bad(f+".interval", fmt.Sprintf("%s already has a %sly price", p.Tier, p.Interval))
		}
		seen[p.Key()] = true
		if p.AmountCents < 1 || p.AmountCents > 100_000_000 {
			return nil, bad(f+".amount_cents", "price must be more than zero")
		}
		if len(p.Currency) != 3 {
			return nil, bad(f+".currency", "3-letter currency code")
		}
		if d := p.Discount; d != nil {
			d.Kind = strings.ToLower(strings.TrimSpace(d.Kind))
			d.Label = strings.TrimSpace(d.Label)
			if len([]rune(d.Label)) > 40 {
				d.Label = string([]rune(d.Label)[:40])
			}
			switch {
			case d.Value <= 0:
				p.Discount = nil // an empty discount is no discount
			case d.Kind == DiscountPercent && d.Value >= 100:
				return nil, bad(f+".discount.value", "percent must be under 100")
			case d.Kind == DiscountFlat && d.Value >= float64(p.AmountCents):
				return nil, bad(f+".discount.value", "flat discount must be less than the price")
			case d.Kind != DiscountPercent && d.Kind != DiscountFlat:
				return nil, bad(f+".discount.kind", "percent or flat")
			case d.StartsAt != nil && d.EndsAt != nil && !d.EndsAt.After(*d.StartsAt):
				return nil, bad(f+".discount.ends_at", "must be after the start")
			}
		}
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Key() < out[j].Key() })
	return out, nil
}
