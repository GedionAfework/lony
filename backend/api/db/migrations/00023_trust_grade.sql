-- Lony Trust Index: A–E grade (replace 300–850 numeric score)

ALTER TABLE lony_scores DROP CONSTRAINT IF EXISTS lony_scores_score_check;

ALTER TABLE lony_scores
  ADD COLUMN IF NOT EXISTS grade char(1),
  ADD COLUMN IF NOT EXISTS points numeric(5, 2),
  ADD COLUMN IF NOT EXISTS repayment_score numeric(5, 2),
  ADD COLUMN IF NOT EXISTS thin_history boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS loan_sample_size int NOT NULL DEFAULT 0;

-- Migrate legacy 300–850 rows if present
UPDATE lony_scores
SET
  points = LEAST(100, GREATEST(0, ROUND((COALESCE(score, 300) - 300)::numeric / 5.5, 2))),
  grade = CASE
    WHEN LEAST(100, GREATEST(0, ROUND((COALESCE(score, 300) - 300)::numeric / 5.5, 2))) >= 85 THEN 'A'
    WHEN LEAST(100, GREATEST(0, ROUND((COALESCE(score, 300) - 300)::numeric / 5.5, 2))) >= 70 THEN 'B'
    WHEN LEAST(100, GREATEST(0, ROUND((COALESCE(score, 300) - 300)::numeric / 5.5, 2))) >= 55 THEN 'C'
    WHEN LEAST(100, GREATEST(0, ROUND((COALESCE(score, 300) - 300)::numeric / 5.5, 2))) >= 40 THEN 'D'
    ELSE 'E'
  END,
  repayment_score = COALESCE(peer_score, 55)
WHERE grade IS NULL;

ALTER TABLE lony_scores ALTER COLUMN grade SET DEFAULT 'C';
ALTER TABLE lony_scores ALTER COLUMN points SET DEFAULT 50;
UPDATE lony_scores SET grade = 'C' WHERE grade IS NULL;
UPDATE lony_scores SET points = 50 WHERE points IS NULL;
UPDATE lony_scores SET repayment_score = COALESCE(peer_score, 55) WHERE repayment_score IS NULL;

ALTER TABLE lony_scores ALTER COLUMN grade SET NOT NULL;
ALTER TABLE lony_scores ALTER COLUMN points SET NOT NULL;
ALTER TABLE lony_scores ALTER COLUMN repayment_score SET NOT NULL;

ALTER TABLE lony_scores DROP CONSTRAINT IF EXISTS lony_scores_grade_check;
ALTER TABLE lony_scores ADD CONSTRAINT lony_scores_grade_check
  CHECK (grade IN ('A', 'B', 'C', 'D', 'E'));

ALTER TABLE lony_scores DROP CONSTRAINT IF EXISTS lony_scores_points_check;
ALTER TABLE lony_scores ADD CONSTRAINT lony_scores_points_check
  CHECK (points >= 0 AND points <= 100);
