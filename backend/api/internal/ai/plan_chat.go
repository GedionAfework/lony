package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"equilend/api/internal/ai/llm"
	"equilend/api/internal/fx"
	"equilend/api/internal/goals"
	"equilend/api/internal/httpx"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// PlanChatTurn is one message from the Plan assistant conversation.
type PlanChatTurn struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// PlanSource is a web page the assistant used, shown to the user as a card.
type PlanSource struct {
	Title        string `json:"title"`
	URL          string `json:"url"`
	Site         string `json:"site"`
	ImageURL     string `json:"image_url,omitempty"`
	Price        string `json:"price,omitempty"`
	CurrencyCode string `json:"currency_code,omitempty"`
	PriceLocal   string `json:"price_local,omitempty"`
}

// PlanChatResult is what the assistant says, the goal draft once a price is known, and the pages behind it.
type PlanChatResult struct {
	Reply    string           `json:"reply"`
	Draft    *goals.PlanDraft `json:"draft,omitempty"`
	ImageURL string           `json:"image_url,omitempty"`
	Images   []goals.WebImage `json:"images,omitempty"`
	Sources  []PlanSource     `json:"sources,omitempty"`
}

const planDecidePrompt = `You are Lony's shopping and planning assistant. The user wants to buy or save for something: anything from headphones or a sofa to a car, a house, land, a yacht, or a trip.
You can search the web. Decide the next step and return ONLY JSON with keys:
action, reply, query, alt_query, title, goal_type, target_date, user_amount, user_currency.

action:
- "search" when you know enough to look the item up. This is the normal case.
- "ask" only when one missing detail would change the price a lot and you cannot pick a sensible default:
  * a brand with many models and no model ("a Samsung phone", "a Toyota") -> ask which model and name the current one as an option;
  * a house, apartment, or land with no city or country -> ask where;
  * "a yacht" or "a boat" with no size or kind -> ask roughly what size or kind.
  Simple items ("a sofa", "running shoes", "a PS5", "a bike") never need a question. Search them.
- "reply" when there is no item to look up (greetings, thanks, a question about saving).
If the user answered a question, said "any", "you pick", "latest", "cheapest", "best", or you already asked once about this item, choose "search". Never ask twice in a row.
Never ask the user for a price or a link. They opened you because they do not have one.

reply: for "ask" one short question; for "reply" 1-3 sentences; for "search" a short line like "Looking up the Toyota RAV4 2025".
query: an English web search query for the latest item only, with model, year, size, and location as relevant. Add "price" or "for sale" when that finds listings. Examples: "Toyota RAV4 2025 price", "3 bedroom house for sale Austin Texas", "Sunseeker Manhattan 55 for sale", "Samsung Galaxy S26 Ultra price". Fill query even when asking, as your best guess.
alt_query: a second query that finds a different kind of page (official product page, a marketplace, or a review with prices). Empty if not useful.
title: the item, max 80 characters. Price only the latest item. Never join two products into one title.
goal_type: travel, purchase, savings, debt_payoff, or custom.
target_date: YYYY-MM-DD only if they named a date.
user_amount and user_currency: only if the user stated their own budget or price; digits only.`

const planAnswerPrompt = `You are Lony's shopping and planning assistant. You just searched the web for the user's item.
Below are the pages found, numbered. Prices were read from the pages; "≈" is converted to the user's currency at today's rate.
Return ONLY JSON with keys: reply, title, goal_type, target_amount, note, sources, price_from, image, images.

sources: page numbers that are really about this item (same model, kind, size, or location), best first, max 5. Leave out accessories, cases, parts, rentals when they want to buy, unrelated products, and pages with nothing useful. An empty list is fine.
price_from: page numbers whose price you used for target_amount.
image: the page number whose picture best shows the item, or 0.
images: numbers from "Pictures found" (write 1 for I1) that show this exact item, best first, max 4. Leave out logos, people, maps, and other products.
target_amount: the typical current price in the user's currency, digits only. Use the converted figures. Prefer prices from the pages in sources; snippet prices count. If several, use a typical middle value, not the lowest outlier. A figure far below the others is usually a monthly payment, deposit, or accessory; ignore it. If no page has a relevant price, give your best current estimate from your own knowledge. Never a calendar year. Empty only if the item cannot be priced at all.
note: one sentence on where the number comes from.
reply: 2-4 plain sentences for the chat. Say what the item is and its price or range, name the sites it came from, or say clearly it is your estimate when no page had a price. Add one useful tip when it fits (for a house or yacht: taxes, fees, upkeep; for a car: import duty or used vs new). Do not ask for a price or a link. Do not list URLs, the app shows them as cards.`

