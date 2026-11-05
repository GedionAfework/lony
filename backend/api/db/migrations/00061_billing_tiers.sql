-- Paid plans: Free / Plus / Pro, Polar subscriptions, trials and admin comps.

-- Premium becomes Pro.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_tier_check;
UPDATE users SET plan_tier = 'pro' WHERE plan_tier = 'premium';
ALTER TABLE users ADD CONSTRAINT users_plan_tier_check CHECK (plan_tier IN ('free', 'plus', 'pro'));

-- Where the current plan came from, and when it lapses back to Free.
-- free: default · trial: sign-up trial · admin: granted by an admin · polar: paid subscription
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_source varchar(16) NOT NULL DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_expires_at timestamptz;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_source_check;
ALTER TABLE users ADD CONSTRAINT users_plan_source_check CHECK (plan_source IN ('free', 'trial', 'admin', 'polar'));
UPDATE users SET plan_source = 'admin' WHERE plan_tier <> 'free' AND plan_source = 'free';
CREATE INDEX IF NOT EXISTS users_plan_idx ON users (plan_tier, plan_source) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS billing_subscriptions (
  id text PRIMARY KEY,
  provider varchar(16) NOT NULL DEFAULT 'polar',
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  customer_id text,
  product_id text,
  plan_key text,
  tier varchar(16),
  status varchar(32) NOT NULL,
  amount_cents int NOT NULL DEFAULT 0,
  currency varchar(8) NOT NULL DEFAULT 'usd',
  billing_interval varchar(16),
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  trial_end timestamptz,
  started_at timestamptz,
  canceled_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_subscriptions_user_idx ON billing_subscriptions (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS billing_subscriptions_status_idx ON billing_subscriptions (status);

-- Every webhook we receive, keyed by its delivery id so retries are ignored.
CREATE TABLE IF NOT EXISTS billing_events (
  id text PRIMARY KEY,
  provider varchar(16) NOT NULL DEFAULT 'polar',
  type text NOT NULL,
  subscription_id text,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  payload jsonb NOT NULL,
  error text,
  processed_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_events_received_idx ON billing_events (received_at DESC);

-- Sign-up trial: new accounts start on trial_tier for trial_days (0 turns it off).
INSERT INTO platform_settings (key, value) VALUES ('trial_days', '14'), ('trial_tier', 'pro')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION lony_start_trial() RETURNS trigger AS $$
DECLARE
  days_raw text;
  tier_raw text;
BEGIN
  IF NEW.plan_tier IS DISTINCT FROM 'free' OR NEW.plan_expires_at IS NOT NULL OR COALESCE(NEW.role, 'user') = 'admin' THEN
    RETURN NEW;
  END IF;
  SELECT value INTO days_raw FROM platform_settings WHERE key = 'trial_days';
  SELECT value INTO tier_raw FROM platform_settings WHERE key = 'trial_tier';
  IF days_raw ~ '^[0-9]+$' AND days_raw::int > 0 AND tier_raw IN ('plus', 'pro') THEN
    NEW.plan_tier := tier_raw;
    NEW.plan_source := 'trial';
    NEW.plan_expires_at := now() + make_interval(days => days_raw::int);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_start_trial ON users;
CREATE TRIGGER users_start_trial BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION lony_start_trial();

-- Admin permissions for billing.
INSERT INTO admin_permissions (code, label, sort_order, area, description, level) VALUES
  ('billing.read',   'View billing',   46, 'billing', 'See revenue, subscriptions, payment events and plan limits.', 'read'),
  ('billing.manage', 'Manage billing', 48, 'billing', 'Change plan limits and the sign-up trial.', 'danger')
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label, sort_order = EXCLUDED.sort_order, area = EXCLUDED.area,
  description = EXCLUDED.description, level = EXCLUDED.level;

INSERT INTO admin_role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM admin_roles r CROSS JOIN admin_permissions p
WHERE r.name = 'Super Admin'
ON CONFLICT DO NOTHING;
