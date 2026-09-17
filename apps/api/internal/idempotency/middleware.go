package idempotency

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"equilend/api/internal/auth"
	"equilend/api/internal/httpx"
	"equilend/api/internal/store"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type Store interface {
	GetIdempotency(ctx context.Context, userID *uuid.UUID, operation, key string) (store.IdempotencyRecord, error)
	SaveIdempotency(ctx context.Context, rec store.IdempotencyRecord) error
}

type Middleware struct {
	store Store
	ttl   time.Duration
}

func New(store Store, ttl time.Duration) *Middleware {
	if ttl <= 0 {
		ttl = 24 * time.Hour
	}
	return &Middleware{store: store, ttl: ttl}
}

func (m *Middleware) Handler(operation string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
			if key == "" {
				next.ServeHTTP(w, r)
				return
			}
			if utf8.RuneCountInString(key) > 100 {
				httpx.Error(w, httpx.E(http.StatusBadRequest, "INVALID_IDEMPOTENCY_KEY", "idempotency key is too long"))
				return
			}

			body, err := io.ReadAll(r.Body)
			if err != nil {
				httpx.Error(w, httpx.E(http.StatusBadRequest, "MALFORMED_BODY", "could not read request body"))
				return
			}
			_ = r.Body.Close()
			r.Body = io.NopCloser(bytes.NewReader(body))
			hash := sha256Hex(body)

			var userID *uuid.UUID
			if uid := auth.UserIDFrom(r.Context()); uid != uuid.Nil {
				userID = &uid
			}

			existing, err := m.store.GetIdempotency(r.Context(), userID, operation, key)
			if err == nil {
				if existing.RequestHash != hash {
					httpx.Error(w, httpx.E(http.StatusConflict, "IDEMPOTENCY_MISMATCH", "idempotency key was reused with a different request body"))
					return
				}
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Idempotent-Replay", "true")
				w.WriteHeader(existing.ResponseStatus)
				_, _ = w.Write(existing.ResponseBodyJSON)
				return
			}
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				httpx.Error(w, err)
				return
			}

			rec := &recordingWriter{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(rec, r)

			_ = m.store.SaveIdempotency(r.Context(), store.IdempotencyRecord{
				UserID:           userID,
				IdempotencyKey:   key,
				Operation:        operation,
				RequestHash:      hash,
				ResponseStatus:   rec.status,
				ResponseBodyJSON: rec.buf.Bytes(),
				ExpiresAt:        time.Now().UTC().Add(m.ttl),
			})
		})
	}
}

type recordingWriter struct {
	http.ResponseWriter
	status int
	buf    bytes.Buffer
}

func (w *recordingWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *recordingWriter) Write(b []byte) (int, error) {
	_, _ = w.buf.Write(b)
	return w.ResponseWriter.Write(b)
}

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
