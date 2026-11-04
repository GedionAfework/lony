-- Successful voice/receipt captures per user per month. Free users get a monthly
-- allowance (FREE_CAPTURES_PER_MONTH); Premium is unlimited.
CREATE TABLE IF NOT EXISTS ai_capture_monthly (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month date NOT NULL,
  capture_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month)
);
