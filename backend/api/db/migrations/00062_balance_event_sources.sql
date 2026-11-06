-- Balance events written for bank-SMS stated balances ('sms') and reconciles ('reconcile')
-- were rejected by the old CHECK, so SMS transfers never moved account balances: the entry
-- skipped its delta (the SMS carries the bank's balance) and then setting that balance failed.
ALTER TABLE money_account_balance_events DROP CONSTRAINT IF EXISTS money_account_balance_events_source_check;
ALTER TABLE money_account_balance_events ADD CONSTRAINT money_account_balance_events_source_check
  CHECK (source IN ('manual', 'interest_job', 'import', 'adjust', 'sms', 'reconcile'));

-- Repair: snap each account fed by bank SMS to the newest balance the bank printed, unless
-- the user stated a balance themselves after that message, or a later entry already moved it.
WITH latest AS (
  SELECT DISTINCT ON (e.account_id)
    e.account_id, e.user_id, (l.parsed->>'stated_balance')::numeric AS bal, e.occurred_at
  FROM sms_ingest_log l
  JOIN cashflow_entries e ON e.id = l.cashflow_id
  JOIN money_accounts a ON a.id = e.account_id AND a.archived_at IS NULL AND a.account_type <> 'credit_card'
  WHERE l.parsed->>'stated_balance' ~ '^[0-9]+(\.[0-9]+)?$'
    AND e.balance_applied_at IS NULL
    AND COALESCE(e.status, 'confirmed') = 'confirmed'
  ORDER BY e.account_id, e.occurred_at DESC
), todo AS (
  SELECT lt.* FROM latest lt
  WHERE NOT EXISTS (
      SELECT 1 FROM money_account_balance_events ev
      WHERE ev.account_id = lt.account_id AND ev.source IN ('manual', 'reconcile') AND ev.created_at > lt.occurred_at
    )
    AND NOT EXISTS (
      SELECT 1 FROM cashflow_entries x
      WHERE x.account_id = lt.account_id AND x.balance_applied_at IS NOT NULL AND x.occurred_at > lt.occurred_at
    )
), upd AS (
  UPDATE money_accounts a
  SET balance = todo.bal, balance_as_of = now(), updated_at = now()
  FROM todo
  WHERE a.id = todo.account_id AND a.balance <> todo.bal
  RETURNING a.id, a.user_id, a.balance
)
INSERT INTO money_account_balance_events (account_id, user_id, balance, source, note, created_at)
SELECT id, user_id, balance, 'sms', 'newest bank SMS balance (repair)', now() FROM upd;
