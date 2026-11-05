package admin

import (
	"context"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

// ---------------------------------------------------------------- request meta

type requestMetaKey struct{}

// RequestMeta is where an admin action came from; stored on each audit row.
type RequestMeta struct {
	IP        string
	UserAgent string
}

// CaptureRequestMeta stores the caller's IP and user agent on the request
// context so audit rows written further down can record them. Runs after
// chi's RealIP middleware, so RemoteAddr already reflects X-Forwarded-For.
func CaptureRequestMeta(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := r.RemoteAddr
		if host, _, err := net.SplitHostPort(ip); err == nil {
			ip = host
		}
		ua := r.UserAgent()
		if len(ua) > 400 {
			ua = ua[:400]
		}
		ctx := context.WithValue(r.Context(), requestMetaKey{}, RequestMeta{IP: ip, UserAgent: ua})
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequestMetaFrom returns the request meta captured for this context, if any.
func RequestMetaFrom(ctx context.Context) RequestMeta {
	m, _ := ctx.Value(requestMetaKey{}).(RequestMeta)
	return m
}

// ---------------------------------------------------------------- filters/stats

// AuditFilter narrows the audit log listing. Zero values mean "any".
type AuditFilter struct {
	Q        string
	Action   string // exact action, or a prefix ending in "." (e.g. "user.")
	ActorID  *uuid.UUID
	TargetID *uuid.UUID
	From     *time.Time
	To       *time.Time
	Limit    int
	Offset   int
}

type ActionCount struct {
	Action string `json:"action"`
	Count  int    `json:"count"`
}

type ActorCount struct {
	ActorID uuid.UUID `json:"actor_id"`
	Email   string    `json:"email"`
	Name    string    `json:"name"`
	Count   int       `json:"count"`
}

type AuditStats struct {
	Total     int           `json:"total"`
	Today     int           `json:"today"`
	Last7d    int           `json:"last_7d"`
	Actors7d  int           `json:"actors_7d"`
	ByDay     []DayCount    `json:"by_day"`
	ByAction  []ActionCount `json:"by_action"`
	TopActors []ActorCount  `json:"top_actors"`
}

func (s *Service) ListAuditFiltered(ctx context.Context, f AuditFilter) ([]AuditEntry, int, error) {
	if f.Limit <= 0 || f.Limit > 100 {
		f.Limit = 50
	}
	if f.Offset < 0 {
		f.Offset = 0
	}
	f.Q = strings.TrimSpace(f.Q)
	f.Action = strings.TrimSpace(f.Action)
	return s.store.ListAuditFiltered(ctx, f)
}

// ExportAudit returns up to max rows matching the filter, newest first.
func (s *Service) ExportAudit(ctx context.Context, f AuditFilter, max int) ([]AuditEntry, error) {
	f.Q = strings.TrimSpace(f.Q)
	f.Action = strings.TrimSpace(f.Action)
	f.Limit = max
	f.Offset = 0
	rows, _, err := s.store.ListAuditFiltered(ctx, f)
	return rows, err
}

func (s *Service) AuditStats(ctx context.Context, days int) (AuditStats, error) {
	if days <= 0 || days > 90 {
		days = 30
	}
	return s.store.AuditStats(ctx, days)
}
