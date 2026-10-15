-- name: InvalidateOpenChallenges :exec
UPDATE verification_challenges
SET consumed_at = now()
WHERE user_id = $1 AND consumed_at IS NULL;

-- name: CreateVerificationChallenge :one
INSERT INTO verification_challenges (
  user_id,
  channel,
  destination,
  code_hash,
  expires_at
) VALUES (
  $1, $2, $3, $4, $5
)
RETURNING *;

-- name: GetLatestOpenChallenge :one
SELECT * FROM verification_challenges
WHERE user_id = $1 AND consumed_at IS NULL
ORDER BY created_at DESC
LIMIT 1;

-- name: IncrementChallengeAttempts :one
UPDATE verification_challenges
SET attempts = attempts + 1
WHERE id = $1
RETURNING *;

-- name: ConsumeChallenge :exec
UPDATE verification_challenges
SET consumed_at = now()
WHERE id = $1 AND consumed_at IS NULL;