type planDecision struct {
	Action       string `json:"action"`
	Reply        string `json:"reply"`
	Query        string `json:"query"`
	AltQuery     string `json:"alt_query"`
	Title        string `json:"title"`
	GoalType     string `json:"goal_type"`
	TargetDate   string `json:"target_date"`
	UserAmount   string `json:"user_amount"`
	UserCurrency string `json:"user_currency"`
}

type planAnswer struct {
	Reply        string `json:"reply"`
	Title        string `json:"title"`
	GoalType     string `json:"goal_type"`
	TargetAmount string `json:"target_amount"`
	Note         string `json:"note"`
	Sources      []int  `json:"sources"`
	PriceFrom    []int  `json:"price_from"`
	Image        int    `json:"image"`
	Images       []int  `json:"images"`
}

// planCandidate is a read page plus its price in the user's currency.
type planCandidate struct {
	goals.WebPage
	PriceLocal string
}

var (
	askPriceRe = regexp.MustCompile(`(?i)(how much|what(?:'s| is) the price|price do you|your price|tell me the price|do you have a (?:price|link)|paste a link|product link|send (?:me )?a link|if you have a link|your budget|what would you pay|know the price)`)
	jsonObjRe  = regexp.MustCompile(`(?s)\{.*\}`)
)

func (s *Service) SetFX(c *fx.Client) { s.fx = c }

func (s *Service) PlanChat(ctx context.Context, userID uuid.UUID, currency string, turns []PlanChatTurn) (PlanChatResult, error) {
	if err := s.ensureAIEnabled(ctx, userID); err != nil {
		return PlanChatResult{}, err
	}
	if s.llm == nil || !s.llm.Available() {
		return PlanChatResult{}, httpx.E(http.StatusServiceUnavailable, "AI_UNAVAILABLE", "AI is not configured")
	}
	if err := s.allowLLM(ctx, userID); err != nil {
		return PlanChatResult{}, err
	}
	currency = strings.ToUpper(strings.TrimSpace(currency))
	if len(currency) != 3 {
		currency = "USD"
	}
	history := planHistory(turns)
	if len(history) == 0 {
		return PlanChatResult{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"messages": "required",
		})
	}
	now := s.now()
	header := "The user's currency is " + currency + ".\n" + productCalendar(now)

	msgs := append([]llm.Message{{Role: "system", Content: planDecidePrompt + "\n" + header}}, history...)
	res, err := s.llm.Chat(ctx, msgs, 400)
	if err != nil {
		return PlanChatResult{}, httpx.E(http.StatusBadGateway, "AI_ERROR", "The assistant could not answer. Try again.")
	}
	dec := parseDecision(res.Content)
	if dec.Action == "ask" && lastAssistantAsked(turns) && dec.Query != "" {
		dec.Action = "search"
	}
	switch dec.Action {
	case "ask", "reply":
		reply := strings.TrimSpace(dec.Reply)
		if reply == "" || asksUserForPrice(reply) {
			reply = "What would you like to buy or save for?"
		}
		return PlanChatResult{Reply: reply}, nil
	}
	if dec.Query == "" {
		dec.Query = lastUserText(turns)
	}

	queries := []string{dec.Query}
	if q := strings.TrimSpace(dec.AltQuery); q != "" && !strings.EqualFold(q, dec.Query) {
		queries = append(queries, q)
	}
	found := goals.ReadWeb(ctx, queries, firstNonBlank(dec.Title, dec.Query), 8, 14*time.Second)
	cands := s.localizePrices(ctx, found.Pages, currency)

	answerMsgs := append([]llm.Message{{
		Role:    "system",
		Content: planAnswerPrompt + "\n" + header + "\nSearched for: " + dec.Query + "\n\n" + formatCandidates(cands, currency) + formatImages(found.Images),
	}}, history...)
	res2, err := s.llm.Chat(ctx, answerMsgs, 600)
	if err != nil {
		return PlanChatResult{}, httpx.E(http.StatusBadGateway, "AI_ERROR", "The assistant could not answer. Try again.")
	}
	ans := parseAnswer(res2.Content)
	out := buildPlanResult(dec, ans, cands, currency)
	out.Images = pickImages(ans.Images, found.Images)
	if len(out.Images) > 0 {
		if out.Draft.ImageURL == "" {
			out.Draft.ImageURL = out.Images[0].ImageURL
		}
		if out.ImageURL == "" {
			out.ImageURL = out.Images[0].ImageURL
		}
	}
	return out, nil
}

