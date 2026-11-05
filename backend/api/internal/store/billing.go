package store

import (
	"context"
	"errors"
	"strings"
	"time"

	"equilend/api/internal/billing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// EffectiveTierSQL is the plan a user has right now: a comp or trial that has
// run out reads as Free. Use with the users table aliased as u.
const EffectiveTierSQL = `(CASE WHEN u.plan_expires_at IS NOT NULL AND u.plan_expires_at <= now() THEN 'free' ELSE COALESCE(u.plan_tier, 'free') END)`

// EffectiveSourceSQL is the plan source to go with EffectiveTierSQL.
const EffectiveSourceSQL = `(CASE WHEN u.plan_expires_at IS NOT NULL AND u.plan_expires_at <= now() THEN 'free' ELSE COALESCE(u.plan_source, 'free') END)`

type billingStore struct{ s *SQLStore }

// BillingAdapter exposes the SQL store to the billing service.
func BillingAdapter(s *SQLStore) billing.Store { return billingStore{s} }

func (b billingStore) UserPlan(ctx context.Context, id uuid.UUID) (billing.UserPlan, error) {
	var p billing.UserPlan
	err := b.s.pool.QueryRow(ctx, `
		SELECT u.id, u.email::text, u.display_name, COALESCE(u.role, 'user'), `+EffectiveTierSQL+`, `+EffectiveSourceSQL+`,
		       CASE WHEN u.plan_expires_at > now() THEN u.plan_expires_at END
		FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL
	`, id).Scan(&p.UserID, &p.Email, &p.DisplayName, &p.Role, &p.Tier, &p.Source, &p.ExpiresAt)
	return p, err
}

func (b billingStore) SetUserPlan(ctx context.Context, id uuid.UUID, tier, source string, expires *time.Time) error {
	_, err := b.s.pool.Exec(ctx, `
		UPDATE users SET plan_tier = $2, plan_source = $3, plan_expires_at = $4, updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL
	`, id, tier, source, expires)
	return err
}

func (b billingStore) GetSetting(ctx context.Context, key string) (string, error) {
	return b.s.GetPlatformSetting(ctx, key)
}

func (b billingStore) SetSetting(ctx context.Context, key, value string) error {
	return b.s.SetPlatformSetting(ctx, key, value)
}

func (b billingStore) AIUsedThisMonth(ctx context.Context, id uuid.UUID) (int, error) {
	var n int
	err := b.s.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(request_count), 0)::int FROM ai_usage_daily
		WHERE user_id = $1 AND day >= date_trunc('month', now() AT TIME ZONE 'UTC')::date
	`, id).Scan(&n)
	return n, err
}

func (b billingStore) CapturesThisMonth(ctx context.Context, id uuid.UUID) (int, error) {
	var n int
	err := b.s.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(capture_count), 0)::int FROM ai_capture_monthly
		WHERE user_id = $1 AND month = date_trunc('month', now() AT TIME ZONE 'UTC')::date
	`, id).Scan(&n)
	return n, err
}

