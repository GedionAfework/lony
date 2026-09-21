-- Allow notes / private self-chat threads (same user on both sides).
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_user_low_id_check;
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_check;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'conversations'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%user_low_id%user_high_id%'
  ) THEN
    EXECUTE (
      SELECT 'ALTER TABLE conversations DROP CONSTRAINT ' || quote_ident(conname)
      FROM pg_constraint
      WHERE conrelid = 'conversations'::regclass AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%user_low_id%<>%user_high_id%'
      LIMIT 1
    );
  END IF;
END $$;
