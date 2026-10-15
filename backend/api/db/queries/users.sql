-- name: CreateUser :one
INSERT INTO users (
  email,
  password_hash,
  display_name,
  timezone,
  locale
) VALUES (
  $1, $2, $3, $4, $5
)
RETURNING *;

-- name: GetUserByID :one
SELECT * FROM users
WHERE id = $1 AND deleted_at IS NULL;

-- name: GetUserByEmail :one
SELECT * FROM users
WHERE email = $1 AND deleted_at IS NULL;

-- name: MarkEmailVerified :one
UPDATE users
SET email_verified_at = now(),
    updated_at = now()
WHERE id = $1 AND deleted_at IS NULL
RETURNING *;

-- name: UpdateUserProfile :one
UPDATE users
SET
  display_name = COALESCE(sqlc.narg('display_name'), display_name),
  username = COALESCE(sqlc.narg('username'), username),
  timezone = COALESCE(sqlc.narg('timezone'), timezone),
  locale = COALESCE(sqlc.narg('locale'), locale),
  default_currency_code = COALESCE(sqlc.narg('default_currency_code'), default_currency_code),
  updated_at = now()
WHERE id = sqlc.arg('id') AND deleted_at IS NULL
RETURNING *;
