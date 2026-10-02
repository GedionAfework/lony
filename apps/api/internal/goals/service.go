package goals

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"equilend/api/internal/httpx"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
)

type AccountDebiter interface {
	ApplyCashflowDelta(ctx context.Context, userID, accountID uuid.UUID, kind string, amount decimal.Decimal, currency, note string) error
}

type MilestoneNotifier interface {
	OnGoalMilestone(ctx context.Context, userID, goalID uuid.UUID, title string, threshold int, progressPercent float64) error
}

type Service struct {
	store      Store
	accounts   AccountDebiter
	milestones MilestoneNotifier
	extractor  PlanExtractor
	now        func() time.Time
}

func NewService(store Store) *Service {
	return &Service{store: store, now: time.Now}
}

func (s *Service) SetAccounts(a AccountDebiter) {
	s.accounts = a
}

func (s *Service) SetMilestoneNotifier(n MilestoneNotifier) {
	s.milestones = n
}

func (s *Service) List(ctx context.Context, userID uuid.UUID, includeArchived bool) ([]GoalDTO, error) {
	rows, err := s.store.List(ctx, userID, includeArchived)
	if err != nil {
		return nil, err
	}
	out := make([]GoalDTO, 0, len(rows))
	for _, row := range rows {
		rate, _ := s.monthlyRate(ctx, userID, row.ID)
		out = append(out, toDTO(row, rate))
	}
	return out, nil
}

func (s *Service) Get(ctx context.Context, userID, id uuid.UUID) (GoalDTO, error) {
	rec, err := s.store.Get(ctx, userID, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return GoalDTO{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "goal not found")
		}
		return GoalDTO{}, err
	}
	rate, _ := s.monthlyRate(ctx, userID, id)
	return toDTO(rec, rate), nil
}

func (s *Service) Create(ctx context.Context, userID uuid.UUID, in CreateInput) (GoalDTO, error) {
	title := strings.TrimSpace(in.Title)
	if title == "" || utf8.RuneCountInString(title) > 120 {
		return GoalDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"title": "required, max 120 characters",
		})
	}
	gtype, err := normalizeType(in.GoalType)
	if err != nil {
		return GoalDTO{}, err
	}
	currency := strings.ToUpper(strings.TrimSpace(in.CurrencyCode))
	if len(currency) != 3 {
		return GoalDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"currency_code": "must be a 3-letter currency code",
		})
	}
	target, err := parsePositive(in.TargetAmount)
	if err != nil {
		return GoalDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"target_amount": "must be a positive decimal",
		})
	}
	current := decimal.Zero
	if in.CurrentAmount != nil && strings.TrimSpace(*in.CurrentAmount) != "" {
		c, err := parseNonNeg(*in.CurrentAmount)
		if err != nil {
			return GoalDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"current_amount": "must be a non-negative decimal",
			})
		}
		current = c
	}
	td, err := parseOptionalDate(in.TargetDate)
	if err != nil {
		return GoalDTO{}, err
	}
	srcURL, err := normalizeSourceURL(in.SourceURL)
	if err != nil {
		return GoalDTO{}, err
	}
	now := s.now().UTC()
	status := StatusActive
	if current.GreaterThanOrEqual(target) {
		status = StatusCompleted
		current = target
	}
	var lastSeen *decimal.Decimal
	var checkedAt *time.Time
	if srcURL != nil {
		lastSeen = &target
		checkedAt = &now
		if in.LastSeenPrice != nil && strings.TrimSpace(*in.LastSeenPrice) != "" {
			p, err := parsePositive(*in.LastSeenPrice)
			if err != nil {
				return GoalDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
					"last_seen_price": "must be a positive decimal",
				})
			}
			lastSeen = &p
		}
		if in.LastPriceCheckedAt != nil {
			t := in.LastPriceCheckedAt.UTC()
			checkedAt = &t
		}
	}
	rec := Goal{
		UserID:          userID,
		Title:           title,
		GoalType:        gtype,
		CurrencyCode:    currency,
		TargetAmount:    target,
		CurrentAmount:   current,
		TargetDate:      td,
		LinkedAccountID: in.LinkedAccountID,
		LinkedLoanID:    in.LinkedLoanID,
		Note:            cleanOpt(in.Note, 500),
		TypeLabel:       cleanOpt(in.TypeLabel, 80),
		Status:          status,
		CreatedAt:       now,
		UpdatedAt:       now,

		SourceURL:          srcURL,
		LastSeenPrice:      lastSeen,
		LastPriceCheckedAt: checkedAt,
	}
	saved, err := s.store.Insert(ctx, rec)
	if err != nil {
		return GoalDTO{}, err
	}
	return toDTO(saved, nil), nil
}

