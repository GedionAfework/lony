package chat

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type memGate struct{ ok bool }

func (g memGate) CanCreateLoan(context.Context, uuid.UUID, uuid.UUID) (bool, error) {
	return g.ok, nil
}

type memMedia struct{}

func (memMedia) Save(_ context.Context, filename, mime string, data []byte) (string, int, error) {
	return "obj-" + filename, len(data), nil
}
func (memMedia) Path(string) (string, error) { return "", nil }

type memoryStore struct {
	mu            sync.Mutex
	conversations map[uuid.UUID]Conversation
	byPair        map[string]uuid.UUID
	members       map[uuid.UUID]map[uuid.UUID]struct{}
	messages      map[uuid.UUID]Message
	reactions     []Reaction
	peers         map[uuid.UUID]Peer
	readAt        map[string]time.Time
}

func newMem(a, b uuid.UUID) *memoryStore {
	return &memoryStore{
		conversations: map[uuid.UUID]Conversation{},
		byPair:        map[string]uuid.UUID{},
		members:       map[uuid.UUID]map[uuid.UUID]struct{}{},
		messages:      map[uuid.UUID]Message{},
		peers: map[uuid.UUID]Peer{
			a: {ID: a, DisplayName: "Alice"},
			b: {ID: b, DisplayName: "Bob"},
		},
		readAt: map[string]time.Time{},
	}
}

func pairKey(low, high uuid.UUID) string { return low.String() + "|" + high.String() }

func (m *memoryStore) GetConversationByPair(_ context.Context, low, high uuid.UUID) (Conversation, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	id, ok := m.byPair[pairKey(low, high)]
	if !ok {
		return Conversation{}, pgx.ErrNoRows
	}
	c := m.conversations[id]
	if c.LoanID != nil {
		return Conversation{}, pgx.ErrNoRows
	}
	return c, nil
}
func (m *memoryStore) GetConversationByLoan(_ context.Context, loanID uuid.UUID) (Conversation, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, c := range m.conversations {
		if c.LoanID != nil && *c.LoanID == loanID {
			return c, nil
		}
	}
	return Conversation{}, pgx.ErrNoRows
}
func (m *memoryStore) GetConversationByID(_ context.Context, id uuid.UUID) (Conversation, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, ok := m.conversations[id]
	if !ok {
		return Conversation{}, pgx.ErrNoRows
	}
	return c, nil
}
func (m *memoryStore) InsertConversation(_ context.Context, low, high uuid.UUID, loanID *uuid.UUID) (Conversation, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c := Conversation{ID: uuid.New(), UserLowID: low, UserHighID: high, LoanID: loanID, CreatedAt: time.Now().UTC()}
	m.conversations[c.ID] = c
	if loanID == nil {
		m.byPair[pairKey(low, high)] = c.ID
	}
	return c, nil
}
func (m *memoryStore) InsertMembers(_ context.Context, conversationID, a, b uuid.UUID) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.members[conversationID] == nil {
		m.members[conversationID] = map[uuid.UUID]struct{}{}
	}
	m.members[conversationID][a] = struct{}{}
	m.members[conversationID][b] = struct{}{}
	return nil
}
func (m *memoryStore) IsMember(_ context.Context, conversationID, userID uuid.UUID) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.members[conversationID][userID]
	return ok, nil
}
func (m *memoryStore) ListConversations(context.Context, uuid.UUID) ([]ConversationListRow, error) {
	return nil, nil
}
func (m *memoryStore) TouchConversation(_ context.Context, id uuid.UUID, at time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	c := m.conversations[id]
	c.LastMessageAt = &at
	m.conversations[id] = c
	return nil
}
func (m *memoryStore) MarkConversationRead(_ context.Context, conversationID, userID uuid.UUID, at time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.readAt[conversationID.String()+"|"+userID.String()] = at
	return nil
}
func (m *memoryStore) InsertMessage(_ context.Context, msg Message) (Message, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	msg.ID = uuid.New()
	msg.CreatedAt = time.Now().UTC()
	m.messages[msg.ID] = msg
	return msg, nil
}
func (m *memoryStore) GetMessage(_ context.Context, id uuid.UUID) (Message, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	msg, ok := m.messages[id]
	if !ok {
		return Message{}, pgx.ErrNoRows
	}
	return msg, nil
}
func (m *memoryStore) ListMessages(_ context.Context, conversationID uuid.UUID, after *time.Time, limit int32) ([]Message, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []Message{}
	for _, msg := range m.messages {
		if msg.ConversationID != conversationID {
			continue
		}
		if after != nil && !msg.CreatedAt.After(*after) {
			continue
		}
		out = append(out, msg)
	}
	if int32(len(out)) > limit {
		out = out[:limit]
	}
	return out, nil
}
func (m *memoryStore) SoftDeleteMessage(_ context.Context, id, senderID uuid.UUID) (Message, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	msg, ok := m.messages[id]
	if !ok || msg.SenderID != senderID {
		return Message{}, pgx.ErrNoRows
	}
	delete(m.messages, id)
	return msg, nil
}
func (m *memoryStore) UpsertReaction(_ context.Context, messageID, userID uuid.UUID, emoji string) (Reaction, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r := Reaction{MessageID: messageID, UserID: userID, Emoji: emoji, CreatedAt: time.Now().UTC()}
	m.reactions = append(m.reactions, r)
	return r, nil
}
func (m *memoryStore) DeleteReaction(_ context.Context, messageID, userID uuid.UUID, emoji string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	kept := m.reactions[:0]
	for _, r := range m.reactions {
		if r.MessageID == messageID && r.UserID == userID && r.Emoji == emoji {
			continue
		}
		kept = append(kept, r)
	}
	m.reactions = kept
	return nil
}
func (m *memoryStore) ListReactions(_ context.Context, messageIDs []uuid.UUID) ([]Reaction, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	set := map[uuid.UUID]struct{}{}
	for _, id := range messageIDs {
		set[id] = struct{}{}
	}
	out := []Reaction{}
	for _, r := range m.reactions {
		if _, ok := set[r.MessageID]; ok {
			out = append(out, r)
		}
	}
	return out, nil
}
func (m *memoryStore) GetUserPeer(_ context.Context, id uuid.UUID) (Peer, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	p, ok := m.peers[id]
	if !ok {
		return Peer{}, pgx.ErrNoRows
	}
	return p, nil
}
func (m *memoryStore) CanAccessMediaKey(_ context.Context, userID uuid.UUID, objectKey string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, msg := range m.messages {
		if msg.AttachmentObjectKey != nil && *msg.AttachmentObjectKey == objectKey {
			if _, ok := m.members[msg.ConversationID][userID]; ok {
				return true, nil
			}
		}
	}
	return false, nil
}

