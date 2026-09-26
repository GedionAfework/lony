package accounts

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"equilend/api/internal/httpx"
	"equilend/api/internal/loans"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
)

type LoanNets interface {
	AllForUser(ctx context.Context, actor uuid.UUID) ([]loans.Record, error)
}

type Service struct {
	store Store
	loans LoanNets
	now   func() time.Time
}

func NewService(store Store) *Service {
	return &Service{store: store, now: time.Now}
}

func (s *Service) SetLoans(l LoanNets) {
	s.loans = l
}

func (s *Service) List(ctx context.Context, userID uuid.UUID, includeArchived bool) ([]AccountDTO, error) {
	rows, err := s.store.List(ctx, userID, includeArchived)
	if err != nil {
		return nil, err
	}
	out := make([]AccountDTO, 0, len(rows))
	for _, r := range rows {
		out = append(out, toDTO(r))
	}
	return out, nil
}

func (s *Service) Get(ctx context.Context, userID, id uuid.UUID) (AccountDTO, error) {
	rec, err := s.store.Get(ctx, userID, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AccountDTO{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "account not found")
		}
		return AccountDTO{}, err
	}
	return toDTO(rec), nil
}

func (s *Service) Create(ctx context.Context, userID uuid.UUID, in CreateInput) (AccountDTO, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" || utf8.RuneCountInString(name) > 120 {
		return AccountDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"name": "required, max 120 characters",
		})
	}
	atype, err := normalizeType(in.AccountType)
	if err != nil {
		return AccountDTO{}, err
	}
	currency := strings.ToUpper(strings.TrimSpace(in.CurrencyCode))
	if len(currency) != 3 {
		return AccountDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"currency_code": "must be a 3-letter currency code",
		})
	}
	bal, err := parseNonNeg(in.Balance)
	if err != nil {
		return AccountDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"balance": "must be a non-negative decimal",
		})
	}
	rate, compounding, err := normalizeInterest(in.InterestRatePercent, in.Compounding)
	if err != nil {
		return AccountDTO{}, err
	}
	now := s.now().UTC()
	rec := Account{
		UserID:              userID,
		Name:                name,
		AccountType:         atype,
		CurrencyCode:        currency,
		Balance:             bal,
		BalanceAsOf:         now,
		InterestRatePercent: rate,
		Compounding:         compounding,
		InstitutionLabel:    cleanOpt(in.InstitutionLabel, 120),
		BankProfileID:       in.BankProfileID,
		CreatedAt:           now,
		UpdatedAt:           now,
	}
	event := BalanceEvent{
		UserID:    userID,
		Balance:   bal,
		Source:    "manual",
		CreatedAt: now,
	}
	saved, err := s.store.Insert(ctx, rec, event)
	if err != nil {
		return AccountDTO{}, err
	}
	return toDTO(saved), nil
}

func (s *Service) Update(ctx context.Context, userID, id uuid.UUID, in UpdateInput) (AccountDTO, error) {
	rec, err := s.store.Get(ctx, userID, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AccountDTO{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "account not found")
		}
		return AccountDTO{}, err
	}
	if in.Name != nil {
		name := strings.TrimSpace(*in.Name)
		if name == "" || utf8.RuneCountInString(name) > 120 {
			return AccountDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"name": "required, max 120 characters",
			})
		}
		rec.Name = name
	}
	if in.AccountType != nil {
		atype, err := normalizeType(*in.AccountType)
		if err != nil {
			return AccountDTO{}, err
		}
		rec.AccountType = atype
	}
	if in.CurrencyCode != nil {
		currency := strings.ToUpper(strings.TrimSpace(*in.CurrencyCode))
		if len(currency) != 3 {
			return AccountDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"currency_code": "must be a 3-letter currency code",
			})
		}
		rec.CurrencyCode = currency
	}
	if in.ClearInterest {
		rec.InterestRatePercent = nil
		rec.Compounding = nil
	} else if in.InterestRatePercent != nil || in.Compounding != nil {
		var rateStr *string
		var compStr *string
		if in.InterestRatePercent != nil {
			rateStr = in.InterestRatePercent
		} else if rec.InterestRatePercent != nil {
			s := rec.InterestRatePercent.StringFixed(4)
			rateStr = &s
		}
		if in.Compounding != nil {
			compStr = in.Compounding
		} else {
			compStr = rec.Compounding
		}
		rate, compounding, err := normalizeInterest(rateStr, compStr)
		if err != nil {
			return AccountDTO{}, err
		}
		rec.InterestRatePercent = rate
		rec.Compounding = compounding
	}
	if in.InstitutionLabel != nil {
		rec.InstitutionLabel = cleanOpt(in.InstitutionLabel, 120)
	}
	if in.BankProfileID != nil {
		rec.BankProfileID = in.BankProfileID
	}
	rec.UpdatedAt = s.now().UTC()
	saved, err := s.store.Update(ctx, rec)
	if err != nil {
		return AccountDTO{}, err
	}
	return toDTO(saved), nil
}

