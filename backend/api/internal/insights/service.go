package insights

import (
	"context"
	"net/http"
	"strings"
	"time"

	"equilend/api/internal/goals"
	"equilend/api/internal/httpx"
	"equilend/api/internal/loans"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

type LoanSource interface {
	AllForUser(ctx context.Context, actor uuid.UUID) ([]loans.Record, error)
}

type GoalSource interface {
	List(ctx context.Context, userID uuid.UUID, includeArchived bool) ([]goals.GoalDTO, error)
}

type Service struct {
	store Store
	loans LoanSource
	goals GoalSource
	now   func() time.Time
}

func NewService(store Store) *Service {
	return &Service{store: store, now: time.Now}
}

func (s *Service) SetLoans(l LoanSource) { s.loans = l }
func (s *Service) SetGoals(g GoalSource) { s.goals = g }

func (s *Service) Overview(ctx context.Context, userID uuid.UUID, currency string, monthsBack int) (Overview, error) {
	currency = strings.ToUpper(strings.TrimSpace(currency))
	if len(currency) != 3 {
		return Overview{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"currency": "must be a 3-letter currency code",
		})
	}
	if monthsBack <= 0 {
		monthsBack = 1
	}
	now := s.now().UTC()
	curStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	curEnd := curStart.AddDate(0, 1, 0)
	prevStart := curStart.AddDate(0, -1, 0)

	cur, err := s.store.CashflowTotals(ctx, userID, curStart, curEnd, currency)
	if err != nil {
		return Overview{}, err
	}
	prev, err := s.store.CashflowTotals(ctx, userID, prevStart, curStart, currency)
	if err != nil {
		return Overview{}, err
	}

	out := Overview{
		CurrencyCode: currency,
		PeriodFrom:   curStart.Format("2006-01-02"),
		PeriodTo:     curEnd.Format("2006-01-02"),
		Income:       cur.Income.StringFixed(Scale),
		Expense:      cur.Expense.StringFixed(Scale),
		Net:          cur.Income.Sub(cur.Expense).StringFixed(Scale),
		PrevIncome:   prev.Income.StringFixed(Scale),
		PrevExpense:  prev.Expense.StringFixed(Scale),
		GoalsFunded:  "0.00",
		GoalsTarget:  "0.00",
	}
	if cur.Income.GreaterThan(decimal.Zero) {
		rate := cur.Income.Sub(cur.Expense).Div(cur.Income).Mul(decimal.NewFromInt(100)).InexactFloat64()
		out.SavingsRatePercent = &rate
		dsr := cur.Expense.Div(cur.Income).InexactFloat64() // rough; refined below with loan payments if available
		_ = dsr
	}
	out.IncomeMoMPercent = mom(prev.Income, cur.Income)
	out.ExpenseMoMPercent = mom(prev.Expense, cur.Expense)

	recv, pay := decimal.Zero, decimal.Zero
	if s.loans != nil {
		rows, err := s.loans.AllForUser(ctx, userID)
		if err != nil {
			return Overview{}, err
		}
		for _, row := range rows {
			if !openLoan(row) || row.CurrencyCode == nil || row.ExpectedTotal == nil {
				continue
			}
			if !strings.EqualFold(*row.CurrencyCode, currency) {
				continue
			}
			amt := *row.ExpectedTotal
			if row.LenderID == userID && row.BorrowerID != userID {
				recv = recv.Add(amt)
			} else if row.BorrowerID == userID {
				pay = pay.Add(amt)
			}
		}
	}
	out.OpenReceivables = recv.StringFixed(Scale)
	out.OpenPayables = pay.StringFixed(Scale)

	// Debt service ≈ expenses tagged as loan-ish isn't available; use payables / income as proxy when income > 0
	if cur.Income.GreaterThan(decimal.Zero) && pay.GreaterThan(decimal.Zero) {
		// Monthly debt load estimate: open payables aren't monthly; use expense/income as coverage proxy instead
		ratio := cur.Expense.Div(cur.Income).InexactFloat64()
		out.DebtServiceRatio = &ratio
	}

	funded, target := decimal.Zero, decimal.Zero
	active := 0
	var progSum float64
	if s.goals != nil {
		gs, err := s.goals.List(ctx, userID, false)
		if err != nil {
			return Overview{}, err
		}
		for _, g := range gs {
			if g.Status != goals.StatusActive && g.Status != goals.StatusCompleted {
				continue
			}
			if !strings.EqualFold(g.CurrencyCode, currency) {
				continue
			}
			if g.Status == goals.StatusActive {
				active++
				progSum += g.ProgressPercent
			}
			c, _ := decimal.NewFromString(g.CurrentAmount)
			t, _ := decimal.NewFromString(g.TargetAmount)
			funded = funded.Add(c)
			target = target.Add(t)
		}
	}
	out.ActiveGoals = active
	out.GoalsFunded = funded.StringFixed(Scale)
	out.GoalsTarget = target.StringFixed(Scale)
	if active > 0 {
		avg := progSum / float64(active)
		out.GoalsProgressAvg = &avg
	}
	return out, nil
}

