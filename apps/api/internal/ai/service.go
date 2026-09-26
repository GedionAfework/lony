package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"equilend/api/internal/httpx"
	"equilend/api/internal/insights"
	"equilend/api/internal/score"

	"github.com/google/uuid"
)

const Disclaimer = "Lony insights are educational estimates, not credit scores, investment advice, or guaranteed outcomes."

type Insight struct {
	ID         uuid.UUID
	UserID     uuid.UUID
	Theme      string
	Severity   string
	Title      string
	Body       string
	Evidence   json.RawMessage
	Source     string
	PeriodFrom *time.Time
	PeriodTo   *time.Time
	CreatedAt  time.Time
}

type InsightDTO struct {
	ID         uuid.UUID       `json:"id"`
	Theme      string          `json:"theme"`
	Severity   string          `json:"severity"`
	Title      string          `json:"title"`
	Body       string          `json:"body"`
	Evidence   json.RawMessage `json:"evidence"`
	Source     string          `json:"source"`
	PeriodFrom *string         `json:"period_from,omitempty"`
	PeriodTo   *string         `json:"period_to,omitempty"`
	CreatedAt  time.Time       `json:"created_at"`
}

type ReportChart struct {
	ID      string         `json:"id"`
	Type    string         `json:"type"`
	Title   string         `json:"title"`
	Caption string         `json:"caption"`
	Data    map[string]any `json:"data"`
}

type Report struct {
	CurrencyCode string        `json:"currency_code"`
	PeriodMonths int           `json:"period_months"`
	Disclaimer   string        `json:"disclaimer"`
	Charts       []ReportChart `json:"charts"`
	Summary      string        `json:"summary"`
}

type CoachReply struct {
	Reply      string   `json:"reply"`
	Disclaimer string   `json:"disclaimer"`
	Actions    []Action `json:"actions,omitempty"`
}

type Action struct {
	Label  string `json:"label"`
	DeepLink string `json:"deep_link"`
}

type Store interface {
	ReplaceInsights(ctx context.Context, userID uuid.UUID, rows []Insight) error
	ListInsights(ctx context.Context, userID uuid.UUID, limit int) ([]Insight, error)
	DismissInsight(ctx context.Context, userID, id uuid.UUID) error
	DismissAllInsights(ctx context.Context, userID uuid.UUID) (int64, error)
}

type Gate interface {
	AIDisabled(ctx context.Context) (bool, error)
}

type InsightsAPI interface {
	Overview(ctx context.Context, userID uuid.UUID, currency string, monthsBack int) (insights.Overview, error)
	CashflowSeries(ctx context.Context, userID uuid.UUID, currency string, months int) ([]insights.MonthPoint, error)
	Categories(ctx context.Context, userID uuid.UUID, currency string, months int) ([]insights.CategoryPoint, error)
}

type ScoreAPI interface {
	Get(ctx context.Context, userID uuid.UUID, currency string, refresh bool) (score.Snapshot, error)
}

type Service struct {
	store Store
	data  InsightsAPI
	score ScoreAPI
	gate  Gate
	now   func() time.Time
}

func NewService(store Store) *Service {
	return &Service{store: store, now: time.Now}
}

func (s *Service) SetInsights(i InsightsAPI) { s.data = i }
func (s *Service) SetScore(sc ScoreAPI)     { s.score = sc }
func (s *Service) SetGate(g Gate)           { s.gate = g }

func (s *Service) ensureAIEnabled(ctx context.Context) error {
	if s.gate == nil {
		return nil
	}
	off, err := s.gate.AIDisabled(ctx)
	if err != nil {
		return err
	}
	if off {
		return httpx.E(http.StatusServiceUnavailable, "AI_DISABLED", "AI features are temporarily disabled")
	}
	return nil
}

