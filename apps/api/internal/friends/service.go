package friends

import (
	"context"
	"errors"
	"net/http"
	"net/mail"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"equilend/api/internal/httpx"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type Service struct {
	store    Store
	notifier Notifier
	now      func() time.Time
}

type Notifier interface {
	OnFriendRequest(ctx context.Context, addresseeID uuid.UUID) error
	OnFriendAccepted(ctx context.Context, requesterID uuid.UUID) error
}

func NewService(store Store) *Service {
	return &Service{store: store, now: time.Now}
}

func (s *Service) SetNotifier(n Notifier) {
	s.notifier = n
}

func (s *Service) Search(ctx context.Context, viewer uuid.UUID, query string) ([]SearchHit, error) {
	q := strings.TrimSpace(query)
	if utf8.RuneCountInString(q) < 2 {
		return nil, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"q": "must be at least 2 characters",
		})
	}
	return s.store.SearchUsers(ctx, viewer, strings.ToLower(q))
}

func (s *Service) LookupPhone(ctx context.Context, viewer uuid.UUID, phone string) (map[string]any, error) {
	phone = normalizePhoneE164(phone)
	if phone == "" {
		return nil, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"phone": "must be an E.164 phone number",
		})
	}
	u, err := s.store.LookupByPhone(ctx, phone)
	if errors.Is(err, pgx.ErrNoRows) {
		return map[string]any{"found": false, "phone": phone}, nil
	}
	if err != nil {
		return nil, err
	}
	if u.ID == viewer || !u.Verified || u.Status != "active" {
		return map[string]any{"found": false, "phone": phone}, nil
	}
	status := ""
	low, high := CanonicalPair(viewer, u.ID)
	if row, err := s.store.GetFriendshipByPair(ctx, low, high); err == nil {
		status = row.Status
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	return map[string]any{
		"found": true,
		"phone": phone,
		"friendship_status": status,
		"user": SearchHit{
			ID:          u.ID,
			DisplayName: u.DisplayName,
			Username:    u.Username,
		},
	}, nil
}

// InvitePhone remembers a non-user phone so a friend request can sync when they join.
func (s *Service) InvitePhone(ctx context.Context, actor uuid.UUID, phone string) error {
	phone = normalizePhoneE164(phone)
	if phone == "" {
		return httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"phone": "must be an E.164 phone number",
		})
	}
	if _, err := s.store.LookupByPhone(ctx, phone); err == nil {
		return httpx.E(http.StatusConflict, "ALREADY_USER", "this phone already has an account")
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	return s.store.UpsertPhoneInvite(ctx, actor, phone)
}

// ResolvePhoneInvites marks invites resolved when someone joins.
// Bonds form later when a loan/split is accepted — not via friend requests.
func (s *Service) ResolvePhoneInvites(ctx context.Context, userID uuid.UUID, phone string) error {
	phone = normalizePhoneE164(phone)
	if phone == "" {
		return nil
	}
	invites, err := s.store.ListOpenInvitesByPhone(ctx, phone)
	if err != nil {
		return err
	}
	for _, inv := range invites {
		_ = s.store.MarkPhoneInviteResolved(ctx, inv.ID, userID)
	}
	return nil
}

