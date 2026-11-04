package ratelimit

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestLimiterBlocksAfterBurst(t *testing.T) {
	lim := New(2, time.Minute)
	lim.now = func() time.Time { return time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC) }
	handler := lim.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = "203.0.113.10:1234"
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != http.StatusNoContent {
			t.Fatalf("req %d: %d", i, rr.Code)
		}
	}
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "203.0.113.10:1234"
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("got %d", rr.Code)
	}
}

func TestPerSessionKeepsUsersOnOneIPApart(t *testing.T) {
	l := New(2, time.Minute).PerSession()
	req := func(token string) *http.Request {
		r := httptest.NewRequest(http.MethodGet, "/x", nil)
		r.RemoteAddr = "196.188.1.1:1234" // same carrier IP for everyone
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		return r
	}
	ok := 0
	h := l.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { ok++ }))
	for _, tok := range []string{"alice-token-aaaaaaaa", "alice-token-aaaaaaaa", "bob-token-bbbbbbbbbb", "bob-token-bbbbbbbbbb"} {
		h.ServeHTTP(httptest.NewRecorder(), req(tok))
	}
	if ok != 4 {
		t.Fatalf("two sessions on one IP should each get their own limit, served %d of 4", ok)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req("alice-token-aaaaaaaa"))
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("alice's third request should be limited, got %d", w.Code)
	}
}
