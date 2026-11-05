package chat

import (
	"context"
	"fmt"
	"testing"

	"github.com/google/uuid"
)

func syncSetup(t *testing.T) (a, b uuid.UUID, svc *Service, store *memoryStore, conv ConversationDTO) {
	t.Helper()
	a, b = uuid.New(), uuid.New()
	store = newMem(a, b)
	svc = NewService(store, memMedia{}, memGate{ok: true})
	conv, err := svc.OpenOrCreate(context.Background(), a, b)
	if err != nil {
		t.Fatal(err)
	}
	return
}

// Opening a long thread shows the newest messages, and scrolling up pages back
// through all of them with nothing skipped or repeated.
func TestThreadOpensOnNewestAndPagesBack(t *testing.T) {
	a, b, svc, _, conv := syncSetup(t)
	ctx := context.Background()
	for i := 1; i <= 120; i++ {
		from := a
		if i%2 == 0 {
			from = b
		}
		if _, err := svc.Send(ctx, from, conv.ID, SendInput{Body: strPtr(fmt.Sprintf("m%d", i))}); err != nil {
			t.Fatal(err)
		}
	}
	page, err := svc.ListMessages(ctx, a, conv.ID, MessageQuery{})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Messages) != 50 || !page.HasMore || *page.Messages[0].Body != "m71" || *page.Messages[49].Body != "m120" {
		t.Fatalf("first page: n=%d more=%v first=%s last=%s", len(page.Messages), page.HasMore, *page.Messages[0].Body, *page.Messages[49].Body)
	}

	seen := map[uuid.UUID]bool{}
	all := append([]MessageDTO{}, page.Messages...)
	for page.HasMore {
		first := page.Messages[0]
		page, err = svc.ListMessages(ctx, a, conv.ID, MessageQuery{Before: &first.CreatedAt, BeforeID: &first.ID})
		if err != nil {
			t.Fatal(err)
		}
		all = append(page.Messages, all...)
	}
	if len(all) != 120 {
		t.Fatalf("paged %d messages, want 120", len(all))
	}
	for i, m := range all {
		if seen[m.ID] || *m.Body != fmt.Sprintf("m%d", i+1) {
			t.Fatalf("position %d: %s (dup=%v)", i, *m.Body, seen[m.ID])
		}
		seen[m.ID] = true
	}
}

// Polling "since" returns new messages and changes to old ones: a reaction, a deletion,
// and messages moved in when a loan thread is merged into the DM.
func TestSinceReturnsChanges(t *testing.T) {
	a, b, svc, store, conv := syncSetup(t)
	ctx := context.Background()
	old, _ := svc.Send(ctx, a, conv.ID, SendInput{Body: strPtr("old one")})
	gone, _ := svc.Send(ctx, b, conv.ID, SendInput{Body: strPtr("to delete")})
	for i := 0; i < 3; i++ {
		_, _ = svc.Send(ctx, a, conv.ID, SendInput{Body: strPtr("filler")})
	}
	open, _ := svc.ListMessages(ctx, a, conv.ID, MessageQuery{})
	cursor := open.Cursor

	if _, err := svc.React(ctx, b, old.ID, "👍", false); err != nil {
		t.Fatal(err)
	}
	if err := svc.Delete(ctx, b, gone.ID, true); err != nil {
		t.Fatal(err)
	}
	fresh, _ := svc.Send(ctx, b, conv.ID, SendInput{Body: strPtr("new")})

	changes, err := svc.ListMessages(ctx, a, conv.ID, MessageQuery{Since: &cursor})
	if err != nil {
		t.Fatal(err)
	}
	got := map[uuid.UUID]MessageDTO{}
	for _, m := range changes.Messages {
		got[m.ID] = m
	}
	if r := got[old.ID]; len(r.Reactions) != 1 || r.Reactions[0].Emoji != "👍" {
		t.Fatalf("reaction not delivered: %+v", r)
	}
	if d := got[gone.ID]; !d.Deleted || d.Body != nil {
		t.Fatalf("deletion not delivered: %+v", d)
	}
	if _, ok := got[fresh.ID]; !ok {
		t.Fatal("new message not delivered")
	}
	if !changes.Cursor.After(cursor) {
		t.Fatal("cursor did not advance")
	}

	// A loan thread with older messages is merged into this DM.
	loanID := uuid.New()
	low, high := CanonicalPair(a, b)
	loanConv, _ := store.InsertConversation(ctx, low, high, &loanID)
	_ = store.InsertMembers(ctx, loanConv.ID, a, b)
	moved, _ := store.InsertMessage(ctx, Message{ConversationID: loanConv.ID, SenderID: b, Body: strPtr("from the loan chat")})
	next := changes.Cursor
	if _, err := svc.mergeConversationsForPair(ctx, low, high); err != nil {
		t.Fatal(err)
	}
	after, _ := svc.ListMessages(ctx, a, conv.ID, MessageQuery{Since: &next})
	found := false
	for _, m := range after.Messages {
		found = found || m.ID == moved.ID
	}
	if !found {
		t.Fatal("message moved in by a merge was not delivered")
	}
}