func (s *Service) Request(ctx context.Context, actor uuid.UUID, email, username, phone string, userID *uuid.UUID) (FriendDTO, error) {
	target, err := s.resolveTarget(ctx, actor, email, username, phone, userID)
	if err != nil {
		return FriendDTO{}, err
	}
	if target.ID == actor {
		return FriendDTO{}, httpx.E(http.StatusUnprocessableEntity, "VALIDATION", "you cannot add yourself")
	}
	if !target.Verified || target.Status != "active" {
		return FriendDTO{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "user not found")
	}

	low, high := CanonicalPair(actor, target.ID)
	existing, err := s.store.GetFriendshipByPair(ctx, low, high)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return FriendDTO{}, err
	}
	if err == nil {
		switch existing.Status {
		case StatusBlocked:
			return FriendDTO{}, httpx.E(http.StatusForbidden, "BLOCKED", "you cannot connect with this user")
		case StatusAccepted:
			return FriendDTO{}, httpx.E(http.StatusConflict, "ALREADY_FRIENDS", "you are already connected")
		case StatusPending:
			if existing.AddresseeID == actor {
				return s.Accept(ctx, actor, existing.ID)
			}
			return s.toDTO(ctx, actor, existing)
		case StatusRejected, StatusRemoved:
			now := s.now()
			existing.RequesterID = actor
			existing.AddresseeID = target.ID
			existing.Status = StatusPending
			existing.RequestedAt = now
			existing.AcceptedAt = nil
			existing.RemovedAt = nil
			existing.BlockedByUserID = nil
			updated, err := s.store.UpdateFriendship(ctx, existing)
			if err != nil {
				return FriendDTO{}, err
			}
			if s.notifier != nil {
				_ = s.notifier.OnFriendRequest(ctx, target.ID)
			}
			return s.toDTO(ctx, actor, updated)
		}
	}

	created, err := s.store.InsertFriendship(ctx, Record{
		RequesterID: actor,
		AddresseeID: target.ID,
		UserLowID:   low,
		UserHighID:  high,
		Status:      StatusPending,
		RequestedAt: s.now(),
	})
	if err != nil {
		return FriendDTO{}, err
	}
	if s.notifier != nil {
		_ = s.notifier.OnFriendRequest(ctx, target.ID)
	}
	return s.toDTO(ctx, actor, created)
}

func (s *Service) Accept(ctx context.Context, actor, friendshipID uuid.UUID) (FriendDTO, error) {
	row, err := s.mustGet(ctx, friendshipID)
	if err != nil {
		return FriendDTO{}, err
	}
	if row.AddresseeID != actor {
		return FriendDTO{}, httpx.E(http.StatusForbidden, "FORBIDDEN", "only the recipient can accept this request")
	}
	if row.Status != StatusPending {
		return FriendDTO{}, httpx.E(http.StatusConflict, "INVALID_STATE", "this request cannot be accepted")
	}
	now := s.now()
	row.Status = StatusAccepted
	row.AcceptedAt = &now
	updated, err := s.store.UpdateFriendship(ctx, row)
	if err != nil {
		return FriendDTO{}, err
	}
	if s.notifier != nil {
		_ = s.notifier.OnFriendAccepted(ctx, row.RequesterID)
	}
	return s.toDTO(ctx, actor, updated)
}

func (s *Service) Reject(ctx context.Context, actor, friendshipID uuid.UUID) (FriendDTO, error) {
	row, err := s.mustGet(ctx, friendshipID)
	if err != nil {
		return FriendDTO{}, err
	}
	if row.AddresseeID != actor {
		return FriendDTO{}, httpx.E(http.StatusForbidden, "FORBIDDEN", "only the recipient can reject this request")
	}
	if row.Status != StatusPending {
		return FriendDTO{}, httpx.E(http.StatusConflict, "INVALID_STATE", "this request cannot be rejected")
	}
	row.Status = StatusRejected
	updated, err := s.store.UpdateFriendship(ctx, row)
	if err != nil {
		return FriendDTO{}, err
	}
	return s.toDTO(ctx, actor, updated)
}

func (s *Service) Remove(ctx context.Context, actor, friendshipID uuid.UUID) (FriendDTO, error) {
	row, err := s.mustGet(ctx, friendshipID)
	if err != nil {
		return FriendDTO{}, err
	}
	if row.RequesterID != actor && row.AddresseeID != actor {
		return FriendDTO{}, httpx.E(http.StatusForbidden, "FORBIDDEN", "not a party to this connection")
	}
	if row.Status != StatusAccepted {
		return FriendDTO{}, httpx.E(http.StatusConflict, "INVALID_STATE", "only an accepted connection can be removed")
	}
	now := s.now()
	row.Status = StatusRemoved
	row.RemovedAt = &now
	updated, err := s.store.UpdateFriendship(ctx, row)
	if err != nil {
		return FriendDTO{}, err
	}
	return s.toDTO(ctx, actor, updated)
}

