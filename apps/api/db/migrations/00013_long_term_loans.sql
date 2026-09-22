-- Long-term / installment loan support + interest period.
ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS loan_kind varchar(32) NOT NULL DEFAULT 'one_time',
  ADD COLUMN IF NOT EXISTS interest_period_months int,
  ADD COLUMN IF NOT EXISTS installment_count int,
  ADD COLUMN IF NOT EXISTS installment_amount numeric(20,4),
  ADD COLUMN IF NOT EXISTS institution_label varchar(120),
  ADD COLUMN IF NOT EXISTS start_at timestamptz;

ALTER TABLE loans
  DROP CONSTRAINT IF EXISTS loans_loan_kind_check;
ALTER TABLE loans
  ADD CONSTRAINT loans_loan_kind_check CHECK (loan_kind IN ('one_time', 'long_term'));

ALTER TABLE loan_terms
  ADD COLUMN IF NOT EXISTS loan_kind varchar(32) NOT NULL DEFAULT 'one_time',
  ADD COLUMN IF NOT EXISTS interest_period_months int,
  ADD COLUMN IF NOT EXISTS installment_count int,
  ADD COLUMN IF NOT EXISTS installment_amount numeric(20,4),
  ADD COLUMN IF NOT EXISTS institution_label varchar(120),
  ADD COLUMN IF NOT EXISTS start_at timestamptz;

CREATE TABLE IF NOT EXISTS loan_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  sequence_no int NOT NULL,
  due_at timestamptz NOT NULL,
  amount numeric(20,4) NOT NULL CHECK (amount > 0),
  principal_portion numeric(20,4) NOT NULL DEFAULT 0,
  interest_portion numeric(20,4) NOT NULL DEFAULT 0,
  status varchar(32) NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'paid', 'overdue', 'skipped')),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (loan_id, sequence_no)
);

CREATE INDEX IF NOT EXISTS loan_installments_loan_due_idx
  ON loan_installments (loan_id, due_at);
CREATE INDEX IF NOT EXISTS loan_installments_due_status_idx
  ON loan_installments (due_at)
  WHERE status = 'scheduled';
