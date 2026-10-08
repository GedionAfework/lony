package goals

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"

	"equilend/api/internal/httpx"
)

type PreviewURLInput struct {
	URL string `json:"url"`
}

type PreviewURLResult struct {
	URL         string  `json:"url"`
	Title       string  `json:"title,omitempty"`
	Description string  `json:"description,omitempty"`
	ImageURL    string  `json:"image_url,omitempty"`
	Price       string  `json:"price,omitempty"`
	Currency    string  `json:"currency,omitempty"`
	SiteName    string  `json:"site_name,omitempty"`
}

var (
	metaPropertyRe = regexp.MustCompile(`(?is)<meta[^>]+(?:property|name)\s*=\s*["']([^"']+)["'][^>]+content\s*=\s*["']([^"']*)["'][^>]*>`)
	metaContentRe  = regexp.MustCompile(`(?is)<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+(?:property|name)\s*=\s*["']([^"']+)["'][^>]*>`)
	titleTagRe     = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	jsonLDRe       = regexp.MustCompile(`(?is)<script[^>]+type=["']application/ld\+json["'][^>]*>(.*?)</script>`)
	itemPropPriceRe = regexp.MustCompile(`(?is)itemprop\s*=\s*["']price["'][^>]*content\s*=\s*["']([^"']+)["']|content\s*=\s*["']([^"']+)["'][^>]*itemprop\s*=\s*["']price["']`)
	jsonPriceRe    = regexp.MustCompile(`(?i)"(?:price|salePrice|sale_price|currentPrice|current_price|amount)"\s*:\s*"?([0-9]+(?:\.[0-9]{1,2})?)"?`)
	jsonCurrencyRe = regexp.MustCompile(`(?i)"(?:priceCurrency|currency|currencyCode|currency_code)"\s*:\s*"([A-Z]{3})"`)
	// Comma-grouped alternative must come first *and* require at least one group; otherwise
	// leftmost-first matching turns "$2000" into "200".
	priceTokenRe   = regexp.MustCompile(`(?i)(?:USD|EUR|GBP|ETB|CAD|AUD|JPY|CHF|CNY|INR|\$|€|£)\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)`)
	barePriceRe    = regexp.MustCompile(`(?i)(?:["']?(?:price|salePrice|sale_price|amount|cost)["']?\s*[:=]\s*["']?)([0-9]{2,}(?:\.[0-9]{1,2})?)`)
	// "$68/mo", "$68 per month", "$68 a month", "68/mo." — financing, not the item price.
	installmentAfterRe  = regexp.MustCompile(`(?i)^\s*(?:</?[a-z][^>]*>\s*)*(?:/|per|a|each|every)\s*(?:mo\b|month|mth|wk|week|yr|year|bi-?weekly|fortnight)`)
	// Keyword must sit right before the amount (only tags / short filler in between), so a
	// "/mo" in a *previous* list item doesn't poison the next full price.
	installmentBeforeRe = regexp.MustCompile(`(?i)(?:as low as|starting at|starting from|from just|or\s+just|per month|monthly|installment|instalment|financ|affirm|klarna|afterpay|sezzle|zip pay|pay in \d|\bapr\b|est\.?\s*payment|payments? of|x\s*\d+\s*months?)[^0-9$€£<]{0,12}(?:<[^>]*>\s*){0,3}$`)
	bareYearRe          = regexp.MustCompile(`^\s*(?:19|20)[0-9]{2}\s*$`)
	leadingNonDigitRe   = regexp.MustCompile(`^[^0-9]+`)
	installmentJSONRe   = regexp.MustCompile(`(?i)(installment|instalment|monthly|per_?month|financ|affirm|klarna|afterpay|paymentPlan|payment_plan|subscription|recurring)`)
)

// isInstallmentContext reports whether the price token at [start,end) is a "/mo"-style payment, not the full price.
func isInstallmentContext(html string, start, end int) bool {
	after := html[end:min(len(html), end+48)]
	if installmentAfterRe.MatchString(after) {
		return true
	}
	before := html[max(0, start-120):start]
	return installmentBeforeRe.MatchString(before)
}

func (h *Handler) PreviewURL(w http.ResponseWriter, r *http.Request) {
	var body PreviewURLInput
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := PreviewProductURL(r.Context(), body.URL)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"preview": out})
}

