package store

import (
	"context"
	"time"

	"equilend/api/internal/goals"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
)

const goalSelect = `
	id, user_id, title, goal_type, currency_code, target_amount::text, current_amount::text,
	target_date, linked_account_id, linked_loan_id, note, cover_image_key, type_label, status, created_at, updated_at
`

func (s *SQLStore) InsertGoal(ctx context.Context, rec goals.Goal) (goals.Goal, error) {
	row := s.pool.QueryRow(ctx, `
		INSERT INTO goals (
			user_id, title, goal_type, currency_code, target_amount, current_amount,
			target_date, linked_account_id, linked_loan_id, note, cover_image_key, type_label, status, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
		RETURNING `+goalSelect+`
	`, rec.UserID, rec.Title, rec.GoalType, rec.CurrencyCode,
		rec.TargetAmount.StringFixed(goals.Scale), rec.CurrentAmount.StringFixed(goals.Scale),
		rec.TargetDate, rec.LinkedAccountID, rec.LinkedLoanID, rec.Note, rec.CoverImageKey, rec.TypeLabel, rec.Status, rec.CreatedAt, rec.UpdatedAt)
	return scanGoal(row)
}

func (s *SQLStore) GetGoal(ctx context.Context, userID, id uuid.UUID) (goals.Goal, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT `+goalSelect+` FROM goals WHERE id = $1 AND user_id = $2
	`, id, userID)
	return scanGoal(row)
}

func (s *SQLStore) ListGoals(ctx context.Context, userID uuid.UUID, includeArchived bool) ([]goals.Goal, error) {
	q := `
		SELECT ` + goalSelect + ` FROM goals WHERE user_id = $1`
	if !includeArchived {
		q += ` AND status <> 'archived'`
	}
	q += ` ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END, created_at DESC`
	rows, err := s.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []goals.Goal
	for rows.Next() {
		rec, err := scanGoal(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

func (s *SQLStore) UpdateGoal(ctx context.Context, rec goals.Goal) (goals.Goal, error) {
	row := s.pool.QueryRow(ctx, `
		UPDATE goals SET
			title = $3, goal_type = $4, currency_code = $5, target_amount = $6, current_amount = $7,
			target_date = $8, linked_account_id = $9, linked_loan_id = $10, note = $11, cover_image_key = $12,
			type_label = $13, status = $14, updated_at = $15
		WHERE id = $1 AND user_id = $2
		RETURNING `+goalSelect+`
	`, rec.ID, rec.UserID, rec.Title, rec.GoalType, rec.CurrencyCode,
		rec.TargetAmount.StringFixed(goals.Scale), rec.CurrentAmount.StringFixed(goals.Scale),
		rec.TargetDate, rec.LinkedAccountID, rec.LinkedLoanID, rec.Note, rec.CoverImageKey, rec.TypeLabel, rec.Status, rec.UpdatedAt)
	return scanGoal(row)
}

func (s *SQLStore) InsertGoalContribution(ctx context.Context, c goals.Contribution) (goals.Contribution, error) {
	row := s.pool.QueryRow(ctx, `
		INSERT INTO goal_contributions (goal_id, user_id, amount, currency_code, account_id, note, occurred_at, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING id, goal_id, user_id, amount::text, currency_code, account_id, note, occurred_at, created_at
	`, c.GoalID, c.UserID, c.Amount.StringFixed(goals.Scale), c.CurrencyCode, c.AccountID, c.Note, c.OccurredAt, c.CreatedAt)
	return scanContribution(row)
}

func (s *SQLStore) ListGoalContributions(ctx context.Context, userID, goalID uuid.UUID, limit int) ([]goals.Contribution, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, goal_id, user_id, amount::text, currency_code, account_id, note, occurred_at, created_at
		FROM goal_contributions
		WHERE goal_id = $1 AND user_id = $2
		ORDER BY occurred_at DESC, created_at DESC
		LIMIT $3
	`, goalID, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []goals.Contribution
	for rows.Next() {
		c, err := scanContribution(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *SQLStore) SumGoalContributionsSince(ctx context.Context, userID, goalID uuid.UUID, since time.Time) (decimal.Decimal, int, error) {
	var sumStr string
	var count int
	err := s.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount), 0)::text, COUNT(*)::int
		FROM goal_contributions
		WHERE goal_id = $1 AND user_id = $2 AND occurred_at >= $3
	`, goalID, userID, since).Scan(&sumStr, &count)
	if err != nil {
		return decimal.Zero, 0, err
	}
	return mustDec(sumStr), count, nil
}

type goalStoreAdapter struct {
	Inner *SQLStore
}

func (a goalStoreAdapter) Insert(ctx context.Context, rec goals.Goal) (goals.Goal, error) {
	return a.Inner.InsertGoal(ctx, rec)
}
func (a goalStoreAdapter) Get(ctx context.Context, userID, id uuid.UUID) (goals.Goal, error) {
	return a.Inner.GetGoal(ctx, userID, id)
}
func (a goalStoreAdapter) List(ctx context.Context, userID uuid.UUID, includeArchived bool) ([]goals.Goal, error) {
	return a.Inner.ListGoals(ctx, userID, includeArchived)
}
func (a goalStoreAdapter) Update(ctx context.Context, rec goals.Goal) (goals.Goal, error) {
	return a.Inner.UpdateGoal(ctx, rec)
}
func (a goalStoreAdapter) InsertContribution(ctx context.Context, c goals.Contribution) (goals.Contribution, error) {
	return a.Inner.InsertGoalContribution(ctx, c)
}
func (a goalStoreAdapter) ListContributions(ctx context.Context, userID, goalID uuid.UUID, limit int) ([]goals.Contribution, error) {
	return a.Inner.ListGoalContributions(ctx, userID, goalID, limit)
}
func (a goalStoreAdapter) SumContributionsSince(ctx context.Context, userID, goalID uuid.UUID, since time.Time) (decimal.Decimal, int, error) {
	return a.Inner.SumGoalContributionsSince(ctx, userID, goalID, since)
}

// GoalsAdapter exposes SQLStore as goals.Store.
func GoalsAdapter(s *SQLStore) goals.Store {
	return goalStoreAdapter{Inner: s}
}

type goalScannable interface {
	Scan(dest ...any) error
}

func scanGoal(row goalScannable) (goals.Goal, error) {
	var rec goals.Goal
	var target, current string
	if err := row.Scan(
		&rec.ID, &rec.UserID, &rec.Title, &rec.GoalType, &rec.CurrencyCode, &target, &current,
		&rec.TargetDate, &rec.LinkedAccountID, &rec.LinkedLoanID, &rec.Note, &rec.CoverImageKey, &rec.TypeLabel, &rec.Status, &rec.CreatedAt, &rec.UpdatedAt,
	); err != nil {
		return goals.Goal{}, err
	}
	rec.TargetAmount = mustDec(target)
	rec.CurrentAmount = mustDec(current)
	return rec, nil
}

func scanContribution(row goalScannable) (goals.Contribution, error) {
	var c goals.Contribution
	var amount string
	if err := row.Scan(
		&c.ID, &c.GoalID, &c.UserID, &amount, &c.CurrencyCode, &c.AccountID, &c.Note, &c.OccurredAt, &c.CreatedAt,
	); err != nil {
		if err == pgx.ErrNoRows {
			return goals.Contribution{}, err
		}
		return goals.Contribution{}, err
	}
	c.Amount = mustDec(amount)
	return c, nil
}