func formatImages(imgs []goals.WebImage) string {
	if len(imgs) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("\nPictures found:\n")
	for i, img := range imgs {
		fmt.Fprintf(&b, "[I%d] %s — %s\n", i+1, img.Title, img.Site)
	}
	return b.String()
}

func pickImages(picks []int, imgs []goals.WebImage) []goals.WebImage {
	var out []goals.WebImage
	used := map[int]bool{}
	for _, n := range picks {
		if n < 1 || n > len(imgs) || used[n] {
			continue
		}
		used[n] = true
		out = append(out, imgs[n-1])
		if len(out) >= 4 {
			break
		}
	}
	return out
}

func planHistory(turns []PlanChatTurn) []llm.Message {
	var out []llm.Message
	for _, t := range turns {
		role := strings.ToLower(strings.TrimSpace(t.Role))
		if role != "user" && role != "assistant" {
			continue
		}
		content := strings.TrimSpace(t.Content)
		if content == "" {
			continue
		}
		if utf8.RuneCountInString(content) > 2000 {
			content = string([]rune(content)[:2000])
		}
		out = append(out, llm.Message{Role: role, Content: content})
	}
	if len(out) > 16 {
		out = out[len(out)-16:]
	}
	return out
}

func lastUserText(turns []PlanChatTurn) string {
	for i := len(turns) - 1; i >= 0; i-- {
		if strings.EqualFold(strings.TrimSpace(turns[i].Role), "user") {
			q := strings.TrimSpace(turns[i].Content)
			if utf8.RuneCountInString(q) > 160 {
				q = string([]rune(q)[:160])
			}
			return q
		}
	}
	return ""
}

// lastAssistantAsked reports whether the assistant's previous message was a question.
func lastAssistantAsked(turns []PlanChatTurn) bool {
	for i := len(turns) - 1; i >= 0; i-- {
		if strings.EqualFold(strings.TrimSpace(turns[i].Role), "assistant") {
			return strings.HasSuffix(strings.TrimSpace(turns[i].Content), "?")
		}
	}
	return false
}

func (s *Service) localizePrices(ctx context.Context, pages []goals.WebPage, currency string) []planCandidate {
	out := make([]planCandidate, len(pages))
	var rates map[string]decimal.Decimal
	for i, p := range pages {
		out[i] = planCandidate{WebPage: p}
		if p.Price == "" {
			continue
		}
		amt, err := decimal.NewFromString(p.Price)
		if err != nil || !amt.GreaterThan(decimal.Zero) {
			out[i].Price = ""
			continue
		}
		from := strings.ToUpper(p.CurrencyCode)
		if from == "" || from == currency {
			if from == currency {
				out[i].PriceLocal = amt.Round(0).String()
			}
			continue
		}
		if rates == nil && s.fx != nil {
			rctx, cancel := context.WithTimeout(ctx, 5*time.Second)
			rates, _, _ = s.fx.Rates(rctx, currency)
			cancel()
		}
		if rates == nil {
			continue
		}
		if v, err := fx.Convert(amt, from, currency, rates); err == nil {
			out[i].PriceLocal = v.Round(0).String()
		}
	}
	return out
}

func formatCandidates(cands []planCandidate, currency string) string {
	if len(cands) == 0 {
		return "The search returned no pages. Estimate the price from your own knowledge and say it is an estimate."
	}
	var b strings.Builder
	for i, c := range cands {
		fmt.Fprintf(&b, "[%d] %s — %s", i+1, c.Title, c.Site)
		switch {
		case c.Price != "" && c.CurrencyCode != "" && c.PriceLocal != "" && !strings.EqualFold(c.CurrencyCode, currency):
			fmt.Fprintf(&b, " — price %s %s (≈ %s %s)", c.Price, c.CurrencyCode, c.PriceLocal, currency)
		case c.Price != "" && c.CurrencyCode != "":
			fmt.Fprintf(&b, " — price %s %s", c.Price, c.CurrencyCode)
		case c.Price != "":
			fmt.Fprintf(&b, " — price %s (currency unknown)", c.Price)
		}
		if c.ImageURL != "" {
			b.WriteString(" — has picture")
		}
		b.WriteByte('\n')
		if c.Snippet != "" {
			fmt.Fprintf(&b, "    snippet: %s\n", c.Snippet)
		} else if c.Description != "" {
			fmt.Fprintf(&b, "    page: %s\n", c.Description)
		}
	}
	return b.String()
}

