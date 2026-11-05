package chat

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

// Only the sender can delete for everyone; anyone in the chat can delete for themselves.
func TestDeleteForMeAndForEveryone(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	store := newMem(a, b)
	svc := NewService(store, memMedia{}, memGate{ok: true})
	ctx := context.Background()

	conv, err := svc.OpenOrCreate(ctx, a, b)
	if err != nil {
		t.Fatal(err)
	}
	fromA, err := svc.Send(ctx, a, conv.ID, SendInput{Body: strPtr("hello")})
	if err != nil {
		t.Fatal(err)
	}

	if err := svc.Delete(ctx, b, fromA.ID, true); err == nil {
		t.Fatal("the other person must not delete my message for everyone")
	}

	if err := svc.Delete(ctx, b, fromA.ID, false); err != nil {
		t.Fatalf("delete for me: %v", err)
	}
	pageB, err := svc.ListMessages(ctx, b, conv.ID, MessageQuery{})
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range pageB.Messages {
		if m.ID == fromA.ID && !m.Deleted {
			t.Fatal("message deleted for me is still visible to me")
		}
	}
	pageA, err := svc.ListMessages(ctx, a, conv.ID, MessageQuery{})
	if err != nil {
		t.Fatal(err)
	}
	seen := false
	for _, m := range pageA.Messages {
		if m.ID == fromA.ID && !m.Deleted {
			seen = true
		}
	}
	if !seen {
		t.Fatal("deleting for me must not hide it from the sender")
	}

	if err := svc.Delete(ctx, a, fromA.ID, true); err != nil {
		t.Fatalf("sender delete for everyone: %v", err)
	}

	stranger := uuid.New()
	if err := svc.Delete(ctx, stranger, fromA.ID, false); err == nil {
		t.Fatal("someone outside the chat must not touch its messages")
	}
}