func PreviewProductURL(ctx context.Context, raw string) (PreviewURLResult, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return PreviewURLResult{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"url": "required",
		})
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return PreviewURLResult{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"url": "must be a valid http(s) URL",
		})
	}
	if isPrivateHost(u.Hostname()) {
		return PreviewURLResult{}, httpx.E(http.StatusBadRequest, "BLOCKED_URL", "url host is not allowed")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return PreviewURLResult{}, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")

	client := &http.Client{
		Timeout: 12 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
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
		return PreviewURLResult{}, httpx.E(http.StatusBadGateway, "FETCH_FAILED", "could not fetch url")
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 400 {
		return PreviewURLResult{}, httpx.E(http.StatusBadGateway, "FETCH_FAILED", "url returned an error status")
	}
	limited := io.LimitReader(res.Body, 2<<20) // 2MB
	b, err := io.ReadAll(limited)
	if err != nil {
		return PreviewURLResult{}, httpx.E(http.StatusBadGateway, "FETCH_FAILED", "could not read url body")
	}
	html := string(b)
	meta := extractMeta(html)
	out := PreviewURLResult{
		URL:         u.String(),
		Title:       firstNonEmpty(meta["og:title"], meta["twitter:title"], meta["title"], extractTitle(html)),
		Description: firstNonEmpty(meta["og:description"], meta["twitter:description"], meta["description"]),
		ImageURL:    absolutize(u, firstNonEmpty(meta["og:image"], meta["og:image:url"], meta["twitter:image"], meta["twitter:image:src"])),
		SiteName:    firstNonEmpty(meta["og:site_name"], u.Hostname()),
		Currency:    strings.ToUpper(firstNonEmpty(meta["og:price:currency"], meta["product:price:currency"], meta["twitter:data2"])),
		Price:       firstNonEmpty(meta["og:price:amount"], meta["product:price:amount"], meta["twitter:data1"]),
	}
	applyJSONLD(&out, html, u)
	if out.Price == "" {
		if m := itemPropPriceRe.FindStringSubmatch(html); len(m) > 0 {
			out.Price = firstNonEmpty(m[1], m[2])
		}
	}
	if out.Price == "" {
		for _, loc := range jsonPriceRe.FindAllStringSubmatchIndex(html, 30) {
			if len(loc) < 4 || loc[2] < 0 {
				continue
			}
			before := html[max(0, loc[0]-160):loc[0]]
			if installmentJSONRe.MatchString(before) {
				continue
			}
			p := normalizePrice(html[loc[2]:loc[3]])
			if p == "" {
				continue
			}
			out.Price = p
			break
		}
	}
	if out.Currency == "" {
		if m := jsonCurrencyRe.FindStringSubmatch(html); len(m) >= 2 {
			out.Currency = strings.ToUpper(m[1])
		}
	}
	out.Price = normalizePrice(out.Price)
	if out.Price == "" || out.Currency == "" {
		price, cur := guessPrice(html)
		if out.Price == "" {
			out.Price = price
		}
		if out.Currency == "" {
			out.Currency = cur
		}
	}
	out.Title = cleanText(out.Title, 120)
	out.Description = cleanText(out.Description, 400)
	out.Price = normalizePrice(out.Price)
	if len(out.Currency) != 3 {
		out.Currency = ""
	}
	if out.Title == "" && out.Price == "" && out.ImageURL == "" {
		return PreviewURLResult{}, httpx.E(http.StatusUnprocessableEntity, "NO_PREVIEW", "could not extract product details from url")
	}
	return out, nil
}

func extractMeta(html string) map[string]string {
	out := map[string]string{}
	for _, m := range metaPropertyRe.FindAllStringSubmatch(html, -1) {
		key := strings.ToLower(strings.TrimSpace(m[1]))
		val := strings.TrimSpace(htmlUnescape(m[2]))
		if key != "" && val != "" {
			out[key] = val
		}
	}
	for _, m := range metaContentRe.FindAllStringSubmatch(html, -1) {
		key := strings.ToLower(strings.TrimSpace(m[2]))
		val := strings.TrimSpace(htmlUnescape(m[1]))
		if key != "" && val != "" {
			if _, ok := out[key]; !ok {
				out[key] = val
			}
		}
	}
	return out
}

func extractTitle(html string) string {
	m := titleTagRe.FindStringSubmatch(html)
	if len(m) < 2 {
		return ""
	}
	return htmlUnescape(stripTags(m[1]))
}

func applyJSONLD(out *PreviewURLResult, html string, base *url.URL) {
	for _, m := range jsonLDRe.FindAllStringSubmatch(html, -1) {
		raw := strings.TrimSpace(m[1])
		if raw == "" {
			continue
		}
		var anyVal any
		if err := json.Unmarshal([]byte(raw), &anyVal); err != nil {
			continue
		}
		walkJSONLD(out, anyVal, base)
	}
}

func walkJSONLD(out *PreviewURLResult, v any, base *url.URL) {
	switch t := v.(type) {
	case []any:
		for _, item := range t {
			walkJSONLD(out, item, base)
		}
	case map[string]any:
		typeVal := strings.ToLower(asString(t["@type"]))
		if strings.Contains(typeVal, "product") || strings.Contains(typeVal, "offer") || typeVal == "" {
			if out.Title == "" {
				out.Title = firstNonEmpty(asString(t["name"]), asString(t["headline"]))
			}
			if out.Description == "" {
				out.Description = asString(t["description"])
			}
			if out.ImageURL == "" {
				out.ImageURL = absolutize(base, firstImage(t["image"]))
			}
		}
		if offer, ok := t["offers"].(map[string]any); ok {
			if out.Price == "" {
				out.Price = asString(offer["price"])
			}
			if out.Currency == "" {
				out.Currency = strings.ToUpper(asString(offer["priceCurrency"]))
			}
		}
		if offers, ok := t["offers"].([]any); ok && len(offers) > 0 {
			if om, ok := offers[0].(map[string]any); ok {
				if out.Price == "" {
					out.Price = asString(om["price"])
				}
				if out.Currency == "" {
					out.Currency = strings.ToUpper(asString(om["priceCurrency"]))
				}
			}
		}
		if out.Price == "" {
			out.Price = asString(t["price"])
		}
		if out.Currency == "" {
			out.Currency = strings.ToUpper(asString(t["priceCurrency"]))
		}
		for _, child := range t {
			switch child.(type) {
			case map[string]any, []any:
				walkJSONLD(out, child, base)
			}
		}
	}
}

func firstImage(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case []any:
		if len(t) == 0 {
			return ""
		}
		return firstImage(t[0])
	case map[string]any:
		return firstNonEmpty(asString(t["url"]), asString(t["contentUrl"]), asString(t["@id"]))
	default:
		return ""
	}
}

