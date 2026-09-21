package chat

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"equilend/api/internal/httpx"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const (
	KindNone  = "none"
	KindImage = "image"
	KindFile  = "file"
	KindVoice = "voice"
)

type FriendshipGate interface {
	CanCreateLoan(ctx context.Context, a, b uuid.UUID) (bool, error)
}

// LoanParty resolves the counterparty for a loan the actor is on.
type LoanParty interface {
	LoanPeer(ctx context.Context, actor, loanID uuid.UUID) (peerID uuid.UUID, ref string, err error)
}

type Peer struct {
	ID          uuid.UUID `json:"id"`
	DisplayName string    `json:"display_name"`
}

type Conversation struct {
	ID            uuid.UUID
	UserLowID     uuid.UUID
	UserHighID    uuid.UUID
	LoanID        *uuid.UUID
	LastMessageAt *time.Time
	CreatedAt     time.Time
}

type ConversationListRow struct {
	Conversation
	LastBody           *string
	LastAttachmentKind *string
	LastSenderID       *uuid.UUID
	LastCreatedAt      *time.Time
	UnreadCount        int32
}

type Message struct {
	ID                  uuid.UUID
	ConversationID      uuid.UUID
	SenderID            uuid.UUID
	Body                *string
	ReplyToMessageID    *uuid.UUID
	AttachmentKind      string
	AttachmentName      *string
	AttachmentMIME      *string
	AttachmentSize      *int32
	AttachmentObjectKey *string
	VoiceDurationMs     *int32
	CreatedAt           time.Time
}

type Reaction struct {
	MessageID uuid.UUID
	UserID    uuid.UUID
	Emoji     string
	CreatedAt time.Time
}

type Store interface {
	GetConversationByPair(ctx context.Context, low, high uuid.UUID) (Conversation, error)
	GetConversationByLoan(ctx context.Context, loanID uuid.UUID) (Conversation, error)
	GetConversationByID(ctx context.Context, id uuid.UUID) (Conversation, error)
	InsertConversation(ctx context.Context, low, high uuid.UUID, loanID *uuid.UUID) (Conversation, error)
	InsertMembers(ctx context.Context, conversationID, a, b uuid.UUID) error
	IsMember(ctx context.Context, conversationID, userID uuid.UUID) (bool, error)
	ListConversations(ctx context.Context, userID uuid.UUID) ([]ConversationListRow, error)
	TouchConversation(ctx context.Context, id uuid.UUID, at time.Time) error
	MarkConversationRead(ctx context.Context, conversationID, userID uuid.UUID, at time.Time) error
	InsertMessage(ctx context.Context, msg Message) (Message, error)
	GetMessage(ctx context.Context, id uuid.UUID) (Message, error)
	ListMessages(ctx context.Context, conversationID uuid.UUID, after *time.Time, limit int32) ([]Message, error)
	SoftDeleteMessage(ctx context.Context, id, senderID uuid.UUID) (Message, error)
	UpsertReaction(ctx context.Context, messageID, userID uuid.UUID, emoji string) (Reaction, error)
	DeleteReaction(ctx context.Context, messageID, userID uuid.UUID, emoji string) error
	ListReactions(ctx context.Context, messageIDs []uuid.UUID) ([]Reaction, error)
	GetUserPeer(ctx context.Context, id uuid.UUID) (Peer, error)
	CanAccessMediaKey(ctx context.Context, userID uuid.UUID, objectKey string) (bool, error)
}

type MediaStore interface {
	Save(ctx context.Context, filename, mime string, data []byte) (objectKey string, size int, err error)
	Path(objectKey string) (string, error)
}

type Service struct {
	store Store
	media MediaStore
	gate  FriendshipGate
	loans LoanParty
	now   func() time.Time
}

func NewService(store Store, media MediaStore, gate FriendshipGate) *Service {
	return &Service{store: store, media: media, gate: gate, now: time.Now}
}

func (s *Service) SetLoans(loans LoanParty) {
	s.loans = loans
}

