package billing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"equilend/api/internal/httpx"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// UserPlan is a user's effective plan right now (expired comps/trials read as Free).
type UserPlan struct {
	UserID      uuid.UUID
	Email       string
	DisplayName string
	Role        string
	Tier        string
	Source      string
	ExpiresAt   *time.Time
}

type Subscription struct {
	ID                string     `json:"id"`
	Provider          string     `json:"provider"`
	UserID            *uuid.UUID `json:"user_id,omitempty"`
	UserEmail         string     `json:"user_email,omitempty"`
	UserName          string     `json:"user_name,omitempty"`
	CustomerID        string     `json:"customer_id,omitempty"`
	ProductID         string     `json:"product_id,omitempty"`
	PlanKey           string     `json:"plan_key,omitempty"`
	Tier              string     `json:"tier,omitempty"`
	Status            string     `json:"status"`
	AmountCents       int        `json:"amount_cents"`
	Currency          string     `json:"currency"`
	Interval          string     `json:"interval,omitempty"`
	CurrentPeriodEnd  *time.Time `json:"current_period_end,omitempty"`
	CancelAtPeriodEnd bool       `json:"cancel_at_period_end"`
	TrialEnd          *time.Time `json:"trial_end,omitempty"`
	StartedAt         *time.Time `json:"started_at,omitempty"`
	CanceledAt        *time.Time `json:"canceled_at,omitempty"`
	EndedAt           *time.Time `json:"ended_at,omitempty"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

type Event struct {
	ID             string     `json:"id"`
	Type           string     `json:"type"`
	SubscriptionID string     `json:"subscription_id,omitempty"`
	UserID         *uuid.UUID `json:"user_id,omitempty"`
	UserEmail      string     `json:"user_email,omitempty"`
	Error          string     `json:"error,omitempty"`
	ProcessedAt    *time.Time `json:"processed_at,omitempty"`
	ReceivedAt     time.Time  `json:"received_at"`
}

type MoneyByCurrency struct {
	Currency string `json:"currency"`
	Cents    int64  `json:"cents"`
}

type TierCount struct {
	Tier   string `json:"tier"`
	Source string `json:"source"`
	Users  int    `json:"users"`
}

type Stats struct {
	MRR            []MoneyByCurrency `json:"mrr"`
	ActiveSubs     int               `json:"active_subscriptions"`
	TrialingSubs   int               `json:"trialing_subscriptions"`
	PastDue        int               `json:"past_due"`
	Canceling      int               `json:"canceling"`
	Churned30d     int               `json:"churned_30d"`
	New30d         int               `json:"new_30d"`
	TrialsActive   int               `json:"trials_active"`
	TrialsEnding7d int               `json:"trials_ending_7d"`
	Comped         int               `json:"comped"`
	TotalUsers     int               `json:"total_users"`
	Tiers          []TierCount       `json:"tiers"`
}

type Store interface {
	UserPlan(ctx context.Context, userID uuid.UUID) (UserPlan, error)
	SetUserPlan(ctx context.Context, userID uuid.UUID, tier, source string, expires *time.Time) error
	GetSetting(ctx context.Context, key string) (string, error)
	SetSetting(ctx context.Context, key, value string) error
	AIUsedThisMonth(ctx context.Context, userID uuid.UUID) (int, error)
	CapturesThisMonth(ctx context.Context, userID uuid.UUID) (int, error)
	ActiveBankLinks(ctx context.Context, userID uuid.UUID) (int, error)

	// RecordEvent stores a webhook delivery. done is true when the same delivery
	// was already processed successfully.
	RecordEvent(ctx context.Context, id, typ string, payload []byte) (done bool, err error)
	FinishEvent(ctx context.Context, id, subscriptionID string, userID *uuid.UUID, errMsg string) error
	UpsertSubscription(ctx context.Context, s Subscription) error
	GetSubscription(ctx context.Context, id string) (*Subscription, error)
	UserForCustomer(ctx context.Context, customerID string) (*uuid.UUID, error)
	LatestSubscription(ctx context.Context, userID uuid.UUID) (*Subscription, error)
	HasOtherLiveSubscription(ctx context.Context, userID uuid.UUID, exceptID string) (bool, error)

	Stats(ctx context.Context) (Stats, error)
	ListSubscriptions(ctx context.Context, status string, limit int) ([]Subscription, error)
	ListEvents(ctx context.Context, limit int) ([]Event, error)
}

type AuditFunc func(ctx context.Context, actor uuid.UUID, action string, target *uuid.UUID, meta json.RawMessage)

type Config struct {
	WebhookSecret string
	SuccessURL    string
	// Products maps plan keys (pro_month, plus_year, ...) to Polar product IDs.
	Products map[string]string
	// ListPrices are the advertised prices in cents per plan key, shown when Polar has no
	// price for a plan (or is not set up yet). Empty means DefaultListPrices.
	ListPrices map[string]int
	// ListCurrency is the currency of ListPrices (default "usd").
	ListCurrency string
}

// StandardPlans are always offered, so every tier shows a monthly and a yearly price.
var StandardPlans = []string{"plus_month", "plus_year", "pro_month", "pro_year"}

// DefaultListPrices: yearly is about two months free. Override with BILLING_LIST_PRICES.
var DefaultListPrices = map[string]int{
	"plus_month": 499,
	"plus_year":  4999,
	"pro_month":  999,
	"pro_year":   9999,
}

type Service struct {
	store  Store
	polar  *Polar
	cfg    Config
	audit  AuditFunc
	now    func() time.Time
	mu     sync.Mutex
	cached map[string]Limits
	at     time.Time

	priceMu  sync.Mutex
	prices   map[string]ProductPrice // by product ID
	pricesAt time.Time
}

func NewService(store Store, polar *Polar, cfg Config) *Service {
	if cfg.Products == nil {
		cfg.Products = map[string]string{}
	}
	return &Service{store: store, polar: polar, cfg: cfg, now: time.Now}
}

func (s *Service) SetAudit(fn AuditFunc) { s.audit = fn }

// ---------------------------------------------------------------- limits

const limitsTTL = 30 * time.Second

func (s *Service) AllLimits(ctx context.Context) map[string]Limits {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cached != nil && time.Since(s.at) < limitsTTL {
		return s.cached
	}
	raw, err := s.store.GetSetting(ctx, settingLimits)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		if s.cached != nil {
			return s.cached
		}
		return DefaultLimits()
	}
	s.cached = parseLimits(raw)
	s.at = time.Now()
	return s.cached
}

// Entitlements returns the user's plan and what it allows. Admins get Pro.
func (s *Service) Entitlements(ctx context.Context, userID uuid.UUID) (UserPlan, Limits, error) {
	p, err := s.store.UserPlan(ctx, userID)
	if err != nil {
		return UserPlan{}, Limits{}, err
	}
	all := s.AllLimits(ctx)
	if strings.EqualFold(p.Role, "admin") {
		return p, all[TierPro], nil
	}
	if !ValidTier(p.Tier) {
		p.Tier = TierFree
	}
	return p, all[p.Tier], nil
}

func (s *Service) LimitsFor(ctx context.Context, userID uuid.UUID) (Limits, error) {
	_, l, err := s.Entitlements(ctx, userID)
	return l, err
}

func (s *Service) AIUsedThisMonth(ctx context.Context, userID uuid.UUID) (int, error) {
	return s.store.AIUsedThisMonth(ctx, userID)
}

func PlanRequired(feature string) error {
	return httpx.E(http.StatusPaymentRequired, "PLAN_REQUIRED", feature+" isn't included in your plan. Upgrade to unlock it.")
}

// RequireFeature blocks a route unless the caller's plan includes it.
func (s *Service) RequireFeature(feature string, allowed func(Limits) bool, userIDFrom func(context.Context) uuid.UUID) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			l, err := s.LimitsFor(r.Context(), userIDFrom(r.Context()))
			if err != nil {
				httpx.Error(w, err)
				return
			}
			if !allowed(l) {
				httpx.Error(w, PlanRequired(feature))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireBankLinkSlot allows connecting a bank only within the plan's limit.
func (s *Service) RequireBankLinkSlot(userIDFrom func(context.Context) uuid.UUID) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			uid := userIDFrom(r.Context())
			l, err := s.LimitsFor(r.Context(), uid)
			if err != nil {
				httpx.Error(w, err)
				return
			}
			if l.BankLinks == 0 {
				httpx.Error(w, PlanRequired("Bank linking"))
				return
			}
			if !Unlimited(l.BankLinks) {
				n, err := s.store.ActiveBankLinks(r.Context(), uid)
				if err != nil {
					httpx.Error(w, err)
					return
				}
				if n >= l.BankLinks {
					httpx.Error(w, httpx.E(http.StatusPaymentRequired, "BANK_LINK_LIMIT",
						fmt.Sprintf("Your plan includes %d connected banks. Disconnect one to add another.", l.BankLinks)))
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// ---------------------------------------------------------------- user-facing

type PlanOption struct {
	Key         string `json:"key"`
	Tier        string `json:"tier"`
	Interval    string `json:"interval,omitempty"`
	Name        string `json:"name,omitempty"`
	AmountCents int    `json:"amount_cents,omitempty"`
	Currency    string `json:"currency,omitempty"`
	// Available: this plan can be bought now (a Polar product is set up for it).
	Available bool `json:"available"`
	// ListCents is the price before Discount; AmountCents is what is paid now.
	ListCents int             `json:"list_cents,omitempty"`
	Discount  *ActiveDiscount `json:"discount,omitempty"`
}

type TierInfo struct {
	Tier   string `json:"tier"`
	Limits Limits `json:"limits"`
}

type Catalog struct {
	Tiers         []TierInfo   `json:"tiers"`
	Plans         []PlanOption `json:"plans"`
	CheckoutReady bool         `json:"checkout_ready"`
	TrialDays     int          `json:"trial_days"`
	TrialTier     string       `json:"trial_tier"`
}

// defaultPlans lists every standard plan with Polar's price, else the list price.
func (s *Service) defaultPlans(ctx context.Context, out *Catalog) {
	prices := s.productPrices(ctx)
	keys := map[string]bool{}
	for _, k := range StandardPlans {
		keys[k] = true
	}
	for k := range s.cfg.Products {
		keys[k] = true
	}
	list := s.cfg.ListPrices
	if len(list) == 0 {
		list = DefaultListPrices
	}
	listCur := strings.ToLower(strings.TrimSpace(s.cfg.ListCurrency))
	if listCur == "" {
		listCur = "usd"
	}
	for k := range keys {
		tier := TierOfPlanKey(k)
		if tier == "" {
			continue
		}
		productID, sold := s.cfg.Products[k]
		opt := PlanOption{Key: k, Tier: tier, Interval: IntervalOfPlanKey(k), Available: sold && out.CheckoutReady}
		if pp, ok := prices[productID]; sold && ok {
			opt.Name, opt.AmountCents, opt.Currency = pp.Name, pp.AmountCents, pp.Currency
			if opt.Interval == "" {
				opt.Interval = pp.Interval
			}
		} else if cents, ok := list[k]; ok && cents > 0 {
			opt.AmountCents, opt.Currency = cents, listCur
		}
		opt.ListCents = opt.AmountCents
		out.Plans = append(out.Plans, opt)
	}
}

func (s *Service) Catalog(ctx context.Context) Catalog {
	all := s.AllLimits(ctx)
	out := Catalog{CheckoutReady: s.polar.Configured() && len(s.cfg.Products) > 0}
	for _, t := range Tiers {
		out.Tiers = append(out.Tiers, TierInfo{Tier: t, Limits: all[t]})
	}
	now := s.now()
	if saved := s.adminPrices(ctx); saved != nil {
		// Prices set in the admin console are the source of truth for what the apps show.
		for _, p := range saved {
			_, sold := s.cfg.Products[p.Key()]
			amt, disc := p.Apply(now)
			out.Plans = append(out.Plans, PlanOption{
				Key: p.Key(), Tier: p.Tier, Interval: p.Interval,
				AmountCents: amt, ListCents: p.AmountCents, Currency: p.Currency,
				Discount: disc, Available: sold && out.CheckoutReady,
			})
		}
	} else {
		s.defaultPlans(ctx, &out)
	}
	sort.Slice(out.Plans, func(i, j int) bool { return out.Plans[i].Key < out.Plans[j].Key })
	if out.Plans == nil {
		out.Plans = []PlanOption{}
	}
	out.TrialDays, out.TrialTier = s.trial(ctx)
	return out
}

const priceTTL = 15 * time.Minute

// productPrices returns Polar prices for the configured products, cached so
// the public plan list never waits on Polar more than once per TTL. Products
// that fail to load are simply left without a price.
func (s *Service) productPrices(ctx context.Context) map[string]ProductPrice {
	if !s.polar.Configured() || len(s.cfg.Products) == 0 {
		return nil
	}
	s.priceMu.Lock()
	defer s.priceMu.Unlock()
	if s.prices != nil && s.now().Sub(s.pricesAt) < priceTTL {
		return s.prices
	}
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	type res struct {
		id  string
		pp  ProductPrice
		err error
	}
	ids := map[string]bool{}
	for _, id := range s.cfg.Products {
		ids[id] = true
	}
	ch := make(chan res, len(ids))
	for id := range ids {
		go func(id string) {
			pp, err := s.polar.Product(ctx, id)
			ch <- res{id, pp, err}
		}(id)
	}
	out := map[string]ProductPrice{}
	for range ids {
		r := <-ch
		if r.err != nil {
			log.Printf("polar product %s: %v", r.id, r.err)
			continue
		}
		out[r.id] = r.pp
	}
	s.prices, s.pricesAt = out, s.now()
	return out
}

func (s *Service) trial(ctx context.Context) (int, string) {
	days, tier := 0, TierPro
	if v, err := s.store.GetSetting(ctx, settingTrialDays); err == nil {
		fmt.Sscanf(strings.TrimSpace(v), "%d", &days)
	}
	if v, err := s.store.GetSetting(ctx, settingTrialTier); err == nil && (v == TierPlus || v == TierPro) {
		tier = v
	}
	return days, tier
}

type Usage struct {
	AIThisMonth       int `json:"ai_this_month"`
	CapturesThisMonth int `json:"captures_this_month"`
	BankLinks         int `json:"bank_links"`
}

type MyBilling struct {
	Tier         string        `json:"tier"`
	Source       string        `json:"source"`
	ExpiresAt    *time.Time    `json:"expires_at,omitempty"`
	Limits       Limits        `json:"limits"`
	Usage        Usage         `json:"usage"`
	Subscription *Subscription `json:"subscription"`
	CanManage    bool          `json:"can_manage"`
}

func (s *Service) Me(ctx context.Context, userID uuid.UUID) (MyBilling, error) {
	p, l, err := s.Entitlements(ctx, userID)
	if err != nil {
		return MyBilling{}, err
	}
	out := MyBilling{Tier: p.Tier, Source: p.Source, ExpiresAt: p.ExpiresAt, Limits: l}
	out.Usage.AIThisMonth, _ = s.store.AIUsedThisMonth(ctx, userID)
	out.Usage.CapturesThisMonth, _ = s.store.CapturesThisMonth(ctx, userID)
	out.Usage.BankLinks, _ = s.store.ActiveBankLinks(ctx, userID)
	sub, err := s.store.LatestSubscription(ctx, userID)
	if err != nil {
		return MyBilling{}, err
	}
	out.Subscription = sub
	out.CanManage = sub != nil && sub.CustomerID != "" && s.polar.Configured()
	return out, nil
}

func (s *Service) Checkout(ctx context.Context, userID uuid.UUID, planKey string) (string, error) {
	planKey = strings.ToLower(strings.TrimSpace(planKey))
	product, ok := s.cfg.Products[planKey]
	if !ok || TierOfPlanKey(planKey) == "" {
		return "", httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{"plan": "unknown plan"})
	}
	if saved := s.adminPrices(ctx); saved != nil {
		offered := false
		for _, sp := range saved {
			offered = offered || sp.Key() == planKey
		}
		if !offered {
			return "", httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{"plan": "this plan is not offered"})
		}
	}
	if !s.polar.Configured() {
		return "", httpx.E(http.StatusServiceUnavailable, "BILLING_UNAVAILABLE", "payments are not set up yet")
	}
	p, err := s.store.UserPlan(ctx, userID)
	if err != nil {
		return "", err
	}
	if p.Source == SourcePolar {
		if sub, _ := s.store.LatestSubscription(ctx, userID); sub != nil && liveStatus(sub.Status) {
			return "", httpx.E(http.StatusConflict, "ALREADY_SUBSCRIBED", "you already have a subscription; change it from Manage billing")
		}
	}
	url, err := s.polar.CreateCheckout(ctx, CheckoutInput{
		ProductID:  product,
		UserID:     userID.String(),
		Email:      p.Email,
		Name:       p.DisplayName,
		SuccessURL: s.cfg.SuccessURL,
		PlanKey:    planKey,
	})
	if err != nil {
		log.Printf("polar checkout failed user=%s plan=%s: %v", userID, planKey, err)
		return "", httpx.E(http.StatusBadGateway, "BILLING_ERROR", "could not start checkout, please try again")
	}
	return url, nil
}

func (s *Service) Portal(ctx context.Context, userID uuid.UUID) (string, error) {
	sub, err := s.store.LatestSubscription(ctx, userID)
	if err != nil {
		return "", err
	}
	if sub == nil || sub.CustomerID == "" {
		return "", httpx.E(http.StatusNotFound, "NO_SUBSCRIPTION", "you don't have a subscription yet")
	}
	if !s.polar.Configured() {
		return "", httpx.E(http.StatusServiceUnavailable, "BILLING_UNAVAILABLE", "payments are not set up yet")
	}
	url, err := s.polar.CustomerPortal(ctx, sub.CustomerID)
	if err != nil {
		log.Printf("polar portal failed user=%s: %v", userID, err)
		return "", httpx.E(http.StatusBadGateway, "BILLING_ERROR", "could not open billing, please try again")
	}
	return url, nil
}

// ---------------------------------------------------------------- webhooks

func liveStatus(status string) bool {
	switch status {
	case "active", "trialing", "past_due":
		return true
	}
	return false
}

// HandleWebhook verifies, stores and applies one Polar delivery.
func (s *Service) HandleWebhook(ctx context.Context, h http.Header, body []byte) error {
	if err := VerifyWebhook(s.cfg.WebhookSecret, h, body, s.now()); err != nil {
		return err
	}
	var env struct {
		Type string          `json:"type"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return fmt.Errorf("decode webhook: %w", err)
	}
	id := h.Get("webhook-id")
	done, err := s.store.RecordEvent(ctx, id, env.Type, body)
	if err != nil {
		return err
	}
	if done {
		return nil
	}
	var subID string
	var userID *uuid.UUID
	var procErr error
	if strings.HasPrefix(env.Type, "subscription.") {
		subID, userID, procErr = s.applySubscription(ctx, env.Type, env.Data)
	}
	msg := ""
	if procErr != nil {
		msg = procErr.Error()
	}
	if err := s.store.FinishEvent(ctx, id, subID, userID, msg); err != nil {
		return err
	}
	return procErr
}

