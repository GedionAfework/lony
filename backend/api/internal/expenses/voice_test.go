package expenses

import (
	"testing"

	"github.com/google/uuid"
)

func TestParseVoiceFallbackLunchBirr(t *testing.T) {
	got := ParseVoiceFallback("lunch 250 birr")
	if got.Kind != KindExpense {
		t.Fatalf("kind=%s", got.Kind)
	}
	if got.Amount != "250.00" {
		t.Fatalf("amount=%s", got.Amount)
	}
	if got.CurrencyCode != "ETB" {
		t.Fatalf("currency=%s", got.CurrencyCode)
	}
	if got.Title != "lunch" {
		t.Fatalf("title=%q", got.Title)
	}
}

func TestParseVoiceFallbackIncome(t *testing.T) {
	got := ParseVoiceFallback("got paid salary 5000 etb")
	if got.Kind != KindIncome {
		t.Fatalf("kind=%s", got.Kind)
	}
	if got.Amount != "5000.00" {
		t.Fatalf("amount=%s", got.Amount)
	}
	if got.CurrencyCode != "ETB" {
		t.Fatalf("currency=%s", got.CurrencyCode)
	}
}

func TestMatchVoiceCategory(t *testing.T) {
	food := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	other := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	cats := []Category{
		{ID: food, Kind: KindExpense, Name: "Food", Slug: "food", Active: true},
		{ID: other, Kind: KindExpense, Name: "Other", Slug: "other", Active: true},
	}
	if id := MatchVoiceCategory(cats, KindExpense, "food", "lunch"); id == nil || *id != food {
		t.Fatalf("expected food, got %v", id)
	}
	if id := MatchVoiceCategory(cats, KindExpense, "unknown thing", ""); id == nil || *id != other {
		t.Fatalf("expected other fallback, got %v", id)
	}
}