func guessPrice(html string) (price, currency string) {
	type cand struct {
		price string
		cur   string
		score int
	}
	var cands []cand
	for _, loc := range priceTokenRe.FindAllStringSubmatchIndex(html, 60) {
		if len(loc) < 4 || loc[2] < 0 {
			continue
		}
		if isInstallmentContext(html, loc[0], loc[1]) {
			continue
		}
		// Pass the whole token: its currency marker means "$2000" is a price, not a year.
		tok := html[loc[0]:loc[1]]
		p := normalizePrice(tok)
		if p == "" {
			continue
		}
		cur := ""
		switch {
		case strings.Contains(tok, "$"):
			cur = "USD"
		case strings.Contains(tok, "€"):
			cur = "EUR"
		case strings.Contains(tok, "£"):
			cur = "GBP"
		default:
			for _, c := range []string{"USD", "EUR", "GBP", "ETB", "CAD", "AUD", "JPY", "CHF", "CNY", "INR"} {
				if strings.Contains(strings.ToUpper(tok), c) {
					cur = c
					break
				}
			}
		}
		score := 2
		if cur != "" {
			score += 2
		}
		f, _ := strconv.ParseFloat(p, 64)
		if f >= 10 && f <= 1_000_000 {
			score += 2
		}
		cands = append(cands, cand{price: p, cur: cur, score: score})
	}
	for _, loc := range barePriceRe.FindAllStringSubmatchIndex(html, 20) {
		if len(loc) < 4 || loc[2] < 0 {
			continue
		}
		if installmentJSONRe.MatchString(html[max(0, loc[0]-160):loc[0]]) {
			continue
		}
		// No currency marker here, so a bare "2018" stays suspicious (normalizePrice drops it).
		p := normalizePrice(html[loc[2]:loc[3]])
		if p == "" {
			continue
		}
		f, _ := strconv.ParseFloat(p, 64)
		score := 1
		if f >= 10 && f <= 1_000_000 {
			score += 2
		}
		cands = append(cands, cand{price: p, score: score})
	}
	// Among equally-scored candidates prefer the one that repeats most (the headline price
	// is usually rendered several times; a stray financing figure usually isn't).
	freq := map[string]int{}
	for _, c := range cands {
		freq[c.price]++
	}
	bestIdx := -1
	for i, c := range cands {
		if bestIdx < 0 {
			bestIdx = i
			continue
		}
		b := cands[bestIdx]
		if c.score > b.score || (c.score == b.score && freq[c.price] > freq[b.price]) {
			bestIdx = i
		}
	}
	if bestIdx >= 0 {
		return cands[bestIdx].price, cands[bestIdx].cur
	}
	return "", ""
}

