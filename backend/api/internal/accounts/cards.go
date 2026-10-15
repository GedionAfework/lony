package accounts

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"equilend/api/internal/httpx"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
)

type CardNotifier interface {
	NotifyCardDue(ctx context.Context, userID, accountID uuid.UUID, name, amount, currency string, days int) error
}

func (s *Service) SetCardNotifier(n CardNotifier) {
	s.cards = n
}

func clampMonthDay(day int) int {
	if day < 1 {
		return 1
	}
	if day > 28 {
		return 28
	}
	return day
}

func nextMonthDay(now time.Time, day int) time.Time {
	now = now.UTC()
	day = clampMonthDay(day)
	y, m, d := now.Date()
	today := time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	cand := time.Date(y, m, day, 0, 0, 0, 0, time.UTC)
	if !cand.Before(today) {
		return cand
	}
	return cand.AddDate(0, 1, 0)
}

func cardMetrics(rec Account) (available *decimal.Decimal, pct *int) {
	if rec.CreditLimit == nil || !rec.CreditLimit.GreaterThan(decimal.Zero) {
		return nil, nil
	}
	avail := rec.CreditLimit.Sub(rec.Balance)
	if avail.IsNegative() {
		avail = decimal.Zero
	}
	p := int(rec.Balance.Div(*rec.CreditLimit).Mul(decimal.NewFromInt(100)).IntPart())
	if p < 0 {
		p = 0
	}
	return &avail, &p
}

func cashflowDelta(accountType, kind string, amount decimal.Decimal) decimal.Decimal {
	expense := kind == "expense" || kind == "outcome"
	income := kind == "income"
	if !expense && !income {
		return decimal.Zero
	}
	if accountType == TypeCreditCard {
		if expense {
			return amount
		}
		return amount.Neg()
	}
	if expense {
		return amount.Neg()
	}
	return amount
}

func applyCreditFields(rec *Account, limit *string, statementDay, dueDay *int) error {
	if rec.AccountType != TypeCreditCard {
		rec.CreditLimit = nil
		rec.StatementDay = nil
		rec.DueDay = nil
		return nil
	}
	if limit != nil {
		d, err := parseOptionalPositive(limit)
		if err != nil {
			return httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"credit_limit": "must be a positive decimal",
			})
		}
		rec.CreditLimit = d
	}
	if statementDay != nil {
		day, err := parseMonthDay(statementDay)
		if err != nil {
			return httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"statement_day": "must be a day from 1 to 28",
			})
		}
		rec.StatementDay = day
	}
	if dueDay != nil {
		day, err := parseMonthDay(dueDay)
		if err != nil {
			return httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"due_day": "must be a day from 1 to 28",
			})
		}
		rec.DueDay = day
	}
	return nil
}

func parseMonthDay(v *int) (*int, error) {
	if v == nil {
		return nil, nil
	}
	if *v == 0 {
		return nil, nil
	}
	if *v < 1 || *v > 28 {
		return nil, errors.New("invalid")
	}
	d := *v
	return &d, nil
}

func parsePositive(raw string) (decimal.Decimal, error) {
	s := strings.TrimSpace(strings.ReplaceAll(raw, ",", ""))
	d, err := decimal.NewFromString(s)
	if err != nil || !d.GreaterThan(decimal.Zero) {
		return decimal.Zero, errors.New("invalid")
	}
	return d.Round(Scale), nil
}

func parseOptionalPositive(raw *string) (*decimal.Decimal, error) {
	if raw == nil {
		return nil, nil
	}
	s := strings.TrimSpace(strings.ReplaceAll(*raw, ",", ""))
	if s == "" {
		return nil, nil
	}
	d, err := decimal.NewFromString(s)
	if err != nil || d.IsNegative() {
		return nil, errors.New("invalid")
	}
	if !d.GreaterThan(decimal.Zero) {
		return nil, nil
	}
	rounded := d.Round(Scale)
	return &rounded, nil
}

func installmentDTO(rec Installment) InstallmentDTO {
	return InstallmentDTO{
		ID:              rec.ID,
		AccountID:       rec.AccountID,
		Merchant:        rec.Merchant,
		TotalAmount:     rec.TotalAmount.StringFixed(Scale),
		RemainingAmount: rec.RemainingAmount.StringFixed(Scale),
		MonthlyAmount:   rec.MonthlyAmount.StringFixed(Scale),
		MonthsTotal:     rec.MonthsTotal,
		MonthsRemaining: rec.MonthsRemaining,
		CurrencyCode:    rec.CurrencyCode,
		NextChargeOn:    rec.NextChargeOn,
		CreatedAt:       rec.CreatedAt,
		UpdatedAt:       rec.UpdatedAt,
	}
}

func (s *Service) requireCard(ctx context.Context, userID, accountID uuid.UUID) (Account, error) {
	rec, err := s.store.Get(ctx, userID, accountID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Account{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "account not found")
		}
		return Account{}, err
	}
	if rec.AccountType != TypeCreditCard {
		return Account{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"account_id": "must be a credit card",
		})
	}
	return rec, nil
}

func (s *Service) ListInstallments(ctx context.Context, userID, accountID uuid.UUID) ([]InstallmentDTO, error) {
	if _, err := s.requireCard(ctx, userID, accountID); err != nil {
		return nil, err
	}
	rows, err := s.store.ListInstallments(ctx, userID, accountID)
	if err != nil {
		return nil, err
	}
	out := make([]InstallmentDTO, 0, len(rows))
	for _, r := range rows {
		out = append(out, installmentDTO(r))
	}
	return out, nil
}

