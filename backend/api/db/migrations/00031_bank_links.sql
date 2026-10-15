-- Live bank OAuth connections (Plaid / future aggregators)

CREATE TABLE IF NOT EXISTS bank_link_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider varchar(32) NOT NULL DEFAULT 'plaid',
  item_id text,
  access_token_enc text,
  institution_label varchar(200),
  status varchar(32) NOT NULL DEFAULT 'active',
  account_id uuid REFERENCES money_accounts(id) ON DELETE SET NULL,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (provider IN ('plaid', 'truelayer', 'other')),
  CHECK (status IN ('active', 'error', 'disconnected'))
);

CREATE INDEX IF NOT EXISTS bank_link_connections_user_idx
  ON bank_link_connections (user_id, created_at DESC);
