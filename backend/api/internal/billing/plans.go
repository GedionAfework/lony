// Package billing owns paid plans: what each tier may do, Polar checkout and
// webhooks, sign-up trials, and the numbers the admin console shows.
package billing

import (
	"encoding/json"
	"strings"
)

const (
	TierFree = "free"
	TierPlus = "plus"
	TierPro  = "pro"

	SourceFree  = "free"
	SourceTrial = "trial"
	SourceAdmin = "admin"
	SourcePolar = "polar"

	settingLimits    = "plan_limits"
	settingTrialDays = "trial_days"
	settingTrialTier = "trial_tier"
)

var Tiers = []string{TierFree, TierPlus, TierPro}

func ValidTier(t string) bool { return t == TierFree || t == TierPlus || t == TierPro }

// Limits is what one tier may use. -1 means unlimited, 0 means not included.
type Limits struct {
	// AI coach, plan chat, insight write-ups and report write-ups per calendar month.
	AIMonthly int `json:"ai_monthly"`
	// Hard ceiling on AI requests per day, whatever the monthly allowance.
	AIDaily int `json:"ai_daily"`
	// Receipt scans and voice entries per calendar month.
	CapturesMonthly int `json:"captures_monthly"`
	// Minimum days between insight refreshes (0 = any time).
	InsightsEveryDays int `json:"insights_every_days"`
	// Analytics reports.
	Reports bool `json:"reports"`
	// Connected banks through Plaid.
	BankLinks int `json:"bank_links"`
	// Trip budgets.
	Trips bool `json:"trips"`
}

// DefaultLimits are used until an admin edits them.
func DefaultLimits() map[string]Limits {
	return map[string]Limits{
		TierFree: {AIMonthly: 10, AIDaily: 5, CapturesMonthly: 15, InsightsEveryDays: 7, Reports: false, BankLinks: 0, Trips: false},
		TierPlus: {AIMonthly: -1, AIDaily: 15, CapturesMonthly: 200, InsightsEveryDays: 1, Reports: true, BankLinks: 0, Trips: true},
		TierPro:  {AIMonthly: -1, AIDaily: 40, CapturesMonthly: -1, InsightsEveryDays: 0, Reports: true, BankLinks: 3, Trips: true},
	}
}

// parseLimits reads the stored JSON over the defaults so a missing tier or
// field never leaves a hole.
func parseLimits(raw string) map[string]Limits {
	out := DefaultLimits()
	if strings.TrimSpace(raw) == "" {
		return out
	}
	var stored map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &stored); err != nil {
		return out
	}
	for _, t := range Tiers {
		if b, ok := stored[t]; ok {
			l := out[t]
			if json.Unmarshal(b, &l) == nil {
				out[t] = l
			}
		}
	}
	return out
}

// TierOfPlanKey turns "pro_year" or "plus_month_eur" into its tier.
func TierOfPlanKey(key string) string {
	t, _, _ := strings.Cut(strings.ToLower(strings.TrimSpace(key)), "_")
	if t == TierPlus || t == TierPro {
		return t
	}
	return ""
}

// IntervalOfPlanKey returns "month" or "year" when the key says so.
func IntervalOfPlanKey(key string) string {
	k := strings.ToLower(key)
	switch {
	case strings.Contains(k, "_year"), strings.Contains(k, "_annual"):
		return "year"
	case strings.Contains(k, "_month"):
		return "month"
	}
	return ""
}

// Unlimited reports whether a numeric limit has no ceiling.
func Unlimited(n int) bool { return n < 0 }