func (s *Service) Update(ctx context.Context, userID, id uuid.UUID, in UpdateInput) (GoalDTO, error) {
	rec, err := s.store.Get(ctx, userID, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return GoalDTO{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "goal not found")
		}
		return GoalDTO{}, err
	}
	if in.Title != nil {
		title := strings.TrimSpace(*in.Title)
		if title == "" || utf8.RuneCountInString(title) > 120 {
			return GoalDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"title": "required, max 120 characters",
			})
		}
		rec.Title = title
	}
	if in.GoalType != nil {
		gtype, err := normalizeType(*in.GoalType)
		if err != nil {
			return GoalDTO{}, err
		}
		rec.GoalType = gtype
	}
	if in.CurrencyCode != nil {
		currency := strings.ToUpper(strings.TrimSpace(*in.CurrencyCode))
		if len(currency) != 3 {
			return GoalDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"currency_code": "must be a 3-letter currency code",
			})
		}
		rec.CurrencyCode = currency
	}
	if in.TargetAmount != nil {
		target, err := parsePositive(*in.TargetAmount)
		if err != nil {
			return GoalDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"target_amount": "must be a positive decimal",
			})
		}
		rec.TargetAmount = target
	}
	if in.ClearTargetDate {
		rec.TargetDate = nil
	} else if in.TargetDate != nil {
		td, err := parseOptionalDate(in.TargetDate)
		if err != nil {
			return GoalDTO{}, err
		}
		rec.TargetDate = td
	}
	if in.ClearAccount {
		rec.LinkedAccountID = nil
	} else if in.LinkedAccountID != nil {
		rec.LinkedAccountID = in.LinkedAccountID
	}
	if in.ClearLoan {
		rec.LinkedLoanID = nil
	} else if in.LinkedLoanID != nil {
		rec.LinkedLoanID = in.LinkedLoanID
	}
	if in.Note != nil {
		rec.Note = cleanOpt(in.Note, 500)
	}
	if in.TypeLabel != nil {
		rec.TypeLabel = cleanOpt(in.TypeLabel, 80)
	}
	if in.Status != nil {
		st, err := normalizeStatus(*in.Status)
		if err != nil {
			return GoalDTO{}, err
		}
		rec.Status = st
	}
	if in.SourceURL != nil {
		srcURL, err := normalizeSourceURL(in.SourceURL)
		if err != nil {
			return GoalDTO{}, err
		}
		changed := (srcURL == nil) != (rec.SourceURL == nil) || (srcURL != nil && rec.SourceURL != nil && *srcURL != *rec.SourceURL)
		rec.SourceURL = srcURL
		if srcURL == nil {
			rec.LastSeenPrice = nil
			rec.LastPriceCheckedAt = nil
		} else if changed {
			seen := rec.TargetAmount
			now := s.now().UTC()
			rec.LastSeenPrice = &seen
			rec.LastPriceCheckedAt = &now
		}
	}
	if in.LastSeenPrice != nil {
		if strings.TrimSpace(*in.LastSeenPrice) == "" {
			rec.LastSeenPrice = nil
		} else {
			p, err := parsePositive(*in.LastSeenPrice)
			if err != nil {
				return GoalDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
					"last_seen_price": "must be a positive decimal",
				})
			}
			rec.LastSeenPrice = &p
		}
	}
	if in.LastPriceCheckedAt != nil {
		t := in.LastPriceCheckedAt.UTC()
		rec.LastPriceCheckedAt = &t
	}
	if rec.CurrentAmount.GreaterThanOrEqual(rec.TargetAmount) && rec.Status == StatusActive {
		rec.Status = StatusCompleted
	}
	rec.UpdatedAt = s.now().UTC()
	saved, err := s.store.Update(ctx, rec)
	if err != nil {
		return GoalDTO{}, err
	}
	rate, _ := s.monthlyRate(ctx, userID, id)
	return toDTO(saved, rate), nil
}

func (s *Service) SetCoverImage(ctx context.Context, userID, id uuid.UUID, key string) (GoalDTO, error) {
	rec, err := s.store.Get(ctx, userID, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return GoalDTO{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "goal not found")
		}
		return GoalDTO{}, err
	}
	key = strings.TrimSpace(key)
	if key == "" {
		rec.CoverImageKey = nil
	} else {
		rec.CoverImageKey = &key
	}
	rec.UpdatedAt = s.now().UTC()
	saved, err := s.store.Update(ctx, rec)
	if err != nil {
		return GoalDTO{}, err
	}
	rate, _ := s.monthlyRate(ctx, userID, id)
	return toDTO(saved, rate), nil
}

