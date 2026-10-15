package goals

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

// WebResult is one organic search hit.
type WebResult struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Site    string `json:"site"`
	Snippet string `json:"snippet,omitempty"`
}

// WebPage is a search hit after its page was read.
type WebPage struct {
	WebResult
	ImageURL     string `json:"image_url,omitempty"`
	Price        string `json:"price,omitempty"`
	CurrencyCode string `json:"currency_code,omitempty"`
	Description  string `json:"description,omitempty"`
}

// WebImage is one image search hit. ThumbURL is served by the search engine and always loads.
type WebImage struct {
	ImageURL string `json:"image_url"`
	ThumbURL string `json:"thumb_url,omitempty"`
	PageURL  string `json:"page_url,omitempty"`
	Site     string `json:"site,omitempty"`
	Title    string `json:"title,omitempty"`
}

var (
	bingImageMetaRe = regexp.MustCompile(`\bm="(\{[^"]*\})"`)
	ddgResultRe     = regexp.MustCompile(`(?s)<a[^>]*class="result__a"[^>]*>.*?</a>`)
	ddgSnippetRe    = regexp.MustCompile(`(?s)class="result__snippet"[^>]*>(.*?)</a>`)
	hrefAttrRe      = regexp.MustCompile(`href="([^"]+)"`)
	anchorTextRe    = regexp.MustCompile(`(?s)<a[^>]*>(.*?)</a>`)
	bingResultRe    = regexp.MustCompile(`(?s)<li class="b_algo".*?</li>`)
	bingLinkRe      = regexp.MustCompile(`(?s)<h2[^>]*>\s*<a[^>]*href="(https?://[^"]+)"[^>]*>(.*?)</a>`)
	bingParaRe      = regexp.MustCompile(`(?s)<p[^>]*>(.*?)</p>`)
)

// junkHost is for sites that never carry a usable price, picture, or listing.
func junkHost(host string) bool {
	h := strings.TrimPrefix(strings.ToLower(host), "www.")
	for _, s := range []string{
		"duckduckgo.com", "bing.com", "google.", "geocountries", "pinterest.", "facebook.com",
		"instagram.com", "tiktok.com", "x.com", "twitter.com", "linkedin.com", "quora.com",
		"youtube.com", "youtu.be", "translate.", "dictionary.", "merriam-webster", "thesaurus",
	} {
		if strings.HasPrefix(h, s) || strings.Contains(h, "."+s) {
			return true
		}
	}
	return false
}

// SearchWeb returns organic results for query, up to limit, from DuckDuckGo with a Bing fallback.
func SearchWeb(ctx context.Context, query string, limit int) []WebResult {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil
	}
	if limit <= 0 {
		limit = 8
	}
	html, _, err := fetchSearchHTML(ctx, "https://html.duckduckgo.com/html/?q="+url.QueryEscape(query))
	var out []WebResult
	if err == nil {
		out = parseDDGResults(html, limit)
	}
	if len(out) == 0 {
		if html, _, err := fetchSearchHTML(ctx, "https://www.bing.com/search?setlang=en&q="+url.QueryEscape(query)); err == nil {
			out = parseBingResults(html, limit)
		}
	}
	return out
}

func parseDDGResults(html string, limit int) []WebResult {
	var out []WebResult
	seen := map[string]struct{}{}
	locs := ddgResultRe.FindAllStringIndex(html, -1)
	for i, loc := range locs {
		tag := html[loc[0]:loc[1]]
		hm := hrefAttrRe.FindStringSubmatch(tag)
		if len(hm) < 2 {
			continue
		}
		link := ddgTarget(htmlUnescape(hm[1]))
		if link == "" {
			continue
		}
		title := ""
		if tm := anchorTextRe.FindStringSubmatch(tag); len(tm) >= 2 {
			title = cleanText(stripTags(tm[1]), 140)
		}
		end := len(html)
		if i+1 < len(locs) {
			end = locs[i+1][0]
		}
		snippet := ""
		if sm := ddgSnippetRe.FindStringSubmatch(html[loc[1]:end]); len(sm) >= 2 {
			snippet = cleanText(stripTags(sm[1]), 300)
		}
		if r, ok := webResult(link, title, snippet, seen); ok {
			out = append(out, r)
			if len(out) >= limit {
				break
			}
		}
	}
	return out
}

func ddgTarget(href string) string {
	if strings.HasPrefix(href, "//") {
		href = "https:" + href
	}
	u, err := url.Parse(href)
	if err != nil {
		return ""
	}
	if strings.Contains(u.Hostname(), "duckduckgo.com") {
		if strings.HasPrefix(u.Path, "/y.js") {
			return ""
		}
		return u.Query().Get("uddg")
	}
	return href
}

func parseBingResults(html string, limit int) []WebResult {
	var out []WebResult
	seen := map[string]struct{}{}
	for _, block := range bingResultRe.FindAllString(html, -1) {
		lm := bingLinkRe.FindStringSubmatch(block)
		if len(lm) < 3 {
			continue
		}
		link := bingTarget(htmlUnescape(lm[1]))
		snippet := ""
		if pm := bingParaRe.FindStringSubmatch(block); len(pm) >= 2 {
			snippet = cleanText(stripTags(pm[1]), 300)
		}
		if r, ok := webResult(link, cleanText(stripTags(lm[2]), 140), snippet, seen); ok {
			out = append(out, r)
			if len(out) >= limit {
				break
			}
		}
	}
	return out
}

