package accounts

import (
	"context"
	"net/http"
	"sort"
	"strings"
	"time"

	"equilend/api/internal/auth"
	"equilend/api/internal/fx"
	"equilend/api/internal/httpx"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// AccountAt is one account's balance now and the money that moved through it after a moment.
type AccountAt struct {
	ID           uuid.UUID
	Type         string
	CurrencyCode string
	Balance      decimal.Decimal
	// NetAfter: confirmed income minus expenses dated after the moment.
	NetAfter    decimal.Decimal
	TransferIn  decimal.Decimal
	TransferOut decimal.Decimal
}

// BalanceAt is the balance at the moment: what the account held before the later money moved.
// Card balances count debt (spending raises them), so their movements run the other way.
func (a AccountAt) BalanceAt() decimal.Decimal {
	moved := a.NetAfter.Add(a.TransferIn).Sub(a.TransferOut)
	if a.Type == TypeCreditCard {
		moved = moved.Neg()
	}
	return a.Balance.Sub(moved)
}

// DayFlow is the confirmed money in or out in one currency during a day.
type DayFlow struct {
	CurrencyCode string
	Kind         string
	Amount       decimal.Decimal
	Count        int
}

// DayLedger is implemented by the SQL store.
type DayLedger interface {
	AccountsAt(ctx context.Context, userID uuid.UUID, at time.Time) ([]AccountAt, error)
	DayFlows(ctx context.Context, userID uuid.UUID, from, to time.Time) ([]DayFlow, error)
}

// DaySummary is one calendar day: money in, money out, and the balance at its end.
type DaySummary struct {
	From         time.Time `json:"from"`
	To           time.Time `json:"to"`
	CurrencyCode string    `json:"currency_code"`
	// Balance: money in accounts at the end of the day, minus card balances.
	Balance   string   `json:"balance"`
	Assets    string   `json:"assets"`
	Cards     string   `json:"cards"`
	Income    string   `json:"income"`
	Expense   string   `json:"expense"`
	Net       string   `json:"net"`
	Entries   int      `json:"entries"`
	Accounts  int      `json:"accounts"`
	Converted bool     `json:"converted"`
	Missing   []string `json:"missing_rates,omitempty"`
}

// DaySummary adds every currency into target (today's rate) so the day reads as one number.
func (s *Service) DaySummary(ctx context.Context, userID uuid.UUID, target string, from, to time.Time) (DaySummary, error) {
	ledger, ok := s.store.(DayLedger)
	if !ok {
		return DaySummary{}, httpx.E(http.StatusServiceUnavailable, "UNAVAILABLE", "day summary is not available")
	}
	if !to.After(from) || to.Sub(from) > 49*time.Hour {
		return DaySummary{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"to": "must be after from, at most two days later",
		})
	}
	target = strings.ToUpper(strings.TrimSpace(target))

	accts, err := ledger.AccountsAt(ctx, userID, to)
	if err != nil {
		return DaySummary{}, err
	}
	flows, err := ledger.DayFlows(ctx, userID, from, to)
	if err != nil {
		return DaySummary{}, err
	}
	if target == "" {
		target = biggestCurrency(accts)
	}
	if target == "" {
		target = "USD"
	}

	var rates map[string]decimal.Decimal
	needRates := false
	for _, a := range accts {
		needRates = needRates || !strings.EqualFold(a.CurrencyCode, target)
	}
	for _, f := range flows {
		needRates = needRates || !strings.EqualFold(f.CurrencyCode, target)
	}
	if needRates && s.fx != nil {
		rctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		rates, _, _ = s.fx.Rates(rctx, target)
		cancel()
	}
	missing := map[string]bool{}
	conv := func(v decimal.Decimal, code string) (decimal.Decimal, bool) {
		code = strings.ToUpper(code)
		if code == target || v.IsZero() {
			return v, true
		}
		if rates == nil {
			missing[code] = true
			return decimal.Zero, false
		}
		c, err := fx.Convert(v, code, target, rates)
		if err != nil {
			missing[code] = true
			return decimal.Zero, false
		}
		return c, true
	}

	var assets, cards, income, expense decimal.Decimal
	converted := false
	for _, a := range accts {
		v, ok := conv(a.BalanceAt(), a.CurrencyCode)
		if !ok {
			continue
		}
		converted = converted || !strings.EqualFold(a.CurrencyCode, target)
		if a.Type == TypeCreditCard {
			cards = cards.Add(v)
		} else {
			assets = assets.Add(v)
		}
	}
	entries := 0
	for _, f := range flows {
		entries += f.Count
		v, ok := conv(f.Amount, f.CurrencyCode)
		if !ok {
			continue
		}
		converted = converted || !strings.EqualFold(f.CurrencyCode, target)
		if f.Kind == "income" {
			income = income.Add(v)
		} else {
			expense = expense.Add(v)
		}
	}
	out := DaySummary{
		From:         from,
		To:           to,
		CurrencyCode: target,
		Balance:      assets.Sub(cards).StringFixed(Scale),
		Assets:       assets.StringFixed(Scale),
		Cards:        cards.StringFixed(Scale),
		Income:       income.StringFixed(Scale),
		Expense:      expense.StringFixed(Scale),
		Net:          income.Sub(expense).StringFixed(Scale),
		Entries:      entries,
		Accounts:     len(accts),
		Converted:    converted,
	}
	for code := range missing {
		out.Missing = append(out.Missing, code)
	}
	sort.Strings(out.Missing)
	return out, nil
}

// biggestCurrency is the currency holding the most money, for users with no default set.
func biggestCurrency(accts []AccountAt) string {
	sums := map[string]decimal.Decimal{}
	for _, a := range accts {
		code := strings.ToUpper(a.CurrencyCode)
		sums[code] = sums[code].Add(a.Balance.Abs())
	}
	best, bestV := "", decimal.Zero
	for code, v := range sums {
		if best == "" || v.GreaterThan(bestV) || (v.Equal(bestV) && code < best) {
			best, bestV = code, v
		}
	}
	return best
}

// Day serves GET /wealth/day?from=…&to=…&currency=…, the bounds of the user's local day.
func (h *Handler) Day(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	from, err1 := time.Parse(time.RFC3339, q.Get("from"))
	to, err2 := time.Parse(time.RFC3339, q.Get("to"))
	if err1 != nil || err2 != nil {
		httpx.Error(w, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"from": "from and to must be RFC3339 times",
		}))
		return
	}
	out, err := h.svc.DaySummary(r.Context(), auth.UserIDFrom(r.Context()), q.Get("currency"), from.UTC(), to.UTC())
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"day": out})
}
