-- How a one-time loan's flat rate is charged: once, per month, or per year of its term.
-- Existing loans keep being charged once.
ALTER TABLE loans ADD COLUMN IF NOT EXISTS interest_charge varchar(16) NOT NULL DEFAULT 'once';
ALTER TABLE loan_terms ADD COLUMN IF NOT EXISTS interest_charge varchar(16) NOT NULL DEFAULT 'once';
ALTER TABLE loans DROP CONSTRAINT IF EXISTS loans_interest_charge_check;
ALTER TABLE loans ADD CONSTRAINT loans_interest_charge_check CHECK (interest_charge IN ('once', 'per_month', 'per_year'));
ALTER TABLE loan_terms DROP CONSTRAINT IF EXISTS loan_terms_interest_charge_check;
ALTER TABLE loan_terms ADD CONSTRAINT loan_terms_interest_charge_check CHECK (interest_charge IN ('once', 'per_month', 'per_year'));
