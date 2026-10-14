-- Payday-to-payday spend envelope, pace, and 80/100% alert log.

CREATE TABLE IF NOT EXISTS payday_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  payday_day smallint,
  spend_limit numeric(18, 2),
  currency_code char(3),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (payday_day IS NULL OR (payday_day >= 1 AND payday_day <= 28)),
  CHECK (spend_limit IS NULL OR spend_limit > 0)
);

CREATE TABLE IF NOT EXISTS budget_alert_log (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope text NOT NULL,
  cycle_start date NOT NULL,
  threshold smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scope, cycle_start, threshold),
  CHECK (threshold IN (80, 100))
);
