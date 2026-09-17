package auth

import (
	"context"
	"net/http"
	"strings"
	"time"

	"equilend/api/internal/httpx"

	"github.com/google/uuid"
)

type ctxKey int

const (
	userIDKey ctxKey = iota
	sessionIDKey
	issuedAtKey
)

func ContextWithIdentity(ctx context.Context, userID, sessionID uuid.UUID, issuedAt time.Time) context.Context {
	ctx = context.WithValue(ctx, userIDKey, userID)
	ctx = context.WithValue(ctx, sessionIDKey, sessionID)
	return context.WithValue(ctx, issuedAtKey, issuedAt)
}

func UserIDFrom(ctx context.Context) uuid.UUID {
	v, _ := ctx.Value(userIDKey).(uuid.UUID)
	return v
}

func SessionIDFrom(ctx context.Context) uuid.UUID {
	v, _ := ctx.Value(sessionIDKey).(uuid.UUID)
	return v
}

func IssuedAtFrom(ctx context.Context) time.Time {
	v, _ := ctx.Value(issuedAtKey).(time.Time)
	return v
}

func Middleware(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get("Authorization")
			if !strings.HasPrefix(strings.ToLower(header), "bearer ") {
				httpx.Error(w, httpx.E(http.StatusUnauthorized, "UNAUTHORIZED", "missing access token"))
				return
			}
			raw := strings.TrimSpace(header[7:])
			claims, err := ParseAccessToken(secret, raw)
			if err != nil {
				httpx.Error(w, httpx.E(http.StatusUnauthorized, "UNAUTHORIZED", "invalid or expired access token"))
				return
			}
			userID, err := uuid.Parse(claims.Subject)
			if err != nil {
				httpx.Error(w, httpx.E(http.StatusUnauthorized, "UNAUTHORIZED", "invalid access token"))
				return
			}
			var issuedAt time.Time
			if claims.IssuedAt != nil {
				issuedAt = claims.IssuedAt.Time
			}
			next.ServeHTTP(w, r.WithContext(ContextWithIdentity(r.Context(), userID, claims.SessionID, issuedAt)))
		})
	}
}
