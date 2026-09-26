package store

import (
	"context"
	"strings"
	"time"

	"equilend/api/internal/expenses"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const cashflowSelect = `
	id, user_id, kind, COALESCE(title, ''), amount::text, currency_code, category, category_id, note,
	occurred_at, COALESCE(is_template, false), recurrence, next_occurrence_at, template_id, linked_loan_id,
	account_id, COALESCE(status, 'confirmed'), created_at, updated_at
`

func (s *SQLStore) InsertCashflow(ctx context.Context, rec expenses.Entry) (expenses.Entry, error) {
	status := rec.Status
	if status == "" {
		status = expenses.StatusConfirmed
	}
	row := s.pool.QueryRow(ctx, `
		INSERT INTO cashflow_entries (
			user_id, kind, title, amount, currency_code, category, category_id, note, occurred_at,
			is_template, recurrence, next_occurrence_at, template_id, linked_loan_id, account_id, status, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
		RETURNING `+cashflowSelect+`
	`, rec.UserID, rec.Kind, rec.Title, rec.Amount.StringFixed(expenses.Scale), rec.CurrencyCode, rec.Category, rec.CategoryID, rec.Note, rec.OccurredAt,
		rec.IsTemplate, rec.Recurrence, rec.NextOccurrenceAt, rec.TemplateID, rec.LinkedLoanID, rec.AccountID, status, rec.CreatedAt, rec.UpdatedAt)
	return scanCashflow(row)
}

func (s *SQLStore) GetCashflow(ctx context.Context, userID, id uuid.UUID) (expenses.Entry, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT `+cashflowSelect+` FROM cashflow_entries WHERE id = $1 AND user_id = $2
	`, id, userID)
	return scanCashflow(row)
}

func (s *SQLStore) ListCashflow(ctx context.Context, userID uuid.UUID, q expenses.ListQuery) ([]expenses.Entry, error) {
	args := []any{userID}
	clauses := []string{"user_id = $1"}
	if q.Kind != "" {
		args = append(args, q.Kind)
		clauses = append(clauses, "kind = $"+itoa(len(args)))
	}
	if q.Currency != "" {
		args = append(args, q.Currency)
		clauses = append(clauses, "currency_code = $"+itoa(len(args)))
	}
	if q.From != nil {
		args = append(args, *q.From)
		clauses = append(clauses, "occurred_at >= $"+itoa(len(args)))
	}
	if q.To != nil {
		args = append(args, *q.To)
		clauses = append(clauses, "occurred_at < $"+itoa(len(args)))
	}
	if q.Templates != nil {
		args = append(args, *q.Templates)
		clauses = append(clauses, "is_template = $"+itoa(len(args)))
	} else {
		clauses = append(clauses, "COALESCE(is_template, false) = false")
	}
	limit := q.Limit
	if limit <= 0 {
		limit = 200
	}
	args = append(args, limit)
	sql := `
		SELECT ` + cashflowSelect + `
		FROM cashflow_entries
		WHERE ` + strings.Join(clauses, " AND ") + `
		ORDER BY occurred_at DESC, created_at DESC
		LIMIT $` + itoa(len(args))
	rows, err := s.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []expenses.Entry
	for rows.Next() {
		rec, err := scanCashflow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

func (s *SQLStore) UpdateCashflow(ctx context.Context, rec expenses.Entry) (expenses.Entry, error) {
	status := rec.Status
	if status == "" {
		status = expenses.StatusConfirmed
	}
	row := s.pool.QueryRow(ctx, `
		UPDATE cashflow_entries SET
			title = $3, amount = $4, currency_code = $5, category = $6, category_id = $7, note = $8,
			occurred_at = $9, is_template = $10, recurrence = $11, next_occurrence_at = $12, account_id = $13, status = $14, updated_at = $15
		WHERE id = $1 AND user_id = $2
		RETURNING `+cashflowSelect+`
	`, rec.ID, rec.UserID, rec.Title, rec.Amount.StringFixed(expenses.Scale), rec.CurrencyCode, rec.Category, rec.CategoryID, rec.Note,
		rec.OccurredAt, rec.IsTemplate, rec.Recurrence, rec.NextOccurrenceAt, rec.AccountID, status, rec.UpdatedAt)
	return scanCashflow(row)
}

func (s *SQLStore) DeleteCashflow(ctx context.Context, userID, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM cashflow_entries WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *SQLStore) CashflowSummary(ctx context.Context, userID uuid.UUID, from, to *time.Time) ([]expenses.SummarySlice, error) {
	args := []any{userID}
	clauses := []string{"user_id = $1", "COALESCE(is_template, false) = false", "COALESCE(status, 'confirmed') = 'confirmed'"}
	if from != nil {
		args = append(args, *from)
		clauses = append(clauses, "occurred_at >= $"+itoa(len(args)))
	}
	if to != nil {
		args = append(args, *to)
		clauses = append(clauses, "occurred_at < $"+itoa(len(args)))
	}
	sql := `
		SELECT currency_code,
			COALESCE(SUM(CASE WHEN kind = 'income' THEN amount ELSE 0 END), 0)::text AS income,
			COALESCE(SUM(CASE WHEN kind IN ('expense','outcome') THEN amount ELSE 0 END), 0)::text AS expense,
			COALESCE(SUM(CASE WHEN kind = 'income' THEN 1 ELSE 0 END), 0)::int AS income_count,
			COALESCE(SUM(CASE WHEN kind IN ('expense','outcome') THEN 1 ELSE 0 END), 0)::int AS expense_count
		FROM cashflow_entries
		WHERE ` + strings.Join(clauses, " AND ") + `
		GROUP BY currency_code
		ORDER BY currency_code ASC
	`
	rows, err := s.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []expenses.SummarySlice
	for rows.Next() {
		var slice expenses.SummarySlice
		var income, expense string
		if err := rows.Scan(&slice.CurrencyCode, &income, &expense, &slice.IncomeCount, &slice.ExpenseCount); err != nil {
			return nil, err
		}
		inc := mustDec(income)
		exp := mustDec(expense)
		slice.Income = inc.StringFixed(expenses.Scale)
		slice.Expense = exp.StringFixed(expenses.Scale)
		slice.Outcome = slice.Expense
		slice.OutcomeCount = slice.ExpenseCount
		slice.Net = inc.Sub(exp).StringFixed(expenses.Scale)
		out = append(out, slice)
	}
	return out, rows.Err()
}

func (s *SQLStore) CashflowCategoryBreakdown(ctx context.Context, userID uuid.UUID, kind string, from, to *time.Time) ([]expenses.CategorySpend, error) {
	args := []any{userID}
	clauses := []string{"user_id = $1", "COALESCE(is_template, false) = false", "COALESCE(status, 'confirmed') = 'confirmed'"}
	if kind != "" {
		args = append(args, kind)
		clauses = append(clauses, "kind = $"+itoa(len(args)))
	}
	if from != nil {
		args = append(args, *from)
		clauses = append(clauses, "occurred_at >= $"+itoa(len(args)))
	}
	if to != nil {
		args = append(args, *to)
		clauses = append(clauses, "occurred_at < $"+itoa(len(args)))
	}
	sql := `
		SELECT category, category_id, currency_code, COALESCE(SUM(amount), 0)::text, COUNT(*)::int
		FROM cashflow_entries
		WHERE ` + strings.Join(clauses, " AND ") + `
		GROUP BY category, category_id, currency_code
		ORDER BY SUM(amount) DESC
	`
	rows, err := s.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []expenses.CategorySpend
	for rows.Next() {
		var row expenses.CategorySpend
		var amt string
		if err := rows.Scan(&row.Category, &row.CategoryID, &row.CurrencyCode, &amt, &row.Count); err != nil {
			return nil, err
		}
		row.Amount = mustDec(amt).StringFixed(expenses.Scale)
		out = append(out, row)
	}
	return out, rows.Err()
}

func (s *SQLStore) UpsertBudget(ctx context.Context, rec expenses.Budget) (expenses.Budget, error) {
	row := s.pool.QueryRow(ctx, `
		INSERT INTO budgets (user_id, category_id, category_name, currency_code, limit_amount, period_month, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		ON CONFLICT (user_id, category_name, currency_code, period_month)
		DO UPDATE SET limit_amount = EXCLUDED.limit_amount, category_id = EXCLUDED.category_id, updated_at = EXCLUDED.updated_at
		RETURNING id, user_id, category_id, category_name, currency_code, limit_amount::text, period_month, created_at, updated_at
	`, rec.UserID, rec.CategoryID, rec.CategoryName, rec.CurrencyCode, rec.LimitAmount.StringFixed(expenses.Scale),
		rec.PeriodMonth, rec.CreatedAt, rec.UpdatedAt)
	return scanBudget(row)
}

func (s *SQLStore) ListBudgets(ctx context.Context, userID uuid.UUID, period time.Time) ([]expenses.Budget, error) {
	month := time.Date(period.UTC().Year(), period.UTC().Month(), 1, 0, 0, 0, 0, time.UTC)
	rows, err := s.pool.Query(ctx, `
		SELECT id, user_id, category_id, category_name, currency_code, limit_amount::text, period_month, created_at, updated_at
		FROM budgets WHERE user_id = $1 AND period_month = $2
		ORDER BY category_name ASC
	`, userID, month)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []expenses.Budget
	for rows.Next() {
		b, err := scanBudget(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func (s *SQLStore) DeleteBudget(ctx context.Context, userID, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM budgets WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

type budgetScannable interface {
	Scan(dest ...any) error
}

func scanBudget(row budgetScannable) (expenses.Budget, error) {
	var b expenses.Budget
	var lim string
	if err := row.Scan(&b.ID, &b.UserID, &b.CategoryID, &b.CategoryName, &b.CurrencyCode, &lim, &b.PeriodMonth, &b.CreatedAt, &b.UpdatedAt); err != nil {
		return expenses.Budget{}, err
	}
	b.LimitAmount = mustDec(lim)
	return b, nil
}

func (s *SQLStore) ListCashflowCategories(ctx context.Context, userID uuid.UUID, kind string) ([]expenses.Category, error) {
	args := []any{userID}
	clause := `(user_id IS NULL OR user_id = $1)`
	if kind != "" {
		args = append(args, kind)
		clause += ` AND kind = $` + itoa(len(args))
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, user_id, kind, name, slug, is_system
		FROM cashflow_categories
		WHERE `+clause+`
		ORDER BY is_system DESC, name ASC
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []expenses.Category
	for rows.Next() {
		var c expenses.Category
		if err := rows.Scan(&c.ID, &c.UserID, &c.Kind, &c.Name, &c.Slug, &c.IsSystem); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *SQLStore) InsertCashflowCategory(ctx context.Context, cat expenses.Category) (expenses.Category, error) {
	row := s.pool.QueryRow(ctx, `
		INSERT INTO cashflow_categories (user_id, kind, name, slug, is_system)
		VALUES ($1, $2, $3, $4, false)
		RETURNING id, user_id, kind, name, slug, is_system
	`, cat.UserID, cat.Kind, cat.Name, cat.Slug)
	var out expenses.Category
	if err := row.Scan(&out.ID, &out.UserID, &out.Kind, &out.Name, &out.Slug, &out.IsSystem); err != nil {
		return expenses.Category{}, err
	}
	return out, nil
}

func (s *SQLStore) ListDueCashflowTemplates(ctx context.Context, before time.Time, limit int) ([]expenses.Entry, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, `
		SELECT `+cashflowSelect+`
		FROM cashflow_entries
		WHERE is_template = true
		  AND recurrence IS NOT NULL
		  AND next_occurrence_at IS NOT NULL
		  AND next_occurrence_at <= $1
		ORDER BY next_occurrence_at ASC
		LIMIT $2
	`, before, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []expenses.Entry
	for rows.Next() {
		rec, err := scanCashflow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

func (s *SQLStore) LinkCashflowLoan(ctx context.Context, userID, entryID, loanID uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE cashflow_entries SET linked_loan_id = $3, updated_at = now()
		WHERE id = $1 AND user_id = $2
	`, entryID, userID, loanID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

type scannable interface {
	Scan(dest ...any) error
}

func scanCashflow(row scannable) (expenses.Entry, error) {
	var rec expenses.Entry
	var amount string
	if err := row.Scan(
		&rec.ID, &rec.UserID, &rec.Kind, &rec.Title, &amount, &rec.CurrencyCode, &rec.Category, &rec.CategoryID, &rec.Note,
		&rec.OccurredAt, &rec.IsTemplate, &rec.Recurrence, &rec.NextOccurrenceAt, &rec.TemplateID, &rec.LinkedLoanID,
		&rec.AccountID, &rec.Status, &rec.CreatedAt, &rec.UpdatedAt,
	); err != nil {
		return expenses.Entry{}, err
	}
	rec.Amount = mustDec(amount)
	if rec.Status == "" {
		rec.Status = expenses.StatusConfirmed
	}
	return rec, nil
}

func itoa(n int) string {
	const digits = "0123456789"
	if n < 10 {
		return string(digits[n])
	}
	var b [12]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = digits[n%10]
		n /= 10
	}
	return string(b[i:])
}
