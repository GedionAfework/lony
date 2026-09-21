package store

import (
	"context"

	"equilend/api/internal/friends"
	"equilend/api/internal/store/sqlc"

	"github.com/google/uuid"
)

func (s *SQLStore) LookupUser(ctx context.Context, id uuid.UUID) (friends.UserRef, error) {
	row, err := s.q.GetUserByID(ctx, id)
	if err != nil {
		return friends.UserRef{}, err
	}
	return mapUserRef(row), nil
}

func (s *SQLStore) LookupByEmail(ctx context.Context, email string) (friends.UserRef, error) {
	row, err := s.q.GetUserByEmail(ctx, email)
	if err != nil {
		return friends.UserRef{}, err
	}
	return mapUserRef(row), nil
}

func (s *SQLStore) LookupByPhone(ctx context.Context, phoneE164 string) (friends.UserRef, error) {
	const q = `SELECT id, email, username, display_name, status, email_verified_at IS NOT NULL
		FROM users WHERE phone_e164 = $1 AND deleted_at IS NULL`
	var u friends.UserRef
	var verified bool
	err := s.pool.QueryRow(ctx, q, phoneE164).Scan(&u.ID, &u.Email, &u.Username, &u.DisplayName, &u.Status, &verified)
	if err != nil {
		return friends.UserRef{}, err
	}
	u.Verified = verified
	return u, nil
}

func (s *SQLStore) LookupByUsername(ctx context.Context, username string) (friends.UserRef, error) {
	row, err := s.q.GetUserByUsername(ctx, username)
	if err != nil {
		return friends.UserRef{}, err
	}
	return mapUserRef(row), nil
}

func (s *SQLStore) SearchUsers(ctx context.Context, viewer uuid.UUID, query string) ([]friends.SearchHit, error) {
	const q = `
SELECT id, username, display_name
FROM users
WHERE deleted_at IS NULL
  AND email_verified_at IS NOT NULL
  AND status = 'active'
  AND id <> $1
  AND (
    email = $2
    OR username = $2
    OR phone_e164 = $2
    OR (
      char_length($2) >= 2
      AND (
        username ILIKE $2 || '%'
        OR display_name ILIKE '%' || $2 || '%'
      )
    )
  )
ORDER BY display_name
LIMIT 20`
	rows, err := s.pool.Query(ctx, q, viewer, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]friends.SearchHit, 0)
	for rows.Next() {
		var hit friends.SearchHit
		if err := rows.Scan(&hit.ID, &hit.Username, &hit.DisplayName); err != nil {
			return nil, err
		}
		out = append(out, hit)
	}
	return out, rows.Err()
}

func (s *SQLStore) InsertFriendship(ctx context.Context, rec friends.Record) (friends.Record, error) {
	row, err := s.q.InsertFriendship(ctx, sqlc.InsertFriendshipParams{
		RequesterID: rec.RequesterID,
		AddresseeID: rec.AddresseeID,
		UserLowID:   rec.UserLowID,
		UserHighID:  rec.UserHighID,
		Status:      rec.Status,
	})
	if err != nil {
		return friends.Record{}, err
	}
	return mapFriendship(row), nil
}

func (s *SQLStore) GetFriendshipByID(ctx context.Context, id uuid.UUID) (friends.Record, error) {
	row, err := s.q.GetFriendshipByID(ctx, id)
	if err != nil {
		return friends.Record{}, err
	}
	return mapFriendship(row), nil
}

func (s *SQLStore) GetFriendshipByPair(ctx context.Context, low, high uuid.UUID) (friends.Record, error) {
	row, err := s.q.GetFriendshipByPair(ctx, sqlc.GetFriendshipByPairParams{UserLowID: low, UserHighID: high})
	if err != nil {
		return friends.Record{}, err
	}
	return mapFriendship(row), nil
}

func (s *SQLStore) UpdateFriendship(ctx context.Context, rec friends.Record) (friends.Record, error) {
	row, err := s.q.UpdateFriendship(ctx, sqlc.UpdateFriendshipParams{
		ID:              rec.ID,
		RequesterID:     rec.RequesterID,
		AddresseeID:     rec.AddresseeID,
		Status:          rec.Status,
		RequestedAt:     rec.RequestedAt,
		AcceptedAt:      rec.AcceptedAt,
		RemovedAt:       rec.RemovedAt,
		BlockedByUserID: rec.BlockedByUserID,
	})
	if err != nil {
		return friends.Record{}, err
	}
	return mapFriendship(row), nil
}

func (s *SQLStore) ListAccepted(ctx context.Context, userID uuid.UUID) ([]friends.Record, error) {
	rows, err := s.q.ListAcceptedFriendships(ctx, userID)
	if err != nil {
		return nil, err
	}
	return mapFriendships(rows), nil
}

func (s *SQLStore) ListIncoming(ctx context.Context, userID uuid.UUID) ([]friends.Record, error) {
	rows, err := s.q.ListIncomingFriendRequests(ctx, userID)
	if err != nil {
		return nil, err
	}
	return mapFriendships(rows), nil
}

func (s *SQLStore) ListOutgoing(ctx context.Context, userID uuid.UUID) ([]friends.Record, error) {
	rows, err := s.q.ListOutgoingFriendRequests(ctx, userID)
	if err != nil {
		return nil, err
	}
	return mapFriendships(rows), nil
}

func mapUserRef(row sqlc.User) friends.UserRef {
	return friends.UserRef{
		ID:          row.ID,
		Email:       row.Email,
		Username:    row.Username,
		DisplayName: row.DisplayName,
		Status:      row.Status,
		Verified:    row.EmailVerifiedAt != nil,
	}
}

func mapFriendship(row sqlc.Friendship) friends.Record {
	return friends.Record{
		ID:              row.ID,
		RequesterID:     row.RequesterID,
		AddresseeID:     row.AddresseeID,
		UserLowID:       row.UserLowID,
		UserHighID:      row.UserHighID,
		Status:          row.Status,
		RequestedAt:     row.RequestedAt,
		AcceptedAt:      row.AcceptedAt,
		RemovedAt:       row.RemovedAt,
		BlockedByUserID: row.BlockedByUserID,
	}
}

func mapFriendships(rows []sqlc.Friendship) []friends.Record {
	out := make([]friends.Record, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapFriendship(row))
	}
	return out
}

var _ friends.Store = (*SQLStore)(nil)
