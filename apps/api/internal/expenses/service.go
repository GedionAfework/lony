package expenses

import (
	"context"
	"errors"
	"fmt"
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

type LoanCreator interface {
	Create(ctx context.Context, actor uuid.UUID, in loans.CreateInput) (loans.LoanDTO, error)
}

type AccountLinker interface {
	ApplyCashflowDelta(ctx context.Context, userID, accountID uuid.UUID, kind string, amount decimal.Decimal, currency, note string) error
}

type Service struct {
	store    Store
	loans    LoanCreator
	accounts AccountLinker
	now      func() time.Time
}

func NewService(store Store) *Service {
	return &Service{store: store, now: time.Now}
}

func (s *Service) SetLoans(lc LoanCreator) {
	s.loans = lc
}

func (s *Service) SetAccounts(a AccountLinker) {
	s.accounts = a
}

func (s *Service) Create(ctx context.Context, userID uuid.UUID, in CreateInput) (EntryDTO, error) {
	kind, err := normalizeKind(in.Kind)
	if err != nil {
		return EntryDTO{}, err
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return EntryDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"title": "required",
		})
	}
	if utf8.RuneCountInString(title) > 120 {
		return EntryDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"title": "max 120 characters",
		})
	}
	amount, err := parsePositive(in.Amount)
	if err != nil {
		return EntryDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"amount": "must be a positive decimal",
		})
	}
	currency := strings.ToUpper(strings.TrimSpace(in.CurrencyCode))
	if len(currency) != 3 {
		return EntryDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"currency_code": "must be a 3-letter currency code",
		})
	}
	category, categoryID, err := s.resolveCategory(ctx, userID, kind, in.Category, in.CategoryID)
	if err != nil {
		return EntryDTO{}, err
	}
	note, err := cleanNote(in.Note)
	if err != nil {
		return EntryDTO{}, err
	}
	occurred := in.OccurredAt.UTC()
	if occurred.IsZero() {
		occurred = s.now().UTC()
	}
	recurrence, err := normalizeRecurrence(in.Recurrence)
	if err != nil {
		return EntryDTO{}, err
	}
	isTemplate := in.IsTemplate || recurrence != nil
	if isTemplate && recurrence == nil {
		return EntryDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"recurrence": "required for periodic entries",
		})
	}
	if in.AccountID == nil {
		return EntryDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"account_id": "choose which account this belongs to",
		})
	}
	now := s.now().UTC()
	rec := Entry{
		UserID:       userID,
		Kind:         kind,
		Title:        title,
		Amount:       amount,
		CurrencyCode: currency,
		Category:     category,
		CategoryID:   categoryID,
		AccountID:    in.AccountID,
		Note:         note,
		OccurredAt:   occurred,
		IsTemplate:   isTemplate,
		Recurrence:   recurrence,
		Status:       StatusConfirmed,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if isTemplate {
		next := nextOccurrence(*recurrence, occurred, now)
		rec.NextOccurrenceAt = &next
	}
	saved, err := s.store.Insert(ctx, rec)
	if err != nil {
		return EntryDTO{}, err
	}
	// Periodic: immediately create an expected occurrence for the start date so the user can mark Received.
	if isTemplate {
		child := Entry{
			UserID:       userID,
			Kind:         kind,
			Title:        title,
			Amount:       amount,
			CurrencyCode: currency,
			Category:     category,
			CategoryID:   categoryID,
			AccountID:    in.AccountID,
			Note:         note,
			OccurredAt:   occurred,
			IsTemplate:   false,
			TemplateID:   &saved.ID,
			Status:       StatusExpected,
			CreatedAt:    now,
			UpdatedAt:    now,
		}
		pending, err := s.store.Insert(ctx, child)
		if err != nil {
			return EntryDTO{}, err
		}
		return toDTO(pending), nil
	}
	if err := s.applyAccount(ctx, userID, saved); err != nil {
		return EntryDTO{}, err
	}
	return toDTO(saved), nil
}

