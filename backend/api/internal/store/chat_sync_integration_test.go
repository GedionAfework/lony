package store

import (
	"fmt"
	"testing"

	"equilend/api/internal/chat"

	"github.com/google/uuid"
)

func mustUUID(t *testing.T, s string) uuid.UUID {
	t.Helper()
	id, err := uuid.Parse(s)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestChatSyncAgainstPostgres(t *testing.T) {
	e := newNetWorthEnv(t)
	a, b := e.user(t), e.user(t)
	svc := chat.NewService(e.store, nil, allowAll{})
	conv, err := svc.OpenOrCreate(e.ctx, a, b)
	if err != nil {
		t.Fatal(err)
	}
	var firstID, lastFromB string
	for i := 1; i <= 120; i++ {
		from := a
		if i%2 == 0 {
			from = b
		}
		body := fmt.Sprintf("m%d", i)
		m, err := svc.Send(e.ctx, from, conv.ID, chat.SendInput{Body: &body})
		if err != nil {
			t.Fatal(err)
		}
		if i == 1 {
			firstID = m.ID.String()
		}
		if from == b {
			lastFromB = m.ID.String()
		}
	}
	page, err := svc.ListMessages(e.ctx, a, conv.ID, chat.MessageQuery{})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Messages) != 50 || !page.HasMore || *page.Messages[49].Body != "m120" || *page.Messages[0].Body != "m71" {
		t.Fatalf("newest page wrong: n=%d first=%s", len(page.Messages), *page.Messages[0].Body)
	}
	total := len(page.Messages)
	p := page
	for p.HasMore {
		f := p.Messages[0]
		p, err = svc.ListMessages(e.ctx, a, conv.ID, chat.MessageQuery{Before: &f.CreatedAt, BeforeID: &f.ID})
		if err != nil {
			t.Fatal(err)
		}
		total += len(p.Messages)
	}
	if total != 120 {
		t.Fatalf("paged %d, want 120", total)
	}

	// Changes after opening: a reaction on the very first message and a deletion.
	cursor := page.Cursor
	first, _ := e.store.GetMessage(e.ctx, mustUUID(t, firstID))
	if _, err := svc.React(e.ctx, b, first.ID, "❤️", false); err != nil {
		t.Fatal(err)
	}
	if err := svc.Delete(e.ctx, b, mustUUID(t, lastFromB), true); err != nil {
		t.Fatal(err)
	}
	changes, err := svc.ListMessages(e.ctx, a, conv.ID, chat.MessageQuery{Since: &cursor})
	if err != nil {
		t.Fatal(err)
	}
	var reacted, deleted bool
	for _, m := range changes.Messages {
		if m.ID == first.ID && len(m.Reactions) == 1 {
			reacted = true
		}
		if m.ID.String() == lastFromB && m.Deleted {
			deleted = true
		}
	}
	if !reacted || !deleted {
		t.Fatalf("reacted=%v deleted=%v in %d changes", reacted, deleted, len(changes.Messages))
	}
}
