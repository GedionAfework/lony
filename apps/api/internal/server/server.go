package server

import (
	"context"
	"net/http"
	"time"

	"equilend/api/internal/auth"
	"equilend/api/internal/config"
	"equilend/api/internal/friends"
	"equilend/api/internal/httpx"
	"equilend/api/internal/store"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"
)

func New(cfg config.Config, pool *pgxpool.Pool, sqlStore *store.SQLStore) http.Handler {
	authH := auth.NewHandler(auth.NewService(sqlStore, cfg))
	friendsH := friends.NewHandler(friends.NewService(sqlStore))

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "Idempotency-Key", "X-Device-Label"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	r.Get("/health", func(w http.ResponseWriter, req *http.Request) {
		ctx, cancel := context.WithTimeout(req.Context(), 2*time.Second)
		defer cancel()
		if err := pool.Ping(ctx); err != nil {
			httpx.Error(w, httpx.E(http.StatusServiceUnavailable, "DB_UNAVAILABLE", "database unavailable"))
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	r.Route("/api/v1", func(r chi.Router) {
		r.Post("/auth/register", authH.Register)
		r.Post("/auth/verify", authH.Verify)
		r.Post("/auth/login", authH.Login)
		r.Post("/auth/refresh", authH.Refresh)

		r.Group(func(r chi.Router) {
			r.Use(auth.Middleware(cfg.JWTSecret))
			r.Post("/auth/logout", authH.Logout)
			r.Get("/me", authH.Me)
			r.Patch("/me", authH.PatchMe)

			r.Get("/users/search", friendsH.Search)
			r.Post("/users/{userID}/block", friendsH.Block)
			r.Get("/friends", friendsH.ListFriends)
			r.Post("/friend-requests", friendsH.Request)
			r.Get("/friend-requests", friendsH.ListIncoming)
			r.Get("/friend-requests/outgoing", friendsH.ListOutgoing)
			r.Post("/friend-requests/{id}/accept", friendsH.Accept)
			r.Post("/friend-requests/{id}/reject", friendsH.Reject)
			r.Post("/friendships/{id}/remove", friendsH.Remove)
		})
	})

	return r
}