func (s *Service) List(ctx context.Context, userID uuid.UUID, q ListQuery) ([]EntryDTO, error) {
	if q.Kind != "" {
		kind, err := normalizeKind(q.Kind)
		if err != nil {
			return nil, err
		}
		q.Kind = kind
	}
	q.Currency = strings.ToUpper(strings.TrimSpace(q.Currency))
	if q.Limit <= 0 || q.Limit > 500 {
		q.Limit = 200
	}
	rows, err := s.store.List(ctx, userID, q)
	if err != nil {
		return nil, err
	}
	out := make([]EntryDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, toDTO(row))
	}
	return out, nil
}

func (s *Service) Summary(ctx context.Context, userID uuid.UUID, from, to *time.Time) (Summary, error) {
	slices, err := s.store.Summary(ctx, userID, from, to)
	if err != nil {
		return Summary{}, err
	}
	if slices == nil {
		slices = []SummarySlice{}
	}
	return Summary{From: from, To: to, ByCurrency: slices}, nil
}

func (s *Service) CategoryBreakdown(ctx context.Context, userID uuid.UUID, kind string, from, to *time.Time) ([]CategorySpend, error) {
	if kind != "" {
		k, err := normalizeKind(kind)
		if err != nil {
			return nil, err
		}
		kind = k
	}
	rows, err := s.store.CategoryBreakdown(ctx, userID, kind, from, to)
	if err != nil {
		return nil, err
	}
	if rows == nil {
		rows = []CategorySpend{}
	}
	return rows, nil
}

func (s *Service) Update(ctx context.Context, userID, id uuid.UUID, in UpdateInput) (EntryDTO, error) {
	rec, err := s.store.Get(ctx, userID, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return EntryDTO{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "entry not found")
		}
		return EntryDTO{}, err
	}
	if in.Title != nil {
		title := strings.TrimSpace(*in.Title)
		if title == "" || utf8.RuneCountInString(title) > 120 {
			return EntryDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"title": "required, max 120 characters",
			})
		}
		rec.Title = title
	}
	if in.Amount != nil {
		amount, err := parsePositive(*in.Amount)
		if err != nil {
			return EntryDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"amount": "must be a positive decimal",
			})
		}
		rec.Amount = amount
	}
	if in.CurrencyCode != nil {
		currency := strings.ToUpper(strings.TrimSpace(*in.CurrencyCode))
		if len(currency) != 3 {
			return EntryDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"currency_code": "must be a 3-letter currency code",
			})
		}
		rec.CurrencyCode = currency
	}
	if in.Category != nil || in.CategoryID != nil {
		catName := ""
		if in.Category != nil {
			catName = *in.Category
		}
		category, categoryID, err := s.resolveCategory(ctx, userID, rec.Kind, catName, in.CategoryID)
		if err != nil {
			return EntryDTO{}, err
		}
		rec.Category = category
		rec.CategoryID = categoryID
	}
	if in.AccountID != nil {
		rec.AccountID = in.AccountID
	}
	if in.Note != nil {
		note, err := cleanNote(in.Note)
		if err != nil {
			return EntryDTO{}, err
		}
		rec.Note = note
	}
	if in.OccurredAt != nil {
		rec.OccurredAt = in.OccurredAt.UTC()
	}
	if in.Recurrence != nil {
		recurrence, err := normalizeRecurrence(in.Recurrence)
		if err != nil {
			return EntryDTO{}, err
		}
		rec.Recurrence = recurrence
		if recurrence != nil {
			rec.IsTemplate = true
			next := nextOccurrence(*recurrence, rec.OccurredAt, s.now().UTC())
			rec.NextOccurrenceAt = &next
		} else {
			rec.IsTemplate = false
			rec.NextOccurrenceAt = nil
		}
	}
	if rec.AccountID == nil {
		return EntryDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"account_id": "choose which account this belongs to",
		})
	}
	rec.UpdatedAt = s.now().UTC()
	saved, err := s.store.Update(ctx, rec)
	if err != nil {
		return EntryDTO{}, err
	}
	return toDTO(saved), nil
}

