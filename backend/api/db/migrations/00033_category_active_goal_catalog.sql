-- Soft-disable for admin-managed system categories; seed goal_type catalog.

ALTER TABLE cashflow_categories ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS cashflow_categories_active_idx
  ON cashflow_categories (kind, active)
  WHERE user_id IS NULL;

ALTER TABLE catalog_types DROP CONSTRAINT IF EXISTS catalog_types_kind_check;
ALTER TABLE catalog_types ADD CONSTRAINT catalog_types_kind_check
  CHECK (kind IN ('account_type', 'institution_type', 'goal_type'));

INSERT INTO catalog_types (id, kind, code, label, sort_order, active)
SELECT gen_random_uuid(), 'goal_type', v.code, v.label, v.sort_order, true
FROM (VALUES
  ('travel', 'Travel', 10),
  ('purchase', 'Purchase', 20),
  ('savings', 'Savings', 30),
  ('debt_payoff', 'Debt payoff', 40),
  ('custom', 'Other', 50)
) AS v(code, label, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM catalog_types ct WHERE ct.kind = 'goal_type' AND ct.code = v.code
);
