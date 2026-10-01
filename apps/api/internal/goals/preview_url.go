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
	priceTokenRe   = regexp.MustCompile(`(?i)(?:USD|EUR|GBP|ETB|CAD|AUD|JPY|CHF|CNY|INR|\$|€|£)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)`)
	barePriceRe    = regexp.MustCompile(`(?i)(?:price|amount|cost)["'\s:=]+["']?([0-9]+(?:\.[0-9]{1,2})?)`)
)

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
	req.Header.Set("User-Agent", "LonyBot/1.0 (+https://lony.app; product preview)")
	req.Header.Set("Accept", "text/html,application/xhtml+xml")

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
	if m := priceTokenRe.FindStringSubmatch(html); len(m) >= 2 {
		tok := m[0]
		price = normalizePrice(m[1])
		switch {
		case strings.Contains(tok, "$"):
			currency = "USD"
		case strings.Contains(tok, "€"):
			currency = "EUR"
		case strings.Contains(tok, "£"):
			currency = "GBP"
		default:
			for _, c := range []string{"USD", "EUR", "GBP", "ETB", "CAD", "AUD", "JPY", "CHF", "CNY", "INR"} {
				if strings.Contains(strings.ToUpper(tok), c) {
					currency = c
					break
				}
			}
		}
		return price, currency
	}
	if m := barePriceRe.FindStringSubmatch(html); len(m) >= 2 {
		return normalizePrice(m[1]), ""
	}
	return "", ""
}

func normalizePrice(p string) string {
	p = strings.TrimSpace(p)
	p = strings.ReplaceAll(p, ",", "")
	if p == "" {
		return ""
	}
	if _, err := strconv.ParseFloat(p, 64); err != nil {
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
