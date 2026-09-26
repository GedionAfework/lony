-- Titles, categories, periodic income, expense→loan share link

ALTER TABLE loans ADD COLUMN IF NOT EXISTS title varchar(120);

CREATE TABLE cashflow_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  kind varchar(16) NOT NULL,
  name varchar(64) NOT NULL,
  slug varchar(64) NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind IN ('income', 'expense')),
  CHECK (char_length(trim(name)) BETWEEN 1 AND 64),
  CHECK (char_length(trim(slug)) BETWEEN 1 AND 64)
);

CREATE UNIQUE INDEX cashflow_categories_system_slug_uidx
  ON cashflow_categories (kind, slug)
  WHERE user_id IS NULL;

CREATE UNIQUE INDEX cashflow_categories_user_slug_uidx
  ON cashflow_categories (user_id, kind, slug)
  WHERE user_id IS NOT NULL;

INSERT INTO cashflow_categories (id, user_id, kind, name, slug, is_system) VALUES
  (gen_random_uuid(), NULL, 'income', 'Salary', 'salary', true),
  (gen_random_uuid(), NULL, 'income', 'Business', 'business', true),
  (gen_random_uuid(), NULL, 'income', 'Freelance', 'freelance', true),
  (gen_random_uuid(), NULL, 'income', 'Investment', 'investment', true),
  (gen_random_uuid(), NULL, 'income', 'Gift', 'gift', true),
  (gen_random_uuid(), NULL, 'income', 'Other', 'other', true),
  (gen_random_uuid(), NULL, 'expense', 'Food', 'food', true),
  (gen_random_uuid(), NULL, 'expense', 'Transport', 'transport', true),
  (gen_random_uuid(), NULL, 'expense', 'Rent', 'rent', true),
  (gen_random_uuid(), NULL, 'expense', 'Utilities', 'utilities', true),
  (gen_random_uuid(), NULL, 'expense', 'Shopping', 'shopping', true),
  (gen_random_uuid(), NULL, 'expense', 'Health', 'health', true),
  (gen_random_uuid(), NULL, 'expense', 'Education', 'education', true),
  (gen_random_uuid(), NULL, 'expense', 'Entertainment', 'entertainment', true),
  (gen_random_uuid(), NULL, 'expense', 'Loan payment', 'loan', true),
  (gen_random_uuid(), NULL, 'expense', 'Other', 'other', true);

ALTER TABLE cashflow_entries ADD COLUMN IF NOT EXISTS title varchar(120) NOT NULL DEFAULT '';
ALTER TABLE cashflow_entries ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES cashflow_categories(id);
ALTER TABLE cashflow_entries ADD COLUMN IF NOT EXISTS is_template boolean NOT NULL DEFAULT false;
ALTER TABLE cashflow_entries ADD COLUMN IF NOT EXISTS recurrence varchar(16);
ALTER TABLE cashflow_entries ADD COLUMN IF NOT EXISTS next_occurrence_at timestamptz;
ALTER TABLE cashflow_entries ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES cashflow_entries(id) ON DELETE SET NULL;
ALTER TABLE cashflow_entries ADD COLUMN IF NOT EXISTS linked_loan_id uuid REFERENCES loans(id) ON DELETE SET NULL;

UPDATE cashflow_entries SET kind = 'expense' WHERE kind = 'outcome';

ALTER TABLE cashflow_entries DROP CONSTRAINT IF EXISTS cashflow_entries_kind_check;
ALTER TABLE cashflow_entries ADD CONSTRAINT cashflow_entries_kind_check
  CHECK (kind IN ('income', 'expense'));

ALTER TABLE cashflow_entries DROP CONSTRAINT IF EXISTS cashflow_entries_recurrence_check;
ALTER TABLE cashflow_entries ADD CONSTRAINT cashflow_entries_recurrence_check
  CHECK (recurrence IS NULL OR recurrence IN ('weekly', 'monthly', 'yearly'));

CREATE INDEX IF NOT EXISTS cashflow_entries_template_due_idx
  ON cashflow_entries (next_occurrence_at)
  WHERE is_template = true AND recurrence IS NOT NULL;