func (s *Service) Contribute(ctx context.Context, userID, id uuid.UUID, in ContributeInput) (GoalDTO, ContributionDTO, error) {
	rec, err := s.store.Get(ctx, userID, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return GoalDTO{}, ContributionDTO{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "goal not found")
		}
		return GoalDTO{}, ContributionDTO{}, err
	}
	if rec.Status == StatusArchived {
		return GoalDTO{}, ContributionDTO{}, httpx.E(http.StatusConflict, "ARCHIVED", "goal is archived")
	}
	amount, err := parsePositive(in.Amount)
	if err != nil {
		return GoalDTO{}, ContributionDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"amount": "must be a positive decimal",
		})
	}
	oldPct := progressPercent(rec)
	accountID := in.AccountID
	if accountID == nil {
		accountID = rec.LinkedAccountID
	}
	now := s.now().UTC()
	note := cleanOpt(in.Note, 500)
	if in.DebitAccount && accountID != nil && s.accounts != nil {
		n := rec.Title
		if note != nil {
			n = *note
		}
		if err := s.accounts.ApplyCashflowDelta(ctx, userID, *accountID, "expense", amount, rec.CurrencyCode, n); err != nil {
			return GoalDTO{}, ContributionDTO{}, err
		}
	}
	c := Contribution{
		GoalID:       rec.ID,
		UserID:       userID,
		Amount:       amount,
		CurrencyCode: rec.CurrencyCode,
		AccountID:    accountID,
		Note:         note,
		OccurredAt:   now,
		CreatedAt:    now,
	}
	savedC, err := s.store.InsertContribution(ctx, c)
	if err != nil {
		return GoalDTO{}, ContributionDTO{}, err
	}
	rec.CurrentAmount = rec.CurrentAmount.Add(amount)
	if rec.CurrentAmount.GreaterThanOrEqual(rec.TargetAmount) {
		rec.CurrentAmount = rec.TargetAmount
		rec.Status = StatusCompleted
	} else if rec.Status == StatusCompleted {
		rec.Status = StatusActive
	}
	rec.UpdatedAt = now
	saved, err := s.store.Update(ctx, rec)
	if err != nil {
		return GoalDTO{}, ContributionDTO{}, err
	}
	newPct := progressPercent(saved)
	s.emitMilestones(ctx, userID, saved, oldPct, newPct)
	rate, _ := s.monthlyRate(ctx, userID, id)
	return toDTO(saved, rate), toContributionDTO(savedC), nil
}

func progressPercent(rec Goal) float64 {
	if !rec.TargetAmount.GreaterThan(decimal.Zero) {
		return 0
	}
	pct := rec.CurrentAmount.Div(rec.TargetAmount).Mul(decimal.NewFromInt(100)).InexactFloat64()
	if pct > 100 {
		return 100
	}
	return pct
}

func (s *Service) emitMilestones(ctx context.Context, userID uuid.UUID, goal Goal, oldPct, newPct float64) {
	if s.milestones == nil {
		return
	}
	for _, t := range []int{25, 50, 75, 100} {
		th := float64(t)
		if oldPct >= th || newPct < th {
			continue
		}
		claimed, err := s.store.ClaimMilestone(ctx, goal.ID, t)
		if err != nil || !claimed {
			continue
		}
		_ = s.milestones.OnGoalMilestone(ctx, userID, goal.ID, goal.Title, t, newPct)
	}
}

func (s *Service) ListContributions(ctx context.Context, userID, id uuid.UUID) ([]ContributionDTO, error) {
	if _, err := s.store.Get(ctx, userID, id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, httpx.E(http.StatusNotFound, "NOT_FOUND", "goal not found")
		}
		return nil, err
	}
	rows, err := s.store.ListContributions(ctx, userID, id, 100)
	if err != nil {
		return nil, err
	}
	out := make([]ContributionDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, toContributionDTO(row))
	}
	return out, nil
}

