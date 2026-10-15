-- Life / financial goals (Phase 3)

CREATE TABLE goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title varchar(120) NOT NULL,
  goal_type varchar(32) NOT NULL DEFAULT 'custom',
  currency_code char(3) NOT NULL,
  target_amount numeric(18, 2) NOT NULL,
  current_amount numeric(18, 2) NOT NULL DEFAULT 0,
  target_date date,
  linked_account_id uuid REFERENCES money_accounts(id) ON DELETE SET NULL,
  linked_loan_id uuid REFERENCES loans(id) ON DELETE SET NULL,
  note text,
  status varchar(16) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (goal_type IN ('travel', 'purchase', 'savings', 'debt_payoff', 'custom')),
  CHECK (status IN ('active', 'completed', 'archived')),
  CHECK (target_amount > 0),
  CHECK (current_amount >= 0),
  CHECK (char_length(trim(currency_code)) = 3),
  CHECK (char_length(trim(title)) BETWEEN 1 AND 120)
);

CREATE INDEX goals_user_status_idx ON goals (user_id, status, created_at DESC);

CREATE TABLE goal_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount numeric(18, 2) NOT NULL,
  currency_code char(3) NOT NULL,
  account_id uuid REFERENCES money_accounts(id) ON DELETE SET NULL,
  note text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (amount > 0),
  CHECK (char_length(trim(currency_code)) = 3)
);

CREATE INDEX goal_contributions_goal_idx
  ON goal_contributions (goal_id, occurred_at DESC);
