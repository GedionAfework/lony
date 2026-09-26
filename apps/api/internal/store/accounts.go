package store

import (
	"context"
	"strings"
	"time"

	"equilend/api/internal/accounts"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
)

const moneyAccountSelect = `
	id, user_id, name, account_type, currency_code, balance::text, balance_as_of,
	interest_rate_percent::text, compounding, institution_label, bank_profile_id,
	archived_at, created_at, updated_at
`

func (s *SQLStore) InsertMoneyAccount(ctx context.Context, rec accounts.Account, event accounts.BalanceEvent) (accounts.Account, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return accounts.Account{}, err
	}
	defer tx.Rollback(ctx)

	var rate any
	if rec.InterestRatePercent != nil {
		rate = rec.InterestRatePercent.StringFixed(4)
	}
	row := tx.QueryRow(ctx, `
		INSERT INTO money_accounts (
			user_id, name, account_type, currency_code, balance, balance_as_of,
			interest_rate_percent, compounding, institution_label, bank_profile_id,
			created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		RETURNING `+moneyAccountSelect+`
	`, rec.UserID, rec.Name, rec.AccountType, rec.CurrencyCode, rec.Balance.StringFixed(accounts.Scale), rec.BalanceAsOf,
		rate, rec.Compounding, rec.InstitutionLabel, rec.BankProfileID, rec.CreatedAt, rec.UpdatedAt)
	saved, err := scanMoneyAccount(row)
	if err != nil {
		return accounts.Account{}, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO money_account_balance_events (account_id, user_id, balance, source, note, created_at)
		VALUES ($1,$2,$3,$4,$5,$6)
	`, saved.ID, event.UserID, event.Balance.StringFixed(accounts.Scale), event.Source, event.Note, event.CreatedAt); err != nil {
		return accounts.Account{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return accounts.Account{}, err
	}
	return saved, nil
}

func (s *SQLStore) GetMoneyAccount(ctx context.Context, userID, id uuid.UUID) (accounts.Account, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT `+moneyAccountSelect+` FROM money_accounts WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
	`, id, userID)
	return scanMoneyAccount(row)
}

