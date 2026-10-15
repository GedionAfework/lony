-- Phase 6: admin role + audit log

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role varchar(16) NOT NULL DEFAULT 'user';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('user', 'admin'));

CREATE INDEX IF NOT EXISTS users_role_idx ON users (role) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS users_status_created_idx ON users (status, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES users(id),
  action varchar(64) NOT NULL,
  target_user_id uuid REFERENCES users(id),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx
  ON admin_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_log_actor_idx
  ON admin_audit_log (actor_id, created_at DESC);
