-- Allow notes / private self-chat threads (same user on both sides).
-- Drop any CHECK that requires user_low_id <> user_high_id on conversations.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'conversations'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%user_low_id%user_high_id%'
  LOOP
    EXECUTE format('ALTER TABLE conversations DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
