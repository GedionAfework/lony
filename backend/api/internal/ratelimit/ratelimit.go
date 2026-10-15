package ratelimit

import (
	"net"
	"net/http"
	"sync"
	"time"

	"equilend/api/internal/httpx"
)

type window struct {
	count int
	reset time.Time
}

// Limiter is a simple fixed-window in-memory rate limiter keyed by client IP.
type Limiter struct {
	mu       sync.Mutex
	windows  map[string]window
	limit    int
	interval time.Duration
	now      func() time.Time
}

func New(limit int, interval time.Duration) *Limiter {
	return &Limiter{
		windows:  map[string]window{},
		limit:    limit,
		interval: interval,
		now:      time.Now,
	}
}

func (l *Limiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := clientIP(r)
		if !l.allow(key) {
			httpx.Error(w, httpx.E(http.StatusTooManyRequests, "RATE_LIMITED", "too many requests, try again shortly"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (l *Limiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	w, ok := l.windows[key]
	if !ok || !w.reset.After(now) {
		l.windows[key] = window{count: 1, reset: now.Add(l.interval)}
		return true
	}
	if w.count >= l.limit {
		return false
	}
	w.count++
	l.windows[key] = w
	return true
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
