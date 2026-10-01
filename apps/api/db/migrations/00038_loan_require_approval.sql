-- User preference: pending peer loans count in wealth only after acceptance when true.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS loan_require_approval boolean NOT NULL DEFAULT true;