func (s *Service) Block(ctx context.Context, actor, targetID uuid.UUID) (FriendDTO, error) {
	if actor == targetID {
		return FriendDTO{}, httpx.E(http.StatusUnprocessableEntity, "VALIDATION", "you cannot block yourself")
	}
	if _, err := s.store.LookupUser(ctx, targetID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return FriendDTO{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "user not found")
		}
		return FriendDTO{}, err
	}
	low, high := CanonicalPair(actor, targetID)
	existing, err := s.store.GetFriendshipByPair(ctx, low, high)
	now := s.now()
	if errors.Is(err, pgx.ErrNoRows) {
		created, err := s.store.InsertFriendship(ctx, Record{
			RequesterID:     actor,
			AddresseeID:     targetID,
			UserLowID:       low,
			UserHighID:      high,
			Status:          StatusBlocked,
			RequestedAt:     now,
			BlockedByUserID: &actor,
		})
		if err != nil {
			return FriendDTO{}, err
		}
		return s.toDTO(ctx, actor, created)
	}
	if err != nil {
		return FriendDTO{}, err
	}
	existing.Status = StatusBlocked
	existing.BlockedByUserID = &actor
	updated, err := s.store.UpdateFriendship(ctx, existing)
	if err != nil {
		return FriendDTO{}, err
	}
	return s.toDTO(ctx, actor, updated)
}

func (s *Service) ListFriends(ctx context.Context, actor uuid.UUID) ([]FriendDTO, error) {
	rows, err := s.store.ListAccepted(ctx, actor)
	if err != nil {
		return nil, err
	}
	out, err := s.mapDTOs(ctx, actor, rows)
	if err != nil {
		return nil, err
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].InteractionCount == out[j].InteractionCount {
			return out[i].Peer.DisplayName < out[j].Peer.DisplayName
		}
		return out[i].InteractionCount > out[j].InteractionCount
	})
	return out, nil
}

// ListPeers returns people the actor has already interacted with (ranked), optionally filtered by q.
func (s *Service) ListPeers(ctx context.Context, actor uuid.UUID, query string, limit int) ([]PeerHit, error) {
	if limit <= 0 || limit > 50 {
		limit = 30
	}
	return s.store.ListInteractedPeers(ctx, actor, strings.TrimSpace(query), limit)
}

// OnLoanAccepted creates/upgrades a bond when a peer loan or expense-split is accepted.
func (s *Service) OnLoanAccepted(ctx context.Context, borrowerID, lenderID uuid.UUID) error {
	if borrowerID == uuid.Nil || lenderID == uuid.Nil || borrowerID == lenderID {
		return nil
	}
	_, err := s.store.EnsureBond(ctx, borrowerID, lenderID, 1)
	return err
}

// OnRepaymentConfirmed strengthens the bond after confirmed repayment.
func (s *Service) OnRepaymentConfirmed(ctx context.Context, borrowerID, lenderID uuid.UUID) error {
	if borrowerID == uuid.Nil || lenderID == uuid.Nil || borrowerID == lenderID {
		return nil
	}
	_, err := s.store.EnsureBond(ctx, borrowerID, lenderID, 1)
	return err
}

func BondLevel(interactionCount int) string {
	switch {
	case interactionCount >= 10:
		return "close"
	case interactionCount >= 3:
		return "friend"
	default:
		return "acquaintance"
	}
}

func (s *Service) ListIncoming(ctx context.Context, actor uuid.UUID) ([]FriendDTO, error) {
	rows, err := s.store.ListIncoming(ctx, actor)
	if err != nil {
		return nil, err
	}
	return s.mapDTOs(ctx, actor, rows)
}

