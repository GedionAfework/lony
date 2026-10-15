CREATE TABLE cashflow_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  kind varchar(16) NOT NULL,
  amount numeric(18, 2) NOT NULL,
  currency_code char(3) NOT NULL,
  category varchar(64) NOT NULL DEFAULT 'general',
  note text,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind IN ('income', 'outcome', 'expense')),
  CHECK (amount > 0),
  CHECK (char_length(trim(currency_code)) = 3),
  CHECK (char_length(trim(category)) BETWEEN 1 AND 64)
);

CREATE INDEX cashflow_entries_user_occurred_idx
  ON cashflow_entries (user_id, occurred_at DESC);

CREATE INDEX cashflow_entries_user_kind_occurred_idx
  ON cashflow_entries (user_id, kind, occurred_at DESC);
