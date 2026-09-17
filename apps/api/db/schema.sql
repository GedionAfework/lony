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

CREATE TABLE loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_code varchar(16) NOT NULL UNIQUE,
  borrower_id uuid NOT NULL REFERENCES users(id),
  lender_id uuid NOT NULL REFERENCES users(id),
  initiator_id uuid NOT NULL REFERENCES users(id),
  status varchar(32) NOT NULL,
  principal_amount numeric(20,4),
  currency_code char(3),
  interest_rate_percent numeric(8,4),
  interest_amount numeric(20,4),
  expected_total numeric(20,4),
  outstanding_amount numeric(20,4),
  due_at timestamptz,
  note varchar(500),
  current_terms_id uuid,
  accepted_terms_id uuid,
  terms_version int,
  proposed_by_user_id uuid REFERENCES users(id),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (borrower_id <> lender_id),
  CHECK (initiator_id IN (borrower_id, lender_id)),
  CHECK (status IN ('pending', 'active', 'overdue', 'repayment_pending', 'rejected', 'cancelled', 'completed')),
  CHECK (principal_amount IS NULL OR principal_amount > 0),
  CHECK (interest_rate_percent IS NULL OR (interest_rate_percent >= 0 AND interest_rate_percent <= 100)),
  CHECK (currency_code IS NULL OR currency_code IN ('ETB', 'USD'))
);

CREATE TABLE loan_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid NOT NULL REFERENCES loans(id),
  version int NOT NULL,
  principal_amount numeric(20,4) NOT NULL CHECK (principal_amount > 0),
  currency_code char(3) NOT NULL CHECK (currency_code IN ('ETB', 'USD')),
  interest_rate_percent numeric(8,4) NOT NULL CHECK (interest_rate_percent >= 0 AND interest_rate_percent <= 100),
  interest_amount numeric(20,4) NOT NULL CHECK (interest_amount >= 0),
  expected_total numeric(20,4) NOT NULL CHECK (expected_total >= principal_amount),
  due_at timestamptz NOT NULL,
  note varchar(500),
  proposed_by_user_id uuid NOT NULL REFERENCES users(id),
  status varchar(32) NOT NULL CHECK (status IN ('proposed', 'accepted', 'superseded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (loan_id, version)
);

CREATE TABLE loan_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid NOT NULL REFERENCES loans(id),
  actor_id uuid REFERENCES users(id),
  event_type varchar(64) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX loans_borrower_status_idx ON loans (borrower_id, status);
CREATE INDEX loans_lender_status_idx ON loans (lender_id, status);
CREATE INDEX loans_active_due_idx ON loans (due_at) WHERE status = 'active';
CREATE INDEX loan_terms_loan_id_idx ON loan_terms (loan_id, version);
CREATE INDEX loan_events_loan_id_idx ON loan_events (loan_id, created_at);

CREATE TABLE bank_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  profile_type varchar(32) NOT NULL,
  label varchar(120) NOT NULL,
  institution_name varchar(120),
  account_identifier_encrypted bytea NOT NULL,
  account_last4 varchar(4) NOT NULL,
  currency_code char(3),
  is_preferred boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (profile_type IN ('bank_account', 'mobile_wallet', 'other')),
  CHECK (currency_code IS NULL OR currency_code IN ('ETB', 'USD'))
);

CREATE INDEX bank_profiles_user_idx ON bank_profiles (user_id, archived_at);
CREATE UNIQUE INDEX bank_profiles_one_preferred
  ON bank_profiles (user_id)
  WHERE is_preferred AND archived_at IS NULL;

CREATE TABLE bank_profile_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_profile_id uuid NOT NULL REFERENCES bank_profiles(id),
  owner_id uuid NOT NULL REFERENCES users(id),
  recipient_id uuid NOT NULL REFERENCES users(id),
  loan_id uuid REFERENCES loans(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK (owner_id <> recipient_id)
);

CREATE UNIQUE INDEX bank_profile_shares_active
  ON bank_profile_shares (bank_profile_id, recipient_id, loan_id)
  NULLS NOT DISTINCT
  WHERE revoked_at IS NULL;

CREATE INDEX bank_profile_shares_recipient_idx ON bank_profile_shares (recipient_id, revoked_at);
CREATE INDEX bank_profile_shares_loan_idx ON bank_profile_shares (loan_id, recipient_id)
  WHERE revoked_at IS NULL AND loan_id IS NOT NULL;

CREATE TABLE bank_profile_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_profile_id uuid NOT NULL REFERENCES bank_profiles(id),
  share_id uuid REFERENCES bank_profile_shares(id),
  actor_id uuid REFERENCES users(id),
  event_type varchar(64) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bank_profile_events_profile_idx ON bank_profile_events (bank_profile_id, created_at);

CREATE TABLE repayments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid NOT NULL REFERENCES loans(id),
  submitted_by_user_id uuid NOT NULL REFERENCES users(id),
  amount numeric(20,4) NOT NULL CHECK (amount > 0),
  status varchar(32) NOT NULL,
  note varchar(500),
  proof_attachment_id uuid,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  confirmed_by_user_id uuid REFERENCES users(id),
  confirmed_at timestamptz,
  rejected_at timestamptz,
  rejection_reason varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('pending', 'confirmed', 'rejected', 'cancelled'))
);

CREATE UNIQUE INDEX repayments_one_pending_per_loan
  ON repayments (loan_id)
  WHERE status = 'pending';

CREATE INDEX repayments_loan_idx ON repayments (loan_id, submitted_at);
CREATE INDEX repayments_lender_pending_idx ON repayments (status, submitted_at)
  WHERE status = 'pending';
