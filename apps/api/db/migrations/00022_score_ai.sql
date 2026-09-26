-- Lony Score history + deterministic AI insights (Phase 5)

CREATE TABLE lony_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score int NOT NULL,
  currency_code char(3) NOT NULL,
  liquidity_score numeric(5, 2) NOT NULL,
  savings_score numeric(5, 2) NOT NULL,
  debt_score numeric(5, 2) NOT NULL,
  consistency_score numeric(5, 2) NOT NULL,
  goals_score numeric(5, 2) NOT NULL,
  peer_score numeric(5, 2) NOT NULL,
  components jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (score BETWEEN 300 AND 850),
  CHECK (char_length(trim(currency_code)) = 3)
);

CREATE INDEX lony_scores_user_computed_idx
  ON lony_scores (user_id, computed_at DESC);

CREATE TABLE ai_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  theme varchar(64) NOT NULL,
  severity varchar(16) NOT NULL DEFAULT 'info',
  title varchar(160) NOT NULL,
  body text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  source varchar(32) NOT NULL DEFAULT 'rules',
  period_from date,
  period_to date,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (severity IN ('info', 'positive', 'warning', 'critical')),
  CHECK (source IN ('rules', 'llm')),
  CHECK (char_length(trim(title)) BETWEEN 1 AND 160)
);

CREATE INDEX ai_insights_user_created_idx
  ON ai_insights (user_id, created_at DESC)
  WHERE dismissed_at IS NULL;
