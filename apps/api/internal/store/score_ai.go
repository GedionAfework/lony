package store

import (
	"context"
	"encoding/json"
	"time"

	"equilend/api/internal/ai"
	"equilend/api/internal/score"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
)

func (s *SQLStore) InsertLonyScore(ctx context.Context, rec score.Record) (score.Record, error) {
	row := s.pool.QueryRow(ctx, `
		INSERT INTO lony_scores (
			user_id, grade, points, currency_code, liquidity_score, savings_score, debt_score,
			consistency_score, goals_score, repayment_score, peer_score, components,
			thin_history, loan_sample_size, computed_at, score
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,$13,$14,
			GREATEST(300, LEAST(850, 300 + ROUND($3 * 5.5)::int))
		)
		RETURNING id, user_id, grade, points::text, currency_code,
			liquidity_score::text, savings_score::text, debt_score::text,
			consistency_score::text, goals_score::text, repayment_score::text,
			components, thin_history, loan_sample_size, computed_at
	`, rec.UserID, rec.Grade, rec.Points.StringFixed(2), rec.CurrencyCode,
		rec.LiquidityScore.StringFixed(2), rec.SavingsScore.StringFixed(2), rec.DebtScore.StringFixed(2),
		rec.ConsistencyScore.StringFixed(2), rec.GoalsScore.StringFixed(2), rec.RepaymentScore.StringFixed(2),
		rec.Components, rec.ThinHistory, rec.LoanSampleSize, rec.ComputedAt)
	return scanScore(row)
}

func (s *SQLStore) LatestLonyScore(ctx context.Context, userID uuid.UUID) (score.Record, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id, user_id, COALESCE(grade, 'C'), COALESCE(points, 50)::text, currency_code,
			liquidity_score::text, savings_score::text, debt_score::text,
			consistency_score::text, goals_score::text, COALESCE(repayment_score, peer_score, 55)::text,
			components, COALESCE(thin_history, false), COALESCE(loan_sample_size, 0), computed_at
		FROM lony_scores WHERE user_id = $1
		ORDER BY computed_at DESC LIMIT 1
	`, userID)
	return scanScore(row)
}

func (s *SQLStore) ListLonyScores(ctx context.Context, userID uuid.UUID, limit int) ([]score.Record, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, user_id, COALESCE(grade, 'C'), COALESCE(points, 50)::text, currency_code,
			liquidity_score::text, savings_score::text, debt_score::text,
			consistency_score::text, goals_score::text, COALESCE(repayment_score, peer_score, 55)::text,
			components, COALESCE(thin_history, false), COALESCE(loan_sample_size, 0), computed_at
		FROM lony_scores WHERE user_id = $1
		ORDER BY computed_at DESC LIMIT $2
	`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []score.Record
	for rows.Next() {
		rec, err := scanScore(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

func (s *SQLStore) AccountBalancesByCurrency(ctx context.Context, userID uuid.UUID) (map[string]decimal.Decimal, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT currency_code, COALESCE(SUM(balance), 0)::text
		FROM money_accounts
		WHERE user_id = $1 AND archived_at IS NULL
		GROUP BY currency_code
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]decimal.Decimal{}
	for rows.Next() {
		var code, bal string
		if err := rows.Scan(&code, &bal); err != nil {
			return nil, err
		}
		out[code] = mustDec(bal)
	}
	return out, rows.Err()
}

func (s *SQLStore) IncomeConfirmStats(ctx context.Context, userID uuid.UUID, from, to time.Time) (expected, confirmed int, err error) {
	err = s.pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE COALESCE(status,'confirmed') IN ('expected','confirmed'))::int,
			COUNT(*) FILTER (WHERE COALESCE(status,'confirmed') = 'confirmed')::int
		FROM cashflow_entries
		WHERE user_id = $1 AND kind = 'income' AND COALESCE(is_template,false) = false
		  AND occurred_at >= $2 AND occurred_at < $3
	`, userID, from, to).Scan(&expected, &confirmed)
	return
}

func (s *SQLStore) LoggedCashflowDays(ctx context.Context, userID uuid.UUID, from, to time.Time) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `
		SELECT COUNT(DISTINCT (occurred_at AT TIME ZONE 'UTC')::date)::int
		FROM cashflow_entries
		WHERE user_id = $1 AND COALESCE(is_template,false) = false
		  AND COALESCE(status,'confirmed') = 'confirmed'
		  AND occurred_at >= $2 AND occurred_at < $3
	`, userID, from, to).Scan(&n)
	return n, err
}

func (s *SQLStore) RepaymentConfirmStats(ctx context.Context, userID uuid.UUID) (total, confirmed int, err error) {
	err = s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::int,
			COUNT(*) FILTER (WHERE r.status = 'confirmed')::int
		FROM repayments r
		JOIN loans l ON l.id = r.loan_id
		WHERE l.lender_id = $1 OR l.borrower_id = $1 OR r.submitted_by_user_id = $1
	`, userID).Scan(&total, &confirmed)
	if err != nil {
		return 0, 0, nil
	}
	return
}