func (s *Service) ListInsights(ctx context.Context, userID uuid.UUID) ([]InsightDTO, error) {
	if err := s.ensureAIEnabled(ctx); err != nil {
		return nil, err
	}
	rows, err := s.store.ListInsights(ctx, userID, 30)
	if err != nil {
		return nil, err
	}
	out := make([]InsightDTO, 0, len(rows))
	for _, r := range rows {
		out = append(out, toDTO(r))
	}
	return out, nil
}

func (s *Service) RefreshInsights(ctx context.Context, userID uuid.UUID, currency string) ([]InsightDTO, error) {
	if err := s.ensureAIEnabled(ctx); err != nil {
		return nil, err
	}
	currency = strings.ToUpper(strings.TrimSpace(currency))
	if len(currency) != 3 {
		return nil, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"currency": "must be a 3-letter currency code",
		})
	}
	if s.data == nil {
		return nil, httpx.E(http.StatusServiceUnavailable, "UNAVAILABLE", "insights unavailable")
	}
	now := s.now().UTC()
	from := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	to := from.AddDate(0, 1, 0)
	ov, err := s.data.Overview(ctx, userID, currency, 1)
	if err != nil {
		return nil, err
	}
	series, err := s.data.CashflowSeries(ctx, userID, currency, 3)
	if err != nil {
		return nil, err
	}
	cats, err := s.data.Categories(ctx, userID, currency, 1)
	if err != nil {
		return nil, err
	}

	var rows []Insight
	add := func(theme, severity, title, body string, evidence map[string]any) {
		ev, _ := json.Marshal(evidence)
		f, t := from, to
		rows = append(rows, Insight{
			UserID: userID, Theme: theme, Severity: severity, Title: title, Body: body,
			Evidence: ev, Source: "rules", PeriodFrom: &f, PeriodTo: &t, CreatedAt: now,
		})
	}

	inc, _ := decimalParse(ov.Income)
	exp, _ := decimalParse(ov.Expense)
	if inc > 0 {
		rate := (inc - exp) / inc * 100
		if rate < 0 {
			add("savings", "warning", "Spending above income this month",
				fmt.Sprintf("Your expenses are about %.0f%% of income so far. Trim discretionary categories or pause non-essential goals.", exp/inc*100),
				map[string]any{"income": ov.Income, "expense": ov.Expense, "savings_rate": rate})
		} else if rate >= 20 {
			add("savings", "positive", "Strong savings rate",
				fmt.Sprintf("You're saving about %.0f%% of income this month. Keep confirming salary when it lands.", rate),
				map[string]any{"savings_rate": rate})
		}
	}
	if ov.IncomeMoMPercent != nil && *ov.IncomeMoMPercent <= -15 {
		add("income", "warning", "Income down vs last month",
			fmt.Sprintf("Income is %.0f%% lower than last month. Check expected income that still needs Received.", *ov.IncomeMoMPercent),
			map[string]any{"income_mom_percent": *ov.IncomeMoMPercent})
	}
	if ov.ExpenseMoMPercent != nil && *ov.ExpenseMoMPercent >= 25 {
		add("spending", "warning", "Spending jumped MoM",
			fmt.Sprintf("Expenses rose about %.0f%% versus last month. Review your top categories.", *ov.ExpenseMoMPercent),
			map[string]any{"expense_mom_percent": *ov.ExpenseMoMPercent})
	}
	if len(cats) > 0 && cats[0].SharePercent >= 40 {
		add("category", "info", fmt.Sprintf("%s dominates spending", cats[0].Category),
			fmt.Sprintf("%s is %.0f%% of this month's expenses (%s %s).", cats[0].Category, cats[0].SharePercent, cats[0].Amount, currency),
			map[string]any{"category": cats[0].Category, "share_percent": cats[0].SharePercent, "amount": cats[0].Amount})
	}
	if len(series) >= 2 {
		last := series[len(series)-1]
		prev := series[len(series)-2]
		li, _ := decimalParse(last.Income)
		le, _ := decimalParse(last.Expense)
		pi, _ := decimalParse(prev.Income)
		pe, _ := decimalParse(prev.Expense)
		if pi > 0 && li == 0 && pe > 0 {
			add("consistency", "info", "Quiet income month so far",
				"No confirmed income this month yet while last month had inflows. Mark salary Received if it already landed.",
				map[string]any{"prev_income": prev.Income})
		}
		_ = le
	}
	pay, _ := decimalParse(ov.OpenPayables)
	if pay > 0 && inc > 0 && pay > inc*6 {
		add("debt", "critical", "Payables look heavy vs income",
			"Open amounts you owe are several months of income. Prioritize high-interest or overdue loans.",
			map[string]any{"payables": ov.OpenPayables, "income": ov.Income})
	}
	if ov.ActiveGoals == 0 {
		add("goals", "info", "No active goals",
			"Set a savings or travel goal under Plan so Lony can track funding progress.",
			map[string]any{})
	} else if ov.GoalsProgressAvg != nil && *ov.GoalsProgressAvg < 25 {
		add("goals", "info", "Goals need contributions",
			fmt.Sprintf("Average goal progress is %.0f%%. A small contribution this week moves the needle.", *ov.GoalsProgressAvg),
			map[string]any{"goals_progress_avg": *ov.GoalsProgressAvg})
	}

	if len(rows) == 0 {
		add("overview", "positive", "Books look steady",
			"No major anomalies this period. Keep logging and confirming expected income.",
			map[string]any{"income": ov.Income, "expense": ov.Expense})
	}

	if err := s.store.ReplaceInsights(ctx, userID, rows); err != nil {
		return nil, err
	}
	return s.ListInsights(ctx, userID)
}

