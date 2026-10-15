package goals

import "testing"

func TestGuessPrice_IgnoresMonthlyInstallment(t *testing.T) {
	html := `<div class="price">$2,000.00</div>
<div class="affirm">As low as <span>$68</span>/mo with Affirm</div>
<p>or 4 payments of $500 with Klarna</p>
<span class="price">$2,000.00</span>`
	price, cur := guessPrice(html)
	if price != "2000.00" {
		t.Fatalf("price=%q want 2000.00 (not the $68/mo plan)", price)
	}
	if cur != "USD" {
		t.Fatalf("currency=%q want USD", cur)
	}
}

func TestGuessPrice_PerMonthWording(t *testing.T) {
	html := `<h1>Laptop</h1><b>$1,299</b> <small>$54 per month</small> <i>$54 a month for 24 months</i>`
	price, _ := guessPrice(html)
	if price != "1299" {
		t.Fatalf("price=%q want 1299", price)
	}
}

func TestGuessPrice_RoundThousandIsNotAYear(t *testing.T) {
	// Regression: "$2000" used to be discarded as a model year, letting "$68/mo" win.
	html := `<span>$2000</span> <span>$68/mo</span>`
	price, _ := guessPrice(html)
	if price != "2000" {
		t.Fatalf("price=%q want 2000", price)
	}
}

func TestNormalizePrice_YearHandling(t *testing.T) {
	cases := map[string]string{
		"2018":      "",        // bare year
		"2,018":     "2018",    // thousands separator → price
		"2018.00":   "2018.00", // decimals → price
		"$2000":     "2000",    // currency marker → price
		"$2,000.00": "2000.00",
		"ETB 2000":  "2000",
		"USD2018":   "2018",
		"1899":      "1899",
	}
	for in, want := range cases {
		if got := normalizePrice(in); got != want {
			t.Errorf("normalizePrice(%q)=%q want %q", in, got, want)
		}
	}
}

func TestHarvestPrices_SkipsInstallments(t *testing.T) {
	html := `<li>$2,000</li><li>$68/mo</li><li>$1,950.00</li>`
	got := harvestPrices(html, "USD")
	if len(got) != 2 {
		t.Fatalf("got %d prices, want 2 (the /mo figure must be dropped): %v", len(got), got)
	}
	for _, d := range got {
		if d.StringFixed(2) == "68.00" {
			t.Fatalf("installment price leaked into market prices: %v", got)
		}
	}
}
