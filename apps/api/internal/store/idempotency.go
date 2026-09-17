package store

import (
	"context"
	"time"

	"equilend/api/internal/store/sqlc"

	"github.com/google/uuid"
)

type IdempotencyRecord struct {
	ID               uuid.UUID
	UserID           *uuid.UUID
	IdempotencyKey   string
	Operation        string
	RequestHash      string
	ResponseStatus   int
	ResponseBodyJSON []byte
	CreatedAt        time.Time
	ExpiresAt        time.Time
}

func (s *SQLStore) GetIdempotency(ctx context.Context, userID *uuid.UUID, operation, key string) (IdempotencyRecord, error) {
	row, err := s.q.GetIdempotencyRecord(ctx, sqlc.GetIdempotencyRecordParams{
		Operation: operation, IdempotencyKey: key, UserID: userID,
	})
	if err != nil {
		return IdempotencyRecord{}, err
	}
	return mapIdempotency(row), nil
}

func (s *SQLStore) SaveIdempotency(ctx context.Context, rec IdempotencyRecord) error {
	_, err := s.q.InsertIdempotencyRecord(ctx, sqlc.InsertIdempotencyRecordParams{
		UserID:           rec.UserID,
		IdempotencyKey:   rec.IdempotencyKey,
		Operation:        rec.Operation,
		RequestHash:      rec.RequestHash,
		ResponseStatus:   int32(rec.ResponseStatus),
		ResponseBodyJson: rec.ResponseBodyJSON,
		ExpiresAt:        rec.ExpiresAt,
	})
	return err
}

func mapIdempotency(row sqlc.IdempotencyRecord) IdempotencyRecord {
	return IdempotencyRecord{
		ID: row.ID, UserID: row.UserID, IdempotencyKey: row.IdempotencyKey,
		Operation: row.Operation, RequestHash: row.RequestHash,
		ResponseStatus: int(row.ResponseStatus), ResponseBodyJSON: row.ResponseBodyJson,
		CreatedAt: row.CreatedAt, ExpiresAt: row.ExpiresAt,
	}
}
