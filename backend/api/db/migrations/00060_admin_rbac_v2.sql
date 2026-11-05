-- Admin RBAC v2: finer-grained permissions grouped by area, with a
-- description and a risk level the console shows next to each switch.

ALTER TABLE admin_permissions ADD COLUMN IF NOT EXISTS area varchar(40) NOT NULL DEFAULT 'general';
ALTER TABLE admin_permissions ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE admin_permissions ADD COLUMN IF NOT EXISTS level varchar(16) NOT NULL DEFAULT 'read';

INSERT INTO admin_permissions (code, label, sort_order, area, description, level) VALUES
  ('overview.read',       'View overview',          10, 'insights', 'See platform metrics on the overview dashboard.', 'read'),
  ('system.read',         'View system health',     20, 'system',   'See runtime, database, job queue and integration status.', 'read'),
  ('system.jobs',         'Manage background jobs', 22, 'system',   'Retry failed notification jobs.', 'write'),
  ('settings.ai',         'Control AI features',    24, 'system',   'Turn AI features on or off for every user.', 'danger'),
  ('settings.platform',   'Control the platform',   26, 'system',   'Maintenance mode, sign-ups and feature switches.', 'danger'),
  ('users.read',          'View users',             30, 'users',    'Search users and open their profiles.', 'read'),
  ('users.suspend',       'Suspend users',          32, 'users',    'Suspend and reinstate user accounts.', 'write'),
  ('users.plan',          'Change plans',           34, 'users',    'Move users between Free and Premium.', 'write'),
  ('users.sessions',      'Sign users out',         36, 'users',    'Revoke every active session of a user.', 'write'),
  ('roles.read',          'View roles & team',      40, 'access',   'See roles, their permissions and the admin team.', 'read'),
  ('roles.assign',        'Manage the admin team',  42, 'access',   'Grant or remove admin access and assign roles.', 'danger'),
  ('roles.manage',        'Edit roles',             44, 'access',   'Create, edit and delete roles and their permissions.', 'danger'),
  ('audit.read',          'View audit log',         50, 'audit',    'Browse every admin action.', 'read'),
  ('audit.export',        'Export audit log',       52, 'audit',    'Download the audit log as CSV.', 'write'),
  ('categories.read',     'View categories',        60, 'content',  'See account, institution and goal catalogs.', 'read'),
  ('categories.write',    'Edit categories',        62, 'content',  'Add, rename, hide and import catalog entries.', 'write'),
  ('themes.read',         'View themes',            64, 'content',  'See the mobile app theme gallery.', 'read'),
  ('themes.write',        'Edit themes',            66, 'content',  'Create, edit, publish and hide themes.', 'write'),
  ('localization.read',   'View languages',         68, 'content',  'See language packs, coverage and calendars.', 'read'),
  ('localization.manage', 'Edit languages',         70, 'content',  'Upload, publish and delete language packs and calendars.', 'write')
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  sort_order = EXCLUDED.sort_order,
  area = EXCLUDED.area,
  description = EXCLUDED.description,
  level = EXCLUDED.level;

-- Keep what existing roles could already do under the new, split permissions.
INSERT INTO admin_role_permissions (role_id, permission_code)
SELECT rp.role_id, m.code
FROM admin_role_permissions rp
JOIN (VALUES
  ('users.write', 'users.suspend'),
  ('users.write', 'users.plan'),
  ('users.write', 'users.sessions'),
  ('roles.manage', 'roles.read'),
  ('roles.manage', 'roles.assign'),
  ('audit.read', 'audit.export'),
  ('localization.manage', 'localization.read')
) AS m(old_code, code) ON m.old_code = rp.permission_code
ON CONFLICT DO NOTHING;

DELETE FROM admin_permissions WHERE code = 'users.write';

-- Super Admin always holds everything.
INSERT INTO admin_role_permissions (role_id, permission_code)
SELECT r.id, p.code
FROM admin_roles r
CROSS JOIN admin_permissions p
WHERE r.name = 'Super Admin'
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS notification_jobs_status_idx ON notification_jobs (status);
