package friends

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

func testUsers() (UserRef, UserRef, *Service) {
	a := UserRef{ID: uuid.New(), Email: "abebe@example.com", DisplayName: "Abebe", Status: "active", Verified: true}
	b := UserRef{ID: uuid.New(), Email: "sara@example.com", DisplayName: "Sara", Status: "active", Verified: true}
	uname := "sara"
	b.Username = &uname
	svc := NewService(newMemoryStore(a, b))
	return a, b, svc
}

func TestRequestAcceptList(t *testing.T) {
	a, b, svc := testUsers()
	ctx := context.Background()

	req, err := svc.Request(ctx, a.ID, b.Email, "", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if req.Status != StatusPending {
		t.Fatalf("status %s", req.Status)
	}

	incoming, err := svc.ListIncoming(ctx, b.ID)
	if err != nil || len(incoming) != 1 {
		t.Fatalf("incoming=%v err=%v", incoming, err)
	}

	accepted, err := svc.Accept(ctx, b.ID, req.ID)
	if err != nil {
		t.Fatal(err)
	}
	if accepted.Status != StatusAccepted {
		t.Fatalf("status %s", accepted.Status)
	}

	friends, err := svc.ListFriends(ctx, a.ID)
	if err != nil || len(friends) != 1 {
		t.Fatalf("friends=%v err=%v", friends, err)
	}
	ok, err := svc.CanCreateLoan(ctx, a.ID, b.ID)
	if err != nil || !ok {
		t.Fatalf("expected loan allowed, ok=%v err=%v", ok, err)
	}
}

func TestBondFromLoanAccept(t *testing.T) {
	a, b, svc := testUsers()
	ctx := context.Background()
	if err := svc.OnLoanAccepted(ctx, a.ID, b.ID); err != nil {
		t.Fatal(err)
	}
	friends, err := svc.ListFriends(ctx, a.ID)
	if err != nil || len(friends) != 1 {
		t.Fatalf("friends=%v err=%v", friends, err)
	}
	if friends[0].Bond != "acquaintance" {
		t.Fatalf("bond %s", friends[0].Bond)
	}
	_ = svc.OnLoanAccepted(ctx, a.ID, b.ID)
	_ = svc.OnRepaymentConfirmed(ctx, a.ID, b.ID)
	friends, err = svc.ListFriends(ctx, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if friends[0].InteractionCount < 3 {
		t.Fatalf("expected interactions>=3 got %d", friends[0].InteractionCount)
	}
	if friends[0].Bond != "friend" {
		t.Fatalf("bond %s", friends[0].Bond)
	}
	peers, err := svc.ListPeers(ctx, a.ID, "", 10)
	if err != nil || len(peers) != 1 {
		t.Fatalf("peers=%v err=%v", peers, err)
	}
}

func TestCannotFriendSelf(t *testing.T) {
	a, _, svc := testUsers()
	_, err := svc.Request(context.Background(), a.ID, a.Email, "", "", nil)
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestDuplicateAccepted(t *testing.T) {
	a, b, svc := testUsers()
	ctx := context.Background()
	req, err := svc.Request(ctx, a.ID, "", "sara", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Accept(ctx, b.ID, req.ID); err != nil {
		t.Fatal(err)
	}
	_, err = svc.Request(ctx, a.ID, b.Email, "", "", nil)
	if err == nil {
		t.Fatal("expected already friends")
	}
}

func TestBlockPreventsRequestAndLoan(t *testing.T) {
	a, b, svc := testUsers()
	ctx := context.Background()
	if _, err := svc.Block(ctx, a.ID, b.ID); err != nil {
		t.Fatal(err)
	}
	_, err := svc.Request(ctx, b.ID, a.Email, "", "", nil)
	if err == nil {
		t.Fatal("blocked user should not send request")
	}
	ok, err := svc.CanCreateLoan(ctx, a.ID, b.ID)
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("blocked pair must not create a loan")
	}
}

func TestRemoveKeepsHistory(t *testing.T) {
	a, b, svc := testUsers()
	ctx := context.Background()
	req, _ := svc.Request(ctx, a.ID, b.Email, "", "", nil)
	acc, _ := svc.Accept(ctx, b.ID, req.ID)
	removed, err := svc.Remove(ctx, a.ID, acc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if removed.Status != StatusRemoved {
		t.Fatalf("status %s", removed.Status)
	}
	ok, _ := svc.CanCreateLoan(ctx, a.ID, b.ID)
	if ok {
		t.Fatal("removed friends cannot start a new loan until they reconnect")
	}
}

func TestIncomingAcceptShortcut(t *testing.T) {
	a, b, svc := testUsers()
	ctx := context.Background()
	if _, err := svc.Request(ctx, a.ID, b.Email, "", "", nil); err != nil {
		t.Fatal(err)
	}
	out, err := svc.Request(ctx, b.ID, a.Email, "", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if out.Status != StatusAccepted {
		t.Fatalf("expected auto-accept, got %s", out.Status)
	}
}
