package score

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"equilend/api/internal/goals"
	"equilend/api/internal/httpx"
	"equilend/api/internal/loans"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
)

type AccountsCash interface {
	ListBalances(ctx context.Context, userID uuid.UUID) (map[string]decimal.Decimal, error)
}

// FriendshipGate limits peer trust reads to accepted friends (same as loans).
type FriendshipGate interface {
	CanCreateLoan(ctx context.Context, a, b uuid.UUID) (bool, error)
}

type Service struct {
	store   Store
	insight InsightsSource
	loans   LoanSource
	goals   GoalSource
	consist ConsistencySource
	cash    AccountsCash
	gate    FriendshipGate
	now     func() time.Time
}

func NewService(store Store) *Service {
	return &Service{store: store, now: time.Now}
}

func (s *Service) SetInsights(i InsightsSource)        { s.insight = i }
func (s *Service) SetLoans(l LoanSource)                { s.loans = l }
func (s *Service) SetGoals(g GoalSource)                { s.goals = g }
func (s *Service) SetConsistency(c ConsistencySource)   { s.consist = c }
func (s *Service) SetCash(c AccountsCash)               { s.cash = c }
func (s *Service) SetGate(g FriendshipGate)             { s.gate = g }

// PeerTrust returns the lender-facing A–E grade for a friend.
func (s *Service) PeerTrust(ctx context.Context, actor, peerID uuid.UUID) (PublicTrust, error) {
	if peerID == uuid.Nil {
		return PublicTrust{}, httpx.E(http.StatusBadRequest, "MALFORMED_ID", "invalid user id")
	}
	if actor != peerID {
		if s.gate == nil {
			return PublicTrust{}, httpx.E(http.StatusForbidden, "FORBIDDEN", "trust grade is friends-only")
		}
		ok, err := s.gate.CanCreateLoan(ctx, actor, peerID)
		if err != nil {
			return PublicTrust{}, err
		}
		if !ok {
			return PublicTrust{}, httpx.E(http.StatusForbidden, "FORBIDDEN", "only friends can see this trust grade")
		}
	}
	rec, err := s.store.Latest(ctx, peerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return PublicTrust{
			Grade:     "—",
			Band:      "No Lony history yet",
			Available: false,
		}, nil
	}
	if err != nil {
		return PublicTrust{}, err
	}
	dto := ToDTO(rec)
	return PublicTrust{
		Grade:          dto.Grade,
		Band:           dto.Band,
		ThinHistory:    dto.ThinHistory,
		LoanSampleSize: dto.LoanSampleSize,
		RepaymentScore: dto.RepaymentScore,
		Available:      true,
		ComputedAt:     dto.ComputedAt,
	}, nil
}

func (s *Service) Get(ctx context.Context, userID uuid.UUID, currency string, refresh bool) (Snapshot, error) {
	currency = strings.ToUpper(strings.TrimSpace(currency))
	if len(currency) != 3 {
		return Snapshot{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"currency": "must be a 3-letter currency code",
		})
	}
	if !refresh {
		rec, err := s.store.Latest(ctx, userID)
		if err == nil && strings.EqualFold(rec.CurrencyCode, currency) {
			return ToDTO(rec), nil
		}
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return Snapshot{}, err
		}
	}
	return s.ComputeAndStore(ctx, userID, currency)
}

func (s *Service) History(ctx context.Context, userID uuid.UUID, limit int) ([]Snapshot, error) {
	if limit <= 0 || limit > 50 {
		limit = 12
	}
	rows, err := s.store.History(ctx, userID, limit)
	if err != nil {
		return nil, err
	}
	out := make([]Snapshot, 0, len(rows))
	for _, r := range rows {
		out = append(out, ToDTO(r))
	}
	return out, nil
}