func (s *Service) SetBalance(ctx context.Context, userID, id uuid.UUID, in SetBalanceInput) (AccountDTO, error) {
	rec, err := s.store.Get(ctx, userID, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AccountDTO{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "account not found")
		}
		return AccountDTO{}, err
	}
	bal, err := parseNonNeg(in.Balance)
	if err != nil {
		return AccountDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"balance": "must be a non-negative decimal",
		})
	}
	now := s.now().UTC()
	rec.Balance = bal
	rec.BalanceAsOf = now
	rec.UpdatedAt = now
	source := "manual"
	if in.Note != nil && strings.Contains(strings.ToLower(*in.Note), "reconcile") {
		source = "reconcile"
	}
	event := BalanceEvent{
		AccountID: rec.ID,
		UserID:    userID,
		Balance:   bal,
		Source:    source,
		Note:      cleanOpt(in.Note, 500),
		CreatedAt: now,
	}
	saved, err := s.store.SetBalance(ctx, rec, event)
	if err != nil {
		return AccountDTO{}, err
	}
	return toDTO(saved), nil
}

func (s *Service) Archive(ctx context.Context, userID, id uuid.UUID) error {
	if err := s.store.Archive(ctx, userID, id, s.now().UTC()); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return httpx.E(http.StatusNotFound, "NOT_FOUND", "account not found")
		}
		return err
	}
	return nil
}

func (s *Service) Reconcile(ctx context.Context, userID, id uuid.UUID) (ReconcileDTO, error) {
	rec, err := s.store.Get(ctx, userID, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ReconcileDTO{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "account not found")
		}
		return ReconcileDTO{}, err
	}
	return s.reconcileOne(ctx, userID, rec)
}

func (s *Service) ReconcileAll(ctx context.Context, userID uuid.UUID) ([]ReconcileDTO, error) {
	rows, err := s.store.List(ctx, userID, false)
	if err != nil {
		return nil, err
	}
	out := make([]ReconcileDTO, 0, len(rows))
	for _, rec := range rows {
		dto, err := s.reconcileOne(ctx, userID, rec)
		if err != nil {
			return nil, err
		}
		out = append(out, dto)
	}
	return out, nil
}

func (s *Service) reconcileOne(ctx context.Context, userID uuid.UUID, rec Account) (ReconcileDTO, error) {
	slice, err := s.store.LedgerSince(ctx, userID, rec.ID, rec.CurrencyCode)
	if err != nil {
		return ReconcileDTO{}, err
	}
	expected := slice.BaselineBalance.
		Add(slice.Income).
		Sub(slice.Expense).
		Add(slice.TransfersIn).
		Sub(slice.TransfersOut)
	diff := rec.Balance.Sub(expected)
	return ReconcileDTO{
		AccountID:           rec.ID,
		AccountName:         rec.Name,
		CurrencyCode:        rec.CurrencyCode,
		StatedBalance:       rec.Balance.StringFixed(Scale),
		ExpectedBalance:     expected.StringFixed(Scale),
		Difference:          diff.StringFixed(Scale),
		InSync:              diff.Abs().LessThanOrEqual(decimal.NewFromFloat(0.009)),
		BaselineBalance:     slice.BaselineBalance.StringFixed(Scale),
		BaselineAt:          slice.BaselineAt,
		IncomeSince:         slice.Income.StringFixed(Scale),
		ExpenseSince:        slice.Expense.StringFixed(Scale),
		TransfersInSince:    slice.TransfersIn.StringFixed(Scale),
		TransfersOutSince:   slice.TransfersOut.StringFixed(Scale),
		UnassignedConfirmed: slice.UnassignedConfirmed.StringFixed(Scale),
	}, nil
}

