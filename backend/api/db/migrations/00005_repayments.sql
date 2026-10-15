ALTER TABLE loans DROP CONSTRAINT IF EXISTS loans_status_check;
ALTER TABLE loans ADD CONSTRAINT loans_status_check
  CHECK (status IN ('pending', 'active', 'overdue', 'repayment_pending', 'rejected', 'cancelled', 'completed'));

CREATE TABLE repayments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid NOT NULL REFERENCES loans(id),
  submitted_by_user_id uuid NOT NULL REFERENCES users(id),
  amount numeric(20,4) NOT NULL CHECK (amount > 0),
  status varchar(32) NOT NULL,
  note varchar(500),
  proof_attachment_id uuid,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  confirmed_by_user_id uuid REFERENCES users(id),
  confirmed_at timestamptz,
  rejected_at timestamptz,
  rejection_reason varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('pending', 'confirmed', 'rejected', 'cancelled'))
);

CREATE UNIQUE INDEX repayments_one_pending_per_loan
  ON repayments (loan_id)
  WHERE status = 'pending';

CREATE INDEX repayments_loan_idx ON repayments (loan_id, submitted_at);
CREATE INDEX repayments_lender_pending_idx ON repayments (status, submitted_at)
  WHERE status = 'pending';
