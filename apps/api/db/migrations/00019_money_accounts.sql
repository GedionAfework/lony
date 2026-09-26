-- Money accounts (balances) — separate from bank_profiles (payment identifiers)

CREATE TABLE money_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  account_type varchar(32) NOT NULL DEFAULT 'bank',
  currency_code char(3) NOT NULL,
  balance numeric(18, 2) NOT NULL DEFAULT 0,
  balance_as_of timestamptz NOT NULL DEFAULT now(),
  interest_rate_percent numeric(9, 4),
  compounding varchar(16),
  institution_label varchar(120),
  bank_profile_id uuid REFERENCES bank_profiles(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (account_type IN ('cash', 'bank', 'mobile_money', 'wallet', 'other')),
  CHECK (char_length(trim(currency_code)) = 3),
  CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  CHECK (compounding IS NULL OR compounding IN ('none', 'monthly', 'yearly')),
  CHECK (interest_rate_percent IS NULL OR interest_rate_percent >= 0)
);

CREATE INDEX money_accounts_user_idx
  ON money_accounts (user_id)
  WHERE archived_at IS NULL;

CREATE TABLE money_account_balance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES money_accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  balance numeric(18, 2) NOT NULL,
  source varchar(32) NOT NULL DEFAULT 'manual',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source IN ('manual', 'interest_job', 'import', 'adjust'))
);

CREATE INDEX money_account_balance_events_account_idx
  ON money_account_balance_events (account_id, created_at DESC);
