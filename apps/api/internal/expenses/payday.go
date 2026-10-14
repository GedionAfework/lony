package expenses

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"equilend/api/internal/httpx"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
)

func clampPaydayDay(day int) int {
	if day < 1 {
		return 1
	}
	if day > 28 {
		return 28
	}
	return day
}

func paydayWindow(now time.Time, day int) (from, to time.Time) {
	now = now.UTC()
	day = clampPaydayDay(day)
	y, m, _ := now.Date()
	candidate := time.Date(y, m, day, 0, 0, 0, 0, time.UTC)
	if now.Before(candidate) {
		return candidate.AddDate(0, -1, 0), candidate
	}
	return candidate, candidate.AddDate(0, 1, 0)
}

func weeklyWindow(now, anchor time.Time) (from, to time.Time) {
	now = now.UTC()
	anchor = anchor.UTC()
	for anchor.After(now) {
		anchor = anchor.AddDate(0, 0, -7)
	}
	from = anchor
	to = anchor.AddDate(0, 0, 7)
	for !now.Before(to) {
		from = to
		to = to.AddDate(0, 0, 7)
	}
	return from, to
}

func cyclePace(now, from, to time.Time) (elapsed, total, left, pacePct int) {
	now = now.UTC()
	if !to.After(from) {
		return 0, 1, 0, 0
	}
	total = int(to.Sub(from).Hours() / 24)
	if total < 1 {
		total = 1
	}
	elapsed = int(now.Sub(from).Hours() / 24)
	if elapsed < 0 {
		elapsed = 0
	}
	if elapsed > total {
		elapsed = total
	}
	left = total - elapsed
	pacePct = int(float64(elapsed) / float64(total) * 100)
	if pacePct > 100 {
		pacePct = 100
	}
	return elapsed, total, left, pacePct
}

func spentPctOf(spent, limit decimal.Decimal) int {
	if !limit.GreaterThan(decimal.Zero) {
		return 0
	}
	pct := int(spent.Div(limit).Mul(decimal.NewFromInt(100)).IntPart())
	if pct < 0 {
		return 0
	}
	return pct
}

func (s *Service) resolvePayday(ctx context.Context, userID uuid.UUID) (day int, from, to time.Time, source string, err error) {
	now := s.now().UTC()
	settings, err := s.store.GetPayday(ctx, userID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return 0, time.Time{}, time.Time{}, "", err
	}
	if settings.PaydayDay != nil {
		day = clampPaydayDay(*settings.PaydayDay)
		from, to = paydayWindow(now, day)
		return day, from, to, "setting", nil
	}
	tTrue := true
	tmpls, err := s.store.List(ctx, userID, ListQuery{Kind: KindIncome, Templates: &tTrue, Limit: 100})
	if err != nil {
		return 0, time.Time{}, time.Time{}, "", err
	}
	var best *Entry
	for i := range tmpls {
		t := &tmpls[i]
		if t.Paused || t.Recurrence == nil {
			continue
		}
		if *t.Recurrence != RecurrenceMonthly && *t.Recurrence != RecurrenceWeekly {
			continue
		}
		if best == nil || t.Amount.GreaterThan(best.Amount) {
			best = t
		}
	}
	if best != nil && best.Recurrence != nil && *best.Recurrence == RecurrenceWeekly {
		anchor := now
		if best.NextOccurrenceAt != nil {
			anchor = best.NextOccurrenceAt.UTC()
		} else {
			anchor = best.OccurredAt.UTC()
		}
		from, to = weeklyWindow(now, anchor)
		return from.Day(), from, to, "income", nil
	}
	if best != nil {
		d := best.OccurredAt.Day()
		if best.NextOccurrenceAt != nil {
			d = best.NextOccurrenceAt.Day()
		}
		day = clampPaydayDay(d)
		from, to = paydayWindow(now, day)
		return day, from, to, "income", nil
	}
	from, to = paydayWindow(now, 1)
	return 1, from, to, "month", nil
}