type ConversationDTO struct {
	ID                 uuid.UUID  `json:"id"`
	Peer               Peer       `json:"peer"`
	LoanID             *uuid.UUID `json:"loan_id,omitempty"`
	LastMessagePreview string     `json:"last_message_preview,omitempty"`
	LastMessageAt      *time.Time `json:"last_message_at,omitempty"`
	UnreadCount        int        `json:"unread_count"`
	CreatedAt          time.Time  `json:"created_at"`
}

type ReactionDTO struct {
	Emoji string `json:"emoji"`
	Count int    `json:"count"`
	Mine  bool   `json:"mine"`
}

type MessageDTO struct {
	ID               uuid.UUID     `json:"id"`
	ConversationID   uuid.UUID     `json:"conversation_id"`
	SenderID         uuid.UUID     `json:"sender_id"`
	Mine             bool          `json:"mine"`
	Body             *string       `json:"body,omitempty"`
	ReplyTo          *MessageDTO   `json:"reply_to,omitempty"`
	AttachmentKind   string        `json:"attachment_kind"`
	AttachmentName   *string       `json:"attachment_name,omitempty"`
	AttachmentMIME   *string       `json:"attachment_mime,omitempty"`
	AttachmentSize   *int32        `json:"attachment_size,omitempty"`
	AttachmentURL    *string       `json:"attachment_url,omitempty"`
	VoiceDurationMs  *int32        `json:"voice_duration_ms,omitempty"`
	Reactions        []ReactionDTO `json:"reactions"`
	CreatedAt        time.Time     `json:"created_at"`
}

type SendInput struct {
	Body             *string
	ReplyToMessageID *uuid.UUID
	AttachmentKind   string
	AttachmentName   string
	AttachmentMIME   string
	AttachmentBytes  []byte
	VoiceDurationMs  *int32
}

func CanonicalPair(a, b uuid.UUID) (uuid.UUID, uuid.UUID) {
	if a.String() < b.String() {
		return a, b
	}
	return b, a
}

func (s *Service) OpenOrCreate(ctx context.Context, actor, peerID uuid.UUID) (ConversationDTO, error) {
	if peerID == uuid.Nil {
		return ConversationDTO{}, httpx.E(422, "VALIDATION", "choose a friend to chat with")
	}
	selfNotes := peerID == actor
	if !selfNotes {
		ok, err := s.gate.CanCreateLoan(ctx, actor, peerID)
		if err != nil {
			return ConversationDTO{}, err
		}
		if !ok {
			return ConversationDTO{}, httpx.E(403, "NOT_FRIENDS", "you can only chat with accepted friends")
		}
	}
	low, high := CanonicalPair(actor, peerID)
	conv, err := s.store.GetConversationByPair(ctx, low, high)
	if err == nil {
		return s.toConversationDTO(ctx, actor, ConversationListRow{Conversation: conv})
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return ConversationDTO{}, err
	}
	conv, err = s.store.InsertConversation(ctx, low, high, nil)
	if err != nil {
		return ConversationDTO{}, err
	}
	if err := s.store.InsertMembers(ctx, conv.ID, actor, peerID); err != nil {
		return ConversationDTO{}, err
	}
	return s.toConversationDTO(ctx, actor, ConversationListRow{Conversation: conv})
}

// OpenForLoan opens (or creates) a loan-scoped thread between lender and borrower.
func (s *Service) OpenForLoan(ctx context.Context, actor, loanID uuid.UUID) (ConversationDTO, error) {
	if s.loans == nil {
		return ConversationDTO{}, httpx.E(500, "LOANS_UNAVAILABLE", "loan chat is not configured")
	}
	peerID, ref, err := s.loans.LoanPeer(ctx, actor, loanID)
	if err != nil {
		return ConversationDTO{}, err
	}
	conv, err := s.store.GetConversationByLoan(ctx, loanID)
	if err == nil {
		return s.toConversationDTO(ctx, actor, ConversationListRow{Conversation: conv})
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return ConversationDTO{}, err
	}
	low, high := CanonicalPair(actor, peerID)
	lid := loanID
	conv, err = s.store.InsertConversation(ctx, low, high, &lid)
	if err != nil {
		// race: another party created it
		if existing, gerr := s.store.GetConversationByLoan(ctx, loanID); gerr == nil {
			return s.toConversationDTO(ctx, actor, ConversationListRow{Conversation: existing})
		}
		return ConversationDTO{}, err
	}
	if err := s.store.InsertMembers(ctx, conv.ID, actor, peerID); err != nil {
		return ConversationDTO{}, err
	}
	body := fmt.Sprintf("Chat for loan %s. Money still moves outside Lony.", ref)
	_, _ = s.Send(ctx, actor, conv.ID, SendInput{Body: &body})
	return s.toConversationDTO(ctx, actor, ConversationListRow{Conversation: conv})
}

