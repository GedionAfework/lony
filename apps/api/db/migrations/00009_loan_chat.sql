-- Loan-scoped chat threads (friend DMs keep loan_id NULL).
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS loan_id uuid REFERENCES loans(id);

DROP INDEX IF EXISTS conversations_pair_key;
CREATE UNIQUE INDEX conversations_pair_key
  ON conversations (user_low_id, user_high_id)
  WHERE loan_id IS NULL;

CREATE UNIQUE INDEX conversations_loan_key
  ON conversations (loan_id)
  WHERE loan_id IS NOT NULL;

CREATE INDEX conversations_loan_idx ON conversations (loan_id)
  WHERE loan_id IS NOT NULL;
