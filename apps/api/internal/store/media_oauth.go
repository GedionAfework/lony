package store

import (
	"context"
	"time"

	"equilend/api/internal/auth"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type MediaObject struct {
	ID           uuid.UUID
	OwnerUserID  uuid.UUID
	ObjectKey    string
	Kind         string
	MimeType     *string
	OriginalName *string
	ByteSize     int32
	CreatedAt    time.Time
}

func (s *SQLStore) InsertMediaObject(ctx context.Context, owner uuid.UUID, key, kind string, mime, name *string, size int32) (MediaObject, error) {
	row := s.pool.QueryRow(ctx, `
		INSERT INTO media_objects (owner_user_id, object_key, kind, mime_type, original_name, byte_size)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, owner_user_id, object_key, kind, mime_type, original_name, byte_size, created_at
	`, owner, key, kind, mime, name, size)
	return scanMedia(row.Scan)
}

func (s *SQLStore) SaveMediaObject(ctx context.Context, owner uuid.UUID, key, kind string, mime, name *string, size int32) error {
	_, err := s.InsertMediaObject(ctx, owner, key, kind, mime, name, size)
	return err
}

func (s *SQLStore) InsertMediaID(ctx context.Context, owner uuid.UUID, key, kind string, mime, name *string, size int32) (uuid.UUID, error) {
	m, err := s.InsertMediaObject(ctx, owner, key, kind, mime, name, size)
	if err != nil {
		return uuid.Nil, err
	}
	return m.ID, nil
}

func (s *SQLStore) GetMediaObject(ctx context.Context, id uuid.UUID) (MediaObject, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id, owner_user_id, object_key, kind, mime_type, original_name, byte_size, created_at
		FROM media_objects WHERE id = $1
	`, id)
	return scanMedia(row.Scan)
}

func (s *SQLStore) GetMediaByKey(ctx context.Context, key string) (MediaObject, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id, owner_user_id, object_key, kind, mime_type, original_name, byte_size, created_at
		FROM media_objects WHERE object_key = $1
	`, key)
	return scanMedia(row.Scan)
}

func (s *SQLStore) SetUserAvatar(ctx context.Context, userID uuid.UUID, objectKey string) (auth.UserRecord, error) {
	row, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return auth.UserRecord{}, err
	}
	_, err = s.pool.Exec(ctx, `UPDATE users SET avatar_object_key = $2, updated_at = now() WHERE id = $1`, userID, objectKey)
	if err != nil {
		return auth.UserRecord{}, err
	}
	row.AvatarObjectKey = &objectKey
	return s.GetUserByID(ctx, userID)
}

func (s *SQLStore) FindIdentity(ctx context.Context, provider, subject string) (userID uuid.UUID, err error) {
	err = s.pool.QueryRow(ctx, `
		SELECT user_id FROM user_identities WHERE provider = $1 AND subject = $2
	`, provider, subject).Scan(&userID)
	return userID, err
}

func (s *SQLStore) LinkIdentity(ctx context.Context, userID uuid.UUID, provider, subject string, email *string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO user_identities (user_id, provider, subject, email)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (provider, subject) DO NOTHING
	`, userID, provider, subject, email)
	return err
}

func scanMedia(scan func(dest ...any) error) (MediaObject, error) {
	var m MediaObject
	err := scan(&m.ID, &m.OwnerUserID, &m.ObjectKey, &m.Kind, &m.MimeType, &m.OriginalName, &m.ByteSize, &m.CreatedAt)
	if err != nil {
		return MediaObject{}, err
	}
	return m, nil
}

func IsNoRows(err error) bool {
	return err == pgx.ErrNoRows
}