func (s *Service) planKeyForProduct(productID string) string {
	for k, v := range s.cfg.Products {
		if v == productID {
			return k
		}
	}
	return ""
}

func (s *Service) applySubscription(ctx context.Context, typ string, data json.RawMessage) (string, *uuid.UUID, error) {
	var ps polarSubscription
	if err := json.Unmarshal(data, &ps); err != nil {
		return "", nil, fmt.Errorf("decode subscription: %w", err)
	}
	if ps.ID == "" {
		return "", nil, errors.New("subscription without id")
	}
	if ps.ProductID == "" && ps.Product != nil {
		ps.ProductID = ps.Product.ID
	}
	customerID := ps.CustomerID
	if customerID == "" && ps.Customer != nil {
		customerID = ps.Customer.ID
	}

	planKey := s.planKeyForProduct(ps.ProductID)
	if planKey == "" {
		planKey = ps.metaString("plan_key")
	}
	tier := TierOfPlanKey(planKey)

	userID := s.resolveUser(ctx, ps, customerID)

	amount := 0
	currency := strings.ToLower(ps.Currency)
	if ps.Amount != nil {
		amount = *ps.Amount
	} else if len(ps.Prices) > 0 && ps.Prices[0].PriceAmount != nil {
		amount = *ps.Prices[0].PriceAmount
		if currency == "" {
			currency = strings.ToLower(ps.Prices[0].Currency)
		}
	}
	if currency == "" {
		currency = "usd"
	}
	interval := ps.RecurringInterval
	if interval == "" {
		interval = IntervalOfPlanKey(planKey)
	}
	status := ps.Status
	if typ == "subscription.revoked" && status != "canceled" {
		status = "canceled"
	}

	sub := Subscription{
		ID: ps.ID, Provider: "polar", UserID: userID, CustomerID: customerID, ProductID: ps.ProductID,
		PlanKey: planKey, Tier: tier, Status: status, AmountCents: amount, Currency: currency, Interval: interval,
		CurrentPeriodEnd: ps.CurrentPeriodEnd, CancelAtPeriodEnd: ps.CancelAtPeriodEnd, TrialEnd: ps.TrialEnd,
		StartedAt: ps.StartedAt, CanceledAt: ps.CanceledAt, EndedAt: ps.EndedAt,
	}
	if err := s.store.UpsertSubscription(ctx, sub); err != nil {
		return ps.ID, userID, err
	}
	if userID == nil {
		return ps.ID, nil, errors.New("no user for subscription (missing external customer id)")
	}

	switch {
	case liveStatus(status) && tier != "":
		if err := s.store.SetUserPlan(ctx, *userID, tier, SourcePolar, nil); err != nil {
			return ps.ID, userID, err
		}
	case status == "canceled" || status == "unpaid" || status == "incomplete_expired" || typ == "subscription.revoked":
		p, err := s.store.UserPlan(ctx, *userID)
		if err != nil {
			return ps.ID, userID, err
		}
		other, err := s.store.HasOtherLiveSubscription(ctx, *userID, ps.ID)
		if err != nil {
			return ps.ID, userID, err
		}
		if p.Source == SourcePolar && !other {
			if err := s.store.SetUserPlan(ctx, *userID, TierFree, SourceFree, nil); err != nil {
				return ps.ID, userID, err
			}
		}
	}
	return ps.ID, userID, nil
}

