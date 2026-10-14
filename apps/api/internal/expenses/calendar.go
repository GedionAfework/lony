package expenses

import (
	"context"
	"net/http"
	"strings"
	"time"
	_ "time/tzdata"
	"unicode"

	"equilend/api/internal/httpx"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

func normalizeTZ(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "UTC"
	}
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '/' || r == '+' || r == '-' {
			continue
		}
		return "UTC"
	}
	if _, err := time.LoadLocation(s); err != nil {
		return "UTC"
	}
	return s
}

func heatLevel(expense, max decimal.Decimal) int {
	if !expense.GreaterThan(decimal.Zero) || !max.GreaterThan(decimal.Zero) {
		return 0
	}
	r := expense.Div(max).InexactFloat64()
	switch {
	case r < 0.25:
		return 1
	case r < 0.5:
		return 2
	case r < 0.75:
		return 3
	default:
		return 4
	}
}

func calendarWindow(fromRaw, toRaw, tz string, now time.Time) (from, to time.Time, loc *time.Location, err error) {
	tz = normalizeTZ(tz)
	loc, err = time.LoadLocation(tz)
	if err != nil {
		loc = time.UTC
		tz = "UTC"
		err = nil
	}
	parseDay := func(raw string) (time.Time, bool) {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			return time.Time{}, false
		}
		if t, e := time.ParseInLocation("2006-01-02", raw, loc); e == nil {
			return t, true
		}
		if t, e := time.Parse(time.RFC3339, raw); e == nil {
			return t.In(loc), true
		}
		return time.Time{}, false
	}
	from, okFrom := parseDay(fromRaw)
	to, okTo := parseDay(toRaw)
	if okFrom && okTo && to.After(from) {
		return from, to, loc, nil
	}
	now = now.In(loc)
	from = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc)
	to = from.AddDate(0, 1, 0)
	return from, to, loc, nil
}

func (s *Service) Calendar(ctx context.Context, userID uuid.UUID, fromRaw, toRaw, currency, tz string) (CalendarDTO, error) {
	from, to, loc, err := calendarWindow(fromRaw, toRaw, tz, s.now().UTC())
	if err != nil {
		return CalendarDTO{}, err
	}
	currency = strings.ToUpper(strings.TrimSpace(currency))
	if currency != "" && len(currency) != 3 {
		return CalendarDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"currency": "must be a 3-letter currency code",
		})
	}
	rows, err := s.store.CalendarDays(ctx, userID, from, to, currency, loc.String())
	if err != nil {
		return CalendarDTO{}, err
	}
	byDay := map[string]CalendarBucket{}
	maxExp := decimal.Zero
	for _, r := range rows {
		key := r.Day.UTC().Format("2006-01-02")
		byDay[key] = r
		if r.Expense.GreaterThan(maxExp) {
			maxExp = r.Expense
		}
	}
	days := make([]CalendarDayDTO, 0)
	for d := from; d.Before(to); d = d.AddDate(0, 0, 1) {
		key := d.Format("2006-01-02")
		b := byDay[key]
		inc := b.Income
		exp := b.Expense
		days = append(days, CalendarDayDTO{
			Date:         key,
			Income:       inc.StringFixed(Scale),
			Expense:      exp.StringFixed(Scale),
			Net:          inc.Sub(exp).StringFixed(Scale),
			IncomeCount:  b.IncomeCount,
			ExpenseCount: b.ExpenseCount,
			Heat:         heatLevel(exp, maxExp),
		})
	}
	return CalendarDTO{
		From:         from.Format("2006-01-02"),
		To:           to.Format("2006-01-02"),
		CurrencyCode: currency,
		Timezone:     loc.String(),
		MaxExpense:   maxExp.StringFixed(Scale),
		Days:         days,
	}, nil
}
