package ai

import (
	"testing"

	"equilend/api/internal/goals"
)

func cand(local string) planCandidate {
	return planCandidate{WebPage: goals.WebPage{WebResult: goals.WebResult{Title: "listing", URL: "https://shop.example/" + local, Site: "shop.example"}}, PriceLocal: local}
}

func TestPlanPriceTrustsListingsOverModel(t *testing.T) {
	cands := []planCandidate{cand("1000"), cand("1100"), cand("1200")}

	// Model says 300 while its own sources say ~1100: the listings win.
	out := buildPlanResult(planDecision{Title: "Sofa"}, planAnswer{TargetAmount: "300", PriceFrom: []int{1, 2, 3}, Sources: []int{1, 2, 3}}, cands, "ETB")
	if out.Draft.TargetAmount != "1100.0000" && out.Draft.TargetAmount != "1100.00" && out.Draft.TargetAmount != "1100" {
		t.Fatalf("want the listings' typical 1100, got %s", out.Draft.TargetAmount)
	}
	if out.Draft.Estimated {
		t.Fatal("a price from listings is not an estimate")
	}

	// Close to the listings: the model's figure stays.
	near := buildPlanResult(planDecision{Title: "Sofa"}, planAnswer{TargetAmount: "1050", PriceFrom: []int{1, 2, 3}}, cands, "ETB")
	if cleanAmount(near.Draft.TargetAmount) != cleanAmount("1050") {
		t.Fatalf("got %s", near.Draft.TargetAmount)
	}

	// No listing had a price: it is an estimate, and it says so.
	none := buildPlanResult(planDecision{Title: "Yacht"}, planAnswer{TargetAmount: "5000000"}, []planCandidate{cand("")}, "ETB")
	if !none.Draft.Estimated || none.Draft.Note == "" {
		t.Fatalf("estimate not flagged: %+v", none.Draft)
	}
}