func (s *Service) Dismiss(ctx context.Context, userID, id uuid.UUID) error {
	return s.store.DismissInsight(ctx, userID, id)
}

func (s *Service) ClearHistory(ctx context.Context, userID uuid.UUID) (int64, error) {
	return s.store.DismissAllInsights(ctx, userID)
}

func (s *Service) Report(ctx context.Context, userID uuid.UUID, currency string, months int) (Report, error) {
	if err := s.ensureAIEnabled(ctx); err != nil {
		return Report{}, err
	}
	currency = strings.ToUpper(strings.TrimSpace(currency))
	if len(currency) != 3 {
		return Report{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"currency": "must be a 3-letter currency code",
		})
	}
	if months <= 0 || months > 12 {
		months = 6
	}
	if s.data == nil {
		return Report{}, httpx.E(http.StatusServiceUnavailable, "UNAVAILABLE", "insights unavailable")
	}
	series, err := s.data.CashflowSeries(ctx, userID, currency, months)
	if err != nil {
		return Report{}, err
	}
	cats, err := s.data.Categories(ctx, userID, currency, 1)
	if err != nil {
		return Report{}, err
	}
	ov, err := s.data.Overview(ctx, userID, currency, 1)
	if err != nil {
		return Report{}, err
	}
	charts := []ReportChart{
		{
			ID: "cashflow_series", Type: "grouped_bar", Title: "Income vs expense",
			Caption: fmt.Sprintf("Last %d months in %s.", months, currency),
			Data:    map[string]any{"series": series},
		},
		{
			ID: "categories", Type: "bar", Title: "Spending by category",
			Caption: "This month's confirmed expenses.",
			Data:    map[string]any{"categories": cats},
		},
		{
			ID: "month_net", Type: "kpi", Title: "This month net",
			Caption: "Income minus expenses.",
			Data:    map[string]any{"net": ov.Net, "income": ov.Income, "expense": ov.Expense},
		},
	}
	summary := fmt.Sprintf("Net %s %s this month (income %s, expense %s).", currency, ov.Net, ov.Income, ov.Expense)
	return Report{
		CurrencyCode: currency,
		PeriodMonths: months,
		Disclaimer:   Disclaimer,
		Charts:       charts,
		Summary:      summary,
	}, nil
}

