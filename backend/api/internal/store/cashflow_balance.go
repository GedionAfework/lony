package store

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"equilend/api/internal/expenses"
	"equilend/api/internal/httpx"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
)

// Cashflow entries and account balances move together, in one transaction, and each
// entry's effect is recorded in balance_applied_at so it is applied once and can be
// undone exactly. See docs/net-worth-integrity.md.

// ApplyEntryBalance moves the account balance for a confirmed entry. It is a no-op when
// the entry was already applied, so a retried request cannot count it twice. When the
// entry has no account yet, accountID is stored on it first.
func (s *SQLStore) ApplyEntryBalance(ctx context.Context, userID, entryID uuid.UUID, accountID *uuid.UUID) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var kind, amount, currency, status string
	var isTemplate bool
	var current *uuid.UUID
	var appliedAt *time.Time
	err = tx.QueryRow(ctx, `
		SELECT kind, amount::text, currency_code, COALESCE(status, 'confirmed'), COALESCE(is_template, false), account_id, balance_applied_at
		FROM cashflow_entries WHERE id = $1 AND user_id = $2 FOR UPDATE
	`, entryID, userID).Scan(&kind, &amount, &currency, &status, &isTemplate, &current, &appliedAt)
	if err != nil {
		return err
	}
	if appliedAt != nil || isTemplate || status != expenses.StatusConfirmed {
		return nil
	}
	if current == nil {
		if accountID == nil {
			return httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"account_id": "choose which account received this money",
			})
		}
		if _, err := tx.Exec(ctx, `UPDATE cashflow_entries SET account_id = $3 WHERE id = $1 AND user_id = $2`, entryID, userID, *accountID); err != nil {
			return err
		}
		current = accountID
	}
	if err := checkAccountCurrency(ctx, tx, userID, *current, currency); err != nil {
		return err
	}
	amt, _ := decimal.NewFromString(amount)
	if err := adjustForEntry(ctx, tx, userID, *current, kind, amt, "", true); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE cashflow_entries SET balance_applied_at = now() WHERE id = $1`, entryID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// DeleteEntryWithBalance deletes an entry and, when its balance change is still part of
// the current balance, reverses it.
func (s *SQLStore) DeleteEntryWithBalance(ctx context.Context, userID, entryID uuid.UUID) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := reverseEntryBalance(ctx, tx, userID, entryID, "Deleted entry"); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `DELETE FROM cashflow_entries WHERE id = $1 AND user_id = $2`, entryID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return tx.Commit(ctx)
}

// UpdateEntryWithBalance saves an edited entry. If its old balance change is still part
// of the current balance, that change is undone and the new amount/account applied, so
// the balance follows the edit.
func (s *SQLStore) UpdateEntryWithBalance(ctx context.Context, rec expenses.Entry) (expenses.Entry, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return expenses.Entry{}, err
	}
	defer tx.Rollback(ctx)

	var oldAmount, oldCurrency string
	var oldAccount *uuid.UUID
	var appliedAt *time.Time
	err = tx.QueryRow(ctx, `
		SELECT amount::text, currency_code, account_id, balance_applied_at
		FROM cashflow_entries WHERE id = $1 AND user_id = $2 FOR UPDATE
	`, rec.ID, rec.UserID).Scan(&oldAmount, &oldCurrency, &oldAccount, &appliedAt)
	if err != nil {
		return expenses.Entry{}, err
	}
	old, _ := decimal.NewFromString(oldAmount)
	moneyChanged := !old.Equal(rec.Amount) || oldCurrency != rec.CurrencyCode || !sameID(oldAccount, rec.AccountID)

	live := false
	if appliedAt != nil && oldAccount != nil && moneyChanged {
		live, err = appliedAfterStatedBalance(ctx, tx, rec.UserID, *oldAccount, *appliedAt)
		if err != nil {
			return expenses.Entry{}, err
		}
	}
	if live {
		if err := reverseEntryBalance(ctx, tx, rec.UserID, rec.ID, "Edited entry"); err != nil {
			return expenses.Entry{}, err
		}
	}

	status := rec.Status
	if status == "" {
		status = expenses.StatusConfirmed
	}
	saved, err := scanCashflow(tx.QueryRow(ctx, `
		UPDATE cashflow_entries SET
			title = $3, amount = $4, currency_code = $5, category = $6, category_id = $7, note = $8,
			occurred_at = $9, is_template = $10, recurrence = $11, next_occurrence_at = $12, account_id = $13, status = $14, paused = $15, updated_at = $16, trip_id = $17
		WHERE id = $1 AND user_id = $2
		RETURNING `+cashflowSelect,
		rec.ID, rec.UserID, rec.Title, rec.Amount.StringFixed(expenses.Scale), rec.CurrencyCode, rec.Category, rec.CategoryID, rec.Note,
		rec.OccurredAt, rec.IsTemplate, rec.Recurrence, rec.NextOccurrenceAt, rec.AccountID, status, rec.Paused, rec.UpdatedAt, rec.TripID))
	if err != nil {
		return expenses.Entry{}, err
	}

	if live && saved.AccountID != nil && !saved.IsTemplate && saved.Status == expenses.StatusConfirmed {
		if err := checkAccountCurrency(ctx, tx, saved.UserID, *saved.AccountID, saved.CurrencyCode); err != nil {
			return expenses.Entry{}, err
		}
		if err := adjustForEntry(ctx, tx, saved.UserID, *saved.AccountID, saved.Kind, saved.Amount, "Edited entry", true); err != nil {
			return expenses.Entry{}, err
		}
		if _, err := tx.Exec(ctx, `UPDATE cashflow_entries SET balance_applied_at = now() WHERE id = $1`, saved.ID); err != nil {
			return expenses.Entry{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return expenses.Entry{}, err
	}
	return saved, nil
}

// reverseEntryBalance undoes an entry's balance change when it is still part of the
// current balance (applied after the last stated balance) and clears balance_applied_at.
// Missing entries are left to the caller.
func reverseEntryBalance(ctx context.Context, tx pgx.Tx, userID, entryID uuid.UUID, note string) error {
	var kind, amount string
	var accountID *uuid.UUID
	var appliedAt *time.Time
	err := tx.QueryRow(ctx, `
		SELECT kind, amount::text, account_id, balance_applied_at
		FROM cashflow_entries WHERE id = $1 AND user_id = $2 FOR UPDATE
	`, entryID, userID).Scan(&kind, &amount, &accountID, &appliedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if appliedAt == nil || accountID == nil {
		return nil
	}
	live, err := appliedAfterStatedBalance(ctx, tx, userID, *accountID, *appliedAt)
	if err != nil {
		return err
	}
	if live {
		amt, _ := decimal.NewFromString(amount)
		reverse := "income"
		if kind == "income" {
			reverse = "expense"
		}
		if err := adjustForEntry(ctx, tx, userID, *accountID, reverse, amt, note, false); err != nil {
			return err
		}
	}
	_, err = tx.Exec(ctx, `UPDATE cashflow_entries SET balance_applied_at = NULL WHERE id = $1`, entryID)
	return err
}

// appliedAfterStatedBalance reports whether a change applied at appliedAt is still in the
// balance, i.e. the user has not stated the balance (manual, reconcile, SMS) since.
func appliedAfterStatedBalance(ctx context.Context, tx pgx.Tx, userID, accountID uuid.UUID, appliedAt time.Time) (bool, error) {
	var stated *time.Time
	err := tx.QueryRow(ctx, `
		SELECT MAX(created_at) FROM money_account_balance_events
		WHERE account_id = $1 AND user_id = $2 AND source IN ('manual', 'reconcile', 'sms')
	`, accountID, userID).Scan(&stated)
	if err != nil {
		return false, err
	}
	return stated == nil || appliedAt.After(*stated), nil
}

func checkAccountCurrency(ctx context.Context, tx pgx.Tx, userID, accountID uuid.UUID, currency string) error {
	var code string
	err := tx.QueryRow(ctx, `SELECT currency_code FROM money_accounts WHERE id = $1 AND user_id = $2`, accountID, userID).Scan(&code)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.E(http.StatusNotFound, "NOT_FOUND", "account not found")
	}
	if err != nil {
		return err
	}
	if !strings.EqualFold(code, currency) {
		return httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"account_id": "account currency must match entry currency",
		})
	}
	return nil
}

func sameID(a, b *uuid.UUID) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}
