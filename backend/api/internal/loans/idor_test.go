package loans

import (
	"context"
	"testing"

	"equilend/api/internal/httpx"
)

func TestIDORLoanHiddenFromStranger(t *testing.T) {
	a, b, stranger, svc := setup()
	due := futureDue()
	created, err := svc.Create(context.Background(), a.ID, CreateInput{
		CounterpartyID: b.ID, Role: RoleBorrower,
		Principal: ptr("250"), CurrencyCode: ptr("ETB"), InterestRatePercent: ptr("0"), DueAt: &due,
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = svc.Get(context.Background(), stranger.ID, created.ID)
	if err == nil {
		t.Fatal("stranger retrieved loan")
	}
	he, ok := err.(*httpx.APIError)
	if !ok || he.Status != 404 {
		t.Fatalf("want 404 got %v", err)
	}
}

func TestIDORCannotAcceptWithoutDisclaimer(t *testing.T) {
	a, b, _, svc := setup()
	due := futureDue()
	created, err := svc.Create(context.Background(), a.ID, CreateInput{
		CounterpartyID: b.ID, Role: RoleBorrower,
		Principal: ptr("100"), CurrencyCode: ptr("ETB"), InterestRatePercent: ptr("0"), DueAt: &due,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Accept(context.Background(), b.ID, created.ID, false); err == nil {
		t.Fatal("expected disclaimer validation")
	}
}

func TestIDORStrangerCannotCancel(t *testing.T) {
	a, b, stranger, svc := setup()
	due := futureDue()
	created, err := svc.Create(context.Background(), a.ID, CreateInput{
		CounterpartyID: b.ID, Role: RoleBorrower,
		Principal: ptr("100"), CurrencyCode: ptr("ETB"), InterestRatePercent: ptr("0"), DueAt: &due,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Cancel(context.Background(), stranger.ID, created.ID); err == nil {
		t.Fatal("stranger cancelled loan")
	}
}
