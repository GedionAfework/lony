CREATE TABLE phone_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone_e164 varchar(20) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_user_id uuid REFERENCES users(id),
  UNIQUE (inviter_id, phone_e164)
);

CREATE INDEX phone_invites_phone_open_idx
  ON phone_invites (phone_e164)
  WHERE resolved_at IS NULL;
