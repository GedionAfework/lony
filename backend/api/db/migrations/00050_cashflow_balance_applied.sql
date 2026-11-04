-- When a cashflow entry moved its account balance. Deleting or editing the entry undoes
-- or adjusts that change, but only if it happened after the account's last stated
-- balance (manual set, reconcile, bank SMS); a stated balance already reflects reality.
-- NULL = never applied (template, expected bill, or SMS that carried the bank balance).
ALTER TABLE cashflow_entries ADD COLUMN IF NOT EXISTS balance_applied_at timestamptz;

-- Backfill: confirmed one-off entries with an account were applied when created, or,
-- for bill instances, when marked received. SMS entries with a stated balance were not.
UPDATE cashflow_entries c
SET balance_applied_at = CASE WHEN c.template_id IS NOT NULL THEN c.updated_at ELSE c.created_at END
WHERE c.balance_applied_at IS NULL
  AND COALESCE(c.status, 'confirmed') = 'confirmed'
  AND COALESCE(c.is_template, false) = false
  AND c.account_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sms_ingest_log l
    WHERE l.cashflow_id = c.id AND COALESCE(l.parsed->>'stated_balance', '') <> ''
  );
