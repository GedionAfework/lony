CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  type varchar(64) NOT NULL,
  loan_id uuid REFERENCES loans(id),
  title varchar(200) NOT NULL,
  body varchar(500) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  push_status varchar(32) NOT NULL DEFAULT 'pending',
  push_error text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (push_status IN ('pending', 'sent', 'skipped', 'failed'))
);

CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE TABLE device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  platform varchar(16) NOT NULL,
  token text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (platform IN ('ios', 'android', 'web')),
  UNIQUE (user_id, token)
);

CREATE INDEX device_tokens_user_idx ON device_tokens (user_id) WHERE enabled;

CREATE TABLE notification_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_key text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id),
  loan_id uuid NOT NULL REFERENCES loans(id),
  kind varchar(64) NOT NULL,
  run_at timestamptz NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'pending',
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('pending', 'completed', 'cancelled', 'failed')),
  CHECK (kind IN ('due_soon_7d', 'due_soon_3d', 'due_soon_1d', 'due_today', 'overdue'))
);

CREATE INDEX notification_jobs_due_idx ON notification_jobs (run_at, status)
  WHERE status = 'pending';
CREATE INDEX notification_jobs_loan_idx ON notification_jobs (loan_id, status);
