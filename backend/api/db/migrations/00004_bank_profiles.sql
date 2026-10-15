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
