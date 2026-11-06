package store

import (
	"context"
	"time"

	"equilend/api/internal/accounts"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// AccountsAt returns each open account's balance and the money dated after at, so the
// balance at that moment can be worked out (accounts.AccountAt.BalanceAt).
func (s *SQLStore) AccountsAt(ctx context.Context, userID uuid.UUID, at time.Time) ([]accounts.AccountAt, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT a.id, a.account_type, upper(a.currency_code), a.balance::text,
			COALESCE((SELECT SUM(CASE WHEN e.kind = 'income' THEN e.amount ELSE -e.amount END)
			          FROM cashflow_entries e
			          WHERE e.user_id = $1 AND e.account_id = a.id
			            AND COALESCE(e.status, 'confirmed') = 'confirmed'
			            AND COALESCE(e.is_template, false) = false
			            AND e.occurred_at > $2), 0)::text,
			COALESCE((SELECT SUM(t.amount) FROM money_transfers t
			          WHERE t.user_id = $1 AND t.to_account_id = a.id AND t.occurred_at > $2), 0)::text,
			COALESCE((SELECT SUM(t.amount) FROM money_transfers t
			          WHERE t.user_id = $1 AND t.from_account_id = a.id AND t.occurred_at > $2), 0)::text
		FROM money_accounts a
		WHERE a.user_id = $1 AND a.archived_at IS NULL
	`, userID, at)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []accounts.AccountAt
	for rows.Next() {
		var a accounts.AccountAt
		var bal, net, tin, tout string
		if err := rows.Scan(&a.ID, &a.Type, &a.CurrencyCode, &bal, &net, &tin, &tout); err != nil {
			return nil, err
		}
		a.Balance, _ = decimal.NewFromString(bal)
		a.NetAfter, _ = decimal.NewFromString(net)
		a.TransferIn, _ = decimal.NewFromString(tin)
		a.TransferOut, _ = decimal.NewFromString(tout)
		out = append(out, a)
	}
	return out, rows.Err()
}

// DayFlows sums confirmed income and expenses dated in [from, to), per currency.
func (s *SQLStore) DayFlows(ctx context.Context, userID uuid.UUID, from, to time.Time) ([]accounts.DayFlow, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT upper(currency_code), kind, SUM(amount)::text, COUNT(*)
		FROM cashflow_entries
		WHERE user_id = $1
		  AND COALESCE(status, 'confirmed') = 'confirmed'
		  AND COALESCE(is_template, false) = false
		  AND occurred_at >= $2 AND occurred_at < $3
		GROUP BY 1, 2
	`, userID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []accounts.DayFlow
	for rows.Next() {
		var f accounts.DayFlow
		var amt string
		if err := rows.Scan(&f.CurrencyCode, &f.Kind, &amt, &f.Count); err != nil {
			return nil, err
		}
		f.Amount, _ = decimal.NewFromString(amt)
		out = append(out, f)
	}
	return out, rows.Err()
}