func (s *Service) Delete(ctx context.Context, userID, id uuid.UUID) error {
	if err := s.store.Delete(ctx, userID, id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return httpx.E(http.StatusNotFound, "NOT_FOUND", "entry not found")
		}
		return err
	}
	return nil
}

func (s *Service) ListCategories(ctx context.Context, userID uuid.UUID, kind string) ([]CategoryDTO, error) {
	if kind != "" {
		k, err := normalizeKind(kind)
		if err != nil {
			return nil, err
		}
		kind = k
	}
	rows, err := s.store.ListCategories(ctx, userID, kind)
	if err != nil {
		return nil, err
	}
	out := make([]CategoryDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, toCategoryDTO(row))
	}
	return out, nil
}

func (s *Service) CreateCategory(ctx context.Context, userID uuid.UUID, kind, name string) (CategoryDTO, error) {
	k, err := normalizeKind(kind)
	if err != nil {
		return CategoryDTO{}, err
	}
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 64 {
		return CategoryDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"name": "required, max 64 characters",
		})
	}
	slug := slugify(name)
	saved, err := s.store.InsertCategory(ctx, Category{
		UserID:   &userID,
		Kind:     k,
		Name:     name,
		Slug:     slug,
		IsSystem: false,
	})
	if err != nil {
		return CategoryDTO{}, httpx.E(http.StatusConflict, "CONFLICT", "category already exists")
	}
	return toCategoryDTO(saved), nil
}

func (s *Service) Share(ctx context.Context, userID, entryID uuid.UUID, in ShareInput) (EntryDTO, loans.LoanDTO, error) {
	if s.loans == nil {
		return EntryDTO{}, loans.LoanDTO{}, httpx.E(http.StatusInternalServerError, "INTERNAL", "loan service unavailable")
	}
	rec, err := s.store.Get(ctx, userID, entryID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return EntryDTO{}, loans.LoanDTO{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "entry not found")
		}
		return EntryDTO{}, loans.LoanDTO{}, err
	}
	if rec.Kind != KindExpense {
		return EntryDTO{}, loans.LoanDTO{}, httpx.E(http.StatusConflict, "INVALID_STATE", "only expenses can be shared")
	}
	if in.FriendID == uuid.Nil || in.FriendID == userID {
		return EntryDTO{}, loans.LoanDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"friend_id": "choose someone to split with",
		})
	}

	shareAmt := rec.Amount.Div(decimal.NewFromInt(2)).Round(Scale)
	if in.ShareAmount != nil && strings.TrimSpace(*in.ShareAmount) != "" {
		parsed, err := parsePositive(*in.ShareAmount)
		if err != nil {
			return EntryDTO{}, loans.LoanDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"share_amount": "must be a positive decimal",
			})
		}
		if parsed.GreaterThan(rec.Amount) {
			return EntryDTO{}, loans.LoanDTO{}, httpx.E(http.StatusConflict, "EXCEEDS_AMOUNT", "share exceeds the expense amount")
		}
		shareAmt = parsed
	} else if in.SharePercent != nil {
		p := *in.SharePercent
		if p <= 0 || p > 100 {
			return EntryDTO{}, loans.LoanDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"share_percent": "must be between 0 and 100",
			})
		}
		shareAmt = rec.Amount.Mul(decimal.NewFromFloat(p)).Div(decimal.NewFromInt(100)).Round(Scale)
	}
	if !shareAmt.GreaterThan(decimal.Zero) {
		return EntryDTO{}, loans.LoanDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"share_amount": "must be positive",
		})
	}

	due := s.now().UTC().Add(14 * 24 * time.Hour)
	if in.DueAt != nil {
		due = in.DueAt.UTC()
	}
	title := rec.Title
	if title == "" {
		title = "Shared expense"
	}
	note := fmt.Sprintf("Split from expense · your share of %s %s", shareAmt.StringFixed(Scale), rec.CurrencyCode)
	principal := shareAmt.StringFixed(Scale)
	zero := "0"
	loan, err := s.loans.Create(ctx, userID, loans.CreateInput{
		CounterpartyID:      in.FriendID,
		Role:                loans.RoleLender,
		Principal:           &principal,
		CurrencyCode:        &rec.CurrencyCode,
		InterestRatePercent: &zero,
		DueAt:               &due,
		Note:                &note,
		Title:               &title,
		AutoAccept:          false, // counterparty accepts → bond forms
	})
	if err != nil {
		return EntryDTO{}, loans.LoanDTO{}, err
	}
	if err := s.store.LinkLoan(ctx, userID, entryID, loan.ID); err != nil {
		return EntryDTO{}, loans.LoanDTO{}, err
	}
	rec.LinkedLoanID = &loan.ID
	return toDTO(rec), loan, nil
}

