-- Preference: prompt before confirming recurring income/expenses.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS ask_recurring_received boolean NOT NULL DEFAULT true;

-- Saved net worth (manual). When set, dashboard shows this instead of live recalculation.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS net_worth_override numeric(20, 2),
  ADD COLUMN IF NOT EXISTS net_worth_override_currency char(3);
