package goals

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"equilend/api/internal/httpx"

	"github.com/shopspring/decimal"
)

type MarketListing struct {
	Title        string `json:"title,omitempty"`
	Price        string `json:"price"`
	CurrencyCode string `json:"currency_code"`
	URL          string `json:"url,omitempty"`
	Site         string `json:"site,omitempty"`
}

type MarketSearchResult struct {
	Query        string          `json:"query"`
	CurrencyCode string          `json:"currency_code"`
	Low          string          `json:"low,omitempty"`
	High         string          `json:"high,omitempty"`
	Typical      string          `json:"typical,omitempty"`
	Listings     []MarketListing `json:"listings"`
	SourceURL    string          `json:"source_url,omitempty"`
	SampleCount  int             `json:"sample_count"`
}

type marketSearchBody struct {
	Query        string `json:"query"`
	CurrencyCode string `json:"currency_code"`
}

var (
	ddgHrefRe   = regexp.MustCompile(`uddg=([^&"]+)`)
	htmlPriceRe = regexp.MustCompile(`(?i)(?:ETB|Br|USD|EUR|GBP|\$|€|£)\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?|[0-9]{2,7}(?:\.[0-9]{1,2})?)`)
	stopQueryRe   = regexp.MustCompile(`(?i)\b(i|i'm|im|wanna|want|to|buy|get|a|an|the|please|just|for|my|me|some|new plan|saving for)\b`)
	multiSpaceRe  = regexp.MustCompile(`\s+`)
)

func (h *Handler) SearchMarket(w http.ResponseWriter, r *http.Request) {
	var body marketSearchBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := SearchMarketPrices(r.Context(), body.Query, body.CurrencyCode)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"market": out})
}

func cleanSearchQuery(raw string) string {
	s := strings.TrimSpace(raw)
	s = planURLRe.ReplaceAllString(s, " ")
	s = stopQueryRe.ReplaceAllString(s, " ")
	s = multiSpaceRe.ReplaceAllString(s, " ")
	return strings.TrimSpace(s)
}

func marketSearchURLs(query, currency string) []string {
	q := url.QueryEscape(query)
	webQ := query + " price"
	if strings.EqualFold(currency, "ETB") {
		webQ = query + " price Ethiopia ETB"
	} else if currency != "" {
		webQ = query + " price " + currency
	}
	out := []string{
		"https://html.duckduckgo.com/html/?q=" + url.QueryEscape(webQ),
	}
	if strings.EqualFold(currency, "ETB") {
		out = append(out,
			"https://jiji.com.et/search?query="+q,
			"https://www.jumia.com.et/catalog/?q="+q,
		)
	} else {
		out = append(out, "https://www.ebay.com/sch/i.html?_nkw="+q+"&_sop=15")
	}
	return out
}

func fetchSearchHTML(ctx context.Context, raw string) (string, string, error) {
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "", "", err
	}
	if isPrivateHost(u.Hostname()) {
		return "", "", httpx.E(http.StatusBadRequest, "BLOCKED_URL", "url host is not allowed")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	client := &http.Client{
		Timeout: 6 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 4 {
				return http.ErrUseLastResponse
			}
			if isPrivateHost(req.URL.Hostname()) {
				return http.ErrUseLastResponse
			}
			return nil
		},
	}
	res, err := client.Do(req)
	if err != nil {
		return "", "", err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 400 {
		return "", "", httpx.E(http.StatusBadGateway, "FETCH_FAILED", "url returned an error status")
	}
	b, err := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if err != nil {
		return "", "", err
	}
	final := raw
	if res.Request != nil && res.Request.URL != nil {
		final = res.Request.URL.String()
	}
	return string(b), final, nil
}

func harvestPrices(html, currency string) []decimal.Decimal {
	var out []decimal.Decimal
	seen := map[string]struct{}{}
	for _, loc := range htmlPriceRe.FindAllStringSubmatchIndex(html, 80) {
		if len(loc) < 4 || loc[2] < 0 {
			continue
		}
		if isInstallmentContext(html, loc[0], loc[1]) {
			continue
		}
		// Whole token (with currency marker) so "ETB 2000" isn't mistaken for a year.
		raw := normalizePrice(html[loc[0]:loc[1]])
		if raw == "" {
			continue
		}
		d, err := decimal.NewFromString(raw)
		if err != nil || !plausibleMarketPrice(d, currency) {
			continue
		}
		key := d.StringFixed(Scale)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, d)
	}
	for _, m := range jsonPriceRe.FindAllStringSubmatch(html, 40) {
		raw := normalizePrice(m[1])
		if raw == "" {
			continue
		}
		d, err := decimal.NewFromString(raw)
		if err != nil || !plausibleMarketPrice(d, currency) {
			continue
		}
		key := d.StringFixed(Scale)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, d)
	}
	return out
}

