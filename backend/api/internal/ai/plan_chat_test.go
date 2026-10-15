package ai

import (
	"strings"
	"testing"
	"time"

	"equilend/api/internal/goals"
)

func TestProductCalendar_October2026(t *testing.T) {
	got := productCalendar(time.Date(2026, time.October, 13, 0, 0, 0, 0, time.UTC))
	if !strings.Contains(got, "S26") || strings.Contains(got, "Latest Samsung Galaxy S series is the S25") {
		t.Fatalf("S26 should be current in Oct 2026:\n%s", got)
	}
	if !strings.Contains(got, "iPhone 18") {
		t.Fatalf("iPhone 18 should be current in Oct 2026:\n%s", got)
	}
	if !strings.Contains(got, "The S27 is not out yet") {
		t.Fatalf("S27 should still be unreleased:\n%s", got)
	}
	if !strings.Contains(got, "Watch 9") {
		t.Fatalf("Galaxy Watch 9 should be current in Oct 2026:\n%s", got)
	}
}

func TestParseDecision(t *testing.T) {
	d := parseDecision("```json\n{\"action\":\"search\",\"reply\":\"Looking it up\",\"query\":\"Sunseeker Manhattan 55 for sale\",\"title\":\"Sunseeker Manhattan 55\"}\n```")
	if d.Action != "search" || d.Query != "Sunseeker Manhattan 55 for sale" {
		t.Fatalf("got %+v", d)
	}
	if d := parseDecision(`{"action":"weird","query":"sofa price"}`); d.Action != "search" {
		t.Fatalf("unknown action with a query should search, got %q", d.Action)
	}
	if d := parseDecision("Hello there"); d.Action != "reply" || d.Reply == "" {
		t.Fatalf("plain text should be a reply, got %+v", d)
	}
}

func TestParseAnswer_stringNumbers(t *testing.T) {
	a := parseAnswer(`{"reply":"ok","target_amount":125000,"sources":["2","1"],"price_from":[2],"image":"1"}`)
	if a.TargetAmount != "125000" || len(a.Sources) != 2 || a.Sources[0] != 2 || a.Image != 1 {
		t.Fatalf("got %+v", a)
	}
}

func TestBuildPlanResult_usesPickedPagesOnly(t *testing.T) {
	cands := []planCandidate{
		{WebPage: goals.WebPage{WebResult: goals.WebResult{Title: "Junk", URL: "https://junk.example/a", Site: "junk.example"}, ImageURL: "https://junk.example/i.jpg"}},
		{WebPage: goals.WebPage{WebResult: goals.WebResult{Title: "House A", URL: "https://homes.example/a", Site: "homes.example"}, ImageURL: "https://homes.example/a.jpg", Price: "450000", CurrencyCode: "USD"}, PriceLocal: "63000000"},
	}
	out := buildPlanResult(planDecision{Title: "3 bed house Austin"}, planAnswer{Reply: "About 63M ETB.", Sources: []int{2, 9}, PriceFrom: []int{2}, Image: 1}, cands, "ETB")
	if len(out.Sources) != 1 || out.Sources[0].URL != "https://homes.example/a" {
		t.Fatalf("sources: %+v", out.Sources)
	}
	if out.ImageURL != "https://homes.example/a.jpg" {
		t.Fatalf("image from an unpicked page must be ignored, got %q", out.ImageURL)
	}
	if out.Draft == nil || out.Draft.TargetAmount != "63000000.00" || out.Draft.CurrencyCode != "ETB" {
		t.Fatalf("draft: %+v", out.Draft)
	}
	if out.Draft.SourceURL != "https://homes.example/a" {
		t.Fatalf("source url: %q", out.Draft.SourceURL)
	}
}

func TestBuildPlanResult_rejectsYearAndUsesUserAmount(t *testing.T) {
	out := buildPlanResult(planDecision{Title: "Toyota RAV4 2025"}, planAnswer{Reply: "Here.", TargetAmount: "2025"}, nil, "ETB")
	if out.Draft.TargetAmount != "" {
		t.Fatalf("year must not be a price, got %s", out.Draft.TargetAmount)
	}
	out = buildPlanResult(planDecision{Title: "Trip", UserAmount: "1500", UserCurrency: "usd"}, planAnswer{Reply: "Ok.", TargetAmount: "200000"}, nil, "ETB")
	if out.Draft.TargetAmount != "1500.00" || out.Draft.CurrencyCode != "USD" {
		t.Fatalf("stated amount should win: %+v", out.Draft)
	}
}

func TestLastAssistantAsked(t *testing.T) {
	turns := []PlanChatTurn{{Role: "user", Content: "a house"}, {Role: "assistant", Content: "Which city?"}, {Role: "user", Content: "anywhere"}}
	if !lastAssistantAsked(turns) {
		t.Fatal("should notice the previous question")
	}
}
