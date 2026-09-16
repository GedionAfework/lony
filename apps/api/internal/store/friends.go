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

func (s *SQLStore) LookupByUsername(ctx context.Context, username string) (friends.UserRef, error) {
	row, err := s.q.GetUserByUsername(ctx, username)
	if err != nil {
		return friends.UserRef{}, err
	}
	return mapUserRef(row), nil
}

func (s *SQLStore) SearchUsers(ctx context.Context, viewer uuid.UUID, query string) ([]friends.SearchHit, error) {
	rows, err := s.q.SearchUsers(ctx, sqlc.SearchUsersParams{ViewerID: viewer, Query: query})
	if err != nil {
		return nil, err
	}
	out := make([]friends.SearchHit, 0, len(rows))
	for _, row := range rows {
		out = append(out, friends.SearchHit{ID: row.ID, DisplayName: row.DisplayName, Username: row.Username})
	}
	return out, nil
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