func (s *Service) CreateInstallment(ctx context.Context, userID, accountID uuid.UUID, in InstallmentInput) (InstallmentDTO, error) {
	card, err := s.requireCard(ctx, userID, accountID)
	if err != nil {
		return InstallmentDTO{}, err
	}
	merchant := strings.TrimSpace(in.Merchant)
	if merchant == "" || utf8.RuneCountInString(merchant) > 120 {
		return InstallmentDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"merchant": "required, max 120 characters",
		})
	}
	if in.MonthsTotal < 2 || in.MonthsTotal > 60 {
		return InstallmentDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"months_total": "must be between 2 and 60",
		})
	}
	total, err := parsePositive(in.TotalAmount)
	if err != nil {
		return InstallmentDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"total_amount": "must be a positive decimal",
		})
	}
	var monthly decimal.Decimal
	if strings.TrimSpace(in.MonthlyAmount) != "" {
		monthly, err = parsePositive(in.MonthlyAmount)
		if err != nil {
			return InstallmentDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"monthly_amount": "must be a positive decimal",
			})
		}
	} else {
		monthly = total.Div(decimal.NewFromInt(int64(in.MonthsTotal))).Round(Scale)
		if !monthly.GreaterThan(decimal.Zero) {
			monthly = total
		}
	}
	now := s.now().UTC()
	next := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	if in.NextChargeOn != nil && !in.NextChargeOn.IsZero() {
		t := in.NextChargeOn.UTC()
		next = time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
	}
	rec := Installment{
		UserID:          userID,
		AccountID:       accountID,
		Merchant:        merchant,
		TotalAmount:     total,
		RemainingAmount: total,
		MonthlyAmount:   monthly,
		MonthsTotal:     in.MonthsTotal,
		MonthsRemaining: in.MonthsTotal,
		CurrencyCode:    card.CurrencyCode,
		NextChargeOn:    next,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	saved, err := s.store.InsertInstallment(ctx, rec)
	if err != nil {
		return InstallmentDTO{}, err
	}
	return installmentDTO(saved), nil
}

func (s *Service) DeleteInstallment(ctx context.Context, userID, accountID, id uuid.UUID) error {
	if _, err := s.requireCard(ctx, userID, accountID); err != nil {
		return err
	}
	if err := s.store.DeleteInstallment(ctx, userID, accountID, id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return httpx.E(http.StatusNotFound, "NOT_FOUND", "installment not found")
		}
		return err
	}
	return nil
}

func (s *Service) TickCreditCards(ctx context.Context) (int, error) {
	n, err := s.tickInstallments(ctx)
	if err != nil {
		return n, err
	}
	if err := s.tickCardDueReminders(ctx); err != nil {
		return n, err
	}
	return n, nil
}

func (s *Service) tickInstallments(ctx context.Context) (int, error) {
	now := s.now().UTC()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	rows, err := s.store.ListDueInstallments(ctx, today, 100)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, rec := range rows {
		amt := rec.MonthlyAmount
		if rec.RemainingAmount.LessThan(amt) {
			amt = rec.RemainingAmount
		}
		if !amt.GreaterThan(decimal.Zero) {
			rec.MonthsRemaining = 0
			rec.RemainingAmount = decimal.Zero
			rec.UpdatedAt = now
			if _, err := s.store.UpdateInstallment(ctx, rec); err != nil {
				return n, err
			}
			continue
		}
		title := rec.Merchant + " installment"
		if err := s.store.PostCharge(ctx, Charge{
			UserID:       rec.UserID,
			AccountID:    rec.AccountID,
			Title:        title,
			Amount:       amt,
			CurrencyCode: rec.CurrencyCode,
			OccurredAt:   now,
		}); err != nil {
			return n, err
		}
		if err := s.ApplyCashflowDelta(ctx, rec.UserID, rec.AccountID, "expense", amt, rec.CurrencyCode, title); err != nil {
			return n, err
		}
		rec.RemainingAmount = rec.RemainingAmount.Sub(amt)
		if rec.RemainingAmount.IsNegative() {
			rec.RemainingAmount = decimal.Zero
		}
		rec.MonthsRemaining--
		if rec.MonthsRemaining < 0 {
			rec.MonthsRemaining = 0
		}
		if rec.MonthsRemaining > 0 && rec.RemainingAmount.GreaterThan(decimal.Zero) {
			rec.NextChargeOn = rec.NextChargeOn.UTC().AddDate(0, 1, 0)
		}
		rec.UpdatedAt = now
		if _, err := s.store.UpdateInstallment(ctx, rec); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

func (s *Service) tickCardDueReminders(ctx context.Context) error {
	if s.cards == nil {
		return nil
	}
	cards, err := s.store.ListCreditCards(ctx)
	if err != nil {
		return err
	}
	now := s.now().UTC()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	for _, rec := range cards {
		if rec.DueDay == nil {
			continue
		}
		due := nextMonthDay(now, *rec.DueDay)
		days := int(due.Sub(today).Hours() / 24)
		if days != 0 && days != 1 && days != 3 {
			continue
		}
		ok, err := s.store.ClaimCardDueAlert(ctx, rec.ID, due, days)
		if err != nil || !ok {
			continue
		}
		_ = s.cards.NotifyCardDue(ctx, rec.UserID, rec.ID, rec.Name, rec.Balance.StringFixed(Scale), rec.CurrencyCode, days)
	}
	return nil
}