func (s *Service) Receive(ctx context.Context, userID, id uuid.UUID, accountID *uuid.UUID) (EntryDTO, error) {
	rec, err := s.store.Get(ctx, userID, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return EntryDTO{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "entry not found")
		}
		return EntryDTO{}, err
	}
	now := s.now().UTC()
	if rec.IsTemplate {
		child := Entry{
			UserID:       rec.UserID,
			Kind:         rec.Kind,
			Title:        rec.Title,
			Amount:       rec.Amount,
			CurrencyCode: rec.CurrencyCode,
			Category:     rec.Category,
			CategoryID:   rec.CategoryID,
			AccountID:    firstAccountID(accountID, rec.AccountID),
			Note:         rec.Note,
			OccurredAt:   now,
			IsTemplate:   false,
			TemplateID:   &rec.ID,
			Status:       StatusConfirmed,
			CreatedAt:    now,
			UpdatedAt:    now,
		}
		saved, err := s.store.Insert(ctx, child)
		if err != nil {
			return EntryDTO{}, err
		}
		if rec.Recurrence != nil {
			next := nextOccurrence(*rec.Recurrence, now, now)
			rec.NextOccurrenceAt = &next
			rec.UpdatedAt = now
			_, _ = s.store.Update(ctx, rec)
		}
		if err := s.applyAccount(ctx, userID, saved); err != nil {
			return EntryDTO{}, err
		}
		return toDTO(saved), nil
	}
	if rec.Status == StatusConfirmed {
		return toDTO(rec), nil
	}
	if accountID != nil {
		rec.AccountID = accountID
	}
	rec.Status = StatusConfirmed
	rec.UpdatedAt = now
	saved, err := s.store.Update(ctx, rec)
	if err != nil {
		return EntryDTO{}, err
	}
	if err := s.applyAccount(ctx, userID, saved); err != nil {
		return EntryDTO{}, err
	}
	return toDTO(saved), nil
}

func (s *Service) MaterializeDue(ctx context.Context) (int, error) {
	now := s.now().UTC()
	templates, err := s.store.ListDueTemplates(ctx, now, 100)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, tmpl := range templates {
		kind := tmpl.Kind
		if kind == "" {
			kind = KindIncome
		}
		child := Entry{
			UserID:       tmpl.UserID,
			Kind:         kind,
			Title:        tmpl.Title,
			Amount:       tmpl.Amount,
			CurrencyCode: tmpl.CurrencyCode,
			Category:     tmpl.Category,
			CategoryID:   tmpl.CategoryID,
			AccountID:    tmpl.AccountID,
			Note:         tmpl.Note,
			OccurredAt:   now,
			IsTemplate:   false,
			TemplateID:   &tmpl.ID,
			Status:       StatusExpected,
			CreatedAt:    now,
			UpdatedAt:    now,
		}
		if _, err := s.store.Insert(ctx, child); err != nil {
			return n, err
		}
		if tmpl.Recurrence == nil {
			continue
		}
		next := nextOccurrence(*tmpl.Recurrence, now, now)
		tmpl.NextOccurrenceAt = &next
		tmpl.UpdatedAt = now
		if _, err := s.store.Update(ctx, tmpl); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

func (s *Service) resolveCategory(ctx context.Context, userID uuid.UUID, kind, name string, id *uuid.UUID) (string, *uuid.UUID, error) {
	cats, err := s.store.ListCategories(ctx, userID, kind)
	if err != nil {
		return "", nil, err
	}
	if id != nil {
		for _, c := range cats {
			if c.ID == *id {
				return c.Name, &c.ID, nil
			}
		}
		return "", nil, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"category_id": "unknown category",
		})
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Other"
	}
	slug := slugify(name)
	for _, c := range cats {
		if strings.EqualFold(c.Slug, slug) || strings.EqualFold(c.Name, name) {
			cid := c.ID
			return c.Name, &cid, nil
		}
	}
	return name, nil, nil
}