// ApplyCashflowDelta credits income / debits expense against an account. Currency must match.
func (s *Service) ApplyCashflowDelta(ctx context.Context, userID, accountID uuid.UUID, kind string, amount decimal.Decimal, currency, note string) error {
	rec, err := s.store.Get(ctx, userID, accountID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return httpx.E(http.StatusNotFound, "NOT_FOUND", "account not found")
		}
		return err
	}
	if !strings.EqualFold(rec.CurrencyCode, currency) {
		return httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"account_id": "account currency must match entry currency",
		})
	}
	delta := amount
	if kind == "expense" || kind == "outcome" {
		delta = amount.Neg()
	} else if kind != "income" {
		return nil
	}
	_, err = s.store.AdjustBalance(ctx, userID, accountID, delta, note, s.now().UTC())
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return httpx.E(http.StatusNotFound, "NOT_FOUND", "account not found")
		}
		return err
	}
	return nil
}

func (s *Service) Transfer(ctx context.Context, userID uuid.UUID, in TransferInput) (TransferDTO, error) {
	if in.FromAccountID == in.ToAccountID {
		return TransferDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"to_account_id": "must differ from from_account_id",
		})
	}
	amount, err := parsePositiveAmount(in.Amount)
	if err != nil {
		return TransferDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"amount": "must be a positive decimal",
		})
	}
	from, err := s.store.Get(ctx, userID, in.FromAccountID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return TransferDTO{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "from account not found")
		}
		return TransferDTO{}, err
	}
	to, err := s.store.Get(ctx, userID, in.ToAccountID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return TransferDTO{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "to account not found")
		}
		return TransferDTO{}, err
	}
	if !strings.EqualFold(from.CurrencyCode, to.CurrencyCode) {
		return TransferDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"to_account_id": "accounts must share the same currency",
		})
	}
	now := s.now().UTC()
	occurred := now
	if in.OccurredAt != nil && !in.OccurredAt.IsZero() {
		occurred = in.OccurredAt.UTC()
	}
	note := ""
	if in.Note != nil {
		note = strings.TrimSpace(*in.Note)
	}
	id, err := s.store.Transfer(ctx, userID, in.FromAccountID, in.ToAccountID, amount, from.CurrencyCode, note, occurred, now)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return TransferDTO{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "account not found or currency mismatch")
		}
		return TransferDTO{}, err
	}
	var notePtr *string
	if note != "" {
		notePtr = &note
	}
	return TransferDTO{
		ID:            id,
		FromAccountID: in.FromAccountID,
		ToAccountID:   in.ToAccountID,
		Amount:        amount.StringFixed(Scale),
		CurrencyCode:  from.CurrencyCode,
		Note:          notePtr,
		OccurredAt:    occurred,
	}, nil
}

func parsePositiveAmount(raw string) (decimal.Decimal, error) {
	raw = strings.TrimSpace(strings.ReplaceAll(raw, ",", ""))
	d, err := decimal.NewFromString(raw)
	if err != nil || !d.GreaterThan(decimal.Zero) {
		return decimal.Zero, errors.New("invalid")
	}
	return d.Round(Scale), nil
}

