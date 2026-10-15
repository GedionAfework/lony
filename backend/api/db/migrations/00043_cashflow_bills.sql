-- Bills timeline: pause subscriptions, skip a cycle without posting.

ALTER TABLE cashflow_entries
  ADD COLUMN IF NOT EXISTS paused boolean NOT NULL DEFAULT false;

ALTER TABLE cashflow_entries DROP CONSTRAINT IF EXISTS cashflow_entries_status_check;
ALTER TABLE cashflow_entries ADD CONSTRAINT cashflow_entries_status_check
  CHECK (status IN ('expected', 'confirmed', 'skipped'));

CREATE INDEX IF NOT EXISTS cashflow_entries_user_paused_idx
  ON cashflow_entries (user_id)
  WHERE is_template = true AND paused = true;