func (s *Service) ComputeAndStore(ctx context.Context, userID uuid.UUID, currency string) (Snapshot, error) {
	in, err := s.gather(ctx, userID, currency)
	if err != nil {
		return Snapshot{}, err
	}
	snap := Compute(in)
	comps, _ := json.Marshal(snap.Components)
	rec := Record{
		UserID:           userID,
		Grade:            snap.Grade,
		Points:           decimal.NewFromFloat(snap.Points),
		CurrencyCode:     currency,
		LiquidityScore:   decimal.NewFromFloat(snap.LiquidityScore),
		SavingsScore:     decimal.NewFromFloat(snap.SavingsScore),
		DebtScore:        decimal.NewFromFloat(snap.DebtScore),
		ConsistencyScore: decimal.NewFromFloat(snap.ConsistencyScore),
		GoalsScore:       decimal.NewFromFloat(snap.GoalsScore),
		RepaymentScore:   decimal.NewFromFloat(snap.RepaymentScore),
		Components:       comps,
		ThinHistory:      snap.ThinHistory,
		LoanSampleSize:   snap.LoanSampleSize,
		ComputedAt:       s.now().UTC(),
	}
	saved, err := s.store.Insert(ctx, rec)
	if err != nil {
		return Snapshot{}, err
	}
	snap.ID = saved.ID
	snap.ComputedAt = saved.ComputedAt
	return snap, nil
}

func (s *Service) gather(ctx context.Context, userID uuid.UUID, currency string) (Inputs, error) {
	in := Inputs{Currency: currency}
	now := s.now().UTC()
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)

	if s.cash != nil {
		bals, err := s.cash.ListBalances(ctx, userID)
		if err != nil {
			return Inputs{}, err
		}
		if v, ok := bals[currency]; ok {
			in.CashOnHand = v
		}
	}

	if s.insight != nil {
		ov, err := s.insight.Overview(ctx, userID, currency, 1)
		if err != nil {
			return Inputs{}, err
		}
		in.MonthExpense, _ = decimal.NewFromString(ov.Expense)
		in.OpenPayables, _ = decimal.NewFromString(ov.OpenPayables)
		in.OpenReceivables, _ = decimal.NewFromString(ov.OpenReceivables)
		series, err := s.insight.CashflowSeries(ctx, userID, currency, 3)
		if err != nil {
			return Inputs{}, err
		}
		for _, p := range series {
			inc, _ := decimal.NewFromString(p.Income)
			exp, _ := decimal.NewFromString(p.Expense)
			in.TrailingIncome = in.TrailingIncome.Add(inc)
			in.TrailingExpense = in.TrailingExpense.Add(exp)
		}
	}

	if s.loans != nil {
		rows, err := s.loans.AllForUser(ctx, userID)
		if err != nil {
			return Inputs{}, err
		}
		for _, row := range rows {
			switch row.Status {
			case loans.StatusOverdue:
				in.OverdueLoanCount++
				in.LoanTouches++
				if row.BorrowerID == userID {
					in.ActiveBorrowCount++
				}
			case loans.StatusActive, loans.StatusRepaymentPending:
				in.LoanTouches++
				if row.BorrowerID == userID {
					in.ActiveBorrowCount++
				}
			case loans.StatusCompleted:
				in.LoanTouches++
			}
		}
	}

	if s.goals != nil {
		gs, err := s.goals.List(ctx, userID, false)
		if err != nil {
			return Inputs{}, err
		}
		var prog float64
		for _, g := range gs {
			if g.Status != goals.StatusActive {
				continue
			}
			if !strings.EqualFold(g.CurrencyCode, currency) {
				continue
			}
			in.ActiveGoals++
			prog += g.ProgressPercent
			if g.ProgressPercent >= 40 || g.ETAMonths == nil {
				in.GoalsOnTrack++
			}
		}
		if in.ActiveGoals > 0 {
			in.GoalsProgressAvg = prog / float64(in.ActiveGoals)
		}
	}

	if s.consist != nil {
		from30 := now.AddDate(0, 0, -30)
		exp, conf, err := s.consist.IncomeConfirmStats(ctx, userID, monthStart.AddDate(0, -2, 0), now)
		if err != nil {
			return Inputs{}, err
		}
		in.ExpectedIncome, in.ConfirmedIncome = exp, conf
		days, err := s.consist.LoggedDayCount(ctx, userID, from30, now)
		if err != nil {
			return Inputs{}, err
		}
		in.LoggedDays30 = days
		total, ok, err := s.consist.RepaymentStats(ctx, userID)
		if err != nil {
			return Inputs{}, err
		}
		in.RepaymentsTotal, in.RepaymentsOK = total, ok
	}

	return in, nil
}
