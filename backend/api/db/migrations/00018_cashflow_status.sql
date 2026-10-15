-- Expected vs confirmed cashflow occurrences (salary “Received” flow)

ALTER TABLE cashflow_entries
  ADD COLUMN IF NOT EXISTS status varchar(16) NOT NULL DEFAULT 'confirmed';

UPDATE cashflow_entries SET status = 'confirmed' WHERE status IS NULL OR status = '';

ALTER TABLE cashflow_entries DROP CONSTRAINT IF EXISTS cashflow_entries_status_check;
ALTER TABLE cashflow_entries ADD CONSTRAINT cashflow_entries_status_check
  CHECK (status IN ('expected', 'confirmed'));

CREATE INDEX IF NOT EXISTS cashflow_entries_user_status_idx
  ON cashflow_entries (user_id, status)
  WHERE COALESCE(is_template, false) = false;