func (s *Service) ListOutgoing(ctx context.Context, actor uuid.UUID) ([]FriendDTO, error) {
	rows, err := s.store.ListOutgoing(ctx, actor)
	if err != nil {
		return nil, err
	}
	return s.mapDTOs(ctx, actor, rows)
}

func (s *Service) CanCreateLoan(ctx context.Context, a, b uuid.UUID) (bool, error) {
	if a == b {
		return false, nil
	}
	low, high := CanonicalPair(a, b)
	row, err := s.store.GetFriendshipByPair(ctx, low, high)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return row.Status == StatusAccepted, nil
}

func (s *Service) resolveTarget(ctx context.Context, actor uuid.UUID, email, username, phone string, userID *uuid.UUID) (UserRef, error) {
	email = strings.TrimSpace(strings.ToLower(email))
	username = strings.TrimSpace(strings.ToLower(username))
	phone = normalizePhoneE164(phone)
	switch {
	case userID != nil:
		u, err := s.store.LookupUser(ctx, *userID)
		if errors.Is(err, pgx.ErrNoRows) {
			return UserRef{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "user not found")
		}
		return u, err
	case email != "":
		if _, err := mail.ParseAddress(email); err != nil {
			return UserRef{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"email": "must be a valid email address",
			})
		}
		u, err := s.store.LookupByEmail(ctx, email)
		if errors.Is(err, pgx.ErrNoRows) {
			return UserRef{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "user not found")
		}
		return u, err
	case phone != "":
		u, err := s.store.LookupByPhone(ctx, phone)
		if errors.Is(err, pgx.ErrNoRows) {
			return UserRef{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "user not found")
		}
		return u, err
	case username != "":
		u, err := s.store.LookupByUsername(ctx, username)
		if errors.Is(err, pgx.ErrNoRows) {
			return UserRef{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "user not found")
		}
		return u, err
	default:
		_ = actor
		return UserRef{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"email": "provide email, username, phone, or user_id",
		})
	}
}

func normalizePhoneE164(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	var b strings.Builder
	if strings.HasPrefix(raw, "+") {
		b.WriteByte('+')
		raw = raw[1:]
	}
	for _, r := range raw {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	out := b.String()
	if !strings.HasPrefix(out, "+") {
		if len(out) < 8 {
			return ""
		}
		out = "+" + out
	}
	digits := strings.TrimPrefix(out, "+")
	if len(digits) < 8 || len(digits) > 15 {
		return ""
	}
	return out
}

func (s *Service) mustGet(ctx context.Context, id uuid.UUID) (Record, error) {
	row, err := s.store.GetFriendshipByID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return Record{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "connection not found")
	}
	return row, err
}

func (s *Service) mapDTOs(ctx context.Context, actor uuid.UUID, rows []Record) ([]FriendDTO, error) {
	out := make([]FriendDTO, 0, len(rows))
	for _, row := range rows {
		dto, err := s.toDTO(ctx, actor, row)
		if err != nil {
			return nil, err
		}
		out = append(out, dto)
	}
	return out, nil
}

func (s *Service) toDTO(ctx context.Context, actor uuid.UUID, row Record) (FriendDTO, error) {
	otherID := OtherParty(actor, row.RequesterID, row.AddresseeID)
	peer, err := s.store.LookupUser(ctx, otherID)
	if err != nil {
		return FriendDTO{}, err
	}
	return FriendDTO{
		ID:               row.ID,
		Status:           row.Status,
		RequestedAt:      row.RequestedAt,
		AcceptedAt:       row.AcceptedAt,
		InteractionCount: row.InteractionCount,
		Bond:             BondLevel(row.InteractionCount),
		Peer: SearchHit{
			ID:          peer.ID,
			DisplayName: peer.DisplayName,
			Username:    peer.Username,
		},
	}, nil
}
