-- Admin RBAC + system themes for mobile

ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_role_id uuid;

CREATE TABLE IF NOT EXISTS admin_permissions (
  code varchar(64) PRIMARY KEY,
  label varchar(120) NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS admin_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(80) NOT NULL UNIQUE,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_role_permissions (
  role_id uuid NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
  permission_code varchar(64) NOT NULL REFERENCES admin_permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_code)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_admin_role_id_fkey'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_admin_role_id_fkey
      FOREIGN KEY (admin_role_id) REFERENCES admin_roles(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS users_admin_role_idx ON users (admin_role_id) WHERE admin_role_id IS NOT NULL;

INSERT INTO admin_permissions (code, label, sort_order) VALUES
  ('overview.read', 'View overview', 10),
  ('users.read', 'View users', 20),
  ('users.write', 'Manage users', 30),
  ('categories.read', 'View categories', 40),
  ('categories.write', 'Manage categories', 50),
  ('themes.read', 'View themes', 60),
  ('themes.write', 'Manage themes', 70),
  ('audit.read', 'View audit log', 80),
  ('settings.ai', 'Toggle AI settings', 90),
  ('roles.manage', 'Manage roles & permissions', 100)
ON CONFLICT (code) DO NOTHING;

INSERT INTO admin_roles (id, name, description, is_system)
SELECT 'a0000000-0000-4000-8000-000000000001'::uuid, 'Super Admin', 'Full access to the admin console', true
WHERE NOT EXISTS (SELECT 1 FROM admin_roles WHERE name = 'Super Admin');

INSERT INTO admin_role_permissions (role_id, permission_code)
SELECT r.id, p.code
FROM admin_roles r
CROSS JOIN admin_permissions p
WHERE r.name = 'Super Admin'
ON CONFLICT DO NOTHING;

UPDATE users u
SET admin_role_id = r.id
FROM admin_roles r
WHERE r.name = 'Super Admin'
  AND u.role = 'admin'
  AND u.admin_role_id IS NULL
  AND u.deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS system_themes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug varchar(64) NOT NULL UNIQUE,
  label varchar(120) NOT NULL,
  colors jsonb NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS system_themes_active_idx ON system_themes (active, sort_order);

INSERT INTO system_themes (slug, label, colors, sort_order) VALUES
(
  'lony-light',
  'Lony Light',
  '{"background":"#FFFFFF","surface":"#FFFFFF","surfaceRaised":"#FFFFFF","surfaceMuted":"#F4F6F8","text":"#0F172A","textSecondary":"#334155","muted":"#64748B","border":"#E8ECF0","borderStrong":"#D0D7DE","primary":"#1FA8A8","primarySoft":"#E6F7F6","onPrimary":"#FFFFFF","secondary":"#D97706","secondarySoft":"#FFF7ED","tertiary":"#0284C7","tertiarySoft":"#EFF8FF","success":"#0F766E","successSoft":"#E6F7F5","warning":"#B45309","warningSoft":"#FFF7ED","error":"#DC2626","errorSoft":"#FEF2F2","nav":"#FFFFFF","fabBorder":"#FFFFFF","overlay":"rgba(15, 23, 42, 0.4)"}'::jsonb,
  10
),
(
  'lony-dark',
  'Lony Dark',
  '{"background":"#0B1220","surface":"#121A2B","surfaceRaised":"#182235","surfaceMuted":"#0F1624","text":"#F1F5F9","textSecondary":"#CBD5E1","muted":"#94A3B8","border":"rgba(148, 163, 184, 0.16)","borderStrong":"rgba(148, 163, 184, 0.28)","primary":"#2EC4C4","primarySoft":"rgba(46, 196, 196, 0.14)","onPrimary":"#042F2E","secondary":"#FBBF24","secondarySoft":"rgba(251, 191, 36, 0.12)","tertiary":"#7DD3FC","tertiarySoft":"rgba(125, 211, 252, 0.12)","success":"#2EC4C4","successSoft":"rgba(46, 196, 196, 0.12)","warning":"#FBBF24","warningSoft":"rgba(251, 191, 36, 0.12)","error":"#F87171","errorSoft":"rgba(248, 113, 113, 0.12)","nav":"#121A2B","fabBorder":"#0B1220","overlay":"rgba(0, 0, 0, 0.55)"}'::jsonb,
  20
),
(
  'ocean',
  'Ocean',
  '{"background":"#F0F9FF","surface":"#FFFFFF","surfaceRaised":"#FFFFFF","surfaceMuted":"#E0F2FE","text":"#0F172A","textSecondary":"#334155","muted":"#64748B","border":"#E8ECF0","borderStrong":"#D0D7DE","primary":"#0369A1","primarySoft":"#E0F2FE","onPrimary":"#FFFFFF","secondary":"#0E7490","secondarySoft":"#FFF7ED","tertiary":"#0284C7","tertiarySoft":"#EFF8FF","success":"#0F766E","successSoft":"#E6F7F5","warning":"#B45309","warningSoft":"#FFF7ED","error":"#DC2626","errorSoft":"#FEF2F2","nav":"#F0F9FF","fabBorder":"#FFFFFF","overlay":"rgba(15, 23, 42, 0.4)"}'::jsonb,
  30
),
(
  'forest',
  'Forest',
  '{"background":"#F3F7F2","surface":"#FFFFFF","surfaceRaised":"#FFFFFF","surfaceMuted":"#E7F0E6","text":"#0F172A","textSecondary":"#334155","muted":"#64748B","border":"#E8ECF0","borderStrong":"#D0D7DE","primary":"#3F6B4D","primarySoft":"#E7F0E6","onPrimary":"#FFFFFF","secondary":"#A16207","secondarySoft":"#FFF7ED","tertiary":"#4D7C5A","tertiarySoft":"#EFF8FF","success":"#3F6B4D","successSoft":"#E6F7F5","warning":"#B45309","warningSoft":"#FFF7ED","error":"#DC2626","errorSoft":"#FEF2F2","nav":"#F3F7F2","fabBorder":"#FFFFFF","overlay":"rgba(15, 23, 42, 0.4)"}'::jsonb,
  40
),
(
  'sunset',
  'Sunset',
  '{"background":"#FFF7ED","surface":"#FFFFFF","surfaceRaised":"#FFFFFF","surfaceMuted":"#FFEDD5","text":"#0F172A","textSecondary":"#334155","muted":"#64748B","border":"#E8ECF0","borderStrong":"#D0D7DE","primary":"#C2410C","primarySoft":"#FFEDD5","onPrimary":"#FFFFFF","secondary":"#B45309","secondarySoft":"#FFF7ED","tertiary":"#EA580C","tertiarySoft":"#EFF8FF","success":"#0F766E","successSoft":"#E6F7F5","warning":"#B45309","warningSoft":"#FFF7ED","error":"#DC2626","errorSoft":"#FEF2F2","nav":"#FFF7ED","fabBorder":"#FFFFFF","overlay":"rgba(15, 23, 42, 0.4)"}'::jsonb,
  50
),
(
  'midnight',
  'Midnight',
  '{"background":"#09090B","surface":"#18181B","surfaceRaised":"#27272A","surfaceMuted":"#09090B","text":"#F1F5F9","textSecondary":"#CBD5E1","muted":"#94A3B8","border":"rgba(148, 163, 184, 0.16)","borderStrong":"rgba(148, 163, 184, 0.28)","primary":"#A78BFA","primarySoft":"rgba(167, 139, 250, 0.16)","onPrimary":"#1E1B4B","secondary":"#F472B6","secondarySoft":"rgba(244, 114, 182, 0.12)","tertiary":"#67E8F9","tertiarySoft":"rgba(103, 232, 249, 0.12)","success":"#2EC4C4","successSoft":"rgba(46, 196, 196, 0.12)","warning":"#FBBF24","warningSoft":"rgba(251, 191, 36, 0.12)","error":"#F87171","errorSoft":"rgba(248, 113, 113, 0.12)","nav":"#18181B","fabBorder":"#09090B","overlay":"rgba(0, 0, 0, 0.55)"}'::jsonb,
  60
)
ON CONFLICT (slug) DO NOTHING;