// NotifyBankSharedInChat opens the friend DM and posts a masked payment-profile note (never the full account).
func (s *Service) NotifyBankSharedInChat(ctx context.Context, owner, recipient uuid.UUID, ref, last4, label string) error {
	conv, err := s.OpenOrCreate(ctx, owner, recipient)
	if err != nil {
		return err
	}
	label = strings.TrimSpace(label)
	if label == "" {
		label = "payment profile"
	}
	body := fmt.Sprintf("Shared %s (••••%s) for %s. Open Banks → Shared with me to reveal after a fresh sign-in.", label, last4, ref)
	_, err = s.Send(ctx, owner, conv.ID, SendInput{Body: &body})
	return err
}

// CanAccessMedia checks conversation membership, avatar ownership, or repayment proof party.
func (s *Service) CanAccessMedia(ctx context.Context, actor uuid.UUID, objectKey string) (bool, error) {
	objectKey = strings.TrimSpace(objectKey)
	if objectKey == "" {
		return false, nil
	}
	return s.store.CanAccessMediaKey(ctx, actor, objectKey)
}

func (s *Service) List(ctx context.Context, actor uuid.UUID) ([]ConversationDTO, error) {
	rows, err := s.store.ListConversations(ctx, actor)
	if err != nil {
		return nil, err
	}
	out := make([]ConversationDTO, 0, len(rows))
	for _, row := range rows {
		dto, err := s.toConversationDTO(ctx, actor, row)
		if err != nil {
			return nil, err
		}
		out = append(out, dto)
	}
	return out, nil
}

func (s *Service) ListMessages(ctx context.Context, actor, conversationID uuid.UUID, after *time.Time, limit int32) ([]MessageDTO, error) {
	if err := s.requireMember(ctx, conversationID, actor); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.store.ListMessages(ctx, conversationID, after, limit)
	if err != nil {
		return nil, err
	}
	_ = s.store.MarkConversationRead(ctx, conversationID, actor, s.now().UTC())
	return s.mapMessages(ctx, actor, rows)
}

