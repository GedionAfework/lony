package goals

import (
	"strings"
	"testing"
)

func TestShopHostRejectsNonStores(t *testing.T) {
	if shopHost("www.geocountries.com") {
		t.Fatal("geocountries is not a shop")
	}
	if !shopHost("www.amazon.com") || !shopHost("ebay.com") || !shopHost("www.samsung.com") {
		t.Fatal("amazon, ebay, and samsung are shops")
	}
}

func TestMarketSearchURLs_areInternational(t *testing.T) {
	for _, cur := range []string{"ETB", "USD", "EUR"} {
		urls := marketSearchURLs("Samsung Galaxy S26", cur)
		joined := strings.Join(urls, " ")
		if strings.Contains(joined, "jiji") || strings.Contains(joined, "jumia.com.et") || strings.Contains(joined, "Ethiopia") {
			t.Fatalf("%s search must not be limited to Ethiopian shops: %v", cur, urls)
		}
		if !strings.Contains(joined, "ebay.com") || !strings.Contains(joined, "amazon.com") || !strings.Contains(joined, "duckduckgo.com") {
			t.Fatalf("%s search should use global listings: %v", cur, urls)
		}
	}
}