func (s *Service) resolveUser(ctx context.Context, ps polarSubscription, customerID string) *uuid.UUID {
	for _, raw := range []string{ps.metaString("user_id"), externalID(ps)} {
		if id, err := uuid.Parse(raw); err == nil {
			return &id
		}
	}
	if existing, err := s.store.GetSubscription(ctx, ps.ID); err == nil && existing != nil && existing.UserID != nil {
		return existing.UserID
	}
	if customerID != "" {
		if id, err := s.store.UserForCustomer(ctx, customerID); err == nil && id != nil {
			return id
		}
	}
	return nil
}

func externalID(ps polarSubscription) string {
	if ps.Customer != nil {
		return ps.Customer.ExternalID
	}
	return ""
}

// ---------------------------------------------------------------- admin

type Setup struct {
	Configured       bool              `json:"configured"`
	Server           string            `json:"server"`
	WebhookSecretSet bool              `json:"webhook_secret_set"`
	SuccessURL       string            `json:"success_url"`
	Products         map[string]string `json:"products"`
	WebhookPath      string            `json:"webhook_path"`
}

type AdminOverview struct {
	Stats         Stats             `json:"stats"`
	Limits        map[string]Limits `json:"limits"`
	TrialDays     int               `json:"trial_days"`
	TrialTier     string            `json:"trial_tier"`
	Setup         Setup             `json:"setup"`
	Subscriptions []Subscription    `json:"subscriptions"`
	Events        []Event           `json:"events"`
	// Prices: the price cards (saved, or the defaults when PricesSaved is false).
	Prices      []PlanPrice `json:"prices"`
	PricesSaved bool        `json:"prices_saved"`
	// PolarPrices: what Polar actually charges per plan key, to spot a mismatch.
	PolarPrices map[string]int `json:"polar_prices,omitempty"`
}

