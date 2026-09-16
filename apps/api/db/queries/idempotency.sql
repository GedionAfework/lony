-- name: GetIdempotencyRecord :one
SELECT * FROM idempotency_records
WHERE operation = $1
  AND idempotency_key = $2
  AND user_id IS NOT DISTINCT FROM $3
  AND expires_at > now();

-- name: InsertIdempotencyRecord :one
INSERT INTO idempotency_records (
  user_id,
  idempotency_key,
  operation,
  request_hash,
  response_status,
  response_body_json,
  expires_at
) VALUES (
  $1, $2, $3, $4, $5, $6, $7
)
RETURNING *;
