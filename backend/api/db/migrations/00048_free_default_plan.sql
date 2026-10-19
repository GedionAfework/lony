-- Free vs Premium: new accounts start free. Admins keep Premium.
ALTER TABLE users ALTER COLUMN plan_tier SET DEFAULT 'free';
UPDATE users
SET plan_tier = 'free'
WHERE plan_tier = 'premium'
  AND COALESCE(role, 'user') IS DISTINCT FROM 'admin';