func (s *Service) AdminOverview(ctx context.Context) (AdminOverview, error) {
	st, err := s.store.Stats(ctx)
	if err != nil {
		return AdminOverview{}, err
	}
	subs, err := s.store.ListSubscriptions(ctx, "", 25)
	if err != nil {
		return AdminOverview{}, err
	}
	events, err := s.store.ListEvents(ctx, 20)
	if err != nil {
		return AdminOverview{}, err
	}
	days, tier := s.trial(ctx)
	prices, saved := s.EffectivePrices(ctx)
	polar := map[string]int{}
	pp := s.productPrices(ctx)
	for k, id := range s.cfg.Products {
		if p, ok := pp[id]; ok {
			polar[k] = p.AmountCents
		}
	}
	return AdminOverview{
		Stats: st, Limits: s.AllLimits(ctx), TrialDays: days, TrialTier: tier,
		Setup:         s.Setup(),
		Subscriptions: subs, Events: events,
		Prices: prices, PricesSaved: saved, PolarPrices: polar,
	}, nil
}

func (s *Service) Setup() Setup {
	return Setup{
		Configured: s.polar.Configured(), Server: s.polar.Server(),
		WebhookSecretSet: s.cfg.WebhookSecret != "", SuccessURL: s.cfg.SuccessURL,
		Products: s.cfg.Products, WebhookPath: "/api/v1/billing/webhooks/polar",
	}
}