func (s *Service) Wealth(ctx context.Context, userID uuid.UUID, preferred string) (WealthSummary, error) {
	accounts, err := s.store.List(ctx, userID, false)
	if err != nil {
		return WealthSummary{}, err
	}
	type agg struct {
		cash  decimal.Decimal
		recv  decimal.Decimal
		pay   decimal.Decimal
		count int
	}
	by := map[string]*agg{}
	ensure := func(code string) *agg {
		code = strings.ToUpper(code)
		if by[code] == nil {
			by[code] = &agg{}
		}
		return by[code]
	}

	dtos := make([]AccountDTO, 0, len(accounts))
	for _, a := range accounts {
		dtos = append(dtos, toDTO(a))
		ensure(a.CurrencyCode).cash = ensure(a.CurrencyCode).cash.Add(a.Balance)
		ensure(a.CurrencyCode).count++
	}

	if s.loans != nil {
		rows, err := s.loans.AllForUser(ctx, userID)
		if err != nil {
			return WealthSummary{}, err
		}
		for _, row := range rows {
			if !isOpenLoan(row) || row.CurrencyCode == nil || row.ExpectedTotal == nil {
				continue
			}
			code := strings.ToUpper(*row.CurrencyCode)
			amt := *row.ExpectedTotal
			a := ensure(code)
			if row.LenderID == userID && row.BorrowerID != userID {
				a.recv = a.recv.Add(amt)
			} else if row.BorrowerID == userID && row.LenderID != userID {
				a.pay = a.pay.Add(amt)
			} else if row.BorrowerID == userID && row.LenderID == userID {
				// Alone institutional debt — treat as payable
				a.pay = a.pay.Add(amt)
			}
		}
	}

	preferred = strings.ToUpper(strings.TrimSpace(preferred))
	slices := make([]CurrencySlice, 0, len(by))
	var prefCash, prefRecv, prefPay decimal.Decimal
	for code, a := range by {
		net := a.cash.Add(a.recv).Sub(a.pay)
		slices = append(slices, CurrencySlice{
			CurrencyCode: code,
			CashOnHand:   a.cash.StringFixed(Scale),
			Receivables:  a.recv.StringFixed(Scale),
			Payables:     a.pay.StringFixed(Scale),
			NetWorth:     net.StringFixed(Scale),
			AccountCount: a.count,
		})
		if preferred != "" && code == preferred {
			prefCash, prefRecv, prefPay = a.cash, a.recv, a.pay
		}
	}
	// Stable-ish order: preferred first, then by code
	for i := 0; i < len(slices); i++ {
		for j := i + 1; j < len(slices); j++ {
			si, sj := slices[i], slices[j]
			pi := preferred != "" && si.CurrencyCode == preferred
			pj := preferred != "" && sj.CurrencyCode == preferred
			if pj && !pi || (!pi && !pj && sj.CurrencyCode < si.CurrencyCode) {
				slices[i], slices[j] = slices[j], slices[i]
			}
		}
	}
	if preferred == "" && len(slices) > 0 {
		preferred = slices[0].CurrencyCode
		prefCash, _ = decimal.NewFromString(slices[0].CashOnHand)
		prefRecv, _ = decimal.NewFromString(slices[0].Receivables)
		prefPay, _ = decimal.NewFromString(slices[0].Payables)
	}
	prefNet := prefCash.Add(prefRecv).Sub(prefPay)
	return WealthSummary{
		PreferredCurrency: preferred,
		CashOnHand:        prefCash.StringFixed(Scale),
		Receivables:       prefRecv.StringFixed(Scale),
		Payables:          prefPay.StringFixed(Scale),
		NetWorth:          prefNet.StringFixed(Scale),
		ByCurrency:        slices,
		Accounts:          dtos,
	}, nil
}

func isOpenLoan(row loans.Record) bool {
	switch row.Status {
	case loans.StatusActive, loans.StatusOverdue, loans.StatusRepaymentPending, loans.StatusPending:
		return true
	default:
		return false
	}
}

func normalizeType(raw string) (string, error) {
	v := strings.ToLower(strings.TrimSpace(raw))
	switch v {
	case TypeCash, TypeBank, TypeMobileMoney, TypeWallet, TypeOther:
		return v, nil
	case "":
		return TypeBank, nil
	default:
		return "", httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"account_type": "must be cash, bank, mobile_money, wallet, or other",
		})
	}
}

func normalizeInterest(rateStr, compounding *string) (*decimal.Decimal, *string, error) {
	if rateStr == nil || strings.TrimSpace(*rateStr) == "" {
		return nil, nil, nil
	}
	rate, err := decimal.NewFromString(strings.TrimSpace(*rateStr))
	if err != nil || rate.IsNegative() {
		return nil, nil, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"interest_rate_percent": "must be a non-negative decimal",
		})
	}
	comp := CompoundNone
	if compounding != nil && strings.TrimSpace(*compounding) != "" {
		c := strings.ToLower(strings.TrimSpace(*compounding))
		switch c {
		case CompoundNone, CompoundMonthly, CompoundYearly:
			comp = c
		default:
			return nil, nil, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"compounding": "must be none, monthly, or yearly",
			})
		}
	}
	return &rate, &comp, nil
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
