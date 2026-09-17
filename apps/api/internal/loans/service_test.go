package loans

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

func setup() (Party, Party, Party, *Service) {
	a := Party{ID: uuid.New(), DisplayName: "Abebe"}
	b := Party{ID: uuid.New(), DisplayName: "Sara"}
	c := Party{ID: uuid.New(), DisplayName: "Chala"}
	svc := NewService(newMemoryStore(a, b, c), staticGate{ok: true})
	svc.now = func() time.Time { return time.Date(2026, 9, 16, 12, 0, 0, 0, time.UTC) }
	return a, b, c, svc
}

func futureDue() time.Time {
	return time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC)
}

func ptr(s string) *string { return &s }

func TestCreateAcceptSameTerms(t *testing.T) {
	a, b, _, svc := setup()
	ctx := context.Background()
	due := futureDue()
	created, err := svc.Create(ctx, a.ID, CreateInput{
		CounterpartyID:      b.ID,
		Role:                RoleBorrower,
		Principal:           ptr("1000"),
		CurrencyCode:        ptr("ETB"),
		InterestRatePercent: ptr("5"),
		DueAt:               &due,
		Note:                ptr("rent"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.Status != StatusPending {
		t.Fatalf("status %s", created.Status)
	}
	if created.Principal == nil || *created.Principal != "1000.0000" || *created.ExpectedTotal != "1050.0000" {
		t.Fatalf("computed terms %+v", created)
	}
	if created.InterestBasis != InterestBasis {
		t.Fatal("interest basis")
	}

	accepted, err := svc.Accept(ctx, b.ID, created.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if accepted.Status != StatusActive {
		t.Fatalf("status %s", accepted.Status)
	}

	fromA, err := svc.Get(ctx, a.ID, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	fromB, err := svc.Get(ctx, b.ID, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if *fromA.Principal != *fromB.Principal || *fromA.ExpectedTotal != *fromB.ExpectedTotal ||
		*fromA.InterestRatePercent != *fromB.InterestRatePercent || fromA.InterestBasis != fromB.InterestBasis ||
		!fromA.DueAt.Equal(*fromB.DueAt) || *fromA.CurrencyCode != *fromB.CurrencyCode {
		t.Fatalf("views differ\nA=%+v\nB=%+v", fromA, fromB)
	}
}

func TestCannotEditAcceptedTerms(t *testing.T) {
	a, b, _, svc := setup()
	ctx := context.Background()
	due := futureDue()
	created, err := svc.Create(ctx, a.ID, CreateInput{
		CounterpartyID: b.ID, Role: RoleLender,
		Principal: ptr("200"), CurrencyCode: ptr("USD"), InterestRatePercent: ptr("0"), DueAt: &due,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Accept(ctx, b.ID, created.ID, true); err != nil {
		t.Fatal(err)
	}
	_, err = svc.Propose(ctx, a.ID, created.ID, TermsInput{
		Principal: "300", CurrencyCode: "USD", InterestRatePercent: "0", DueAt: due,
	})
	if err == nil {
		t.Fatal("expected 409")
	}
}

func TestInvalidTransitions(t *testing.T) {
	a, b, _, svc := setup()
	ctx := context.Background()
	due := futureDue()
	created, _ := svc.Create(ctx, a.ID, CreateInput{
		CounterpartyID: b.ID, Role: RoleBorrower,
		Principal: ptr("50"), CurrencyCode: ptr("ETB"), InterestRatePercent: ptr("1"), DueAt: &due,
	})
	if _, err := svc.Accept(ctx, a.ID, created.ID, true); err == nil {
		t.Fatal("proposer cannot accept")
	}
	if _, err := svc.Accept(ctx, b.ID, created.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Accept(ctx, b.ID, created.ID, true); err == nil {
		t.Fatal("second accept")
	}
	if _, err := svc.Reject(ctx, b.ID, created.ID); err == nil {
		t.Fatal("reject after accept")
	}
	if _, err := svc.Cancel(ctx, a.ID, created.ID); err == nil {
		t.Fatal("cancel after accept")
	}
}

func TestRequestThenLenderSetsTerms(t *testing.T) {
	a, b, _, svc := setup()
	ctx := context.Background()
	created, err := svc.Create(ctx, a.ID, CreateInput{CounterpartyID: b.ID, Role: RoleBorrower})
	if err != nil {
		t.Fatal(err)
	}
	if created.Principal != nil {
		t.Fatal("expected no terms yet")
	}
	if _, err := svc.Accept(ctx, b.ID, created.ID, true); err == nil {
		t.Fatal("accept without terms")
	}
	due := futureDue()
	proposed, err := svc.Propose(ctx, b.ID, created.ID, TermsInput{
		Principal: "750.5", CurrencyCode: "ETB", InterestRatePercent: "10", DueAt: due,
	})
	if err != nil {
		t.Fatal(err)
	}
	if proposed.ExpectedTotal == nil || *proposed.ExpectedTotal != "825.5500" {
		t.Fatalf("expected total %v", proposed.ExpectedTotal)
	}
	accepted, err := svc.Accept(ctx, a.ID, proposed.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if accepted.Status != StatusActive {
		t.Fatalf("status %s", accepted.Status)
	}
}

func TestFriendshipRequired(t *testing.T) {
	a, b, _, _ := setup()
	svc := NewService(newMemoryStore(a, b), staticGate{ok: false})
	_, err := svc.Create(context.Background(), a.ID, CreateInput{CounterpartyID: b.ID, Role: RoleBorrower})
	if err == nil {
		t.Fatal("expected not friends")
	}
}

func TestHiddenFromStrangers(t *testing.T) {
	a, b, c, svc := setup()
	due := futureDue()
	created, err := svc.Create(context.Background(), a.ID, CreateInput{
		CounterpartyID: b.ID, Role: RoleBorrower,
		Principal: ptr("10"), CurrencyCode: ptr("USD"), InterestRatePercent: ptr("0"), DueAt: &due,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Get(context.Background(), c.ID, created.ID); err == nil {
		t.Fatal("stranger should not see loan")
	}
}

func TestMarkOverdue(t *testing.T) {
	a, b, _, svc := setup()
	due := futureDue()
	created, _ := svc.Create(context.Background(), a.ID, CreateInput{
		CounterpartyID: b.ID, Role: RoleBorrower,
		Principal: ptr("10"), CurrencyCode: ptr("ETB"), InterestRatePercent: ptr("0"), DueAt: &due,
	})
	if _, err := svc.Accept(context.Background(), b.ID, created.ID, true); err != nil {
		t.Fatal(err)
	}
	svc.now = func() time.Time { return due.Add(time.Hour) }
	n, err := svc.MarkOverdue(context.Background())
	if err != nil || n != 1 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	got, err := svc.Get(context.Background(), a.ID, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != StatusOverdue {
		t.Fatalf("status %s", got.Status)
	}
}