func buildPlanResult(dec planDecision, ans planAnswer, cands []planCandidate, currency string) PlanChatResult {
	pick := func(n int) (planCandidate, bool) {
		if n < 1 || n > len(cands) {
			return planCandidate{}, false
		}
		return cands[n-1], true
	}
	var sources []PlanSource
	used := map[int]bool{}
	for _, n := range ans.Sources {
		c, ok := pick(n)
		if !ok || used[n] {
			continue
		}
		used[n] = true
		sources = append(sources, PlanSource{
			Title:        c.Title,
			URL:          c.URL,
			Site:         c.Site,
			ImageURL:     c.ImageURL,
			Price:        c.Price,
			CurrencyCode: c.CurrencyCode,
			PriceLocal:   c.PriceLocal,
		})
		if len(sources) >= 5 {
			break
		}
	}

	image := ""
	if c, ok := pick(ans.Image); ok && c.ImageURL != "" && (used[ans.Image] || len(used) == 0) {
		image = c.ImageURL
	}
	if image == "" {
		for _, src := range sources {
			if src.ImageURL != "" {
				image = src.ImageURL
				break
			}
		}
	}

	sourceURL := ""
	for _, n := range ans.PriceFrom {
		if c, ok := pick(n); ok {
			sourceURL = c.URL
			break
		}
	}
	if sourceURL == "" && len(sources) > 0 {
		sourceURL = sources[0].URL
	}

	title := firstNonBlank(ans.Title, dec.Title, dec.Query)
	if utf8.RuneCountInString(title) > 80 {
		title = string([]rune(title)[:80])
	}
	amount := cleanAmount(ans.TargetAmount)
	if amount == "" {
		var priced []planCandidate
		for _, n := range append(append([]int{}, ans.PriceFrom...), ans.Sources...) {
			if c, ok := pick(n); ok {
				priced = append(priced, c)
			}
		}
		amount = cleanAmount(medianLocal(priced))
	}
	cur := currency
	note := strings.TrimSpace(ans.Note)
	if ua := cleanAmount(dec.UserAmount); ua != "" {
		amount = ua
		if c := strings.ToUpper(strings.TrimSpace(dec.UserCurrency)); len(c) == 3 {
			cur = c
		}
		note = "Using the amount you gave."
	}

	reply := strings.TrimSpace(ans.Reply)
	if reply == "" || asksUserForPrice(reply) {
		if amount != "" {
			reply = fmt.Sprintf("%s is about %s %s.", title, amount, cur)
		} else {
			reply = "I couldn't find a price for " + title + "."
		}
	}

	draft := &goals.PlanDraft{
		Title:        title,
		GoalType:     normalizeGoalType(firstNonBlank(ans.GoalType, dec.GoalType)),
		CurrencyCode: cur,
		TargetAmount: amount,
		TargetDate:   strings.TrimSpace(dec.TargetDate),
		Note:         note,
		SourceURL:    sourceURL,
		ImageURL:     image,
	}
	return PlanChatResult{Reply: reply, Draft: draft, ImageURL: image, Sources: sources}
}

func parseDecision(raw string) planDecision {
	var d planDecision
	if err := json.Unmarshal([]byte(jsonObject(raw)), &d); err != nil {
		text := strings.TrimSpace(llm.StripThinking(raw))
		return planDecision{Action: "reply", Reply: text}
	}
	d.Action = strings.ToLower(strings.TrimSpace(d.Action))
	switch d.Action {
	case "search", "ask", "reply":
	default:
		if strings.TrimSpace(d.Query) != "" {
			d.Action = "search"
		} else {
			d.Action = "reply"
		}
	}
	d.Query = trimRunes(strings.TrimSpace(d.Query), 160)
	d.AltQuery = trimRunes(strings.TrimSpace(d.AltQuery), 160)
	return d
}

func parseAnswer(raw string) planAnswer {
	var a planAnswer
	if err := json.Unmarshal([]byte(jsonObject(raw)), &a); err != nil {
		// Numbers sometimes come back as strings; retry loosely.
		var loose map[string]any
		if json.Unmarshal([]byte(jsonObject(raw)), &loose) != nil {
			return planAnswer{Reply: strings.TrimSpace(llm.StripThinking(raw))}
		}
		a.Reply = asText(loose["reply"])
		a.Title = asText(loose["title"])
		a.GoalType = asText(loose["goal_type"])
		a.TargetAmount = asText(loose["target_amount"])
		a.Note = asText(loose["note"])
		a.Sources = asInts(loose["sources"])
		a.PriceFrom = asInts(loose["price_from"])
		if v := asInts(loose["image"]); len(v) > 0 {
			a.Image = v[0]
		}
		a.Images = asInts(loose["images"])
	}
	return a
}

