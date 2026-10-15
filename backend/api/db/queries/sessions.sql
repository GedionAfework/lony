-- name: CreateSession :one
INSERT INTO user_sessions (
  user_id,
  refresh_token_hash,
  device_label,
  expires_at
) VALUES (
  $1, $2, $3, $4
)
RETURNING *;

-- name: GetSessionByID :one
SELECT * FROM user_sessions
WHERE id = $1;

-- name: GetSessionByRefreshHash :one
SELECT * FROM user_sessions
WHERE refresh_token_hash = $1;

-- name: TouchSession :exec
UPDATE user_sessions
SET last_used_at = now()
WHERE id = $1 AND revoked_at IS NULL;

-- name: RotateSession :one
UPDATE user_sessions
SET refresh_token_hash = $2,
    last_used_at = now()
WHERE id = $1 AND revoked_at IS NULL
RETURNING *;

-- name: RevokeSession :exec
UPDATE user_sessions
SET revoked_at = now()
WHERE id = $1 AND revoked_at IS NULL;
