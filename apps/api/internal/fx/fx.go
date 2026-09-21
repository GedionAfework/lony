package fx

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/shopspring/decimal"
)

// Client fetches and caches FX rates (open.er-api.com free tier).
type Client struct {
	mu      sync.RWMutex
	base    string
	rates   map[string]decimal.Decimal
	asOf    time.Time
	ttl     time.Duration
	http    *http.Client
	baseURL string
}

func New() *Client {
	return &Client{
		ttl:     time.Hour,
		http:    &http.Client{Timeout: 12 * time.Second},
		baseURL: "https://open.er-api.com/v6/latest/",
	}
}

func (c *Client) Rates(ctx context.Context, base string) (map[string]decimal.Decimal, time.Time, error) {
	base = strings.ToUpper(strings.TrimSpace(base))
	if base == "" {
		base = "USD"
	}
	c.mu.RLock()
	if c.rates != nil && c.base == base && time.Since(c.asOf) < c.ttl {
		defer c.mu.RUnlock()
		return c.rates, c.asOf, nil
	}
	c.mu.RUnlock()

	c.mu.Lock()
	defer c.mu.Unlock()
	if c.rates != nil && c.base == base && time.Since(c.asOf) < c.ttl {
		return c.rates, c.asOf, nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+base, nil)
	if err != nil {
		return nil, time.Time{}, err
	}
	res, err := c.http.Do(req)
	if err != nil {
		return nil, time.Time{}, err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return nil, time.Time{}, fmt.Errorf("fx: status %d", res.StatusCode)
	}
	var body struct {
		Result string             `json:"result"`
		Rates  map[string]float64 `json:"rates"`
		Time   int64              `json:"time_last_update_unix"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return nil, time.Time{}, err
	}
	if body.Result != "success" || len(body.Rates) == 0 {
		return nil, time.Time{}, fmt.Errorf("fx: empty rates")
	}
	out := make(map[string]decimal.Decimal, len(body.Rates)+1)
	out[base] = decimal.NewFromInt(1)
	for k, v := range body.Rates {
		out[strings.ToUpper(k)] = decimal.NewFromFloat(v)
	}
	asOf := time.Now().UTC()
	if body.Time > 0 {
		asOf = time.Unix(body.Time, 0).UTC()
	}
	c.base = base
	c.rates = out
	c.asOf = asOf
	return out, asOf, nil
}

// Convert amount from `from` to `to` using rates denominated in `base`.
func Convert(amount decimal.Decimal, from, to string, rates map[string]decimal.Decimal) (decimal.Decimal, error) {
	from = strings.ToUpper(from)
	to = strings.ToUpper(to)
	if from == to {
		return amount, nil
	}
	rf, ok := rates[from]
	if !ok || rf.IsZero() {
		return decimal.Zero, fmt.Errorf("missing rate for %s", from)
	}
	rt, ok := rates[to]
	if !ok || rt.IsZero() {
		return decimal.Zero, fmt.Errorf("missing rate for %s", to)
	}
	// rates are quote per 1 base: amount_in_base = amount/rf; to = amount_in_base*rt
	return amount.Div(rf).Mul(rt), nil
}