func harvestListings(html, pageURL, currency string) []MarketListing {
	var out []MarketListing
	host := pageURL
	if u, err := url.Parse(pageURL); err == nil {
		host = u.Hostname()
	}
	for i, m := range ddgHrefRe.FindAllStringSubmatch(html, 8) {
		if i >= 5 {
			break
		}
		raw, err := url.QueryUnescape(m[1])
		if err != nil || !strings.HasPrefix(raw, "http") {
			continue
		}
		out = append(out, MarketListing{
			URL:          raw,
			Site:         host,
			CurrencyCode: currency,
		})
	}
	if len(out) == 0 && pageURL != "" {
		out = append(out, MarketListing{URL: pageURL, Site: host, CurrencyCode: currency})
	}
	return out
}

// plausibleMarketPrice bounds-checks a price. Bare model years ("2018") are already dropped by
// normalizePrice; "$2,000" or "2000.00" are legitimate prices and must not be rejected here.
func plausibleMarketPrice(d decimal.Decimal, currency string) bool {
	if !d.GreaterThan(decimal.Zero) {
		return false
	}
	if strings.EqualFold(currency, "ETB") {
		return d.GreaterThanOrEqual(decimal.NewFromInt(200)) && d.LessThanOrEqual(decimal.NewFromInt(30000000))
	}
	return d.GreaterThanOrEqual(decimal.NewFromInt(20)) && d.LessThanOrEqual(decimal.NewFromInt(2000000))
}

func medianPrice(ds []decimal.Decimal) decimal.Decimal {
	if len(ds) == 0 {
		return decimal.Zero
	}
	sort.Slice(ds, func(i, j int) bool { return ds[i].LessThan(ds[j]) })
	n := len(ds)
	if n%2 == 1 {
		return ds[n/2]
	}
	return ds[n/2-1].Add(ds[n/2]).Div(decimal.NewFromInt(2))
}

// SearchMarketPrices scrapes live listings / search pages and returns a typical selling price.
func SearchMarketPrices(ctx context.Context, rawQuery, currency string) (MarketSearchResult, error) {
	query := cleanSearchQuery(rawQuery)
	if query == "" || utf8.RuneCountInString(query) > 200 {
		return MarketSearchResult{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"query": "required, max 200 characters",
		})
	}
	currency = strings.ToUpper(strings.TrimSpace(currency))
	if len(currency) != 3 {
		currency = "USD"
	}

	// Hard cap so the phone never sits on "Thinking…" — slow sources are simply skipped.
	ctx, cancel := context.WithTimeout(ctx, 7*time.Second)
	defer cancel()

	targets := marketSearchURLs(query, currency)
	var mu sync.Mutex
	var prices []decimal.Decimal
	var listings []MarketListing

	var wg sync.WaitGroup
	for _, t := range targets {
		wg.Add(1)
		go func(target string) {
			defer wg.Done()
			html, finalURL, err := fetchSearchHTML(ctx, target)
			if err != nil || html == "" {
				return
			}
			found := harvestPrices(html, currency)
			ls := harvestListings(html, finalURL, currency)
			mu.Lock()
			prices = append(prices, found...)
			listings = append(listings, ls...)
			mu.Unlock()
		}(t)
	}
	wg.Wait()

	out := MarketSearchResult{
		Query:        query,
		CurrencyCode: currency,
		Listings:     []MarketListing{},
	}
	if len(prices) == 0 {
		return out, nil
	}
	sorted := append([]decimal.Decimal{}, prices...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].LessThan(sorted[j]) })
	typ := medianPrice(sorted)
	out.Low = sorted[0].StringFixed(Scale)
	out.High = sorted[len(sorted)-1].StringFixed(Scale)
	out.Typical = typ.StringFixed(Scale)
	out.SampleCount = len(sorted)

	for i := range listings {
		if listings[i].Price == "" {
			listings[i].Price = out.Typical
			listings[i].CurrencyCode = currency
		}
		if out.SourceURL == "" && listings[i].URL != "" {
			out.SourceURL = listings[i].URL
		}
		out.Listings = append(out.Listings, listings[i])
		if len(out.Listings) >= 6 {
			break
		}
	}
	return out, nil
}
