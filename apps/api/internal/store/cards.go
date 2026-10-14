package store

import (
	"context"
	"errors"
	"time"

	"equilend/api/internal/accounts"
	"equilend/api/internal/expenses"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const installmentSelect = `
	id, user_id, account_id, merchant, total_amount::text, remaining_amount::text, monthly_amount::text,
	months_total, months_remaining, currency_code, next_charge_on, created_at, updated_at
`

func (s *SQLStore) InsertCardInstallment(ctx context.Context, rec accounts.Installment) (accounts.Installment, error) {
	row := s.pool.QueryRow(ctx, `
		INSERT INTO credit_card_installments (
			user_id, account_id, merchant, total_amount, remaining_amount, monthly_amount,
			months_total, months_remaining, currency_code, next_charge_on, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		RETURNING `+installmentSelect+`
	`, rec.UserID, rec.AccountID, rec.Merchant,
		rec.TotalAmount.StringFixed(accounts.Scale), rec.RemainingAmount.StringFixed(accounts.Scale), rec.MonthlyAmount.StringFixed(accounts.Scale),
		rec.MonthsTotal, rec.MonthsRemaining, rec.CurrencyCode, rec.NextChargeOn, rec.CreatedAt, rec.UpdatedAt)
	return scanInstallment(row)
}

func (s *SQLStore) ListCardInstallments(ctx context.Context, userID, accountID uuid.UUID) ([]accounts.Installment, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+installmentSelect+`
		FROM credit_card_installments
		WHERE user_id = $1 AND account_id = $2
		ORDER BY CASE WHEN months_remaining > 0 THEN 0 ELSE 1 END, next_charge_on ASC, created_at ASC
	`, userID, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []accounts.Installment
	for rows.Next() {
		rec, err := scanInstallment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

func (s *SQLStore) GetCardInstallment(ctx context.Context, userID, accountID, id uuid.UUID) (accounts.Installment, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT `+installmentSelect+`
		FROM credit_card_installments
		WHERE id = $1 AND user_id = $2 AND account_id = $3
	`, id, userID, accountID)
	return scanInstallment(row)
}

func (s *SQLStore) UpdateCardInstallment(ctx context.Context, rec accounts.Installment) (accounts.Installment, error) {
	row := s.pool.QueryRow(ctx, `
		UPDATE credit_card_installments SET
			remaining_amount = $4, monthly_amount = $5, months_remaining = $6,
			next_charge_on = $7, updated_at = $8
		WHERE id = $1 AND user_id = $2 AND account_id = $3
		RETURNING `+installmentSelect+`
	`, rec.ID, rec.UserID, rec.AccountID,
		rec.RemainingAmount.StringFixed(accounts.Scale), rec.MonthlyAmount.StringFixed(accounts.Scale), rec.MonthsRemaining,
		rec.NextChargeOn, rec.UpdatedAt)
	return scanInstallment(row)
}

func (s *SQLStore) DeleteCardInstallment(ctx context.Context, userID, accountID, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `
		DELETE FROM credit_card_installments
		WHERE id = $1 AND user_id = $2 AND account_id = $3
	`, id, userID, accountID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *SQLStore) ListDueCardInstallments(ctx context.Context, asOf time.Time, limit int) ([]accounts.Installment, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, `
		SELECT `+installmentSelect+`
		FROM credit_card_installments
		WHERE months_remaining > 0 AND next_charge_on <= $1::date
		ORDER BY next_charge_on ASC
		LIMIT $2
	`, asOf, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []accounts.Installment
	for rows.Next() {
		rec, err := scanInstallment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

func (s *SQLStore) ListCreditCardAccounts(ctx context.Context) ([]accounts.Account, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+moneyAccountSelect+`
		FROM money_accounts
		WHERE account_type = 'credit_card' AND archived_at IS NULL AND due_day IS NOT NULL
		ORDER BY created_at ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []accounts.Account
	for rows.Next() {
		rec, err := scanMoneyAccount(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

func (s *SQLStore) ClaimCardDueAlert(ctx context.Context, accountID uuid.UUID, dueOn time.Time, daysBefore int) (bool, error) {
	var got uuid.UUID
	err := s.pool.QueryRow(ctx, `
		INSERT INTO card_due_alert_log (account_id, due_on, days_before)
		VALUES ($1, $2::date, $3)
		ON CONFLICT DO NOTHING
		RETURNING account_id
	`, accountID, dueOn, daysBefore).Scan(&got)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

func (s *SQLStore) PostCardCharge(ctx context.Context, rec accounts.Charge) error {
	now := rec.OccurredAt
	note := rec.Title
	_, err := s.InsertCashflow(ctx, expenses.Entry{
		UserID:       rec.UserID,
		Kind:         expenses.KindExpense,
		Title:        rec.Title,
		Amount:       rec.Amount,
		CurrencyCode: rec.CurrencyCode,
		Category:     "Installment",
		AccountID:    &rec.AccountID,
		Note:         &note,
		OccurredAt:   rec.OccurredAt,
		Status:       expenses.StatusConfirmed,
		CreatedAt:    now,
		UpdatedAt:    now,
	})
	return err
}

func scanInstallment(row moneyScannable) (accounts.Installment, error) {
	var rec accounts.Installment
	var total, remaining, monthly string
	if err := row.Scan(
		&rec.ID, &rec.UserID, &rec.AccountID, &rec.Merchant, &total, &remaining, &monthly,
		&rec.MonthsTotal, &rec.MonthsRemaining, &rec.CurrencyCode, &rec.NextChargeOn, &rec.CreatedAt, &rec.UpdatedAt,
	); err != nil {
		return accounts.Installment{}, err
	}
	rec.TotalAmount = mustDec(total)
	rec.RemainingAmount = mustDec(remaining)
	rec.MonthlyAmount = mustDec(monthly)
	return rec, nil
}
