package chat

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

type pushed struct {
	recipient, sender uuid.UUID
	name, preview     string
}
type fakeNotifier struct{ got []pushed }

func (f *fakeNotifier) OnChatMessage(_ context.Context, recipient, sender uuid.UUID, name, preview string) error {
	f.got = append(f.got, pushed{recipient, sender, name, preview})
	return nil
}

func TestSendNotifiesTheOtherPerson(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	store := newMem(a, b)
	svc := NewService(store, memMedia{}, memGate{ok: true})
	n := &fakeNotifier{}
	svc.SetNotifier(n)
	ctx := context.Background()

	conv, _ := svc.OpenOrCreate(ctx, a, b)
	if _, err := svc.Send(ctx, a, conv.ID, SendInput{Body: strPtr("lunch at 1?")}); err != nil {
		t.Fatal(err)
	}
	if len(n.got) != 1 || n.got[0].recipient != b || n.got[0].sender != a || n.got[0].name != "Alice" || n.got[0].preview != "lunch at 1?" {
		t.Fatalf("%+v", n.got)
	}

	self, _ := svc.OpenOrCreate(ctx, a, a)
	_, _ = svc.Send(ctx, a, self.ID, SendInput{Body: strPtr("note to self")})
	if len(n.got) != 1 {
		t.Fatal("notes to self must not notify")
	}
}
