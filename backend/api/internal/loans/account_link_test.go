package loans

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"equilend/api/internal/httpx"

	"github.com/google/uuid"
)

func timePtr(t time.Time) *time.Time { return &t }

// fakeCards accepts only the listed card ids, in ETB.
type fakeCards map[uuid.UUID]bool

func (f fakeCards) CheckCardForDebt(_ context.Context, _ uuid.UUID, id uuid.UUID, currency string) error {
	if !f[id] || !strings.EqualFold(currency, "ETB") {
		return httpx.Field(422, "VALIDATION", "invalid fields", map[string]string{"account_id": "must be a credit card"})
	}
	return nil
}

func createCardPlan(t *testing.T, svc *Service, actor uuid.UUID, link *uuid.UUID) (LoanDTO, error) {
	t.Helper()
	label := "CBE"
	months := int32(6)
	return svc.Create(context.Background(), actor, CreateInput{
		Role:                RoleBorrower,
		Principal:           ptr("6000"),
		CurrencyCode:        ptr("ETB"),
		InterestRatePercent: ptr("0"),
		InstitutionLabel:    &label,
		InstallmentCount:    &months,
		LinkedAccountID:     link,
	})
}

func TestCreateDebtLinkedToCard(t *testing.T) {
	a, b, _, svc := setup()
	card, notCard := uuid.New(), uuid.New()
	svc.SetCards(fakeCards{card: true})

	created, err := createCardPlan(t, svc, a.ID, &card)
	if err != nil {
		t.Fatal(err)
	}
	if created.LinkedAccountID == nil || *created.LinkedAccountID != card {
		t.Fatalf("link %+v", created.LinkedAccountID)
	}
	if _, err := createCardPlan(t, svc, a.ID, &notCard); err == nil {
		t.Fatal("non-card account must be refused")
	}

	// A peer loan is not inside any card balance.
	if _, err := svc.Create(context.Background(), a.ID, CreateInput{
		CounterpartyID: b.ID, Role: RoleBorrower, Principal: ptr("100"), CurrencyCode: ptr("ETB"),
		InterestRatePercent: ptr("0"), DueAt: timePtr(futureDue()), LinkedAccountID: &card,
	}); err == nil {
		t.Fatal("peer loan must not link to a card")
	}
}

func TestSetAccountLink(t *testing.T) {
	a, b, _, svc := setup()
	card := uuid.New()
	svc.SetCards(fakeCards{card: true})
	ctx := context.Background()
	plan, err := createCardPlan(t, svc, a.ID, nil)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := svc.SetAccountLink(ctx, b.ID, plan.ID, &card, false); err == nil {
		t.Fatal("stranger must not link")
	}
	if _, err := svc.SetAccountLink(ctx, a.ID, plan.ID, &card, true); err == nil {
		t.Fatal("card and separate together must be refused")
	}
	linked, err := svc.SetAccountLink(ctx, a.ID, plan.ID, &card, false)
	if err != nil || linked.LinkedAccountID == nil {
		t.Fatalf("%v %+v", err, linked)
	}
	separate, err := svc.SetAccountLink(ctx, a.ID, plan.ID, nil, true)
	if err != nil || separate.LinkedAccountID != nil {
		t.Fatalf("%v %+v", err, separate)
	}
	if rec, _ := svc.store.GetLoan(ctx, plan.ID); !rec.AccountLinkDismissed {
		t.Fatal("separate should be remembered")
	}

	peer, err := svc.Create(ctx, a.ID, CreateInput{
		CounterpartyID: b.ID, Role: RoleBorrower, Principal: ptr("100"), CurrencyCode: ptr("ETB"),
		InterestRatePercent: ptr("0"), DueAt: timePtr(futureDue()),
	})
	if err != nil {
		t.Fatal(err)
	}
	var apiErr *httpx.APIError
	if _, err := svc.SetAccountLink(ctx, a.ID, peer.ID, &card, false); !errors.As(err, &apiErr) || apiErr.Code != "INVALID_STATE" {
		t.Fatalf("peer loan: %v", err)
	}
}
