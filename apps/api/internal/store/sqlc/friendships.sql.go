package sqlc

import (
	"context"
	"time"

	"github.com/google/uuid"
)

func scanFriendship(scan func(dest ...any) error) (Friendship, error) {
	var i Friendship
	err := scan(
		&i.ID,
		&i.RequesterID,
		&i.AddresseeID,
		&i.UserLowID,
		&i.UserHighID,
		&i.Status,
		&i.RequestedAt,
		&i.AcceptedAt,
		&i.RemovedAt,
		&i.BlockedByUserID,
		&i.CreatedAt,
		&i.UpdatedAt,
	)
	return i, err
}

const getUserByUsername = `-- name: GetUserByUsername :one
SELECT id, email, phone_e164, username, display_name, avatar_object_key, timezone, locale, default_currency_code, password_hash, email_verified_at, status, created_at, updated_at, deleted_at FROM users
WHERE username = $1 AND deleted_at IS NULL
`

func (q *Queries) GetUserByUsername(ctx context.Context, username string) (User, error) {
	row := q.db.QueryRow(ctx, getUserByUsername, username)
	var i User
	err := row.Scan(
		&i.ID,
		&i.Email,
		&i.PhoneE164,
		&i.Username,
		&i.DisplayName,
		&i.AvatarObjectKey,
		&i.Timezone,
		&i.Locale,
		&i.DefaultCurrencyCode,
		&i.PasswordHash,
		&i.EmailVerifiedAt,
		&i.Status,
		&i.CreatedAt,
		&i.UpdatedAt,
		&i.DeletedAt,
	)
	return i, err
}

const searchUsers = `-- name: SearchUsers :many
SELECT id, username, display_name
FROM users
WHERE deleted_at IS NULL
  AND email_verified_at IS NOT NULL
  AND status = 'active'
  AND id <> $1
  AND (
    email = $2
    OR username = $2
    OR (
      char_length($2::text) >= 2
      AND (
        username ILIKE $2::text || '%'
        OR display_name ILIKE '%' || $2::text || '%'
      )
    )
  )
ORDER BY display_name
LIMIT 20
`

type SearchUsersParams struct {
	ViewerID uuid.UUID `json:"viewer_id"`
	Query    string    `json:"query"`
}

type SearchUsersRow struct {
	ID          uuid.UUID `json:"id"`
	Username    *string   `json:"username"`
	DisplayName string    `json:"display_name"`
}

