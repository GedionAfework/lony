package store

import (
	"context"
	"time"

	"equilend/api/internal/insights"

	"github.com/google/uuid"
)

func (s *SQLStore) InsightsCashflowTotals(ctx context.Context, userID uuid.UUID, from, to time.Time, currency string) (insights.CashflowTotals, error) {
	var income, expense string
	err := s.pool.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(CASE WHEN kind = 'income' THEN amount ELSE 0 END), 0)::text,
			COALESCE(SUM(CASE WHEN kind IN ('expense','outcome') THEN amount ELSE 0 END), 0)::text
		FROM cashflow_entries
		WHERE user_id = $1
		  AND COALESCE(is_template, false) = false
		  AND COALESCE(status, 'confirmed') = 'confirmed'
		  AND currency_code = $2
		  AND occurred_at >= $3 AND occurred_at < $4
	`, userID, currency, from, to).Scan(&income, &expense)
	if err != nil {
		return insights.CashflowTotals{}, err
	}
	return insights.CashflowTotals{Income: mustDec(income), Expense: mustDec(expense)}, nil
}

func (s *SQLStore) InsightsCashflowSeries(ctx context.Context, userID uuid.UUID, from time.Time, currency string) ([]insights.MonthlyRow, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT date_trunc('month', occurred_at AT TIME ZONE 'UTC') AS month,
			currency_code,
			COALESCE(SUM(CASE WHEN kind = 'income' THEN amount ELSE 0 END), 0)::text,
			COALESCE(SUM(CASE WHEN kind IN ('expense','outcome') THEN amount ELSE 0 END), 0)::text
		FROM cashflow_entries
		WHERE user_id = $1
		  AND COALESCE(is_template, false) = false
		  AND COALESCE(status, 'confirmed') = 'confirmed'
		  AND currency_code = $2
		  AND occurred_at >= $3
		GROUP BY 1, 2
		ORDER BY 1 ASC
	`, userID, currency, from)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []insights.MonthlyRow
	for rows.Next() {
		var row insights.MonthlyRow
		var inc, exp string
		if err := rows.Scan(&row.Month, &row.CurrencyCode, &inc, &exp); err != nil {
			return nil, err
		}
		row.Income = mustDec(inc)
		row.Expense = mustDec(exp)
		out = append(out, row)
	}
	return out, rows.Err()
}

func (s *SQLStore) InsightsCategorySpend(ctx context.Context, userID uuid.UUID, from, to time.Time, currency string) ([]insights.CategoryRow, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT category, currency_code, COALESCE(SUM(amount), 0)::text, COUNT(*)::int
		FROM cashflow_entries
		WHERE user_id = $1
		  AND COALESCE(is_template, false) = false
		  AND COALESCE(status, 'confirmed') = 'confirmed'
		  AND kind IN ('expense','outcome')
		  AND currency_code = $2
		  AND occurred_at >= $3 AND occurred_at < $4
		GROUP BY category, currency_code
		ORDER BY SUM(amount) DESC
	`, userID, currency, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []insights.CategoryRow
	for rows.Next() {
		var row insights.CategoryRow
		var amt string
		if err := rows.Scan(&row.Category, &row.CurrencyCode, &amt, &row.Count); err != nil {
			return nil, err
		}
		row.Amount = mustDec(amt)
		out = append(out, row)
	}
	return out, rows.Err()
}

type insightsStoreAdapter struct {
	Inner *SQLStore
}

func (a insightsStoreAdapter) CashflowTotals(ctx context.Context, userID uuid.UUID, from, to time.Time, currency string) (insights.CashflowTotals, error) {
	return a.Inner.InsightsCashflowTotals(ctx, userID, from, to, currency)
}
func (a insightsStoreAdapter) CashflowSeries(ctx context.Context, userID uuid.UUID, from time.Time, currency string) ([]insights.MonthlyRow, error) {
	return a.Inner.InsightsCashflowSeries(ctx, userID, from, currency)
}
func (a insightsStoreAdapter) CategorySpend(ctx context.Context, userID uuid.UUID, from, to time.Time, currency string) ([]insights.CategoryRow, error) {
	return a.Inner.InsightsCategorySpend(ctx, userID, from, to, currency)
}

// InsightsAdapter exposes SQLStore as insights.Store.
func InsightsAdapter(s *SQLStore) insights.Store {
	return insightsStoreAdapter{Inner: s}
}