func (s *Service) Send(ctx context.Context, actor, conversationID uuid.UUID, in SendInput) (MessageDTO, error) {
	if err := s.requireMember(ctx, conversationID, actor); err != nil {
		return MessageDTO{}, err
	}
	kind := in.AttachmentKind
	if kind == "" {
		kind = KindNone
	}
	body := trimPtr(in.Body)
	msg := Message{
		ConversationID:   conversationID,
		SenderID:         actor,
		Body:             body,
		ReplyToMessageID: in.ReplyToMessageID,
		AttachmentKind:   kind,
		VoiceDurationMs:  in.VoiceDurationMs,
	}
	if in.ReplyToMessageID != nil {
		reply, err := s.store.GetMessage(ctx, *in.ReplyToMessageID)
		if err != nil {
			return MessageDTO{}, httpx.E(404, "NOT_FOUND", "reply target not found")
		}
		if reply.ConversationID != conversationID {
			return MessageDTO{}, httpx.E(422, "VALIDATION", "reply must be in the same conversation")
		}
	}
	if kind != KindNone {
		if s.media == nil {
			return MessageDTO{}, httpx.E(500, "MEDIA_UNAVAILABLE", "media storage is not configured")
		}
		if len(in.AttachmentBytes) == 0 {
			return MessageDTO{}, httpx.E(422, "VALIDATION", "attachment data is required")
		}
		if len(in.AttachmentBytes) > 15<<20 {
			return MessageDTO{}, httpx.E(413, "TOO_LARGE", "attachments are limited to 15MB")
		}
		key, size, err := s.media.Save(ctx, in.AttachmentName, in.AttachmentMIME, in.AttachmentBytes)
		if err != nil {
			return MessageDTO{}, err
		}
		sz := int32(size)
		name := in.AttachmentName
		mime := in.AttachmentMIME
		msg.AttachmentObjectKey = &key
		msg.AttachmentSize = &sz
		msg.AttachmentName = &name
		msg.AttachmentMIME = &mime
		if kind == KindVoice && (in.VoiceDurationMs == nil || *in.VoiceDurationMs <= 0) {
			return MessageDTO{}, httpx.E(422, "VALIDATION", "voice_duration_ms is required for voice notes")
		}
	} else if body == nil {
		return MessageDTO{}, httpx.E(422, "VALIDATION", "message body is required")
	} else if utf8.RuneCountInString(*body) > 4000 {
		return MessageDTO{}, httpx.E(422, "VALIDATION", "message is too long")
	}

	saved, err := s.store.InsertMessage(ctx, msg)
	if err != nil {
		return MessageDTO{}, err
	}
	now := s.now().UTC()
	_ = s.store.TouchConversation(ctx, conversationID, now)
	_ = s.store.MarkConversationRead(ctx, conversationID, actor, now)
	out, err := s.mapMessages(ctx, actor, []Message{saved})
	if err != nil {
		return MessageDTO{}, err
	}
	return out[0], nil
}

func (s *Service) React(ctx context.Context, actor, messageID uuid.UUID, emoji string, remove bool) (MessageDTO, error) {
	emoji = stringsTrim(emoji)
	if emoji == "" || utf8.RuneCountInString(emoji) > 8 {
		return MessageDTO{}, httpx.E(422, "VALIDATION", "emoji is required")
	}
	msg, err := s.store.GetMessage(ctx, messageID)
	if err != nil {
		return MessageDTO{}, httpx.E(404, "NOT_FOUND", "message not found")
	}
	if err := s.requireMember(ctx, msg.ConversationID, actor); err != nil {
		return MessageDTO{}, err
	}
	if remove {
		_ = s.store.DeleteReaction(ctx, messageID, actor, emoji)
	} else {
		if _, err := s.store.UpsertReaction(ctx, messageID, actor, emoji); err != nil {
			return MessageDTO{}, err
		}
	}
	out, err := s.mapMessages(ctx, actor, []Message{msg})
	if err != nil {
		return MessageDTO{}, err
	}
	return out[0], nil
}

func (s *Service) Delete(ctx context.Context, actor, messageID uuid.UUID) error {
	_, err := s.store.SoftDeleteMessage(ctx, messageID, actor)
	if err != nil {
		return httpx.E(404, "NOT_FOUND", "message not found")
	}
	return nil
}

func (s *Service) requireMember(ctx context.Context, conversationID, userID uuid.UUID) error {
	ok, err := s.store.IsMember(ctx, conversationID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return httpx.E(404, "NOT_FOUND", "conversation not found")
	}
	return nil
}

func (s *Service) toConversationDTO(ctx context.Context, actor uuid.UUID, row ConversationListRow) (ConversationDTO, error) {
	peerID := row.UserHighID
	if peerID == actor {
		peerID = row.UserLowID
	}
	peer, err := s.store.GetUserPeer(ctx, peerID)
	if err != nil {
		return ConversationDTO{}, err
	}
	if row.UserLowID == row.UserHighID {
		peer.DisplayName = "Private Messages"
	}
	preview := ""
	if row.LastBody != nil {
		preview = *row.LastBody
	} else if row.LastAttachmentKind != nil {
		switch *row.LastAttachmentKind {
		case KindVoice:
			preview = "Voice message"
		case KindImage:
			preview = "Photo"
		case KindFile:
			preview = "File"
		}
	}
	return ConversationDTO{
		ID:                 row.ID,
		Peer:               peer,
		LoanID:             row.LoanID,
		LastMessagePreview: preview,
		LastMessageAt:      firstTime(row.LastCreatedAt, row.LastMessageAt),
		UnreadCount:        int(row.UnreadCount),
		CreatedAt:          row.CreatedAt,
	}, nil
}

