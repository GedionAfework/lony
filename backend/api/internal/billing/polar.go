package billing

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Polar is a small client for the parts of the Polar API we use.
type Polar struct {
	token   string
	baseURL string
	http    *http.Client
}

func NewPolar(token, server string) *Polar {
	base := "https://sandbox-api.polar.sh"
	if strings.EqualFold(strings.TrimSpace(server), "production") {
		base = "https://api.polar.sh"
	}
	return &Polar{token: token, baseURL: base, http: &http.Client{Timeout: 15 * time.Second}}
}

func (p *Polar) Configured() bool { return p != nil && p.token != "" }

func (p *Polar) Server() string {
	if p == nil {
		return ""
	}
	if strings.Contains(p.baseURL, "sandbox") {
		return "sandbox"
	}
	return "production"
}

func (p *Polar) do(ctx context.Context, method, path string, body any, out any) error {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, p.baseURL+path, rd)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+p.token)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := p.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		return fmt.Errorf("polar %s %s: %d %s", method, path, res.StatusCode, strings.TrimSpace(string(raw)))
	}
	if out != nil {
		return json.Unmarshal(raw, out)
	}
	return nil
}

type CheckoutInput struct {
	ProductID  string
	UserID     string
	Email      string
	Name       string
	SuccessURL string
	PlanKey    string
}

// CreateCheckout starts a hosted Polar checkout and returns its URL.
func (p *Polar) CreateCheckout(ctx context.Context, in CheckoutInput) (string, error) {
	body := map[string]any{
		"products":             []string{in.ProductID},
		"external_customer_id": in.UserID,
		"metadata":             map[string]string{"user_id": in.UserID, "plan_key": in.PlanKey},
	}
	if in.Email != "" {
		body["customer_email"] = in.Email
	}
	if in.Name != "" {
		body["customer_name"] = in.Name
	}
	if in.SuccessURL != "" {
		body["success_url"] = in.SuccessURL
	}
	var out struct {
		URL string `json:"url"`
	}
	if err := p.do(ctx, http.MethodPost, "/v1/checkouts/", body, &out); err != nil {
		return "", err
	}
	if out.URL == "" {
		return "", errors.New("polar returned no checkout url")
	}
	return out.URL, nil
}

// CustomerPortal returns a short-lived link where the customer manages billing.
func (p *Polar) CustomerPortal(ctx context.Context, customerID string) (string, error) {
	var out struct {
		URL string `json:"customer_portal_url"`
	}
	if err := p.do(ctx, http.MethodPost, "/v1/customer-sessions/", map[string]string{"customer_id": customerID}, &out); err != nil {
		return "", err
	}
	if out.URL == "" {
		return "", errors.New("polar returned no portal url")
	}
	return out.URL, nil
}

// ---------------------------------------------------------------- webhooks

var ErrBadSignature = errors.New("invalid webhook signature")

const webhookTolerance = 5 * time.Minute

// VerifyWebhook checks a Standard Webhooks signature, which Polar uses.
// Signed content is "<webhook-id>.<webhook-timestamp>.<body>" with HMAC-SHA256.
func VerifyWebhook(secret string, h http.Header, body []byte, now time.Time) error {
	id := h.Get("webhook-id")
	ts := h.Get("webhook-timestamp")
	sigs := h.Get("webhook-signature")
	if secret == "" || id == "" || ts == "" || sigs == "" {
		return ErrBadSignature
	}
	sec, err := strconv.ParseInt(ts, 10, 64)
	if err != nil {
		return ErrBadSignature
	}
	if d := now.Sub(time.Unix(sec, 0)); d > webhookTolerance || d < -webhookTolerance {
		return ErrBadSignature
	}
	msg := []byte(id + "." + ts + "." + string(body))

	// Polar's SDKs sign with the secret's raw bytes; standard "whsec_" secrets
	// carry base64 key material. Accept either.
	keys := [][]byte{[]byte(secret)}
	if rest, ok := strings.CutPrefix(secret, "whsec_"); ok {
		if k, err := base64.StdEncoding.DecodeString(rest); err == nil {
			keys = append(keys, k)
		}
	}
	for _, key := range keys {
		mac := hmac.New(sha256.New, key)
		mac.Write(msg)
		want := mac.Sum(nil)
		for _, part := range strings.Fields(sigs) {
			_, sig, ok := strings.Cut(part, ",")
			if !ok {
				continue
			}
			got, err := base64.StdEncoding.DecodeString(sig)
			if err == nil && hmac.Equal(got, want) {
				return nil
			}
		}
	}
	return ErrBadSignature
}

// polarSubscription is the subset of Polar's subscription object we read.
type polarSubscription struct {
	ID                string         `json:"id"`
	Status            string         `json:"status"`
	Amount            *int           `json:"amount"`
	Currency          string         `json:"currency"`
	RecurringInterval string         `json:"recurring_interval"`
	CurrentPeriodEnd  *time.Time     `json:"current_period_end"`
	CancelAtPeriodEnd bool           `json:"cancel_at_period_end"`
	TrialEnd          *time.Time     `json:"trial_end"`
	StartedAt         *time.Time     `json:"started_at"`
	CanceledAt        *time.Time     `json:"canceled_at"`
	EndedAt           *time.Time     `json:"ended_at"`
	CustomerID        string         `json:"customer_id"`
	ProductID         string         `json:"product_id"`
	Metadata          map[string]any `json:"metadata"`
	Customer          *struct {
		ID         string `json:"id"`
		Email      string `json:"email"`
		ExternalID string `json:"external_id"`
	} `json:"customer"`
	Product *struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"product"`
	Prices []struct {
		PriceAmount *int   `json:"price_amount"`
		Currency    string `json:"price_currency"`
	} `json:"prices"`
}

func (s polarSubscription) metaString(key string) string {
	if s.Metadata == nil {
		return ""
	}
	if v, ok := s.Metadata[key].(string); ok {
		return strings.TrimSpace(v)
	}
	return ""
}

// ProductPrice is the fixed recurring price of a Polar product.
type ProductPrice struct {
	Name        string
	AmountCents int
	Currency    string
	Interval    string
}

// Product reads a product's name and its first fixed price.
func (p *Polar) Product(ctx context.Context, id string) (ProductPrice, error) {
	var out struct {
		Name              string `json:"name"`
		RecurringInterval string `json:"recurring_interval"`
		IsArchived        bool   `json:"is_archived"`
		Prices            []struct {
			AmountType        string `json:"amount_type"`
			PriceAmount       int    `json:"price_amount"`
			PriceCurrency     string `json:"price_currency"`
			RecurringInterval string `json:"recurring_interval"`
			IsArchived        bool   `json:"is_archived"`
		} `json:"prices"`
	}
	if err := p.do(ctx, http.MethodGet, "/v1/products/"+id, nil, &out); err != nil {
		return ProductPrice{}, err
	}
	pp := ProductPrice{Name: out.Name, Interval: out.RecurringInterval}
	for _, pr := range out.Prices {
		if pr.IsArchived || pr.AmountType != "fixed" {
			continue
		}
		pp.AmountCents, pp.Currency = pr.PriceAmount, pr.PriceCurrency
		if pr.RecurringInterval != "" {
			pp.Interval = pr.RecurringInterval
		}
		break
	}
	return pp, nil
}
