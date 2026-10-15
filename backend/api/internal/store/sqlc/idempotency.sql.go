package sqlc

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type GetIdempotencyRecordParams struct {
	Operation      string     `json:"operation"`
	IdempotencyKey string     `json:"idempotency_key"`
	UserID         *uuid.UUID `json:"user_id"`
}

func (q *Queries) GetIdempotencyRecord(ctx context.Context, arg GetIdempotencyRecordParams) (IdempotencyRecord, error) {
	const query = `-- name: GetIdempotencyRecord :one
SELECT id, user_id, idempotency_key, operation, request_hash, response_status, response_body_json, created_at, expires_at
FROM idempotency_records
WHERE operation = $1
  AND idempotency_key = $2
  AND user_id IS NOT DISTINCT FROM $3
  AND expires_at > now()
`
	row := q.db.QueryRow(ctx, query, arg.Operation, arg.IdempotencyKey, arg.UserID)
	var i IdempotencyRecord
	err := row.Scan(
		&i.ID, &i.UserID, &i.IdempotencyKey, &i.Operation, &i.RequestHash,
		&i.ResponseStatus, &i.ResponseBodyJson, &i.CreatedAt, &i.ExpiresAt,
	)
	return i, err
}

type InsertIdempotencyRecordParams struct {
	UserID           *uuid.UUID `json:"user_id"`
	IdempotencyKey   string     `json:"idempotency_key"`
	Operation        string     `json:"operation"`
	RequestHash      string     `json:"request_hash"`
	ResponseStatus   int32      `json:"response_status"`
	ResponseBodyJson []byte     `json:"response_body_json"`
	ExpiresAt        time.Time  `json:"expires_at"`
}

func (q *Queries) InsertIdempotencyRecord(ctx context.Context, arg InsertIdempotencyRecordParams) (IdempotencyRecord, error) {
	const query = `-- name: InsertIdempotencyRecord :one
INSERT INTO idempotency_records (
  user_id, idempotency_key, operation, request_hash, response_status, response_body_json, expires_at
) VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, user_id, idempotency_key, operation, request_hash, response_status, response_body_json, created_at, expires_at
`
	row := q.db.QueryRow(ctx, query,
		arg.UserID, arg.IdempotencyKey, arg.Operation, arg.RequestHash, arg.ResponseStatus, arg.ResponseBodyJson, arg.ExpiresAt,
	)
	var i IdempotencyRecord
	err := row.Scan(
		&i.ID, &i.UserID, &i.IdempotencyKey, &i.Operation, &i.RequestHash,
		&i.ResponseStatus, &i.ResponseBodyJson, &i.CreatedAt, &i.ExpiresAt,
	)
	return i, err
}
