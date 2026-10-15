-- Global catalogs for account types, institution types, and institutions.
-- Admins manage these; clients can fetch active rows worldwide (not country-locked).

CREATE TABLE IF NOT EXISTS catalog_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind varchar(32) NOT NULL CHECK (kind IN ('account_type', 'institution_type')),
  code varchar(64) NOT NULL,
  label varchar(120) NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, code)
);

CREATE TABLE IF NOT EXISTS catalog_institutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(64) NOT NULL UNIQUE,
  label varchar(160) NOT NULL,
  type_kind varchar(32) NOT NULL DEFAULT 'account_type'
    CHECK (type_kind IN ('account_type', 'institution_type')),
  type_code varchar(64) NOT NULL,
  country_code char(2),
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_institutions_type_idx
  ON catalog_institutions (type_kind, type_code, active, sort_order, label);

CREATE INDEX IF NOT EXISTS catalog_types_kind_idx
  ON catalog_types (kind, active, sort_order, label);

-- Seed account types
INSERT INTO catalog_types (kind, code, label, sort_order) VALUES
  ('account_type', 'bank', 'Bank', 10),
  ('account_type', 'cash', 'Cash', 20),
  ('account_type', 'mobile_money', 'Mobile money', 30),
  ('account_type', 'wallet', 'Wallet', 40),
  ('account_type', 'other', 'Other', 90)
ON CONFLICT (kind, code) DO NOTHING;

-- Seed institution types (for loans / lenders)
INSERT INTO catalog_types (kind, code, label, sort_order) VALUES
  ('institution_type', 'bank', 'Bank', 10),
  ('institution_type', 'sacco', 'SACCO / Credit union', 20),
  ('institution_type', 'microfinance', 'Microfinance', 30),
  ('institution_type', 'fintech', 'Fintech / digital lender', 40),
  ('institution_type', 'insurance', 'Insurance', 50),
  ('institution_type', 'government', 'Government / public lender', 60),
  ('institution_type', 'employer', 'Employer', 70),
  ('institution_type', 'hedge_fund', 'Hedge fund', 80),
  ('institution_type', 'private_equity', 'Private equity', 85),
  ('institution_type', 'person', 'Person', 88),
  ('institution_type', 'other', 'Other', 90)
ON CONFLICT (kind, code) DO NOTHING;

-- Seed a small global starter set (admins can add more)
INSERT INTO catalog_institutions (code, label, type_kind, type_code, sort_order) VALUES
  ('hsbc', 'HSBC', 'account_type', 'bank', 10),
  ('citibank', 'Citibank', 'account_type', 'bank', 20),
  ('standard_chartered', 'Standard Chartered', 'account_type', 'bank', 30),
  ('jpmorgan_chase', 'JPMorgan Chase', 'account_type', 'bank', 40),
  ('bank_of_america', 'Bank of America', 'account_type', 'bank', 50),
  ('wells_fargo', 'Wells Fargo', 'account_type', 'bank', 60),
  ('barclays', 'Barclays', 'account_type', 'bank', 70),
  ('deutsche_bank', 'Deutsche Bank', 'account_type', 'bank', 80),
  ('ubs', 'UBS', 'account_type', 'bank', 90),
  ('rbc', 'Royal Bank of Canada', 'account_type', 'bank', 100),
  ('mpesa', 'M-Pesa', 'account_type', 'mobile_money', 10),
  ('orangemoney', 'Orange Money', 'account_type', 'mobile_money', 20),
  ('mtn_momo', 'MTN MoMo', 'account_type', 'mobile_money', 30),
  ('paypal', 'PayPal', 'account_type', 'wallet', 10),
  ('wise', 'Wise', 'account_type', 'wallet', 20),
  ('revolut', 'Revolut', 'account_type', 'wallet', 30),
  ('venmo', 'Venmo', 'account_type', 'wallet', 40),
  ('cash_app', 'Cash App', 'account_type', 'wallet', 50),
  ('inst_hsbc', 'HSBC', 'institution_type', 'bank', 10),
  ('inst_citi', 'Citibank', 'institution_type', 'bank', 20),
  ('inst_sc', 'Standard Chartered', 'institution_type', 'bank', 30),
  ('inst_other', 'Other / unlisted', 'institution_type', 'other', 999)
ON CONFLICT (code) DO NOTHING;