func (s *Service) Coach(ctx context.Context, userID uuid.UUID, currency, message string) (CoachReply, error) {
	if err := s.ensureAIEnabled(ctx); err != nil {
		return CoachReply{}, err
	}
	currency = strings.ToUpper(strings.TrimSpace(currency))
	if len(currency) != 3 {
		return CoachReply{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"currency": "must be a 3-letter currency code",
		})
	}
	msg := strings.ToLower(strings.TrimSpace(message))
	if msg == "" {
		return CoachReply{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"message": "required",
		})
	}
	if s.data == nil {
		return CoachReply{}, httpx.E(http.StatusServiceUnavailable, "UNAVAILABLE", "insights unavailable")
	}
	ov, err := s.data.Overview(ctx, userID, currency, 1)
	if err != nil {
		return CoachReply{}, err
	}
	cats, err := s.data.Categories(ctx, userID, currency, 1)
	if err != nil {
		return CoachReply{}, err
	}

	reply := ""
	actions := []Action{}
	switch {
	case strings.Contains(msg, "cut") || strings.Contains(msg, "spend") || strings.Contains(msg, "save"):
		if len(cats) > 0 {
			reply = fmt.Sprintf(
				"Your largest category this month is %s at %s %s (%.0f%% of expenses). Start there: set a budget under Expenses, or move a portion into a Plan goal.",
				cats[0].Category, cats[0].Amount, currency, cats[0].SharePercent,
			)
			actions = append(actions,
				Action{Label: "Create budget", DeepLink: "lony://expenses"},
				Action{Label: "Open goals", DeepLink: "lony://plan"},
			)
		} else {
			reply = "I don't see confirmed expenses yet this month. Log a few spends, then ask again for cut suggestions."
			actions = append(actions, Action{Label: "Log expense", DeepLink: "lony://expenses/new"})
		}
	case strings.Contains(msg, "debt") || strings.Contains(msg, "owe") || strings.Contains(msg, "loan"):
		reply = fmt.Sprintf("You currently show %s %s in open payables and %s %s owed to you. Prioritize overdue loans, then contribute any surplus to goals.",
			ov.OpenPayables, currency, ov.OpenReceivables, currency)
		actions = append(actions, Action{Label: "Open loans", DeepLink: "lony://loans"})
	case strings.Contains(msg, "score") || strings.Contains(msg, "health"):
		if s.score != nil {
			sc, err := s.score.Get(ctx, userID, currency, false)
			if err == nil {
				reply = fmt.Sprintf("Your Lony Trust grade is %s (%s). Focus on: %s",
					sc.Grade, sc.Band, strings.Join(sc.Tips, " "))
			}
		}
		if reply == "" {
			reply = "Open Insights to refresh your Lony Trust grade and see component tips."
		}
		actions = append(actions, Action{Label: "View insights", DeepLink: "lony://insights"})
	default:
		reply = fmt.Sprintf(
			"This month: income %s, expenses %s, net %s %s. Ask me where to cut spending, how debt looks, or how to improve your Lony Trust grade.",
			ov.Income, ov.Expense, ov.Net, currency,
		)
		actions = append(actions,
			Action{Label: "Log expense", DeepLink: "lony://expenses/new"},
			Action{Label: "Open plan", DeepLink: "lony://plan"},
		)
	}

	return CoachReply{Reply: reply, Disclaimer: Disclaimer, Actions: actions}, nil
}

func toDTO(r Insight) InsightDTO {
	dto := InsightDTO{
		ID: r.ID, Theme: r.Theme, Severity: r.Severity, Title: r.Title, Body: r.Body,
		Evidence: r.Evidence, Source: r.Source, CreatedAt: r.CreatedAt,
	}
	if r.PeriodFrom != nil {
		s := r.PeriodFrom.Format("2006-01-02")
		dto.PeriodFrom = &s
	}
	if r.PeriodTo != nil {
		s := r.PeriodTo.Format("2006-01-02")
		dto.PeriodTo = &s
	}
	return dto
}

func decimalParse(raw string) (float64, error) {
	var d float64
	_, err := fmt.Sscanf(strings.TrimSpace(raw), "%f", &d)
	return d, err
}