func jsonObject(raw string) string {
	raw = strings.TrimSpace(raw)
	if m := jsonObjRe.FindString(raw); m != "" {
		return m
	}
	return raw
}

func asText(v any) string {
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t)
	case float64:
		return decimal.NewFromFloat(t).String()
	}
	return ""
}

func asInts(v any) []int {
	var out []int
	add := func(x any) {
		switch t := x.(type) {
		case float64:
			out = append(out, int(t))
		case string:
			var n int
			if _, err := fmt.Sscanf(strings.TrimLeft(strings.Trim(t, "[] "), "Ii"), "%d", &n); err == nil {
				out = append(out, n)
			}
		}
	}
	if arr, ok := v.([]any); ok {
		for _, x := range arr {
			add(x)
		}
	} else if v != nil {
		add(v)
	}
	return out
}

// cleanAmount keeps a positive price and drops calendar years.
func cleanAmount(raw string) string {
	amt := strings.TrimSpace(strings.ReplaceAll(raw, ",", ""))
	d, err := decimal.NewFromString(amt)
	if err != nil || !d.GreaterThan(decimal.Zero) || yearAmount(amt) {
		return ""
	}
	return d.Round(goals.Scale).StringFixed(goals.Scale)
}

func normalizeGoalType(t string) string {
	t = strings.ToLower(strings.TrimSpace(t))
	switch t {
	case goals.TypeTravel, goals.TypePurchase, goals.TypeSavings, goals.TypeDebtPayoff, goals.TypeCustom:
		return t
	}
	return goals.TypePurchase
}

func firstNonBlank(vals ...string) string {
	for _, v := range vals {
		if v = strings.TrimSpace(v); v != "" {
			return v
		}
	}
	return ""
}

func trimRunes(s string, n int) string {
	if utf8.RuneCountInString(s) > n {
		return string([]rune(s)[:n])
	}
	return s
}

// productCalendar states which flagship phones are already on sale.
// Galaxy S{n} launches in January of year n+2000 (S26 in January 2026).
// A numbered iPhone launches in September; after that month the new generation is on sale.
func productCalendar(now time.Time) string {
	y, m, d := now.Date()
	samsung := y - 2000
	if m == time.January && d < 22 {
		samsung--
	}
	iphone := y - 2009
	if m > time.September || (m == time.September && d >= 12) {
		iphone = y - 2008
	}
	return fmt.Sprintf(`Today is %s. Your training data is older than today; trust this over your memory.
These are on sale now. Do not say they are unreleased:
- Latest Samsung Galaxy S series is the S%d (S%d, S%d+, S%d Ultra). The S%d is not out yet.
- Latest numbered iPhone is iPhone %d. iPhone %d is not out yet.
- Latest Samsung Galaxy Watch is the Watch %d. The Watch %d is not out yet.
- Car model years up to %d are on sale.
For any other "latest" product, search for it and trust the pages over your memory.`,
		now.Format("2 January 2006"),
		samsung, samsung, samsung, samsung, samsung+1,
		iphone, iphone+1,
		galaxyWatchGen(now), galaxyWatchGen(now)+1,
		y+1,
	)
}

func galaxyWatchGen(now time.Time) int {
	// Galaxy Watch 7 launched in July 2024, so the generation is year-2017 after that launch.
	g := now.Year() - 2017
	if now.Month() < time.July || (now.Month() == time.July && now.Day() < 20) {
		g--
	}
	return g
}

func yearAmount(raw string) bool {
	d, err := decimal.NewFromString(strings.TrimSpace(strings.ReplaceAll(raw, ",", "")))
	if err != nil {
		return false
	}
	return d.Equal(d.Truncate(0)) && d.GreaterThanOrEqual(decimal.NewFromInt(1900)) && d.LessThanOrEqual(decimal.NewFromInt(2099))
}

func asksUserForPrice(reply string) bool {
	return askPriceRe.MatchString(reply)
}

// medianLocal is the middle converted price among the given candidates.
func medianLocal(cands []planCandidate) string {
	var ds []decimal.Decimal
	for _, c := range cands {
		if d, err := decimal.NewFromString(c.PriceLocal); err == nil && d.GreaterThan(decimal.Zero) {
			ds = append(ds, d)
		}
	}
	if len(ds) == 0 {
		return ""
	}
	sort.Slice(ds, func(i, j int) bool { return ds[i].LessThan(ds[j]) })
	return ds[len(ds)/2].String()
}
