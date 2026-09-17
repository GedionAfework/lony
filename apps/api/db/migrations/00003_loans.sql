CREATE TABLE loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_code varchar(16) NOT NULL UNIQUE,
  borrower_id uuid NOT NULL REFERENCES users(id),
  lender_id uuid NOT NULL REFERENCES users(id),
  initiator_id uuid NOT NULL REFERENCES users(id),
  status varchar(32) NOT NULL,
  principal_amount numeric(20,4),
  currency_code char(3),
  interest_rate_percent numeric(8,4),
  interest_amount numeric(20,4),
  expected_total numeric(20,4),
  outstanding_amount numeric(20,4),
  due_at timestamptz,
  note varchar(500),
  current_terms_id uuid,
  accepted_terms_id uuid,
  terms_version int,
  proposed_by_user_id uuid REFERENCES users(id),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (borrower_id <> lender_id),
  CHECK (initiator_id IN (borrower_id, lender_id)),
  CHECK (status IN ('pending', 'active', 'overdue', 'rejected', 'cancelled', 'completed')),
  CHECK (principal_amount IS NULL OR principal_amount > 0),
  CHECK (interest_rate_percent IS NULL OR (interest_rate_percent >= 0 AND interest_rate_percent <= 100)),
  CHECK (currency_code IS NULL OR currency_code IN ('ETB', 'USD'))
);

CREATE TABLE loan_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid NOT NULL REFERENCES loans(id),
  version int NOT NULL,
  principal_amount numeric(20,4) NOT NULL CHECK (principal_amount > 0),
  currency_code char(3) NOT NULL CHECK (currency_code IN ('ETB', 'USD')),
  interest_rate_percent numeric(8,4) NOT NULL CHECK (interest_rate_percent >= 0 AND interest_rate_percent <= 100),
  interest_amount numeric(20,4) NOT NULL CHECK (interest_amount >= 0),
  expected_total numeric(20,4) NOT NULL CHECK (expected_total >= principal_amount),
  due_at timestamptz NOT NULL,
  note varchar(500),
  proposed_by_user_id uuid NOT NULL REFERENCES users(id),
  status varchar(32) NOT NULL CHECK (status IN ('proposed', 'accepted', 'superseded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (loan_id, version)
);

CREATE TABLE loan_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid NOT NULL REFERENCES loans(id),
  actor_id uuid REFERENCES users(id),
  event_type varchar(64) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX loans_borrower_status_idx ON loans (borrower_id, status);
CREATE INDEX loans_lender_status_idx ON loans (lender_id, status);
CREATE INDEX loans_active_due_idx ON loans (due_at) WHERE status = 'active';
CREATE INDEX loan_terms_loan_id_idx ON loan_terms (loan_id, version);
CREATE INDEX loan_events_loan_id_idx ON loan_events (loan_id, created_at);