func (s *Service) ListBudgets(ctx context.Context, userID uuid.UUID, periodRaw string) ([]BudgetDTO, *PaydayDTO, error) {
	month := s.now().UTC()
	if strings.TrimSpace(periodRaw) != "" {
		m, err := parsePeriodMonth(periodRaw)
		if err != nil {
			return nil, nil, err
		}
		month = m
	} else {
		month = time.Date(month.Year(), month.Month(), 1, 0, 0, 0, 0, time.UTC)
	}
	day, from, to, source, err := s.resolvePayday(ctx, userID)
	if err != nil {
		return nil, nil, err
	}
	now := s.now().UTC()
	elapsed, total, left, pacePct := cyclePace(now, from, to)
	rows, err := s.store.ListBudgets(ctx, userID, month)
	if err != nil {
		return nil, nil, err
	}
	out := make([]BudgetDTO, 0, len(rows))
	for _, row := range rows {
		dto, err := s.budgetDTO(ctx, userID, row, from, to, pacePct)
		if err != nil {
			return nil, nil, err
		}
		out = append(out, dto)
	}
	payday, err := s.paydayDTO(ctx, userID, day, from, to, source, elapsed, total, left, pacePct)
	if err != nil {
		return nil, nil, err
	}
	return out, payday, nil
}

func (s *Service) paydayDTO(ctx context.Context, userID uuid.UUID, day int, from, to time.Time, source string, elapsed, total, left, pacePct int) (*PaydayDTO, error) {
	settings, err := s.store.GetPayday(ctx, userID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	currency := ""
	if settings.CurrencyCode != nil {
		currency = strings.ToUpper(strings.TrimSpace(*settings.CurrencyCode))
	}
	slices, err := s.store.Summary(ctx, userID, &from, &to)
	if err != nil {
		return nil, err
	}
	spent := decimal.Zero
	if currency != "" {
		for _, sl := range slices {
			if strings.EqualFold(sl.CurrencyCode, currency) {
				spent = mustDec(sl.Expense)
				break
			}
		}
	} else if len(slices) > 0 {
		spent = mustDec(slices[0].Expense)
		currency = slices[0].CurrencyCode
	}
	dto := &PaydayDTO{
		PaydayDay:    &day,
		Source:       source,
		CycleStart:   from.Format("2006-01-02"),
		CycleEnd:     to.Format("2006-01-02"),
		DaysTotal:    total,
		DaysElapsed:  elapsed,
		DaysLeft:     left,
		PacePct:      pacePct,
		CurrencyCode: currency,
		Spent:        spent.StringFixed(Scale),
	}
	if settings.PaydayDay != nil {
		dto.PaydayDay = settings.PaydayDay
	}
	if settings.SpendLimit != nil && settings.SpendLimit.GreaterThan(decimal.Zero) {
		lim := settings.SpendLimit.StringFixed(Scale)
		dto.LimitAmount = &lim
		rem := settings.SpendLimit.Sub(spent).StringFixed(Scale)
		dto.Remaining = &rem
		paceAmt := settings.SpendLimit.Mul(decimal.NewFromInt(int64(pacePct))).Div(decimal.NewFromInt(100))
		pa := paceAmt.StringFixed(Scale)
		dto.PaceAmount = &pa
		pct := spentPctOf(spent, *settings.SpendLimit)
		dto.SpentPct = &pct
		dto.Ahead = spent.GreaterThan(paceAmt)
		if pct >= 100 {
			dto.Alert = "100"
		} else if pct >= 80 {
			dto.Alert = "80"
		}
	}
	return dto, nil
}

func (s *Service) UpsertPayday(ctx context.Context, userID uuid.UUID, in PaydayInput) (*PaydayDTO, error) {
	existing, err := s.store.GetPayday(ctx, userID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	rec := existing
	rec.UserID = userID
	if in.PaydayDay != nil {
		if *in.PaydayDay == 0 {
			rec.PaydayDay = nil
		} else {
			d := clampPaydayDay(*in.PaydayDay)
			rec.PaydayDay = &d
		}
	}
	if in.ClearLimit {
		rec.SpendLimit = nil
		rec.CurrencyCode = nil
	}
	if in.SpendLimit != nil {
		raw := strings.TrimSpace(*in.SpendLimit)
		if raw == "" || raw == "0" {
			rec.SpendLimit = nil
		} else {
			lim, err := parsePositive(raw)
			if err != nil {
				return nil, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
					"spend_limit": "must be a positive decimal",
				})
			}
			rec.SpendLimit = &lim
		}
	}
	if in.CurrencyCode != nil {
		c := strings.ToUpper(strings.TrimSpace(*in.CurrencyCode))
		if c != "" && len(c) != 3 {
			return nil, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"currency_code": "must be a 3-letter currency code",
			})
		}
		if c == "" {
			rec.CurrencyCode = nil
		} else {
			rec.CurrencyCode = &c
		}
	}
	rec.UpdatedAt = s.now().UTC()
	if _, err := s.store.UpsertPayday(ctx, rec); err != nil {
		return nil, err
	}
	_, payday, err := s.ListBudgets(ctx, userID, "")
	return payday, err
}