// bingTarget unwraps bing.com/ck/a?u=a1<base64url> click links.
func bingTarget(href string) string {
	u, err := url.Parse(href)
	if err != nil {
		return ""
	}
	if !strings.HasSuffix(u.Hostname(), "bing.com") {
		return href
	}
	enc := u.Query().Get("u")
	if !strings.HasPrefix(enc, "a1") {
		return ""
	}
	enc = enc[2:]
	b, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(enc, "="))
	if err != nil {
		return ""
	}
	return string(b)
}

// SearchImages returns pictures of query from Bing Images.
func SearchImages(ctx context.Context, query string, limit int) []WebImage {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil
	}
	html, _, err := fetchSearchHTML(ctx, "https://www.bing.com/images/search?setlang=en&first=1&q="+url.QueryEscape(query))
	if err != nil {
		return nil
	}
	return parseBingImages(html, limit)
}

func parseBingImages(html string, limit int) []WebImage {
	if limit <= 0 {
		limit = 6
	}
	var out []WebImage
	seen := map[string]struct{}{}
	for _, m := range bingImageMetaRe.FindAllStringSubmatch(html, 40) {
		var meta struct {
			PURL string `json:"purl"`
			MURL string `json:"murl"`
			TURL string `json:"turl"`
			T    string `json:"t"`
		}
		if json.Unmarshal([]byte(htmlUnescape(m[1])), &meta) != nil {
			continue
		}
		img, err := url.Parse(meta.MURL)
		if err != nil || (img.Scheme != "http" && img.Scheme != "https") || img.Host == "" {
			continue
		}
		page := ""
		site := ""
		if p, err := url.Parse(meta.PURL); err == nil && p.Host != "" {
			if junkHost(p.Hostname()) {
				continue
			}
			page = p.String()
			site = strings.TrimPrefix(p.Hostname(), "www.")
		}
		if _, ok := seen[meta.MURL]; ok {
			continue
		}
		seen[meta.MURL] = struct{}{}
		out = append(out, WebImage{
			ImageURL: meta.MURL,
			ThumbURL: htmlUnescape(meta.TURL),
			PageURL:  page,
			Site:     site,
			Title:    cleanText(meta.T, 140),
		})
		if len(out) >= limit {
			break
		}
	}
	return out
}

func webResult(link, title, snippet string, seen map[string]struct{}) (WebResult, bool) {
	u, err := url.Parse(strings.TrimSpace(link))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return WebResult{}, false
	}
	host := u.Hostname()
	if junkHost(host) || isPrivateHost(host) {
		return WebResult{}, false
	}
	key := strings.TrimSuffix(host+u.Path, "/")
	if _, ok := seen[key]; ok {
		return WebResult{}, false
	}
	seen[key] = struct{}{}
	return WebResult{Title: title, URL: u.String(), Site: strings.TrimPrefix(host, "www."), Snippet: snippet}, true
}

// WebFindings is what a web lookup produced.
type WebFindings struct {
	Pages  []WebPage
	Images []WebImage
}

// ReadWeb searches each query and imageQuery at once, merges the hits, and reads up to
// maxPages pages in parallel for a picture, a price, and a description. Pages that fail
// keep their snippet, and get a picture from the same site when the image search has one.
func ReadWeb(ctx context.Context, queries []string, imageQuery string, maxPages int, budget time.Duration) WebFindings {
	ctx, cancel := context.WithTimeout(ctx, budget)
	defer cancel()

	var images []WebImage
	imagesDone := make(chan struct{})
	go func() {
		defer close(imagesDone)
		images = SearchImages(ctx, imageQuery, 8)
	}()

	lists := make([][]WebResult, len(queries))
	var wg sync.WaitGroup
	for i, q := range queries {
		wg.Add(1)
		go func(i int, q string) {
			defer wg.Done()
			lists[i] = SearchWeb(ctx, q, 8)
		}(i, q)
	}
	wg.Wait()

	// Interleave so each query contributes its best hits.
	var hits []WebResult
	seen := map[string]struct{}{}
	for round := 0; round < 8 && len(hits) < maxPages; round++ {
		for _, l := range lists {
			if round >= len(l) || len(hits) >= maxPages {
				continue
			}
			r := l[round]
			if _, ok := seen[r.URL]; ok {
				continue
			}
			seen[r.URL] = struct{}{}
			hits = append(hits, r)
		}
	}

	pages := make([]WebPage, len(hits))
	for i, h := range hits {
		pages[i] = WebPage{WebResult: h}
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			p, err := PreviewProductURL(ctx, pages[i].URL)
			if err != nil {
				return
			}
			if pages[i].Title == "" {
				pages[i].Title = p.Title
			}
			pages[i].ImageURL = p.ImageURL
			pages[i].Description = cleanText(p.Description, 240)
			if p.Price != "" && !isYearLikePrice(p.Price) {
				pages[i].Price = p.Price
				pages[i].CurrencyCode = p.Currency
			}
		}(i)
	}
	wg.Wait()
	<-imagesDone

	for i := range pages {
		if pages[i].ImageURL != "" {
			continue
		}
		for _, img := range images {
			if img.Site != "" && strings.EqualFold(img.Site, pages[i].Site) {
				pages[i].ImageURL = img.ImageURL
				break
			}
		}
	}
	return WebFindings{Pages: pages, Images: images}
}
