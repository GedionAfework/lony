-- Link records that describe the same money so net worth counts it once.
-- See docs/net-worth-integrity.md.

-- The borrower's expense that paid a repayment claim, and the lender's income that received it.
ALTER TABLE repayments
  ADD COLUMN IF NOT EXISTS paid_entry_id uuid REFERENCES cashflow_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS received_entry_id uuid REFERENCES cashflow_entries(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS repayments_paid_entry_uniq
  ON repayments (paid_entry_id) WHERE paid_entry_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS repayments_received_entry_uniq
  ON repayments (received_entry_id) WHERE received_entry_id IS NOT NULL;

-- A self-recorded (alone) debt that is already part of a credit card balance.
ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS linked_account_id uuid REFERENCES money_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS account_link_dismissed boolean NOT NULL DEFAULT false;
