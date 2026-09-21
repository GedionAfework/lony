-- Expanded account profile + payment rail types + ToS acceptance.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS first_name varchar(60),
  ADD COLUMN IF NOT EXISTS middle_name varchar(60),
  ADD COLUMN IF NOT EXISTS last_name varchar(60),
  ADD COLUMN IF NOT EXISTS country_code char(2),
  ADD COLUMN IF NOT EXISTS preferred_auth_provider varchar(16),
  ADD COLUMN IF NOT EXISTS tos_version varchar(32),
  ADD COLUMN IF NOT EXISTS tos_accepted_at timestamptz;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_preferred_auth_provider_check;

ALTER TABLE users
  ADD CONSTRAINT users_preferred_auth_provider_check
  CHECK (
    preferred_auth_provider IS NULL
    OR preferred_auth_provider IN ('email', 'google', 'telegram')
  );

-- Broaden payment profile types (rails catalog lives in app code).
ALTER TABLE bank_profiles DROP CONSTRAINT IF EXISTS bank_profiles_profile_type_check;
ALTER TABLE bank_profiles
  ADD CONSTRAINT bank_profiles_profile_type_check
  CHECK (profile_type IN (
    'bank_account',
    'iban',
    'mobile_money',
    'mobile_wallet',
    'crypto_wallet',
    'card',
    'paypal',
    'wise',
    'cash_app',
    'venmo',
    'upi',
    'pix',
    'sepa',
    'swift',
    'other'
  ));

ALTER TABLE bank_profiles
  ADD COLUMN IF NOT EXISTS country_code char(2),
  ADD COLUMN IF NOT EXISTS rail_code varchar(64);

ALTER TABLE bank_profiles DROP CONSTRAINT IF EXISTS bank_profiles_currency_code_check;
