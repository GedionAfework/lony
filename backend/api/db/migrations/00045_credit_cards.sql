-- Credit cards: liability accounts with limit, statement/due days, and installment plans.

DO $$
DECLARE
  conname text;
BEGIN
  SELECT con.conname INTO conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = current_schema()
    AND rel.relname = 'money_accounts'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%account_type%'
    AND pg_get_constraintdef(con.oid) ILIKE '%mobile_money%'
  LIMIT 1;
  IF conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE money_accounts DROP CONSTRAINT %I', conname);
  END IF;
END $$;

ALTER TABLE money_accounts
  ADD CONSTRAINT money_accounts_account_type_check
  CHECK (account_type IN ('cash', 'bank', 'mobile_money', 'wallet', 'credit_card', 'other'));

ALTER TABLE money_accounts
  ADD COLUMN IF NOT EXISTS credit_limit numeric(18, 2),
  ADD COLUMN IF NOT EXISTS statement_day smallint,
  ADD COLUMN IF NOT EXISTS due_day smallint;

ALTER TABLE money_accounts
  DROP CONSTRAINT IF EXISTS money_accounts_credit_limit_check,
  DROP CONSTRAINT IF EXISTS money_accounts_statement_day_check,
  DROP CONSTRAINT IF EXISTS money_accounts_due_day_check;

ALTER TABLE money_accounts
  ADD CONSTRAINT money_accounts_credit_limit_check
    CHECK (credit_limit IS NULL OR credit_limit >= 0),
  ADD CONSTRAINT money_accounts_statement_day_check
    CHECK (statement_day IS NULL OR (statement_day >= 1 AND statement_day <= 28)),
  ADD CONSTRAINT money_accounts_due_day_check
    CHECK (due_day IS NULL OR (due_day >= 1 AND due_day <= 28));

INSERT INTO catalog_types (kind, code, label, sort_order) VALUES
  ('account_type', 'credit_card', 'Credit card', 35)
ON CONFLICT (kind, code) DO NOTHING;

INSERT INTO catalog_institutions (code, label, type_kind, type_code, sort_order) VALUES
  ('visa', 'Visa', 'account_type', 'credit_card', 5),
  ('mastercard', 'Mastercard', 'account_type', 'credit_card', 6),
  ('amex', 'American Express', 'account_type', 'credit_card', 7),
  ('discover', 'Discover', 'account_type', 'credit_card', 8)
ON CONFLICT (code) DO NOTHING;

INSERT INTO catalog_institutions (code, label, type_kind, type_code, country_code, sort_order)
SELECT code || '_cc', label, 'account_type', 'credit_card', country_code, sort_order
FROM catalog_institutions
WHERE type_kind = 'account_type' AND type_code = 'bank'
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS credit_card_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES money_accounts(id) ON DELETE CASCADE,
  merchant varchar(120) NOT NULL,
  total_amount numeric(18, 2) NOT NULL,
  remaining_amount numeric(18, 2) NOT NULL,
  monthly_amount numeric(18, 2) NOT NULL,
  months_total smallint NOT NULL,
  months_remaining smallint NOT NULL,
  currency_code char(3) NOT NULL,
  next_charge_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(trim(merchant)) BETWEEN 1 AND 120),
  CHECK (months_total >= 2 AND months_total <= 60),
  CHECK (months_remaining >= 0 AND months_remaining <= months_total),
  CHECK (total_amount > 0 AND monthly_amount > 0 AND remaining_amount >= 0)
);

CREATE INDEX IF NOT EXISTS credit_card_installments_account_idx
  ON credit_card_installments (account_id, months_remaining, next_charge_on);

CREATE INDEX IF NOT EXISTS credit_card_installments_due_idx
  ON credit_card_installments (next_charge_on)
  WHERE months_remaining > 0;

CREATE TABLE IF NOT EXISTS card_due_alert_log (
  account_id uuid NOT NULL REFERENCES money_accounts(id) ON DELETE CASCADE,
  due_on date NOT NULL,
  days_before smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, due_on, days_before),
  CHECK (days_before IN (0, 1, 3))
);
