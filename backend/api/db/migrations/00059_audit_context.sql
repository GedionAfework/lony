-- Admin audit log: record where an action came from, and index the filters the
-- admin console uses (action, target, time range).

ALTER TABLE admin_audit_log ADD COLUMN IF NOT EXISTS ip text;
ALTER TABLE admin_audit_log ADD COLUMN IF NOT EXISTS user_agent text;

CREATE INDEX IF NOT EXISTS admin_audit_log_action_idx
  ON admin_audit_log (action, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_log_target_idx
  ON admin_audit_log (target_user_id, created_at DESC)
  WHERE target_user_id IS NOT NULL;