func (s *SQLStore) ReplaceAIInsights(ctx context.Context, userID uuid.UUID, rows []ai.Insight) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `UPDATE ai_insights SET dismissed_at = now() WHERE user_id = $1 AND dismissed_at IS NULL`, userID); err != nil {
		return err
	}
	for _, row := range rows {
		if _, err := tx.Exec(ctx, `
			INSERT INTO ai_insights (user_id, theme, severity, title, body, evidence, source, period_from, period_to, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		`, userID, row.Theme, row.Severity, row.Title, row.Body, row.Evidence, row.Source, row.PeriodFrom, row.PeriodTo, row.CreatedAt); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *SQLStore) ListAIInsights(ctx context.Context, userID uuid.UUID, limit int) ([]ai.Insight, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, user_id, theme, severity, title, body, evidence, source, period_from, period_to, created_at
		FROM ai_insights
		WHERE user_id = $1 AND dismissed_at IS NULL
		ORDER BY created_at DESC LIMIT $2
	`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ai.Insight
	for rows.Next() {
		var row ai.Insight
		var ev []byte
		if err := rows.Scan(&row.ID, &row.UserID, &row.Theme, &row.Severity, &row.Title, &row.Body, &ev, &row.Source, &row.PeriodFrom, &row.PeriodTo, &row.CreatedAt); err != nil {
			return nil, err
		}
		row.Evidence = json.RawMessage(ev)
		out = append(out, row)
	}
	return out, rows.Err()
}

func (s *SQLStore) DismissAIInsight(ctx context.Context, userID, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE ai_insights SET dismissed_at = now() WHERE id = $1 AND user_id = $2 AND dismissed_at IS NULL
	`, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

type scoreStoreAdapter struct{ Inner *SQLStore }

func (a scoreStoreAdapter) Insert(ctx context.Context, rec score.Record) (score.Record, error) {
	return a.Inner.InsertLonyScore(ctx, rec)
}
func (a scoreStoreAdapter) Latest(ctx context.Context, userID uuid.UUID) (score.Record, error) {
	return a.Inner.LatestLonyScore(ctx, userID)
}
func (a scoreStoreAdapter) History(ctx context.Context, userID uuid.UUID, limit int) ([]score.Record, error) {
	return a.Inner.ListLonyScores(ctx, userID, limit)
}

func ScoreAdapter(s *SQLStore) score.Store { return scoreStoreAdapter{Inner: s} }

type scoreCashAdapter struct{ Inner *SQLStore }

func (a scoreCashAdapter) ListBalances(ctx context.Context, userID uuid.UUID) (map[string]decimal.Decimal, error) {
	return a.Inner.AccountBalancesByCurrency(ctx, userID)
}

func ScoreCashAdapter(s *SQLStore) score.AccountsCash { return scoreCashAdapter{Inner: s} }

type scoreConsistencyAdapter struct{ Inner *SQLStore }

func (a scoreConsistencyAdapter) IncomeConfirmStats(ctx context.Context, userID uuid.UUID, from, to time.Time) (int, int, error) {
	return a.Inner.IncomeConfirmStats(ctx, userID, from, to)
}
func (a scoreConsistencyAdapter) LoggedDayCount(ctx context.Context, userID uuid.UUID, from, to time.Time) (int, error) {
	return a.Inner.LoggedCashflowDays(ctx, userID, from, to)
}
func (a scoreConsistencyAdapter) RepaymentStats(ctx context.Context, userID uuid.UUID) (int, int, error) {
	return a.Inner.RepaymentConfirmStats(ctx, userID)
}

func ScoreConsistencyAdapter(s *SQLStore) score.ConsistencySource {
	return scoreConsistencyAdapter{Inner: s}
}

type aiStoreAdapter struct{ Inner *SQLStore }

func (a aiStoreAdapter) ReplaceInsights(ctx context.Context, userID uuid.UUID, rows []ai.Insight) error {
	return a.Inner.ReplaceAIInsights(ctx, userID, rows)
}
func (a aiStoreAdapter) ListInsights(ctx context.Context, userID uuid.UUID, limit int) ([]ai.Insight, error) {
	return a.Inner.ListAIInsights(ctx, userID, limit)
}
func (a aiStoreAdapter) DismissInsight(ctx context.Context, userID, id uuid.UUID) error {
	return a.Inner.DismissAIInsight(ctx, userID, id)
}
func (a aiStoreAdapter) DismissAllInsights(ctx context.Context, userID uuid.UUID) (int64, error) {
	return a.Inner.DismissAllAIInsights(ctx, userID)
}

func AIAdapter(s *SQLStore) ai.Store { return aiStoreAdapter{Inner: s} }

type scoreScannable interface {
	Scan(dest ...any) error
}

func scanScore(row scoreScannable) (score.Record, error) {
	var rec score.Record
	var points, liq, sav, debt, cons, goals, repay string
	var comps []byte
	if err := row.Scan(
		&rec.ID, &rec.UserID, &rec.Grade, &points, &rec.CurrencyCode,
		&liq, &sav, &debt, &cons, &goals, &repay, &comps,
		&rec.ThinHistory, &rec.LoanSampleSize, &rec.ComputedAt,
	); err != nil {
		return score.Record{}, err
	}
	rec.Points = mustDec(points)
	rec.LiquidityScore = mustDec(liq)
	rec.SavingsScore = mustDec(sav)
	rec.DebtScore = mustDec(debt)
	rec.ConsistencyScore = mustDec(cons)
	rec.GoalsScore = mustDec(goals)
	rec.RepaymentScore = mustDec(repay)
	rec.Components = json.RawMessage(comps)
	return rec, nil
}
