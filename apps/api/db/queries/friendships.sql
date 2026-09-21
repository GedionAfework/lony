-- name: GetUserByUsername :one
SELECT * FROM users
WHERE username = $1 AND deleted_at IS NULL;

-- name: GetUserByPhone :one
SELECT * FROM users
WHERE phone_e164 = $1 AND deleted_at IS NULL;

-- name: SearchUsers :many
SELECT id, username, display_name
FROM users
WHERE deleted_at IS NULL
  AND email_verified_at IS NOT NULL
  AND status = 'active'
  AND id <> sqlc.arg('viewer_id')
  AND (
    email = sqlc.arg('query')
    OR username = sqlc.arg('query')
    OR phone_e164 = sqlc.arg('query')
    OR (
      char_length(sqlc.arg('query')::text) >= 2
      AND (
        username ILIKE sqlc.arg('query')::text || '%'
        OR display_name ILIKE '%' || sqlc.arg('query')::text || '%'
      )
    )
  )
ORDER BY display_name
LIMIT 20;

-- name: InsertFriendship :one
INSERT INTO friendships (
  requester_id,
  addressee_id,
  user_low_id,
  user_high_id,
  status
) VALUES (
  $1, $2, $3, $4, $5
)
RETURNING *;

-- name: GetFriendshipByID :one
SELECT * FROM friendships
WHERE id = $1;

-- name: GetFriendshipByPair :one
SELECT * FROM friendships
WHERE user_low_id = $1 AND user_high_id = $2;

-- name: UpdateFriendship :one
UPDATE friendships
SET
  requester_id = $2,
  addressee_id = $3,
  status = $4,
  requested_at = $5,
  accepted_at = $6,
  removed_at = $7,
  blocked_by_user_id = $8,
  updated_at = now()
WHERE id = $1
RETURNING *;

-- name: ListAcceptedFriendships :many
SELECT * FROM friendships
WHERE status = 'accepted'
  AND (requester_id = $1 OR addressee_id = $1)
ORDER BY COALESCE(accepted_at, updated_at) DESC;

-- name: ListIncomingFriendRequests :many
SELECT * FROM friendships
WHERE addressee_id = $1 AND status = 'pending'
ORDER BY requested_at DESC;

-- name: ListOutgoingFriendRequests :many
SELECT * FROM friendships
WHERE requester_id = $1 AND status = 'pending'
ORDER BY requested_at DESC;
