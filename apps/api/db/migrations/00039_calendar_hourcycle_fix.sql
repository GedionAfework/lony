-- Allow all major calendars on users; drop Ethiopian hour-cycle option.

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

-- Drop any restrictive calendar_id check (some envs only allowed gregorian/ethiopic/hijri).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_calendar_id_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_calendar_check;

UPDATE users
SET calendar_id = 'islamic'
WHERE lower(calendar_id) IN ('hijri');

UPDATE users
SET hour_cycle = '24h'
WHERE hour_cycle = 'ethiopian_6';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_hour_cycle_check;
ALTER TABLE users ADD CONSTRAINT users_hour_cycle_check CHECK (hour_cycle IN ('24h', '12h'));