func (q *Queries) SearchUsers(ctx context.Context, arg SearchUsersParams) ([]SearchUsersRow, error) {
	rows, err := q.db.Query(ctx, searchUsers, arg.ViewerID, arg.Query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []SearchUsersRow
	for rows.Next() {
		var i SearchUsersRow
		if err := rows.Scan(&i.ID, &i.Username, &i.DisplayName); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	return items, rows.Err()
}

const insertFriendship = `-- name: InsertFriendship :one
INSERT INTO friendships (
  requester_id, addressee_id, user_low_id, user_high_id, status
) VALUES ($1, $2, $3, $4, $5)
RETURNING id, requester_id, addressee_id, user_low_id, user_high_id, status, requested_at, accepted_at, removed_at, blocked_by_user_id, created_at, updated_at
`

type InsertFriendshipParams struct {
	RequesterID uuid.UUID `json:"requester_id"`
	AddresseeID uuid.UUID `json:"addressee_id"`
	UserLowID   uuid.UUID `json:"user_low_id"`
	UserHighID  uuid.UUID `json:"user_high_id"`
	Status      string    `json:"status"`
}

func (q *Queries) InsertFriendship(ctx context.Context, arg InsertFriendshipParams) (Friendship, error) {
	row := q.db.QueryRow(ctx, insertFriendship, arg.RequesterID, arg.AddresseeID, arg.UserLowID, arg.UserHighID, arg.Status)
	return scanFriendship(row.Scan)
}

const getFriendshipByID = `-- name: GetFriendshipByID :one
SELECT id, requester_id, addressee_id, user_low_id, user_high_id, status, requested_at, accepted_at, removed_at, blocked_by_user_id, created_at, updated_at FROM friendships
WHERE id = $1
`

func (q *Queries) GetFriendshipByID(ctx context.Context, id uuid.UUID) (Friendship, error) {
	row := q.db.QueryRow(ctx, getFriendshipByID, id)
	return scanFriendship(row.Scan)
}

const getFriendshipByPair = `-- name: GetFriendshipByPair :one
SELECT id, requester_id, addressee_id, user_low_id, user_high_id, status, requested_at, accepted_at, removed_at, blocked_by_user_id, created_at, updated_at FROM friendships
WHERE user_low_id = $1 AND user_high_id = $2
`

type GetFriendshipByPairParams struct {
	UserLowID  uuid.UUID `json:"user_low_id"`
	UserHighID uuid.UUID `json:"user_high_id"`
}

func (q *Queries) GetFriendshipByPair(ctx context.Context, arg GetFriendshipByPairParams) (Friendship, error) {
	row := q.db.QueryRow(ctx, getFriendshipByPair, arg.UserLowID, arg.UserHighID)
	return scanFriendship(row.Scan)
}

const updateFriendship = `-- name: UpdateFriendship :one
UPDATE friendships
SET requester_id = $2, addressee_id = $3, status = $4, requested_at = $5, accepted_at = $6, removed_at = $7, blocked_by_user_id = $8, updated_at = now()
WHERE id = $1
RETURNING id, requester_id, addressee_id, user_low_id, user_high_id, status, requested_at, accepted_at, removed_at, blocked_by_user_id, created_at, updated_at
`

type UpdateFriendshipParams struct {
	ID              uuid.UUID  `json:"id"`
	RequesterID     uuid.UUID  `json:"requester_id"`
	AddresseeID     uuid.UUID  `json:"addressee_id"`
	Status          string     `json:"status"`
	RequestedAt     time.Time  `json:"requested_at"`
	AcceptedAt      *time.Time `json:"accepted_at"`
	RemovedAt       *time.Time `json:"removed_at"`
	BlockedByUserID *uuid.UUID `json:"blocked_by_user_id"`
}

func (q *Queries) UpdateFriendship(ctx context.Context, arg UpdateFriendshipParams) (Friendship, error) {
	row := q.db.QueryRow(ctx, updateFriendship,
		arg.ID, arg.RequesterID, arg.AddresseeID, arg.Status, arg.RequestedAt, arg.AcceptedAt, arg.RemovedAt, arg.BlockedByUserID,
	)
	return scanFriendship(row.Scan)
}

func listFriendships(ctx context.Context, q *Queries, sql string, arg any) ([]Friendship, error) {
	rows, err := q.db.Query(ctx, sql, arg)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []Friendship
	for rows.Next() {
		item, err := scanFriendship(rows.Scan)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

const listAcceptedFriendships = `-- name: ListAcceptedFriendships :many
SELECT id, requester_id, addressee_id, user_low_id, user_high_id, status, requested_at, accepted_at, removed_at, blocked_by_user_id, created_at, updated_at FROM friendships
WHERE status = 'accepted' AND (requester_id = $1 OR addressee_id = $1)
ORDER BY COALESCE(accepted_at, updated_at) DESC
`

func (q *Queries) ListAcceptedFriendships(ctx context.Context, userID uuid.UUID) ([]Friendship, error) {
	return listFriendships(ctx, q, listAcceptedFriendships, userID)
}

const listIncomingFriendRequests = `-- name: ListIncomingFriendRequests :many
SELECT id, requester_id, addressee_id, user_low_id, user_high_id, status, requested_at, accepted_at, removed_at, blocked_by_user_id, created_at, updated_at FROM friendships
WHERE addressee_id = $1 AND status = 'pending'
ORDER BY requested_at DESC
`

func (q *Queries) ListIncomingFriendRequests(ctx context.Context, addresseeID uuid.UUID) ([]Friendship, error) {
	return listFriendships(ctx, q, listIncomingFriendRequests, addresseeID)
}

const listOutgoingFriendRequests = `-- name: ListOutgoingFriendRequests :many
SELECT id, requester_id, addressee_id, user_low_id, user_high_id, status, requested_at, accepted_at, removed_at, blocked_by_user_id, created_at, updated_at FROM friendships
WHERE requester_id = $1 AND status = 'pending'
ORDER BY requested_at DESC
`

func (q *Queries) ListOutgoingFriendRequests(ctx context.Context, requesterID uuid.UUID) ([]Friendship, error) {
	return listFriendships(ctx, q, listOutgoingFriendRequests, requesterID)
}