type SettingsUpdate struct {
	Limits    map[string]Limits `json:"limits"`
	TrialDays *int              `json:"trial_days"`
	TrialTier *string           `json:"trial_tier"`
	// Prices replaces every price card when set; an empty list hides paid plans.
	Prices *[]PlanPrice `json:"prices"`
}

func (s *Service) UpdateSettings(ctx context.Context, actor uuid.UUID, in SettingsUpdate) error {
	meta := map[string]any{}
	if in.Limits != nil {
		merged := s.AllLimits(ctx)
		next := map[string]Limits{}
		for _, t := range Tiers {
			next[t] = merged[t]
			if l, ok := in.Limits[t]; ok {
				if l.AIDaily < -1 || l.AIMonthly < -1 || l.CapturesMonthly < -1 || l.BankLinks < -1 || l.InsightsEveryDays < 0 {
					return httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{t: "limits must be -1 (unlimited) or more"})
				}
				next[t] = l
			}
		}
		b, _ := json.Marshal(next)
		if err := s.store.SetSetting(ctx, settingLimits, string(b)); err != nil {
			return err
		}
		meta["limits"] = next
		s.mu.Lock()
		s.cached = nil
		s.mu.Unlock()
	}
	if in.TrialDays != nil {
		if *in.TrialDays < 0 || *in.TrialDays > 90 {
			return httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{"trial_days": "0 to 90"})
		}
		if err := s.store.SetSetting(ctx, settingTrialDays, fmt.Sprint(*in.TrialDays)); err != nil {
			return err
		}
		meta["trial_days"] = *in.TrialDays
	}
	if in.TrialTier != nil {
		if *in.TrialTier != TierPlus && *in.TrialTier != TierPro {
			return httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{"trial_tier": "plus or pro"})
		}
		if err := s.store.SetSetting(ctx, settingTrialTier, *in.TrialTier); err != nil {
			return err
		}
		meta["trial_tier"] = *in.TrialTier
	}
	if in.Prices != nil {
		clean, err := ValidatePrices(*in.Prices)
		if err != nil {
			return err
		}
		b, _ := json.Marshal(clean)
		if err := s.store.SetSetting(ctx, settingPrices, string(b)); err != nil {
			return err
		}
		meta["prices"] = clean
	}
	if s.audit != nil && len(meta) > 0 {
		b, _ := json.Marshal(meta)
		s.audit(ctx, actor, "billing.settings_update", nil, b)
	}
	return nil
}

func (s *Service) ListSubscriptions(ctx context.Context, status string, limit int) ([]Subscription, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	return s.store.ListSubscriptions(ctx, status, limit)
}