func (s *Service) Projection(ctx context.Context, userID, id uuid.UUID) (ProjectionDTO, error) {
	rec, err := s.store.Get(ctx, userID, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ProjectionDTO{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "goal not found")
		}
		return ProjectionDTO{}, err
	}
	rate, count, err := s.monthlyRateWithCount(ctx, userID, id)
	if err != nil {
		return ProjectionDTO{}, err
	}
	remaining := rec.TargetAmount.Sub(rec.CurrentAmount)
	if remaining.IsNegative() {
		remaining = decimal.Zero
	}
	out := ProjectionDTO{
		GoalID:            rec.ID,
		Remaining:         remaining.StringFixed(Scale),
		MonthlyRate:       decimal.Zero.StringFixed(Scale),
		ContributionCount: count,
	}
	if rate != nil {
		out.MonthlyRate = rate.StringFixed(Scale)
		if remaining.GreaterThan(decimal.Zero) && rate.GreaterThan(decimal.Zero) {
			m := int(remaining.Div(*rate).Ceil().IntPart())
			if m < 1 {
				m = 1
			}
			out.ETAMonths = &m
		}
	}
	if rec.TargetDate != nil {
		dateStr := rec.TargetDate.Format("2006-01-02")
		out.TargetDate = &dateStr
		if out.ETAMonths != nil {
			etaDate := s.now().UTC().AddDate(0, *out.ETAMonths, 0)
			onTrack := !etaDate.After(*rec.TargetDate)
			out.OnTrack = &onTrack
		}
	}
	return out, nil
}

func (s *Service) monthlyRate(ctx context.Context, userID, goalID uuid.UUID) (*decimal.Decimal, error) {
	rate, _, err := s.monthlyRateWithCount(ctx, userID, goalID)
	return rate, err
}

func (s *Service) monthlyRateWithCount(ctx context.Context, userID, goalID uuid.UUID) (*decimal.Decimal, int, error) {
	since := s.now().UTC().AddDate(0, -3, 0)
	sum, count, err := s.store.SumContributionsSince(ctx, userID, goalID, since)
	if err != nil {
		return nil, 0, err
	}
	if count == 0 || !sum.GreaterThan(decimal.Zero) {
		return nil, count, nil
	}
	// Approximate monthly rate over the lookback window (up to 3 months).
	months := decimal.NewFromFloat(3)
	elapsed := s.now().UTC().Sub(since).Hours() / (24 * 30)
	if elapsed > 0.5 && elapsed < 3 {
		months = decimal.NewFromFloat(elapsed)
	}
	rate := sum.Div(months).Round(Scale)
	return &rate, count, nil
}

func normalizeType(raw string) (string, error) {
	v := strings.ToLower(strings.TrimSpace(raw))
	switch v {
	case TypeTravel, TypePurchase, TypeSavings, TypeDebtPayoff, TypeCustom:
		return v, nil
	case "":
		return TypeCustom, nil
	default:
		return "", httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"goal_type": "must be travel, purchase, savings, debt_payoff, or custom",
		})
	}
}

func normalizeStatus(raw string) (string, error) {
	v := strings.ToLower(strings.TrimSpace(raw))
	switch v {
	case StatusActive, StatusCompleted, StatusArchived:
		return v, nil
	default:
		return "", httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"status": "must be active, completed, or archived",
		})
	}
}

func parsePositive(raw string) (decimal.Decimal, error) {
	raw = strings.TrimSpace(strings.ReplaceAll(raw, ",", ""))
	d, err := decimal.NewFromString(raw)
	if err != nil || !d.GreaterThan(decimal.Zero) {
		return decimal.Zero, errors.New("invalid")
	}
	return d.Round(Scale), nil
}

func parseNonNeg(raw string) (decimal.Decimal, error) {
	raw = strings.TrimSpace(strings.ReplaceAll(raw, ",", ""))
	if raw == "" {
		return decimal.Zero, nil
	}
	d, err := decimal.NewFromString(raw)
	if err != nil || d.IsNegative() {
		return decimal.Zero, errors.New("invalid")
	}
	return d.Round(Scale), nil
}

func parseOptionalDate(in *string) (*time.Time, error) {
	if in == nil || strings.TrimSpace(*in) == "" {
		return nil, nil
	}
	raw := strings.TrimSpace(*in)
	t, err := time.Parse("2006-01-02", raw)
	if err != nil {
		return nil, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"target_date": "must be YYYY-MM-DD",
		})
	}
	u := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
	return &u, nil
}

const maxSourceURLLen = 2000

// normalizeSourceURL validates an optional http(s) URL. Empty input yields nil.
func normalizeSourceURL(in *string) (*string, error) {
	if in == nil {
		return nil, nil
	}
	raw := strings.TrimSpace(*in)
	if raw == "" {
		return nil, nil
	}
	bad := func(msg string) error {
		return httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"source_url": msg,
		})
	}
	if utf8.RuneCountInString(raw) > maxSourceURLLen {
		return nil, bad("max 2000 characters")
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, bad("must be a valid http(s) URL")
	}
	return &raw, nil
}

func cleanOpt(in *string, max int) *string {
	if in == nil {
		return nil
	}
	v := strings.TrimSpace(*in)
	if v == "" {
		return nil
	}
	if utf8.RuneCountInString(v) > max {
		r := []rune(v)
		v = string(r[:max])
	}
	return &v
}
