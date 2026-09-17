package server

import (
	"context"
	"net/http"
	"time"

	"equilend/api/internal/auth"
	"equilend/api/internal/banks"
	"equilend/api/internal/config"
	"equilend/api/internal/dashboard"
	"equilend/api/internal/friends"
	"equilend/api/internal/httpx"
	"equilend/api/internal/loans"
	"equilend/api/internal/repayments"
	"equilend/api/internal/store"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"
)

func New(cfg config.Config, pool *pgxpool.Pool, sqlStore *store.SQLStore) http.Handler {
	authH := auth.NewHandler(auth.NewService(sqlStore, cfg))
	friendsSvc := friends.NewService(sqlStore)
	friendsH := friends.NewHandler(friendsSvc)
	loansSvc := loans.NewService(sqlStore, friendsSvc)
	loansH := loans.NewHandler(loansSvc)
	dashH := dashboard.NewHandler(dashboard.NewService(loansSvc))
	banksSvc := banks.NewService(sqlStore, loansSvc, friendsSvc, cfg.BankKey)
	banksH := banks.NewHandler(banksSvc)
	repaySvc := repayments.NewService(sqlStore, loansSvc)
	repayH := repayments.NewHandler(repaySvc)

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

			r.Get("/dashboard", dashH.Get)
			r.Post("/loans", loansH.Create)
			r.Get("/loans", loansH.List)
			r.Get("/loans/{id}", loansH.Get)
			r.Get("/loans/{id}/payment-profile", banksH.LoanPaymentProfile)
			r.Post("/loans/{id}/terms", loansH.ProposeTerms)
			r.Post("/loans/{id}/accept", loansH.Accept)
			r.Post("/loans/{id}/reject", loansH.Reject)
			r.Post("/loans/{id}/cancel", loansH.Cancel)
			r.Post("/loans/{id}/repayments", repayH.Claim)
			r.Get("/loans/{id}/repayments", repayH.ListForLoan)
			r.Post("/repayments/{id}/confirm", repayH.Confirm)
			r.Post("/repayments/{id}/reject", repayH.Reject)

			r.Get("/bank-profiles", banksH.List)
			r.Post("/bank-profiles", banksH.Create)
			r.Get("/bank-profiles/{id}", banksH.Get)
			r.Patch("/bank-profiles/{id}", banksH.Patch)
			r.Post("/bank-profiles/{id}/archive", banksH.Archive)
			r.Post("/bank-profiles/{id}/preferred", banksH.Preferred)
			r.Post("/bank-profiles/{id}/share", banksH.Share)
			r.Get("/bank-profiles/{id}/events", banksH.Events)
			r.Get("/bank-profile-shares", banksH.ListShares)
			r.Post("/bank-profile-shares/{id}/revoke", banksH.Revoke)
		})
	})

	return r
}
