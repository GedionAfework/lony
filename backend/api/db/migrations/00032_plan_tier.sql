-- User plan tier for AI paywall (admin-managed; Stripe later)

ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_tier varchar(16) NOT NULL DEFAULT 'free';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_tier_check;
ALTER TABLE users ADD CONSTRAINT users_plan_tier_check CHECK (plan_tier IN ('free', 'premium'));

CREATE INDEX IF NOT EXISTS users_plan_tier_idx ON users (plan_tier) WHERE deleted_at IS NULL;