func (s *Service) mapMessages(ctx context.Context, actor uuid.UUID, rows []Message) ([]MessageDTO, error) {
	ids := make([]uuid.UUID, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
		if r.ReplyToMessageID != nil {
			ids = append(ids, *r.ReplyToMessageID)
		}
	}
	reactions, err := s.store.ListReactions(ctx, uniqueIDs(ids))
	if err != nil {
		return nil, err
	}
	byMsg := map[uuid.UUID][]Reaction{}
	for _, r := range reactions {
		byMsg[r.MessageID] = append(byMsg[r.MessageID], r)
	}
	replyCache := map[uuid.UUID]Message{}
	out := make([]MessageDTO, 0, len(rows))
	for _, row := range rows {
		dto := s.toMessageDTO(actor, row, byMsg[row.ID])
		if row.ReplyToMessageID != nil {
			reply, ok := replyCache[*row.ReplyToMessageID]
			if !ok {
				reply, err = s.store.GetMessage(ctx, *row.ReplyToMessageID)
				if err == nil {
					replyCache[*row.ReplyToMessageID] = reply
					ok = true
				}
			}
			if ok {
				rd := s.toMessageDTO(actor, reply, nil)
				dto.ReplyTo = &rd
			}
		}
		out = append(out, dto)
	}
	return out, nil
}

func (s *Service) toMessageDTO(actor uuid.UUID, row Message, reactions []Reaction) MessageDTO {
	dto := MessageDTO{
		ID:              row.ID,
		ConversationID:  row.ConversationID,
		SenderID:        row.SenderID,
		Mine:            row.SenderID == actor,
		Body:            row.Body,
		AttachmentKind:  row.AttachmentKind,
		AttachmentName:  row.AttachmentName,
		AttachmentMIME:  row.AttachmentMIME,
		AttachmentSize:  row.AttachmentSize,
		VoiceDurationMs: row.VoiceDurationMs,
		Reactions:       aggregateReactions(actor, reactions),
		CreatedAt:       row.CreatedAt,
	}
	if row.AttachmentObjectKey != nil {
		url := "/api/v1/media/" + *row.AttachmentObjectKey
		dto.AttachmentURL = &url
	}
	return dto
}

func aggregateReactions(actor uuid.UUID, rows []Reaction) []ReactionDTO {
	type agg struct {
		count int
		mine  bool
	}
	m := map[string]*agg{}
	order := []string{}
	for _, r := range rows {
		a, ok := m[r.Emoji]
		if !ok {
			a = &agg{}
			m[r.Emoji] = a
			order = append(order, r.Emoji)
		}
		a.count++
		if r.UserID == actor {
			a.mine = true
		}
	}
	out := make([]ReactionDTO, 0, len(order))
	for _, emoji := range order {
		a := m[emoji]
		out = append(out, ReactionDTO{Emoji: emoji, Count: a.count, Mine: a.mine})
	}
	return out
}

func trimPtr(s *string) *string {
	if s == nil {
		return nil
	}
	v := stringsTrim(*s)
	if v == "" {
		return nil
	}
	return &v
}

func stringsTrim(s string) string {
	start, end := 0, len(s)
	for start < end && (s[start] == ' ' || s[start] == '\n' || s[start] == '\t' || s[start] == '\r') {
		start++
	}
	for end > start && (s[end-1] == ' ' || s[end-1] == '\n' || s[end-1] == '\t' || s[end-1] == '\r') {
		end--
	}
	return s[start:end]
}

func firstTime(a, b *time.Time) *time.Time {
	if a != nil {
		return a
	}
	return b
}

func uniqueIDs(ids []uuid.UUID) []uuid.UUID {
	seen := map[uuid.UUID]struct{}{}
	out := make([]uuid.UUID, 0, len(ids))
	for _, id := range ids {
		if id == uuid.Nil {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}