func (s *SQLStore) ListMoneyAccounts(ctx context.Context, userID uuid.UUID, includeArchived bool) ([]accounts.Account, error) {
	sql := `SELECT ` + moneyAccountSelect + ` FROM money_accounts WHERE user_id = $1`
	if !includeArchived {
		sql += ` AND archived_at IS NULL`
	}
	sql += ` ORDER BY created_at ASC`
	rows, err := s.pool.Query(ctx, sql, userID)
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

func (s *SQLStore) UpdateMoneyAccount(ctx context.Context, rec accounts.Account) (accounts.Account, error) {
	var rate any
	if rec.InterestRatePercent != nil {
		rate = rec.InterestRatePercent.StringFixed(4)
	}
	row := s.pool.QueryRow(ctx, `
		UPDATE money_accounts SET
			name = $3, account_type = $4, currency_code = $5,
			interest_rate_percent = $6, compounding = $7, institution_label = $8,
			bank_profile_id = $9, updated_at = $10
		WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
		RETURNING `+moneyAccountSelect+`
	`, rec.ID, rec.UserID, rec.Name, rec.AccountType, rec.CurrencyCode,
		rate, rec.Compounding, rec.InstitutionLabel, rec.BankProfileID, rec.UpdatedAt)
	return scanMoneyAccount(row)
}

func (s *SQLStore) SetMoneyAccountBalance(ctx context.Context, rec accounts.Account, event accounts.BalanceEvent) (accounts.Account, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return accounts.Account{}, err
	}
	defer tx.Rollback(ctx)
	row := tx.QueryRow(ctx, `
		UPDATE money_accounts SET balance = $3, balance_as_of = $4, updated_at = $5
		WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
		RETURNING `+moneyAccountSelect+`
	`, rec.ID, rec.UserID, rec.Balance.StringFixed(accounts.Scale), rec.BalanceAsOf, rec.UpdatedAt)
	saved, err := scanMoneyAccount(row)
	if err != nil {
		return accounts.Account{}, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO money_account_balance_events (account_id, user_id, balance, source, note, created_at)
		VALUES ($1,$2,$3,$4,$5,$6)
	`, saved.ID, event.UserID, event.Balance.StringFixed(accounts.Scale), event.Source, event.Note, event.CreatedAt); err != nil {
		return accounts.Account{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return accounts.Account{}, err
	}
	return saved, nil
}

func (s *SQLStore) ArchiveMoneyAccount(ctx context.Context, userID, id uuid.UUID, at time.Time) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE money_accounts SET archived_at = $3, updated_at = $3
		WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
	`, id, userID, at)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *SQLStore) MoneyAccountLedgerSince(ctx context.Context, userID, accountID uuid.UUID, currency string) (accounts.LedgerSlice, error) {
	var out accounts.LedgerSlice
	var baselineStr string
	err := s.pool.QueryRow(ctx, `
		SELECT COALESCE(
			(SELECT balance::text FROM money_account_balance_events
			 WHERE account_id = $1 AND user_id = $2 AND source IN ('manual','reconcile')
			 ORDER BY created_at DESC LIMIT 1),
			(SELECT balance::text FROM money_account_balance_events
			 WHERE account_id = $1 AND user_id = $2
			 ORDER BY created_at ASC LIMIT 1),
			(SELECT balance::text FROM money_accounts WHERE id = $1 AND user_id = $2)
		),
		COALESCE(
			(SELECT created_at FROM money_account_balance_events
			 WHERE account_id = $1 AND user_id = $2 AND source IN ('manual','reconcile')
			 ORDER BY created_at DESC LIMIT 1),
			(SELECT created_at FROM money_account_balance_events
			 WHERE account_id = $1 AND user_id = $2
			 ORDER BY created_at ASC LIMIT 1),
			(SELECT created_at FROM money_accounts WHERE id = $1 AND user_id = $2)
		)
	`, accountID, userID).Scan(&baselineStr, &out.BaselineAt)
	if err != nil {
		return accounts.LedgerSlice{}, err
	}
	out.BaselineBalance, _ = decimal.NewFromString(baselineStr)

	var income, expense string
	if err := s.pool.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(amount) FILTER (WHERE kind = 'income'), 0)::text,
			COALESCE(SUM(amount) FILTER (WHERE kind = 'expense'), 0)::text
		FROM cashflow_entries
		WHERE user_id = $1
		  AND account_id = $2
		  AND status = 'confirmed'
		  AND COALESCE(is_template, false) = false
		  AND occurred_at > $3
	`, userID, accountID, out.BaselineAt).Scan(&income, &expense); err != nil {
		return accounts.LedgerSlice{}, err
	}
	out.Income, _ = decimal.NewFromString(income)
	out.Expense, _ = decimal.NewFromString(expense)

	var tin, tout string
	if err := s.pool.QueryRow(ctx, `
		SELECT
			COALESCE((SELECT SUM(amount) FROM money_transfers
			          WHERE user_id = $1 AND to_account_id = $2 AND occurred_at > $3), 0)::text,
			COALESCE((SELECT SUM(amount) FROM money_transfers
			          WHERE user_id = $1 AND from_account_id = $2 AND occurred_at > $3), 0)::text
	`, userID, accountID, out.BaselineAt).Scan(&tin, &tout); err != nil {
		return accounts.LedgerSlice{}, err
	}
	out.TransfersIn, _ = decimal.NewFromString(tin)
	out.TransfersOut, _ = decimal.NewFromString(tout)

	var unassigned string
	if err := s.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount ELSE -amount END), 0)::text
		FROM cashflow_entries
		WHERE user_id = $1
		  AND account_id IS NULL
		  AND status = 'confirmed'
		  AND COALESCE(is_template, false) = false
		  AND upper(currency_code) = upper($2)
		  AND occurred_at > $3
	`, userID, currency, out.BaselineAt).Scan(&unassigned); err != nil {
		return accounts.LedgerSlice{}, err
	}
	out.UnassignedConfirmed, _ = decimal.NewFromString(unassigned)
	return out, nil
}

func (s *SQLStore) AdjustMoneyAccountBalance(ctx context.Context, userID, accountID uuid.UUID, delta decimal.Decimal, note string, at time.Time) (accounts.Account, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return accounts.Account{}, err
	}
	defer tx.Rollback(ctx)
	row := tx.QueryRow(ctx, `
		UPDATE money_accounts
		SET balance = balance + $3, balance_as_of = $4, updated_at = $4
		WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
		RETURNING `+moneyAccountSelect+`
	`, accountID, userID, delta.StringFixed(accounts.Scale), at)
	saved, err := scanMoneyAccount(row)
	if err != nil {
		return accounts.Account{}, err
	}
	var n *string
	if strings.TrimSpace(note) != "" {
		trimmed := strings.TrimSpace(note)
		n = &trimmed
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO money_account_balance_events (account_id, user_id, balance, source, note, created_at)
		VALUES ($1,$2,$3,'adjust',$4,$5)
	`, saved.ID, userID, saved.Balance.StringFixed(accounts.Scale), n, at); err != nil {
		return accounts.Account{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return accounts.Account{}, err
	}
	return saved, nil
}

func (s *SQLStore) InsertMoneyTransfer(ctx context.Context, userID, fromID, toID uuid.UUID, amount decimal.Decimal, currency, note string, occurredAt, now time.Time) (uuid.UUID, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx, `
		UPDATE money_accounts SET balance = balance - $3, balance_as_of = $4, updated_at = $4
		WHERE id = $1 AND user_id = $2 AND archived_at IS NULL AND currency_code = $5
	`, fromID, userID, amount.StringFixed(accounts.Scale), now, currency)
	if err != nil {
		return uuid.Nil, err
	}
	if tag.RowsAffected() == 0 {
		return uuid.Nil, pgx.ErrNoRows
	}
	var fromBal string
	if err := tx.QueryRow(ctx, `SELECT balance::text FROM money_accounts WHERE id = $1 AND user_id = $2`, fromID, userID).Scan(&fromBal); err != nil {
		return uuid.Nil, err
	}

	tag, err = tx.Exec(ctx, `
		UPDATE money_accounts SET balance = balance + $3, balance_as_of = $4, updated_at = $4
		WHERE id = $1 AND user_id = $2 AND archived_at IS NULL AND currency_code = $5
	`, toID, userID, amount.StringFixed(accounts.Scale), now, currency)
	if err != nil {
		return uuid.Nil, err
	}
	if tag.RowsAffected() == 0 {
		return uuid.Nil, pgx.ErrNoRows
	}
	var toBal string
	if err := tx.QueryRow(ctx, `SELECT balance::text FROM money_accounts WHERE id = $1 AND user_id = $2`, toID, userID).Scan(&toBal); err != nil {
		return uuid.Nil, err
	}

	var notePtr *string
	if strings.TrimSpace(note) != "" {
		trimmed := strings.TrimSpace(note)
		notePtr = &trimmed
	}
	var id uuid.UUID
	if err := tx.QueryRow(ctx, `
		INSERT INTO money_transfers (user_id, from_account_id, to_account_id, amount, currency_code, note, occurred_at, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id
	`, userID, fromID, toID, amount.StringFixed(accounts.Scale), currency, notePtr, occurredAt, now).Scan(&id); err != nil {
		return uuid.Nil, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO money_account_balance_events (account_id, user_id, balance, source, note, created_at) VALUES
		($1,$2,$3,'adjust',$4,$5), ($6,$2,$7,'adjust',$4,$5)
	`, fromID, userID, fromBal, notePtr, now, toID, toBal); err != nil {
		return uuid.Nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return uuid.Nil, err
	}
	return id, nil
}

