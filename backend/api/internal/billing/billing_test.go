package billing

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
)

func sign(secret []byte, id string, ts int64, body string) string {
	mac := hmac.New(sha256.New, secret)
	fmt.Fprintf(mac, "%s.%d.%s", id, ts, body)
	return "v1," + base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

func headers(id string, ts int64, sig string) http.Header {
	h := http.Header{}
	h.Set("webhook-id", id)
	h.Set("webhook-timestamp", fmt.Sprint(ts))
	h.Set("webhook-signature", sig)
	return h
}

func TestVerifyWebhook(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	body := `{"type":"subscription.active"}`
	secret := "polar_whs_testsecret"

	if err := VerifyWebhook(secret, headers("msg_1", now.Unix(), sign([]byte(secret), "msg_1", now.Unix(), body)), []byte(body), now); err != nil {
		t.Fatalf("raw-key signature rejected: %v", err)
	}
	key := []byte("0123456789abcdef0123456789abcdef")
	whsec := "whsec_" + base64.StdEncoding.EncodeToString(key)
	if err := VerifyWebhook(whsec, headers("msg_2", now.Unix(), "v1,bogus "+sign(key, "msg_2", now.Unix(), body)), []byte(body), now); err != nil {
		t.Fatalf("whsec signature rejected: %v", err)
	}
	if err := VerifyWebhook(secret, headers("msg_1", now.Unix(), sign([]byte(secret), "msg_1", now.Unix(), body)), []byte(body+" "), now); err == nil {
		t.Fatal("tampered body accepted")
	}
	old := now.Add(-10 * time.Minute).Unix()
	if err := VerifyWebhook(secret, headers("msg_1", old, sign([]byte(secret), "msg_1", old, body)), []byte(body), now); err == nil {
		t.Fatal("stale timestamp accepted")
	}
}

func TestParseLimitsKeepsDefaults(t *testing.T) {
	l := parseLimits(`{"plus":{"captures_monthly":300}}`)
	if l[TierPlus].CapturesMonthly != 300 {
		t.Fatalf("override lost: %+v", l[TierPlus])
	}
	if l[TierPlus].AIDaily != DefaultLimits()[TierPlus].AIDaily {
		t.Fatal("missing field should keep its default")
	}
	if l[TierPro] != DefaultLimits()[TierPro] {
		t.Fatal("missing tier should keep defaults")
	}
	if parseLimits("not json")[TierFree] != DefaultLimits()[TierFree] {
		t.Fatal("bad json should fall back to defaults")
	}
}

func TestPlanKeys(t *testing.T) {
	cases := map[string][2]string{
		"pro_year":       {TierPro, "year"},
		"plus_month":     {TierPlus, "month"},
		"pro_month_eur":  {TierPro, "month"},
		"enterprise_one": {"", ""},
	}
	for k, want := range cases {
		if TierOfPlanKey(k) != want[0] || IntervalOfPlanKey(k) != want[1] {
			t.Errorf("%s -> %s/%s", k, TierOfPlanKey(k), IntervalOfPlanKey(k))
		}
	}
}

// ---------------------------------------------------------------- subscription flow

type memStore struct {
	Store
	plans  map[uuid.UUID]UserPlan
	subs   map[string]Subscription
	events map[string]bool
}

func newMem() *memStore {
	return &memStore{plans: map[uuid.UUID]UserPlan{}, subs: map[string]Subscription{}, events: map[string]bool{}}
}

func (m *memStore) UserPlan(_ context.Context, id uuid.UUID) (UserPlan, error) { return m.plans[id], nil }
func (m *memStore) SetUserPlan(_ context.Context, id uuid.UUID, tier, source string, exp *time.Time) error {
	p := m.plans[id]
	p.Tier, p.Source, p.ExpiresAt = tier, source, exp
	m.plans[id] = p
	return nil
}
func (m *memStore) RecordEvent(_ context.Context, id, _ string, _ []byte) (bool, error) {
	return m.events[id], nil
}
func (m *memStore) FinishEvent(_ context.Context, id, _ string, _ *uuid.UUID, msg string) error {
	m.events[id] = msg == ""
	return nil
}
func (m *memStore) UpsertSubscription(_ context.Context, s Subscription) error {
	m.subs[s.ID] = s
	return nil
}
func (m *memStore) GetSubscription(_ context.Context, id string) (*Subscription, error) {
	if s, ok := m.subs[id]; ok {
		return &s, nil
	}
	return nil, nil
}
func (m *memStore) UserForCustomer(context.Context, string) (*uuid.UUID, error) { return nil, nil }
func (m *memStore) HasOtherLiveSubscription(_ context.Context, uid uuid.UUID, except string) (bool, error) {
	for id, s := range m.subs {
		if id != except && s.UserID != nil && *s.UserID == uid && liveStatus(s.Status) {
			return true, nil
		}
	}
	return false, nil
}

func deliver(t *testing.T, svc *Service, id, typ, data string) {
	t.Helper()
	body := fmt.Sprintf(`{"type":%q,"data":%s}`, typ, data)
	ts := svc.now().Unix()
	if err := svc.HandleWebhook(context.Background(), headers(id, ts, sign([]byte("sec"), id, ts, body)), []byte(body)); err != nil {
		t.Fatalf("%s: %v", typ, err)
	}
}

func TestSubscriptionLifecycle(t *testing.T) {
	st := newMem()
	uid := uuid.New()
	st.plans[uid] = UserPlan{UserID: uid, Tier: TierFree, Source: SourceTrial}
	svc := NewService(st, NewPolar("", "sandbox"), Config{WebhookSecret: "sec", Products: map[string]string{"pro_year": "prod_pro_y"}})

	active := fmt.Sprintf(`{"id":"sub_1","status":"active","amount":8999,"currency":"usd","recurring_interval":"year",
		"customer_id":"cus_1","product_id":"prod_pro_y","customer":{"id":"cus_1","external_id":%q}}`, uid)
	deliver(t, svc, "evt_1", "subscription.active", active)
	if p := st.plans[uid]; p.Tier != TierPro || p.Source != SourcePolar {
		t.Fatalf("after active: %+v", p)
	}
	if s := st.subs["sub_1"]; s.AmountCents != 8999 || s.Tier != TierPro || s.Interval != "year" {
		t.Fatalf("stored sub: %+v", s)
	}

	// A duplicate delivery is ignored even if the state changed meanwhile.
	st.plans[uid] = UserPlan{UserID: uid, Tier: TierPlus, Source: SourceAdmin}
	deliver(t, svc, "evt_1", "subscription.active", active)
	if st.plans[uid].Source != SourceAdmin {
		t.Fatal("duplicate webhook was re-applied")
	}
	st.plans[uid] = UserPlan{UserID: uid, Tier: TierPro, Source: SourcePolar}

	revoked := fmt.Sprintf(`{"id":"sub_1","status":"canceled","customer_id":"cus_1","product_id":"prod_pro_y","metadata":{"user_id":%q}}`, uid)
	deliver(t, svc, "evt_2", "subscription.revoked", revoked)
	if p := st.plans[uid]; p.Tier != TierFree {
		t.Fatalf("after revoke: %+v", p)
	}
}

func TestRevokeKeepsAdminComp(t *testing.T) {
	st := newMem()
	uid := uuid.New()
	st.plans[uid] = UserPlan{UserID: uid, Tier: TierPro, Source: SourceAdmin}
	svc := NewService(st, NewPolar("", "sandbox"), Config{WebhookSecret: "sec"})
	deliver(t, svc, "evt_9", "subscription.revoked", fmt.Sprintf(`{"id":"sub_9","status":"canceled","metadata":{"user_id":%q,"plan_key":"plus_month"}}`, uid))
	if st.plans[uid].Source != SourceAdmin {
		t.Fatal("revoking an old subscription must not wipe an admin comp")
	}
}