func isYearLikePrice(p string) bool {
	f, err := strconv.ParseFloat(p, 64)
	if err != nil {
		return false
	}
	if f != float64(int64(f)) {
		return false
	}
	return f >= 1900 && f <= 2099
}

// normalizePrice turns "$2,000.00" into "2000.00". A bare 4-digit integer in 1900–2099 with no
// currency marker, thousands separator or decimals ("2018") is treated as a model year and dropped;
// "$2,000", "2,000" and "2000.00" are real prices and kept.
func normalizePrice(p string) string {
	p = strings.TrimSpace(p)
	bareYearCandidate := bareYearRe.MatchString(p)
	p = strings.ReplaceAll(p, ",", "")
	// Strip any currency marker ("$", "USD ", "ETB ", "Br ") so the full token can be passed in.
	p = strings.TrimSpace(leadingNonDigitRe.ReplaceAllString(p, ""))
	if p == "" {
		return ""
	}
	f, err := strconv.ParseFloat(p, 64)
	if err != nil || f <= 0 {
		return ""
	}
	if bareYearCandidate && isYearLikePrice(p) {
		return ""
	}
	return p
}

func absolutize(base *url.URL, ref string) string {
	ref = strings.TrimSpace(ref)
	if ref == "" || base == nil {
		return ref
	}
	u, err := url.Parse(ref)
	if err != nil {
		return ref
	}
	return base.ResolveReference(u).String()
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func asString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	case json.Number:
		return t.String()
	default:
		return ""
	}
}

func cleanText(s string, max int) string {
	s = strings.TrimSpace(stripTags(htmlUnescape(s)))
	s = strings.Join(strings.Fields(s), " ")
	if max > 0 {
		r := []rune(s)
		if len(r) > max {
			s = string(r[:max])
		}
	}
	return s
}

func stripTags(s string) string {
	var b strings.Builder
	in := false
	for _, r := range s {
		if r == '<' {
			in = true
			continue
		}
		if r == '>' {
			in = false
			continue
		}
		if !in {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func htmlUnescape(s string) string {
	replacer := strings.NewReplacer(
		"&amp;", "&",
		"&lt;", "<",
		"&gt;", ">",
		"&quot;", `"`,
		"&#39;", "'",
		"&apos;", "'",
		"&nbsp;", " ",
	)
	return replacer.Replace(s)
}

func isPrivateHost(host string) bool {
	h := strings.ToLower(strings.TrimSpace(host))
	if h == "" || h == "localhost" || strings.HasSuffix(h, ".localhost") || h == "0.0.0.0" {
		return true
	}
	// Block obvious private / link-local / metadata hosts without full DNS resolve.
	if strings.HasPrefix(h, "127.") || strings.HasPrefix(h, "10.") || strings.HasPrefix(h, "192.168.") ||
		strings.HasPrefix(h, "169.254.") || strings.HasPrefix(h, "0.") {
		return true
	}
	if strings.HasPrefix(h, "172.") {
		parts := strings.Split(h, ".")
		if len(parts) > 1 {
			n, _ := strconv.Atoi(parts[1])
			if n >= 16 && n <= 31 {
				return true
			}
		}
	}
	for _, r := range h {
		if unicode.IsSpace(r) {
			return true
		}
	}
	return false
}
