-- Billing is not on yet. Every account is premium until a paid tier exists.
ALTER TABLE users ALTER COLUMN plan_tier SET DEFAULT 'premium';
UPDATE users SET plan_tier = 'premium' WHERE plan_tier IS DISTINCT FROM 'premium';
