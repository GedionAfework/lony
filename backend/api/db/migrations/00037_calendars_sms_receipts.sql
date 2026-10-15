-- Major world calendars + cashflow bill reminders support + receipt/SMS ingest helpers.

INSERT INTO app_calendars (id, name, enabled, sort_order, config) VALUES
  ('gregorian', 'Gregorian', true, 1, '{"intl":"gregory"}'),
  ('islamic', 'Islamic (Hijri)', true, 2, '{"intl":"islamic"}'),
  ('hebrew', 'Hebrew', true, 3, '{"intl":"hebrew"}'),
  ('chinese', 'Chinese', true, 4, '{"intl":"chinese"}'),
  ('ethiopic', 'Ethiopian', true, 5, '{"intl":"ethiopic"}'),
  ('persian', 'Solar Hijri (Persian)', true, 6, '{"intl":"persian"}'),
  ('hijri', 'Islamic (Hijri) — legacy id', true, 7, '{"intl":"islamic","alias_of":"islamic"}')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  enabled = true,
  sort_order = EXCLUDED.sort_order,
  config = EXCLUDED.config,
  updated_at = now();

-- Optional receipt attachment + SMS fingerprint for cashflow entries.
ALTER TABLE cashflow_entries
  ADD COLUMN IF NOT EXISTS receipt_media_key text,
  ADD COLUMN IF NOT EXISTS source varchar(32) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS external_ref text,
  ADD COLUMN IF NOT EXISTS remind_days_before int NOT NULL DEFAULT 3;

CREATE UNIQUE INDEX IF NOT EXISTS cashflow_entries_user_external_ref_uidx
  ON cashflow_entries (user_id, external_ref)
  WHERE external_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS sms_ingest_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  raw_excerpt text NOT NULL DEFAULT '',
  parsed jsonb NOT NULL DEFAULT '{}'::jsonb,
  cashflow_id uuid REFERENCES cashflow_entries(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS sms_ingest_log_user_created_idx ON sms_ingest_log (user_id, created_at DESC);