func TestSendReplyReact(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	store := newMem(a, b)
	svc := NewService(store, memMedia{}, memGate{ok: true})
	ctx := context.Background()

	conv, err := svc.OpenOrCreate(ctx, a, b)
	if err != nil {
		t.Fatal(err)
	}
	first, err := svc.Send(ctx, a, conv.ID, SendInput{Body: strPtr("hey")})
	if err != nil {
		t.Fatal(err)
	}
	reply, err := svc.Send(ctx, b, conv.ID, SendInput{Body: strPtr("hi back"), ReplyToMessageID: &first.ID})
	if err != nil || reply.ReplyTo == nil || reply.ReplyTo.ID != first.ID {
		t.Fatalf("%+v %v", reply, err)
	}
	reacted, err := svc.React(ctx, a, reply.ID, "🔥", false)
	if err != nil || len(reacted.Reactions) != 1 || !reacted.Reactions[0].Mine {
		t.Fatalf("%+v %v", reacted, err)
	}
	voice, err := svc.Send(ctx, a, conv.ID, SendInput{
		AttachmentKind: KindVoice, AttachmentName: "note.m4a", AttachmentMIME: "audio/m4a",
		AttachmentBytes: []byte("fake-audio"), VoiceDurationMs: int32Ptr(1200),
	})
	if err != nil || voice.AttachmentKind != KindVoice {
		t.Fatalf("%+v %v", voice, err)
	}
}

func strPtr(s string) *string { return &s }
func int32Ptr(n int32) *int32 { return &n }
