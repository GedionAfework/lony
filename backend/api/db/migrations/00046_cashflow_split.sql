ALTER TABLE cashflow_entries
  ADD COLUMN IF NOT EXISTS split_group_id uuid;

CREATE INDEX IF NOT EXISTS cashflow_entries_user_split_idx
  ON cashflow_entries (user_id, split_group_id)
  WHERE split_group_id IS NOT NULL;