func (b billingStore) ActiveBankLinks(ctx context.Context, id uuid.UUID) (int, error) {
	var n int
	err := b.s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM bank_link_connections WHERE user_id = $1 AND status <> 'disconnected'
	`, id).Scan(&n)
	return n, err
}

func (b billingStore) RecordEvent(ctx context.Context, id, typ string, payload []byte) (bool, error) {
	var processed *time.Time
	var errMsg *string
	err := b.s.pool.QueryRow(ctx, `
		INSERT INTO billing_events (id, type, payload) VALUES ($1, $2, $3::jsonb)
		ON CONFLICT (id) DO UPDATE SET type = EXCLUDED.type
		RETURNING processed_at, error
	`, id, typ, string(payload)).Scan(&processed, &errMsg)
	if err != nil {
		return false, err
	}
	return processed != nil && (errMsg == nil || *errMsg == ""), nil
}

func (b billingStore) FinishEvent(ctx context.Context, id, subID string, userID *uuid.UUID, errMsg string) error {
	_, err := b.s.pool.Exec(ctx, `
		UPDATE billing_events SET subscription_id = NULLIF($2, ''), user_id = $3, error = NULLIF($4, ''), processed_at = now()
		WHERE id = $1
	`, id, subID, userID, errMsg)
	return err
}

func (b billingStore) UpsertSubscription(ctx context.Context, s billing.Subscription) error {
	_, err := b.s.pool.Exec(ctx, `
		INSERT INTO billing_subscriptions (id, provider, user_id, customer_id, product_id, plan_key, tier, status,
		  amount_cents, currency, billing_interval, current_period_end, cancel_at_period_end, trial_end,
		  started_at, canceled_at, ended_at)
		VALUES ($1,$2,$3,NULLIF($4,''),NULLIF($5,''),NULLIF($6,''),NULLIF($7,''),$8,$9,$10,NULLIF($11,''),$12,$13,$14,$15,$16,$17)
		ON CONFLICT (id) DO UPDATE SET
		  user_id = COALESCE(EXCLUDED.user_id, billing_subscriptions.user_id),
		  customer_id = COALESCE(EXCLUDED.customer_id, billing_subscriptions.customer_id),
		  product_id = COALESCE(EXCLUDED.product_id, billing_subscriptions.product_id),
		  plan_key = COALESCE(EXCLUDED.plan_key, billing_subscriptions.plan_key),
		  tier = COALESCE(EXCLUDED.tier, billing_subscriptions.tier),
		  status = EXCLUDED.status,
		  amount_cents = EXCLUDED.amount_cents,
		  currency = EXCLUDED.currency,
		  billing_interval = COALESCE(EXCLUDED.billing_interval, billing_subscriptions.billing_interval),
		  current_period_end = EXCLUDED.current_period_end,
		  cancel_at_period_end = EXCLUDED.cancel_at_period_end,
		  trial_end = EXCLUDED.trial_end,
		  started_at = COALESCE(EXCLUDED.started_at, billing_subscriptions.started_at),
		  canceled_at = EXCLUDED.canceled_at,
		  ended_at = EXCLUDED.ended_at,
		  updated_at = now()
	`, s.ID, s.Provider, s.UserID, s.CustomerID, s.ProductID, s.PlanKey, s.Tier, s.Status,
		s.AmountCents, s.Currency, s.Interval, s.CurrentPeriodEnd, s.CancelAtPeriodEnd, s.TrialEnd,
		s.StartedAt, s.CanceledAt, s.EndedAt)
	return err
}

const subColumns = `bs.id, bs.provider, bs.user_id, COALESCE(u.email::text, ''), COALESCE(u.display_name, ''),
	COALESCE(bs.customer_id, ''), COALESCE(bs.product_id, ''), COALESCE(bs.plan_key, ''), COALESCE(bs.tier, ''),
	bs.status, bs.amount_cents, bs.currency, COALESCE(bs.billing_interval, ''), bs.current_period_end,
	bs.cancel_at_period_end, bs.trial_end, bs.started_at, bs.canceled_at, bs.ended_at, bs.updated_at`

func scanSub(row pgx.Row) (*billing.Subscription, error) {
	var s billing.Subscription
	err := row.Scan(&s.ID, &s.Provider, &s.UserID, &s.UserEmail, &s.UserName, &s.CustomerID, &s.ProductID, &s.PlanKey,
		&s.Tier, &s.Status, &s.AmountCents, &s.Currency, &s.Interval, &s.CurrentPeriodEnd, &s.CancelAtPeriodEnd,
		&s.TrialEnd, &s.StartedAt, &s.CanceledAt, &s.EndedAt, &s.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func (b billingStore) GetSubscription(ctx context.Context, id string) (*billing.Subscription, error) {
	return scanSub(b.s.pool.QueryRow(ctx, `SELECT `+subColumns+` FROM billing_subscriptions bs LEFT JOIN users u ON u.id = bs.user_id WHERE bs.id = $1`, id))
}

func (b billingStore) LatestSubscription(ctx context.Context, userID uuid.UUID) (*billing.Subscription, error) {
	return scanSub(b.s.pool.QueryRow(ctx, `
		SELECT `+subColumns+` FROM billing_subscriptions bs LEFT JOIN users u ON u.id = bs.user_id
		WHERE bs.user_id = $1
		ORDER BY (bs.status IN ('active','trialing','past_due')) DESC, bs.updated_at DESC
		LIMIT 1`, userID))
}

func (b billingStore) UserForCustomer(ctx context.Context, customerID string) (*uuid.UUID, error) {
	var id *uuid.UUID
	err := b.s.pool.QueryRow(ctx, `
		SELECT user_id FROM billing_subscriptions WHERE customer_id = $1 AND user_id IS NOT NULL
		ORDER BY updated_at DESC LIMIT 1`, customerID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return id, err
}

func (b billingStore) HasOtherLiveSubscription(ctx context.Context, userID uuid.UUID, exceptID string) (bool, error) {
	var ok bool
	err := b.s.pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM billing_subscriptions
		  WHERE user_id = $1 AND id <> $2 AND status IN ('active','trialing','past_due'))`, userID, exceptID).Scan(&ok)
	return ok, err
}

