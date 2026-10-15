package score

import (
	"context"
	"encoding/json"
	"math"
	"strings"
	"time"

	"equilend/api/internal/goals"
	"equilend/api/internal/insights"
	"equilend/api/internal/loans"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

const Scale = 2

// Component weights — peer-lending trust first (must sum to 1.0).
const (
	wRepayment    = 0.35
	wDebt         = 0.25
	wConsistency  = 0.15
	wLiquidity    = 0.10
	wSavings      = 0.10
	wGoals        = 0.05
)

const (
	GradeA = "A"
	GradeB = "B"
	GradeC = "C"
	GradeD = "D"
	GradeE = "E"
)

type Snapshot struct {
	ID               uuid.UUID      `json:"id,omitempty"`
	Grade            string         `json:"grade"`
	Band             string         `json:"band"`
	Points           float64        `json:"points"`
	CurrencyCode     string         `json:"currency_code"`
	LiquidityScore   float64        `json:"liquidity_score"`
	SavingsScore     float64        `json:"savings_score"`
	DebtScore        float64        `json:"debt_score"`
	ConsistencyScore float64        `json:"consistency_score"`
	GoalsScore       float64        `json:"goals_score"`
	RepaymentScore   float64        `json:"repayment_score"`
	Components       map[string]any `json:"components"`
	Tips             []string       `json:"tips"`
	ThinHistory      bool           `json:"thin_history"`
	LoanSampleSize   int            `json:"loan_sample_size"`
	ComputedAt       time.Time      `json:"computed_at"`
}

type Record struct {
	ID               uuid.UUID
	UserID           uuid.UUID
	Grade            string
	Points           decimal.Decimal
	CurrencyCode     string
	LiquidityScore   decimal.Decimal
	SavingsScore     decimal.Decimal
	DebtScore        decimal.Decimal
	ConsistencyScore decimal.Decimal
	GoalsScore       decimal.Decimal
	RepaymentScore   decimal.Decimal
	Components       json.RawMessage
	ThinHistory      bool
	LoanSampleSize   int
	ComputedAt       time.Time
}

type Inputs struct {
	Currency          string
	CashOnHand        decimal.Decimal
	MonthExpense      decimal.Decimal
	TrailingIncome    decimal.Decimal
	TrailingExpense   decimal.Decimal
	OpenPayables      decimal.Decimal
	OpenReceivables   decimal.Decimal
	OverdueLoanCount  int
	ActiveBorrowCount int
	ExpectedIncome    int
	ConfirmedIncome   int
	LoggedDays30      int
	ActiveGoals       int
	GoalsOnTrack      int
	GoalsProgressAvg  float64
	RepaymentsTotal   int
	RepaymentsOK      int
	LoanTouches       int // loans as borrower or lender (accepted+)
}

type Store interface {
	Insert(ctx context.Context, rec Record) (Record, error)
	Latest(ctx context.Context, userID uuid.UUID) (Record, error)
	History(ctx context.Context, userID uuid.UUID, limit int) ([]Record, error)
}

type WealthSource interface {
	CashOnHand(ctx context.Context, userID uuid.UUID, currency string) (decimal.Decimal, error)
}

type InsightsSource interface {
	Overview(ctx context.Context, userID uuid.UUID, currency string, monthsBack int) (insights.Overview, error)
	CashflowSeries(ctx context.Context, userID uuid.UUID, currency string, months int) ([]insights.MonthPoint, error)
}

type LoanSource interface {
	AllForUser(ctx context.Context, actor uuid.UUID) ([]loans.Record, error)
}

type GoalSource interface {
	List(ctx context.Context, userID uuid.UUID, includeArchived bool) ([]goals.GoalDTO, error)
}

type ConsistencySource interface {
	IncomeConfirmStats(ctx context.Context, userID uuid.UUID, from, to time.Time) (expected, confirmed int, err error)
	LoggedDayCount(ctx context.Context, userID uuid.UUID, from, to time.Time) (int, error)
	RepaymentStats(ctx context.Context, userID uuid.UUID) (total, confirmed int, err error)
}

// Compute builds a 0–100 trust index and maps it to grade A–E.
func Compute(in Inputs) Snapshot {
	repay := clamp100(repaymentPts(in.RepaymentsTotal, in.RepaymentsOK, in.OverdueLoanCount))
	debt := clamp100(debtPts(in.OpenPayables, in.TrailingIncome, in.OverdueLoanCount, in.ActiveBorrowCount))
	cons := clamp100(consistencyPts(in.ExpectedIncome, in.ConfirmedIncome, in.LoggedDays30))
	liq := clamp100(liquidityPts(in.CashOnHand, in.MonthExpense))
	sav := clamp100(savingsPts(in.TrailingIncome, in.TrailingExpense))
	goal := clamp100(goalsPts(in.ActiveGoals, in.GoalsOnTrack, in.GoalsProgressAvg))

	points := repay*wRepayment + debt*wDebt + cons*wConsistency + liq*wLiquidity + sav*wSavings + goal*wGoals
	points = clamp100(points)

	thin := in.LoanTouches < 2 && in.RepaymentsTotal < 2
	grade := gradeFromPoints(points)
	if thin && (grade == GradeA) {
		grade = GradeB // need a real sample before "Strong"
	}
	// Hard floor: any overdue open loan cannot be A
	if in.OverdueLoanCount > 0 && grade == GradeA {
		grade = GradeB
	}
	if in.OverdueLoanCount >= 2 {
		grade = worseGrade(grade, GradeD)
	}

	comps := map[string]any{
		"repayment":    map[string]any{"score": repay, "weight": wRepayment, "total": in.RepaymentsTotal, "confirmed": in.RepaymentsOK},
		"debt_burden":  map[string]any{"score": debt, "weight": wDebt, "payables": in.OpenPayables.StringFixed(Scale), "overdue_loans": in.OverdueLoanCount, "active_borrows": in.ActiveBorrowCount},
		"consistency":  map[string]any{"score": cons, "weight": wConsistency, "expected_income": in.ExpectedIncome, "confirmed_income": in.ConfirmedIncome, "logged_days_30": in.LoggedDays30},
		"liquidity":    map[string]any{"score": liq, "weight": wLiquidity, "cash": in.CashOnHand.StringFixed(Scale), "month_expense": in.MonthExpense.StringFixed(Scale)},
		"savings_rate": map[string]any{"score": sav, "weight": wSavings, "income_3m": in.TrailingIncome.StringFixed(Scale), "expense_3m": in.TrailingExpense.StringFixed(Scale)},
		"goals":        map[string]any{"score": goal, "weight": wGoals, "active": in.ActiveGoals, "on_track": in.GoalsOnTrack, "progress_avg": in.GoalsProgressAvg},
	}

	return Snapshot{
		Grade:            grade,
		Band:             bandLabel(grade, thin),
		Points:           points,
		CurrencyCode:     strings.ToUpper(in.Currency),
		LiquidityScore:   liq,
		SavingsScore:     sav,
		DebtScore:        debt,
		ConsistencyScore: cons,
		GoalsScore:       goal,
		RepaymentScore:   repay,
		Components:       comps,
		Tips:             tips(in, repay, debt, cons, liq, sav, goal),
		ThinHistory:      thin,
		LoanSampleSize:   in.LoanTouches,
		ComputedAt:       time.Now().UTC(),
	}
}

func gradeFromPoints(points float64) string {
	switch {
	case points >= 85:
		return GradeA
	case points >= 70:
		return GradeB
	case points >= 55:
		return GradeC
	case points >= 40:
		return GradeD
	default:
		return GradeE
	}
}

func bandLabel(grade string, thin bool) string {
	base := map[string]string{
		GradeA: "Strong",
		GradeB: "Good",
		GradeC: "Fair",
		GradeD: "Watch",
		GradeE: "High risk",
	}[grade]
	if thin && grade != GradeE {
		return base + " · thin history"
	}
	return base
}

func worseGrade(a, b string) string {
	order := map[string]int{GradeA: 5, GradeB: 4, GradeC: 3, GradeD: 2, GradeE: 1}
	if order[a] < order[b] {
		return a
	}
	return b
}

func liquidityPts(cash, expense decimal.Decimal) float64 {
	if !expense.GreaterThan(decimal.Zero) {
		if cash.GreaterThan(decimal.Zero) {
			return 80
		}
		return 50
	}
	months := cash.Div(expense).InexactFloat64()
	if months <= 0 {
		return 15
	}
	if months >= 6 {
		return 100
	}
	if months >= 3 {
		return 70 + (months-3)/3*30
	}
	return 20 + months/3*50
}

func savingsPts(income, expense decimal.Decimal) float64 {
	if !income.GreaterThan(decimal.Zero) {
		return 40
	}
	rate := income.Sub(expense).Div(income).InexactFloat64()
	if rate <= -0.2 {
		return 10
	}
	if rate >= 0.35 {
		return 100
	}
	if rate < 0 {
		return 40 + rate/0.2*30
	}
	return 40 + rate/0.35*60
}

func debtPts(payables, income3m decimal.Decimal, overdue, activeBorrows int) float64 {
	base := 90.0
	if income3m.GreaterThan(decimal.Zero) {
		monthly := income3m.Div(decimal.NewFromInt(3))
		if monthly.GreaterThan(decimal.Zero) {
			burden := payables.Div(monthly).InexactFloat64()
			if burden >= 12 {
				base = 10
			} else if burden <= 0 {
				base = 95
			} else {
				base = 95 - burden/12*85
			}
		}
	} else if payables.GreaterThan(decimal.Zero) {
		base = 40
	}
	base -= float64(overdue) * 18
	if activeBorrows >= 4 {
		base -= 12
	} else if activeBorrows >= 3 {
		base -= 6
	}
	return base
}

func consistencyPts(expected, confirmed, loggedDays int) float64 {
	recv := 50.0
	if expected > 0 {
		recv = float64(confirmed) / float64(expected) * 100
	}
	logPts := float64(loggedDays) / 20.0 * 100
	if logPts > 100 {
		logPts = 100
	}
	return recv*0.6 + logPts*0.4
}

func goalsPts(active, onTrack int, progressAvg float64) float64 {
	if active <= 0 {
		return 50
	}
	track := float64(onTrack) / float64(active) * 100
	return track*0.5 + clamp100(progressAvg)*0.5
}

func repaymentPts(total, ok, overdue int) float64 {
	if total <= 0 {
		// No repayment sample — neutral-low; grade capped elsewhere via thin history
		return 55
	}
	rate := float64(ok) / float64(total) * 100
	rate -= float64(overdue) * 15
	return rate
}

func tips(in Inputs, repay, debt, cons, liq, sav, goal float64) []string {
	type pair struct {
		score float64
		tip   string
	}
	cands := []pair{
		{repay, "Confirm and complete repayments on time — this drives most of your Trust grade."},
		{debt, "Clear overdue loans and keep open borrows manageable vs income."},
		{cons, "Confirm expected income when it lands and log spends regularly."},
		{liq, "Keep a cash buffer of at least 1–3 months of expenses."},
		{sav, "Improve savings rate after essentials (aim for 10%+ of income)."},
		{goal, "Fund an active goal so lenders see follow-through."},
	}
	if in.LoanTouches < 2 {
		return []string{
			"Build a short loan history on Lony (a few completed loans) so your grade reflects real repayment behavior.",
			cands[0].tip,
		}
	}
	out := make([]string, 0, 3)
	used := map[string]bool{}
	for len(out) < 3 {
		bestI := -1
		for i, c := range cands {
			if used[c.tip] {
				continue
			}
			if bestI < 0 || c.score < cands[bestI].score {
				bestI = i
			}
		}
		if bestI < 0 {
			break
		}
		used[cands[bestI].tip] = true
		if cands[bestI].score < 75 {
			out = append(out, cands[bestI].tip)
		}
	}
	if len(out) == 0 {
		out = append(out, "Keep confirming repayments on time to hold a Strong trust grade.")
	}
	return out
}

func clamp100(v float64) float64 {
	if math.IsNaN(v) || v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return math.Round(v*100) / 100
}

// PublicTrust is the lender-facing grade (no full ledger breakdown).
type PublicTrust struct {
	Grade          string    `json:"grade"`
	Band           string    `json:"band"`
	ThinHistory    bool      `json:"thin_history"`
	LoanSampleSize int       `json:"loan_sample_size"`
	RepaymentScore float64   `json:"repayment_score"`
	Available      bool      `json:"available"`
	ComputedAt     time.Time `json:"computed_at,omitempty"`
}

func ToDTO(rec Record) Snapshot {
	comps := map[string]any{}
	_ = json.Unmarshal(rec.Components, &comps)
	grade := rec.Grade
	if grade == "" {
		grade = gradeFromPoints(mustFloat(rec.Points))
	}
	repay := mustFloat(rec.RepaymentScore)
	debt := mustFloat(rec.DebtScore)
	cons := mustFloat(rec.ConsistencyScore)
	liq := mustFloat(rec.LiquidityScore)
	sav := mustFloat(rec.SavingsScore)
	goal := mustFloat(rec.GoalsScore)
	return Snapshot{
		ID:               rec.ID,
		Grade:            grade,
		Band:             bandLabel(grade, rec.ThinHistory),
		Points:           mustFloat(rec.Points),
		CurrencyCode:     rec.CurrencyCode,
		LiquidityScore:   liq,
		SavingsScore:     sav,
		DebtScore:        debt,
		ConsistencyScore: cons,
		GoalsScore:       goal,
		RepaymentScore:   repay,
		Components:       comps,
		Tips:             tipsFromScores(repay, debt, cons, liq, sav, goal, rec.ThinHistory),
		ThinHistory:      rec.ThinHistory,
		LoanSampleSize:   rec.LoanSampleSize,
		ComputedAt:       rec.ComputedAt,
	}
}

func tipsFromScores(repay, debt, cons, liq, sav, goal float64, thin bool) []string {
	type pair struct {
		score float64
		tip   string
	}
	cands := []pair{
		{repay, "Confirm and complete repayments on time — this drives most of your Trust grade."},
		{debt, "Reduce open borrows or clear overdue loans before taking more."},
		{cons, "Confirm expected income when it lands and log spends regularly."},
		{liq, "Keep a clearer cash buffer vs monthly expenses."},
		{sav, "Raise your savings rate after essentials."},
		{goal, "Fund an active goal so progress stays visible."},
	}
	out := make([]string, 0, 3)
	used := map[string]bool{}
	for len(out) < 3 {
		bestI := -1
		for i, c := range cands {
			if used[c.tip] {
				continue
			}
			if bestI < 0 || c.score < cands[bestI].score {
				bestI = i
			}
		}
		if bestI < 0 {
			break
		}
		used[cands[bestI].tip] = true
		if cands[bestI].score < 75 {
			out = append(out, cands[bestI].tip)
		}
	}
	if thin {
		out = append([]string{"Build a short loan history on Lony so your grade reflects real repayment behavior."}, out...)
		if len(out) > 3 {
			out = out[:3]
		}
	}
	if len(out) == 0 {
		out = append(out, "Keep confirming repayments on time to hold a Strong trust grade.")
	}
	return out
}

func mustFloat(d decimal.Decimal) float64 {
	f, _ := d.Float64()
	return f
}