type moneyAccountStoreAdapter struct {
	Inner *SQLStore
}

func (a moneyAccountStoreAdapter) Insert(ctx context.Context, rec accounts.Account, event accounts.BalanceEvent) (accounts.Account, error) {
	return a.Inner.InsertMoneyAccount(ctx, rec, event)
}
func (a moneyAccountStoreAdapter) Get(ctx context.Context, userID, id uuid.UUID) (accounts.Account, error) {
	return a.Inner.GetMoneyAccount(ctx, userID, id)
}
func (a moneyAccountStoreAdapter) List(ctx context.Context, userID uuid.UUID, includeArchived bool) ([]accounts.Account, error) {
	return a.Inner.ListMoneyAccounts(ctx, userID, includeArchived)
}
func (a moneyAccountStoreAdapter) Update(ctx context.Context, rec accounts.Account) (accounts.Account, error) {
	return a.Inner.UpdateMoneyAccount(ctx, rec)
}
func (a moneyAccountStoreAdapter) SetBalance(ctx context.Context, rec accounts.Account, event accounts.BalanceEvent) (accounts.Account, error) {
	return a.Inner.SetMoneyAccountBalance(ctx, rec, event)
}
func (a moneyAccountStoreAdapter) Archive(ctx context.Context, userID, id uuid.UUID, at time.Time) error {
	return a.Inner.ArchiveMoneyAccount(ctx, userID, id, at)
}
func (a moneyAccountStoreAdapter) AdjustBalance(ctx context.Context, userID, accountID uuid.UUID, delta decimal.Decimal, note string, at time.Time) (accounts.Account, error) {
	return a.Inner.AdjustMoneyAccountBalance(ctx, userID, accountID, delta, note, at)
}
func (a moneyAccountStoreAdapter) Transfer(ctx context.Context, userID, fromID, toID uuid.UUID, amount decimal.Decimal, currency, note string, occurredAt, now time.Time) (uuid.UUID, error) {
	return a.Inner.InsertMoneyTransfer(ctx, userID, fromID, toID, amount, currency, note, occurredAt, now)
}
func (a moneyAccountStoreAdapter) LedgerSince(ctx context.Context, userID, accountID uuid.UUID, currency string) (accounts.LedgerSlice, error) {
	return a.Inner.MoneyAccountLedgerSince(ctx, userID, accountID, currency)
}

// MoneyAccountsAdapter exposes SQLStore as accounts.Store.
func MoneyAccountsAdapter(s *SQLStore) accounts.Store {
	return moneyAccountStoreAdapter{Inner: s}
}

type moneyScannable interface {
	Scan(dest ...any) error
}

func scanMoneyAccount(row moneyScannable) (accounts.Account, error) {
	var rec accounts.Account
	var bal string
	var rate *string
	if err := row.Scan(
		&rec.ID, &rec.UserID, &rec.Name, &rec.AccountType, &rec.CurrencyCode, &bal, &rec.BalanceAsOf,
		&rate, &rec.Compounding, &rec.InstitutionLabel, &rec.BankProfileID,
		&rec.ArchivedAt, &rec.CreatedAt, &rec.UpdatedAt,
	); err != nil {
		return accounts.Account{}, err
	}
	rec.Balance = mustDec(bal)
	if rate != nil && *rate != "" {
		d := mustDec(*rate)
		rec.InterestRatePercent = &d
	}
	return rec, nil
}
