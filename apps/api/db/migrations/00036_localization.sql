-- Localization: admin-managed languages + calendars; user display preferences.

CREATE TABLE IF NOT EXISTS app_locales (
  code varchar(32) PRIMARY KEY,
  name varchar(120) NOT NULL,
  dir varchar(3) NOT NULL DEFAULT 'ltr' CHECK (dir IN ('ltr', 'rtl')),
  enabled boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  messages jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_calendars (
  id varchar(32) PRIMARY KEY,
  name varchar(120) NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_id varchar(32) NOT NULL DEFAULT 'gregorian';
ALTER TABLE users ADD COLUMN IF NOT EXISTS hour_cycle varchar(16) NOT NULL DEFAULT '24h';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_hour_cycle_check;
ALTER TABLE users ADD CONSTRAINT users_hour_cycle_check CHECK (hour_cycle IN ('24h', '12h', 'ethiopian_6'));

INSERT INTO app_calendars (id, name, enabled, sort_order, config) VALUES
  ('gregorian', 'Gregorian', true, 1, '{"months":["January","February","March","April","May","June","July","August","September","October","November","December"]}'),
  ('ethiopic', 'Ethiopic (Ethiopian)', true, 2, '{"months":["Meskerem","Tikimt","Hidar","Tahsas","Tir","Yekatit","Megabit","Miazia","Ginbot","Sene","Hamle","Nehase","Pagumen"],"days_per_month":30,"pagumen_days":5}'),
  ('hijri', 'Islamic (Hijri)', true, 3, '{"months":["Muharram","Safar","Rabiʻ I","Rabiʻ II","Jumada I","Jumada II","Rajab","Shaʻban","Ramadan","Shawwal","Dhuʻl-Qiʻdah","Dhuʻl-Hijjah"]}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO app_locales (code, name, dir, enabled, sort_order, messages) VALUES
  ('en', 'English', 'ltr', true, 1, '{}'::jsonb),
  ('am-ET', 'አማርኛ', 'ltr', true, 2, '{}'::jsonb),
  ('fr', 'Français', 'ltr', true, 3, '{}'::jsonb),
  ('ar', 'العربية', 'rtl', false, 4, '{}'::jsonb)
ON CONFLICT (code) DO NOTHING;

INSERT INTO admin_permissions (code, label, sort_order) VALUES
  ('localization.manage', 'Manage languages & calendars', 100)
ON CONFLICT (code) DO NOTHING;

INSERT INTO admin_role_permissions (role_id, permission_code)
SELECT r.id, 'localization.manage'
FROM admin_roles r
WHERE r.is_system = true
ON CONFLICT DO NOTHING;
