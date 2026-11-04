-- A friend's share of an expense is a loan; remember which expense it came from so a
-- declined share can be shown to the payer, who then asks again or keeps the full cost.
ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS source_entry_id uuid REFERENCES cashflow_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decline_handled boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS loans_source_entry_idx ON loans (source_entry_id) WHERE source_entry_id IS NOT NULL;

-- Shares made before this change were linked from the expense side only.
UPDATE loans l SET source_entry_id = c.id
FROM cashflow_entries c
WHERE c.linked_loan_id = l.id AND l.source_entry_id IS NULL AND c.kind = 'expense' AND l.lender_id = c.user_id
  AND l.borrower_id <> l.lender_id AND l.note LIKE 'Split from expense%';