func normalizeKind(raw string) (string, error) {
	k := strings.TrimSpace(strings.ToLower(raw))
	switch k {
	case KindIncome:
		return KindIncome, nil
	case KindExpense, "outcome":
		return KindExpense, nil
	default:
		return "", httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"kind": "must be income or expense",
		})
	}
}

func normalizeRecurrence(in *string) (*string, error) {
	if in == nil {
		return nil, nil
	}
	v := strings.TrimSpace(strings.ToLower(*in))
	if v == "" || v == "none" || v == "one_time" {
		return nil, nil
	}
	switch v {
	case RecurrenceWeekly, RecurrenceMonthly, RecurrenceYearly:
		return &v, nil
	default:
		return nil, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"recurrence": "must be weekly, monthly, or yearly",
		})
	}
}

func nextOccurrence(recurrence string, from, now time.Time) time.Time {
	base := from.UTC()
	if base.Before(now) {
		base = now
	}
	switch recurrence {
	case RecurrenceWeekly:
		return base.AddDate(0, 0, 7)
	case RecurrenceYearly:
		return base.AddDate(1, 0, 0)
	default:
		return base.AddDate(0, 1, 0)
	}
}

func parsePositive(raw string) (decimal.Decimal, error) {
	d, err := decimal.NewFromString(strings.TrimSpace(raw))
	if err != nil || !d.GreaterThan(decimal.Zero) {
		return decimal.Decimal{}, errors.New("invalid")
	}
	return d.Round(Scale), nil
}

func cleanNote(in *string) (*string, error) {
	if in == nil {
		return nil, nil
	}
	n := strings.TrimSpace(*in)
	if n == "" {
		return nil, nil
	}
	if utf8.RuneCountInString(n) > 500 {
		return nil, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"note": "max 500 characters",
		})
	}
	return &n, nil
}

func slugify(name string) string {
	name = strings.ToLower(strings.TrimSpace(name))
	var b strings.Builder
	prevDash := false
	for _, r := range name {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			prevDash = false
			continue
		}
		if !prevDash {
			b.WriteByte('-')
			prevDash = true
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "custom"
	}
	if len(out) > 64 {
		out = out[:64]
	}
	return out
}

func (s *Service) applyAccount(ctx context.Context, userID uuid.UUID, rec Entry) error {
	if s.accounts == nil || rec.AccountID == nil || rec.Status != StatusConfirmed || rec.IsTemplate {
		return nil
	}
	note := rec.Title
	return s.accounts.ApplyCashflowDelta(ctx, userID, *rec.AccountID, rec.Kind, rec.Amount, rec.CurrencyCode, note)
}

func firstAccountID(preferred, fallback *uuid.UUID) *uuid.UUID {
	if preferred != nil {
		return preferred
	}
	return fallback
}

