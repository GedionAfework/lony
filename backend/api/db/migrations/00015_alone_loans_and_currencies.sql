-- Alone / institutional loans store the borrower as both borrower_id and lender_id
-- (no Lony counterparty). Drop the peer-only party inequality check.
DO $$
DECLARE
  cname text;
BEGIN
  FOR cname IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = current_schema()
      AND rel.relname = 'loans'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%borrower_id%<>%lender_id%'
  LOOP
    EXECUTE format('ALTER TABLE loans DROP CONSTRAINT %I', cname);
  END LOOP;
END $$;

-- Allow any ISO-4217 currency (mobile catalogs are global).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT rel.relname AS table_name, con.conname AS constraint_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = current_schema()
      AND rel.relname IN ('loans', 'loan_terms')
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%currency_code%'
      AND pg_get_constraintdef(con.oid) ILIKE '%ETB%'
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', r.table_name, r.constraint_name);
  END LOOP;
END $$;

ALTER TABLE loans DROP CONSTRAINT IF EXISTS loans_currency_code_check;
ALTER TABLE loan_terms DROP CONSTRAINT IF EXISTS loan_terms_currency_code_check;
