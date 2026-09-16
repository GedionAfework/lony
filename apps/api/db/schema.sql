CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  phone_e164 varchar(20),
  username citext UNIQUE,
  display_name varchar(120) NOT NULL,
  avatar_object_key varchar,
  timezone varchar(64) NOT NULL DEFAULT 'UTC',
  locale varchar(16) NOT NULL DEFAULT 'en',
  default_currency_code char(3),
  password_hash text NOT NULL,
  email_verified_at timestamptz,
  status varchar(32) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (status IN ('active', 'suspended', 'deletion_pending', 'deleted'))
);

CREATE UNIQUE INDEX users_phone_e164_key
  ON users (phone_e164)
  WHERE phone_e164 IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  refresh_token_hash varchar(64) NOT NULL UNIQUE,
  device_label varchar(120),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX user_sessions_user_id_idx ON user_sessions (user_id, revoked_at);

CREATE TABLE verification_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  channel varchar(16) NOT NULL,
  destination varchar(320) NOT NULL,
  code_hash varchar(64) NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX verification_challenges_user_idx
  ON verification_challenges (user_id, created_at DESC);

CREATE TABLE idempotency_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  idempotency_key varchar(100) NOT NULL,
  operation varchar(120) NOT NULL,
  request_hash varchar(64) NOT NULL,
  response_status integer NOT NULL,
  response_body_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX idempotency_records_actor_op_key
  ON idempotency_records (user_id, operation, idempotency_key)
  NULLS NOT DISTINCT;

CREATE TABLE friendships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES users(id),
  addressee_id uuid NOT NULL REFERENCES users(id),
  user_low_id uuid NOT NULL,
  user_high_id uuid NOT NULL,
  status varchar(32) NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  removed_at timestamptz,
  blocked_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (requester_id <> addressee_id),
  CHECK (user_low_id <> user_high_id),
  CHECK (status IN ('pending', 'accepted', 'rejected', 'removed', 'blocked'))
);

CREATE UNIQUE INDEX friendships_pair_key ON friendships (user_low_id, user_high_id);
CREATE INDEX friendships_requester_status_idx ON friendships (requester_id, status);
CREATE INDEX friendships_addressee_status_idx ON friendships (addressee_id, status);