func (b billingStore) Stats(ctx context.Context) (billing.Stats, error) {
	var st billing.Stats
	st.MRR = []billing.MoneyByCurrency{}
	rows, err := b.s.pool.Query(ctx, `
		SELECT currency, SUM(CASE WHEN billing_interval = 'year' THEN amount_cents / 12.0 ELSE amount_cents END)::bigint
		FROM billing_subscriptions WHERE status IN ('active', 'past_due')
		GROUP BY currency ORDER BY 2 DESC`)
	if err != nil {
		return st, err
	}
	for rows.Next() {
		var m billing.MoneyByCurrency
		if err := rows.Scan(&m.Currency, &m.Cents); err != nil {
			rows.Close()
			return st, err
		}
		st.MRR = append(st.MRR, m)
	}
	rows.Close()

	if err := b.s.pool.QueryRow(ctx, `
		SELECT
		  COUNT(*) FILTER (WHERE status = 'active')::int,
		  COUNT(*) FILTER (WHERE status = 'trialing')::int,
		  COUNT(*) FILTER (WHERE status = 'past_due')::int,
		  COUNT(*) FILTER (WHERE status IN ('active','trialing') AND cancel_at_period_end)::int,
		  COUNT(*) FILTER (WHERE status IN ('canceled','unpaid') AND COALESCE(ended_at, canceled_at, updated_at) >= now() - interval '30 days')::int,
		  COUNT(*) FILTER (WHERE started_at >= now() - interval '30 days')::int
		FROM billing_subscriptions`).Scan(&st.ActiveSubs, &st.TrialingSubs, &st.PastDue, &st.Canceling, &st.Churned30d, &st.New30d); err != nil {
		return st, err
	}
	if err := b.s.pool.QueryRow(ctx, `
		SELECT
		  COUNT(*) FILTER (WHERE plan_source = 'trial' AND plan_expires_at > now())::int,
		  COUNT(*) FILTER (WHERE plan_source = 'trial' AND plan_expires_at > now() AND plan_expires_at <= now() + interval '7 days')::int,
		  COUNT(*) FILTER (WHERE plan_source = 'admin' AND plan_tier <> 'free' AND (plan_expires_at IS NULL OR plan_expires_at > now()))::int,
		  COUNT(*)::int
		FROM users WHERE deleted_at IS NULL`).Scan(&st.TrialsActive, &st.TrialsEnding7d, &st.Comped, &st.TotalUsers); err != nil {
		return st, err
	}
	st.Tiers = []billing.TierCount{}
	rows, err = b.s.pool.Query(ctx, `
		SELECT `+EffectiveTierSQL+` AS tier, `+EffectiveSourceSQL+` AS source, COUNT(*)::int
		FROM users u WHERE u.deleted_at IS NULL GROUP BY 1, 2 ORDER BY 1, 2`)
	if err != nil {
		return st, err
	}
	defer rows.Close()
	for rows.Next() {
		var t billing.TierCount
		if err := rows.Scan(&t.Tier, &t.Source, &t.Users); err != nil {
			return st, err
		}
		st.Tiers = append(st.Tiers, t)
	}
	return st, rows.Err()
}

func (b billingStore) ListSubscriptions(ctx context.Context, status string, limit int) ([]billing.Subscription, error) {
	status = strings.TrimSpace(status)
	rows, err := b.s.pool.Query(ctx, `
		SELECT `+subColumns+` FROM billing_subscriptions bs LEFT JOIN users u ON u.id = bs.user_id
		WHERE ($1 = '' OR bs.status = $1)
		ORDER BY bs.updated_at DESC LIMIT $2`, status, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []billing.Subscription{}
	for rows.Next() {
		s, err := scanSub(rows)
		if err != nil {
			return nil, err
		}
		if s != nil {
			out = append(out, *s)
		}
	}
	return out, rows.Err()
}

func (b billingStore) ListEvents(ctx context.Context, limit int) ([]billing.Event, error) {
	rows, err := b.s.pool.Query(ctx, `
		SELECT e.id, e.type, COALESCE(e.subscription_id, ''), e.user_id, COALESCE(u.email::text, ''),
		       COALESCE(e.error, ''), e.processed_at, e.received_at
		FROM billing_events e LEFT JOIN users u ON u.id = e.user_id
		ORDER BY e.received_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []billing.Event{}
	for rows.Next() {
		var e billing.Event
		if err := rows.Scan(&e.ID, &e.Type, &e.SubscriptionID, &e.UserID, &e.UserEmail, &e.Error, &e.ProcessedAt, &e.ReceivedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
