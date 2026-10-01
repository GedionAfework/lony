-- Plaid sync cursor + goal milestone dedupe

ALTER TABLE bank_link_connections
  ADD COLUMN IF NOT EXISTS sync_cursor text;

CREATE TABLE IF NOT EXISTS goal_milestones (
  goal_id uuid NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  threshold int NOT NULL,
  notified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (goal_id, threshold),
  CHECK (threshold IN (25, 50, 75, 100))
);