func (s *Service) CheckBudgetAlerts(ctx context.Context) (int, error) {
	ids, err := s.store.ListPaydayUserIDs(ctx)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, id := range ids {
		c, err := s.checkUserBudgetAlerts(ctx, id)
		if err != nil {
			return n, err
		}
		n += c
	}
	return n, nil
}

func (s *Service) checkUserBudgetAlerts(ctx context.Context, userID uuid.UUID) (int, error) {
	if s.notify == nil {
		return 0, nil
	}
	now := s.now().UTC()
	month := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	_, from, to, _, err := s.resolvePayday(ctx, userID)
	if err != nil {
		return 0, err
	}
	_, _, _, pacePct := cyclePace(now, from, to)
	n := 0
	payday, err := s.paydayDTO(ctx, userID, 1, from, to, "setting", 0, 1, 0, pacePct)
	if err != nil {
		return 0, err
	}
	if payday.LimitAmount != nil && payday.SpentPct != nil {
		c, err := s.fireBudgetAlert(ctx, userID, "payday", from, "Payday", *payday.SpentPct, payday.Spent, *payday.LimitAmount, payday.CurrencyCode)
		if err != nil {
			return n, err
		}
		n += c
	}
	rows, err := s.store.ListBudgets(ctx, userID, month)
	if err != nil {
		return n, err
	}
	for _, row := range rows {
		dto, err := s.budgetDTO(ctx, userID, row, from, to, pacePct)
		if err != nil {
			return n, err
		}
		c, err := s.fireBudgetAlert(ctx, userID, row.ID.String(), from, row.CategoryName, dto.SpentPct, dto.Spent, dto.LimitAmount, dto.CurrencyCode)
		if err != nil {
			return n, err
		}
		n += c
	}
	return n, nil
}

func (s *Service) fireBudgetAlert(ctx context.Context, userID uuid.UUID, scope string, cycleStart time.Time, category string, spentPct int, spent, limit, currency string) (int, error) {
	n := 0
	for _, th := range []int{100, 80} {
		if spentPct < th {
			continue
		}
		ok, err := s.store.ClaimBudgetAlert(ctx, userID, scope, cycleStart, th)
		if err != nil {
			return n, err
		}
		if !ok {
			continue
		}
		_ = s.notify.NotifyBudgetAlert(ctx, userID, category, th, spent, limit, currency)
		n++
	}
	return n, nil
}

func mustDec(raw string) decimal.Decimal {
	d, err := decimal.NewFromString(strings.TrimSpace(raw))
	if err != nil {
		return decimal.Zero
	}
	return d
}