func (s *Service) CashflowSeries(ctx context.Context, userID uuid.UUID, currency string, months int) ([]MonthPoint, error) {
	currency = strings.ToUpper(strings.TrimSpace(currency))
	if len(currency) != 3 {
		return nil, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"currency": "must be a 3-letter currency code",
		})
	}
	if months <= 0 || months > 36 {
		months = 6
	}
	now := s.now().UTC()
	from := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, -(months - 1), 0)
	rows, err := s.store.CashflowSeries(ctx, userID, from, currency)
	if err != nil {
		return nil, err
	}
	byMonth := map[string]MonthlyRow{}
	for _, row := range rows {
		key := row.Month.UTC().Format("2006-01")
		byMonth[key] = row
	}
	out := make([]MonthPoint, 0, months)
	for i := 0; i < months; i++ {
		m := from.AddDate(0, i, 0)
		key := m.Format("2006-01")
		row, ok := byMonth[key]
		if !ok {
			row = MonthlyRow{Month: m, CurrencyCode: currency}
		}
		out = append(out, MonthPoint{
			Month:        key,
			CurrencyCode: currency,
			Income:       row.Income.StringFixed(Scale),
			Expense:      row.Expense.StringFixed(Scale),
			Net:          row.Income.Sub(row.Expense).StringFixed(Scale),
		})
	}
	return out, nil
}

func (s *Service) Categories(ctx context.Context, userID uuid.UUID, currency string, months int) ([]CategoryPoint, error) {
	currency = strings.ToUpper(strings.TrimSpace(currency))
	if len(currency) != 3 {
		return nil, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"currency": "must be a 3-letter currency code",
		})
	}
	if months <= 0 {
		months = 1
	}
	now := s.now().UTC()
	to := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, 1, 0)
	from := to.AddDate(0, -months, 0)
	rows, err := s.store.CategorySpend(ctx, userID, from, to, currency)
	if err != nil {
		return nil, err
	}
	total := decimal.Zero
	for _, r := range rows {
		total = total.Add(r.Amount)
	}
	out := make([]CategoryPoint, 0, len(rows))
	for _, r := range rows {
		share := 0.0
		if total.GreaterThan(decimal.Zero) {
			share = r.Amount.Div(total).Mul(decimal.NewFromInt(100)).InexactFloat64()
		}
		out = append(out, CategoryPoint{
			Category:     r.Category,
			CurrencyCode: r.CurrencyCode,
			Amount:       r.Amount.StringFixed(Scale),
			Count:        r.Count,
			SharePercent: share,
		})
	}
	return out, nil
}

