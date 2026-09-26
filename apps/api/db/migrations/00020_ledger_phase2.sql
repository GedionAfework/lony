-- Link cashflow to money accounts; transfers; monthly category budgets

ALTER TABLE cashflow_entries
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES money_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS cashflow_entries_account_idx
  ON cashflow_entries (account_id)
  WHERE account_id IS NOT NULL;

CREATE TABLE money_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_account_id uuid NOT NULL REFERENCES money_accounts(id),
  to_account_id uuid NOT NULL REFERENCES money_accounts(id),
  amount numeric(18, 2) NOT NULL,
  currency_code char(3) NOT NULL,
  note text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (amount > 0),
  CHECK (from_account_id <> to_account_id),
  CHECK (char_length(trim(currency_code)) = 3)
);

CREATE INDEX money_transfers_user_occurred_idx
  ON money_transfers (user_id, occurred_at DESC);

CREATE TABLE budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id uuid REFERENCES cashflow_categories(id) ON DELETE SET NULL,
  category_name varchar(64) NOT NULL,
  currency_code char(3) NOT NULL,
  limit_amount numeric(18, 2) NOT NULL,
  period_month date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (limit_amount > 0),
  CHECK (char_length(trim(currency_code)) = 3),
  CHECK (char_length(trim(category_name)) BETWEEN 1 AND 64),
  CHECK (EXTRACT(DAY FROM period_month) = 1)
);

CREATE UNIQUE INDEX budgets_user_cat_month_uidx
  ON budgets (user_id, category_name, currency_code, period_month);
