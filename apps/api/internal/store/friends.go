package store

import (
	"context"
	"strings"

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
	const q = `
SELECT id, requester_id, addressee_id, user_low_id, user_high_id, status,
       requested_at, accepted_at, removed_at, blocked_by_user_id,
       COALESCE(interaction_count, 0), last_interacted_at
FROM friendships
WHERE status = 'accepted' AND (requester_id = $1 OR addressee_id = $1)
ORDER BY COALESCE(interaction_count, 0) DESC, COALESCE(last_interacted_at, accepted_at, updated_at) DESC`
	rows, err := s.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []friends.Record
	for rows.Next() {
		var rec friends.Record
		if err := rows.Scan(
			&rec.ID, &rec.RequesterID, &rec.AddresseeID, &rec.UserLowID, &rec.UserHighID, &rec.Status,
			&rec.RequestedAt, &rec.AcceptedAt, &rec.RemovedAt, &rec.BlockedByUserID,
			&rec.InteractionCount, &rec.LastInteractedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

func (s *SQLStore) EnsureBond(ctx context.Context, a, b uuid.UUID, bump int) (friends.Record, error) {
	if a == b {
		return friends.Record{}, nil
	}
	if bump < 1 {
		bump = 1
	}
	low, high := friends.CanonicalPair(a, b)
	const q = `
INSERT INTO friendships (
  requester_id, addressee_id, user_low_id, user_high_id, status,
  requested_at, accepted_at, interaction_count, last_interacted_at
) VALUES (
  $1, $2, $3, $4, 'accepted', now(), now(), $5, now()
)
ON CONFLICT (user_low_id, user_high_id) DO UPDATE SET
  status = CASE
    WHEN friendships.status = 'blocked' THEN friendships.status
    ELSE 'accepted'
  END,
  accepted_at = CASE
    WHEN friendships.status = 'blocked' THEN friendships.accepted_at
    ELSE COALESCE(friendships.accepted_at, now())
  END,
  removed_at = CASE
    WHEN friendships.status = 'blocked' THEN friendships.removed_at
    ELSE NULL
  END,
  interaction_count = CASE
    WHEN friendships.status = 'blocked' THEN friendships.interaction_count
    ELSE friendships.interaction_count + EXCLUDED.interaction_count
  END,
  last_interacted_at = CASE
    WHEN friendships.status = 'blocked' THEN friendships.last_interacted_at
    ELSE now()
  END,
  updated_at = now()
RETURNING id, requester_id, addressee_id, user_low_id, user_high_id, status,
          requested_at, accepted_at, removed_at, blocked_by_user_id,
          COALESCE(interaction_count, 0), last_interacted_at`
	var rec friends.Record
	err := s.pool.QueryRow(ctx, q, a, b, low, high, bump).Scan(
		&rec.ID, &rec.RequesterID, &rec.AddresseeID, &rec.UserLowID, &rec.UserHighID, &rec.Status,
		&rec.RequestedAt, &rec.AcceptedAt, &rec.RemovedAt, &rec.BlockedByUserID,
		&rec.InteractionCount, &rec.LastInteractedAt,
	)
	return rec, err
}

func (s *SQLStore) ListInteractedPeers(ctx context.Context, userID uuid.UUID, query string, limit int) ([]friends.PeerHit, error) {
	q := strings.ToLower(strings.TrimSpace(query))
	const sql = `
WITH loan_peers AS (
  SELECT
    CASE WHEN l.borrower_id = $1 THEN l.lender_id ELSE l.borrower_id END AS peer_id,
    COUNT(*)::int AS touches
  FROM loans l
  WHERE l.borrower_id <> l.lender_id
    AND (l.borrower_id = $1 OR l.lender_id = $1)
  GROUP BY 1
),
bonded AS (
  SELECT
    CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END AS peer_id,
    f.interaction_count,
    f.status
  FROM friendships f
  WHERE f.status = 'accepted'
    AND (f.requester_id = $1 OR f.addressee_id = $1)
),
merged AS (
  SELECT
    COALESCE(b.peer_id, lp.peer_id) AS peer_id,
    GREATEST(COALESCE(b.interaction_count, 0), COALESCE(lp.touches, 0)) AS interaction_count,
    COALESCE(b.status = 'accepted', false) AS is_bonded
  FROM bonded b
  FULL OUTER JOIN loan_peers lp ON lp.peer_id = b.peer_id
)
SELECT u.id, u.display_name, u.username, m.interaction_count, m.is_bonded
FROM merged m
JOIN users u ON u.id = m.peer_id AND u.deleted_at IS NULL AND u.status = 'active'
WHERE ($2 = '' OR lower(u.display_name) LIKE '%' || $2 || '%' OR lower(COALESCE(u.username,'')) LIKE $2 || '%')
ORDER BY m.interaction_count DESC, u.display_name ASC
LIMIT $3`
	rows, err := s.pool.Query(ctx, sql, userID, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []friends.PeerHit
	for rows.Next() {
		var p friends.PeerHit
		if err := rows.Scan(&p.ID, &p.DisplayName, &p.Username, &p.InteractionCount, &p.IsBonded); err != nil {
			return nil, err
		}
		p.Bond = friends.BondLevel(p.InteractionCount)
		out = append(out, p)
	}
	return out, rows.Err()
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

func (s *SQLStore) UpsertPhoneInvite(ctx context.Context, inviterID uuid.UUID, phoneE164 string) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO phone_invites (inviter_id, phone_e164)
VALUES ($1, $2)
ON CONFLICT (inviter_id, phone_e164) DO UPDATE
SET resolved_at = NULL, resolved_user_id = NULL
WHERE phone_invites.resolved_at IS NOT NULL`, inviterID, phoneE164)
	return err
}

func (s *SQLStore) ListOpenInvitesByPhone(ctx context.Context, phoneE164 string) ([]friends.PhoneInvite, error) {
	const q = `SELECT id, inviter_id, phone_e164 FROM phone_invites
		WHERE phone_e164 = $1 AND resolved_at IS NULL`
	rows, err := s.pool.Query(ctx, q, phoneE164)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []friends.PhoneInvite{}
	for rows.Next() {
		var inv friends.PhoneInvite
		if err := rows.Scan(&inv.ID, &inv.InviterID, &inv.PhoneE164); err != nil {
			return nil, err
		}
		out = append(out, inv)
	}
	return out, rows.Err()
}

func (s *SQLStore) MarkPhoneInviteResolved(ctx context.Context, id, resolvedUserID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `
UPDATE phone_invites
SET resolved_at = now(), resolved_user_id = $2
WHERE id = $1 AND resolved_at IS NULL`, id, resolvedUserID)
	return err
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