func (s *Service) Debts(ctx context.Context, userID uuid.UUID, preferred string) (DebtsSummary, error) {
	preferred = strings.ToUpper(strings.TrimSpace(preferred))
	by := map[string]*DebtSlice{}
	ensure := func(code string) *DebtSlice {
		code = strings.ToUpper(code)
		if by[code] == nil {
			by[code] = &DebtSlice{CurrencyCode: code, Receivables: "0", Payables: "0", Net: "0"}
		}
		return by[code]
	}
	recvT, payT := decimal.Zero, decimal.Zero
	if s.loans != nil {
		rows, err := s.loans.AllForUser(ctx, userID)
		if err != nil {
			return DebtsSummary{}, err
		}
		recvMap := map[string]decimal.Decimal{}
		payMap := map[string]decimal.Decimal{}
		countMap := map[string]int{}
		for _, row := range rows {
			if !openLoan(row) || row.CurrencyCode == nil || row.ExpectedTotal == nil {
				continue
			}
			code := strings.ToUpper(*row.CurrencyCode)
			amt := *row.ExpectedTotal
			countMap[code]++
			if row.LenderID == userID && row.BorrowerID != userID {
				recvMap[code] = recvMap[code].Add(amt)
			} else if row.BorrowerID == userID {
				payMap[code] = payMap[code].Add(amt)
			}
		}
		for code, recv := range recvMap {
			sl := ensure(code)
			pay := payMap[code]
			sl.Receivables = recv.StringFixed(Scale)
			sl.Payables = pay.StringFixed(Scale)
			sl.Net = recv.Sub(pay).StringFixed(Scale)
			sl.OpenCount = countMap[code]
			if preferred != "" && code == preferred {
				recvT, payT = recv, pay
			}
		}
		for code, pay := range payMap {
			if _, ok := recvMap[code]; ok {
				continue
			}
			sl := ensure(code)
			sl.Payables = pay.StringFixed(Scale)
			sl.Net = pay.Neg().StringFixed(Scale)
			sl.OpenCount = countMap[code]
			if preferred != "" && code == preferred {
				payT = pay
			}
		}
	}
	slices := make([]DebtSlice, 0, len(by))
	for _, sl := range by {
		slices = append(slices, *sl)
	}
	if preferred == "" && len(slices) > 0 {
		preferred = slices[0].CurrencyCode
		recvT, _ = decimal.NewFromString(slices[0].Receivables)
		payT, _ = decimal.NewFromString(slices[0].Payables)
	}
	out := DebtsSummary{
		PreferredCurrency: preferred,
		Receivables:       recvT.StringFixed(Scale),
		Payables:          payT.StringFixed(Scale),
		Net:               recvT.Sub(payT).StringFixed(Scale),
		ByCurrency:        slices,
	}
	if preferred != "" {
		now := s.now().UTC()
		curStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
		curEnd := curStart.AddDate(0, 1, 0)
		tot, err := s.store.CashflowTotals(ctx, userID, curStart, curEnd, preferred)
		if err == nil && tot.Income.GreaterThan(decimal.Zero) {
			r := tot.Expense.Div(tot.Income).InexactFloat64()
			out.DebtServiceRatio = &r
		}
	}
	return out, nil
}

func (s *Service) Goals(ctx context.Context, userID uuid.UUID) ([]GoalInsight, error) {
	if s.goals == nil {
		return []GoalInsight{}, nil
	}
	rows, err := s.goals.List(ctx, userID, false)
	if err != nil {
		return nil, err
	}
	out := make([]GoalInsight, 0, len(rows))
	for _, g := range rows {
		out = append(out, GoalInsight{
			ID:              g.ID,
			Title:           g.Title,
			GoalType:        g.GoalType,
			CurrencyCode:    g.CurrencyCode,
			TargetAmount:    g.TargetAmount,
			CurrentAmount:   g.CurrentAmount,
			ProgressPercent: g.ProgressPercent,
			Status:          g.Status,
			ETAMonths:       g.ETAMonths,
		})
	}
	return out, nil
}

func openLoan(row loans.Record) bool {
	switch row.Status {
	case loans.StatusActive, loans.StatusOverdue, loans.StatusRepaymentPending, loans.StatusPending:
		return true
	default:
		return false
	}
}

func mom(prev, cur decimal.Decimal) *float64 {
	if !prev.GreaterThan(decimal.Zero) {
		return nil
	}
	v := cur.Sub(prev).Div(prev).Mul(decimal.NewFromInt(100)).InexactFloat64()
	return &v
}
