-- Institution type + co-lenders for long-term loans.
ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS institution_type varchar(64),
  ADD COLUMN IF NOT EXISTS party_mode varchar(32) NOT NULL DEFAULT 'peer';

ALTER TABLE loans
  DROP CONSTRAINT IF EXISTS loans_party_mode_check;
ALTER TABLE loans
  ADD CONSTRAINT loans_party_mode_check CHECK (party_mode IN ('peer', 'alone', 'shared'));

CREATE TABLE IF NOT EXISTS loan_co_lenders (
  loan_id uuid NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position int NOT NULL DEFAULT 0,
  PRIMARY KEY (loan_id, user_id)
);

CREATE INDEX IF NOT EXISTS loan_co_lenders_user_idx ON loan_co_lenders (user_id);