func (s *Service) UpsertBudget(ctx context.Context, userID uuid.UUID, in BudgetInput) (BudgetDTO, error) {
	name := strings.TrimSpace(in.CategoryName)
	if name == "" && in.CategoryID != nil {
		cats, err := s.store.ListCategories(ctx, userID, KindExpense)
		if err != nil {
			return BudgetDTO{}, err
		}
		for _, c := range cats {
			if c.ID == *in.CategoryID {
				name = c.Name
				break
			}
		}
	}
	if name == "" || utf8.RuneCountInString(name) > 64 {
		return BudgetDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"category_name": "required, max 64 characters",
		})
	}
	currency := strings.ToUpper(strings.TrimSpace(in.CurrencyCode))
	if len(currency) != 3 {
		return BudgetDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"currency_code": "must be a 3-letter currency code",
		})
	}
	limit, err := parsePositive(in.LimitAmount)
	if err != nil {
		return BudgetDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"limit_amount": "must be a positive decimal",
		})
	}
	month, err := parsePeriodMonth(in.PeriodMonth)
	if err != nil {
		return BudgetDTO{}, err
	}
	now := s.now().UTC()
	saved, err := s.store.UpsertBudget(ctx, Budget{
		UserID:       userID,
		CategoryID:   in.CategoryID,
		CategoryName: name,
		CurrencyCode: currency,
		LimitAmount:  limit,
		PeriodMonth:  month,
		CreatedAt:    now,
		UpdatedAt:    now,
	})
	if err != nil {
		return BudgetDTO{}, err
	}
	return s.budgetDTO(ctx, userID, saved)
}

func (s *Service) ListBudgets(ctx context.Context, userID uuid.UUID, periodRaw string) ([]BudgetDTO, error) {
	month := s.now().UTC()
	if strings.TrimSpace(periodRaw) != "" {
		m, err := parsePeriodMonth(periodRaw)
		if err != nil {
			return nil, err
		}
		month = m
	} else {
		month = time.Date(month.Year(), month.Month(), 1, 0, 0, 0, 0, time.UTC)
	}
	rows, err := s.store.ListBudgets(ctx, userID, month)
	if err != nil {
		return nil, err
	}
	out := make([]BudgetDTO, 0, len(rows))
	for _, row := range rows {
		dto, err := s.budgetDTO(ctx, userID, row)
		if err != nil {
			return nil, err
		}
		out = append(out, dto)
	}
	return out, nil
}

func (s *Service) DeleteBudget(ctx context.Context, userID, id uuid.UUID) error {
	if err := s.store.DeleteBudget(ctx, userID, id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return httpx.E(http.StatusNotFound, "NOT_FOUND", "budget not found")
		}
		return err
	}
	return nil
}

func (s *Service) budgetDTO(ctx context.Context, userID uuid.UUID, b Budget) (BudgetDTO, error) {
	from := b.PeriodMonth
	to := from.AddDate(0, 1, 0)
	spent := decimal.Zero
	rows, err := s.store.CategoryBreakdown(ctx, userID, KindExpense, &from, &to)
	if err != nil {
		return BudgetDTO{}, err
	}
	for _, row := range rows {
		if !strings.EqualFold(row.CurrencyCode, b.CurrencyCode) {
			continue
		}
		if !strings.EqualFold(row.Category, b.CategoryName) {
			continue
		}
		amt, err := decimal.NewFromString(row.Amount)
		if err == nil {
			spent = amt
		}
		break
	}
	remaining := b.LimitAmount.Sub(spent)
	return BudgetDTO{
		ID:           b.ID,
		CategoryID:   b.CategoryID,
		CategoryName: b.CategoryName,
		CurrencyCode: b.CurrencyCode,
		LimitAmount:  b.LimitAmount.StringFixed(Scale),
		PeriodMonth:  b.PeriodMonth.Format("2006-01-02"),
		Spent:        spent.StringFixed(Scale),
		Remaining:    remaining.StringFixed(Scale),
		CreatedAt:    b.CreatedAt,
		UpdatedAt:    b.UpdatedAt,
	}, nil
}

func parsePeriodMonth(raw string) (time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		now := time.Now().UTC()
		return time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC), nil
	}
	if t, err := time.Parse("2006-01-02", raw); err == nil {
		return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC), nil
	}
	if t, err := time.Parse("2006-01", raw); err == nil {
		return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC), nil
	}
	return time.Time{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
		"period_month": "must be YYYY-MM or YYYY-MM-01",
	})
}
