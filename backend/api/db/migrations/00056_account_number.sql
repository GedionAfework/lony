-- The full account number the owner can share so others can send them money.
-- Stored encrypted (AES-GCM with BANK_ENCRYPTION_KEY), like bank profile numbers.
ALTER TABLE money_accounts ADD COLUMN IF NOT EXISTS account_number_enc bytea;
