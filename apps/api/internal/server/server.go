package server

import (
	"context"
	"net/http"
	"time"

	"equilend/api/internal/auth"
	"equilend/api/internal/banks"
	"equilend/api/internal/chat"
	"equilend/api/internal/config"
	"equilend/api/internal/dashboard"
	"equilend/api/internal/friends"
	"equilend/api/internal/fx"
	"equilend/api/internal/httpx"
	"equilend/api/internal/idempotency"
	"equilend/api/internal/legal"
	"equilend/api/internal/loans"
	"equilend/api/internal/notifications"
	"equilend/api/internal/rails"
	"equilend/api/internal/ratelimit"
	"equilend/api/internal/repayments"
	"equilend/api/internal/store"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"
)

func New(cfg config.Config, pool *pgxpool.Pool, sqlStore *store.SQLStore) http.Handler {
	mediaStore, err := chat.NewDiskMedia(cfg.MediaDir)
	if err != nil {
		panic(err)
	}

	authSvc := auth.NewService(sqlStore, cfg)
	authH := auth.NewHandler(authSvc).WithMedia(mediaStore, sqlStore)
	friendsSvc := friends.NewService(sqlStore)
	friendsH := friends.NewHandler(friendsSvc)
	loansSvc := loans.NewService(sqlStore, friendsSvc)
	loansH := loans.NewHandler(loansSvc)
	dashH := dashboard.NewHandler(dashboard.NewService(loansSvc))
	banksSvc := banks.NewService(sqlStore, loansSvc, friendsSvc, cfg.BankKey)
	banksH := banks.NewHandler(banksSvc)
	repaySvc := repayments.NewService(sqlStore, loansSvc)
	repayH := repayments.NewHandler(repaySvc).WithMedia(mediaStore, sqlStore)
	notifySvc := notifications.NewService(sqlStore, notifications.NewPusher(cfg.ExpoAccessToken))
	notifyH := notifications.NewHandler(notifySvc)
	loansSvc.SetHooks(notifications.LoanHooks{Svc: notifySvc})
	friendsSvc.SetNotifier(notifications.FriendHooks{Svc: notifySvc})
	repaySvc.SetNotifier(notifications.RepayHooks{Svc: notifySvc})

	chatSvc := chat.NewService(sqlStore, mediaStore, friendsSvc)
	chatSvc.SetLoans(loansSvc)
	chatH := chat.NewHandler(chatSvc, mediaStore)
	banksSvc.SetNotifier(notifications.BankHooks{Svc: notifySvc, Chat: chatSvc})

	authLimit := ratelimit.New(30, time.Minute)
	apiLimit := ratelimit.New(180, time.Minute)
	idem := idempotency.New(sqlStore, 24*time.Hour)

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
		ExposedHeaders:   []string{"Idempotent-Replay"},
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

	// Telegram Login Widget HTML (public; no JWT). Domain must match BotFather settings in production.
	r.Get("/auth/telegram/widget", authH.TelegramWidget)
	r.Get("/auth/telegram/callback", authH.TelegramCallback)

	legalH := legal.NewHandler()
	railsH := rails.NewHandler()
	fxH := fx.NewHandler(fx.New())

	r.Route("/api/v1", func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(authLimit.Middleware)
			r.With(idem.Handler("auth.register")).Post("/auth/register", authH.Register)
			r.With(idem.Handler("auth.verify")).Post("/auth/verify", authH.Verify)
			r.With(idem.Handler("auth.login")).Post("/auth/login", authH.Login)
			r.With(idem.Handler("auth.refresh")).Post("/auth/refresh", authH.Refresh)
			r.With(idem.Handler("auth.oauth")).Post("/auth/oauth", authH.OAuth)
			r.Get("/legal/tos", legalH.GetTOS)
			r.Get("/payment-rails", railsH.List)
			r.Get("/fx/rates", fxH.Rates)
		})

		r.Group(func(r chi.Router) {
			r.Use(apiLimit.Middleware)
			r.Use(auth.Middleware(cfg.JWTSecret))
			r.Post("/auth/logout", authH.Logout)
			r.Get("/me", authH.Me)
			r.Patch("/me", authH.PatchMe)
			r.With(idem.Handler("auth.tos")).Post("/me/tos", authH.AcceptTOS)
			r.With(idem.Handler("auth.avatar")).Post("/me/avatar", authH.UploadAvatar)

			r.Get("/users/search", friendsH.Search)
			r.With(idem.Handler("friends.block")).Post("/users/{userID}/block", friendsH.Block)
			r.Get("/friends", friendsH.ListFriends)
			r.With(idem.Handler("friends.request")).Post("/friend-requests", friendsH.Request)
			r.Get("/friend-requests", friendsH.ListIncoming)
			r.Get("/friend-requests/outgoing", friendsH.ListOutgoing)
			r.With(idem.Handler("friends.accept")).Post("/friend-requests/{id}/accept", friendsH.Accept)
			r.With(idem.Handler("friends.reject")).Post("/friend-requests/{id}/reject", friendsH.Reject)
			r.With(idem.Handler("friends.remove")).Post("/friendships/{id}/remove", friendsH.Remove)

			r.Get("/dashboard", dashH.Get)
			r.With(idem.Handler("loans.create")).Post("/loans", loansH.Create)
			r.Get("/loans", loansH.List)
			r.Get("/loans/{id}", loansH.Get)
			r.Get("/loans/{id}/payment-profile", banksH.LoanPaymentProfile)
			r.With(idem.Handler("loans.terms")).Post("/loans/{id}/terms", loansH.ProposeTerms)
			r.With(idem.Handler("loans.accept")).Post("/loans/{id}/accept", loansH.Accept)
			r.With(idem.Handler("loans.reject")).Post("/loans/{id}/reject", loansH.Reject)
			r.With(idem.Handler("loans.cancel")).Post("/loans/{id}/cancel", loansH.Cancel)
			r.With(idem.Handler("repayments.claim")).Post("/loans/{id}/repayments", repayH.Claim)
			r.Get("/loans/{id}/repayments", repayH.ListForLoan)
			r.With(idem.Handler("repayments.confirm")).Post("/repayments/{id}/confirm", repayH.Confirm)
			r.With(idem.Handler("repayments.reject")).Post("/repayments/{id}/reject", repayH.Reject)

			r.Get("/bank-profiles", banksH.List)
			r.With(idem.Handler("banks.create")).Post("/bank-profiles", banksH.Create)
			r.Get("/bank-profiles/{id}", banksH.Get)
			r.Patch("/bank-profiles/{id}", banksH.Patch)
			r.With(idem.Handler("banks.archive")).Post("/bank-profiles/{id}/archive", banksH.Archive)
			r.With(idem.Handler("banks.preferred")).Post("/bank-profiles/{id}/preferred", banksH.Preferred)
			r.With(idem.Handler("banks.share")).Post("/bank-profiles/{id}/share", banksH.Share)
			r.Get("/bank-profiles/{id}/events", banksH.Events)
			r.Get("/bank-profile-shares", banksH.ListShares)
			r.With(idem.Handler("banks.revoke")).Post("/bank-profile-shares/{id}/revoke", banksH.Revoke)

			r.Get("/notifications", notifyH.List)
			r.With(idem.Handler("notifications.read_all")).Post("/notifications/read-all", notifyH.MarkAllRead)
			r.With(idem.Handler("notifications.read")).Post("/notifications/{id}/read", notifyH.MarkRead)
			r.With(idem.Handler("notifications.device")).Post("/device-tokens", notifyH.RegisterDevice)

			r.Get("/conversations", chatH.ListConversations)
			r.With(idem.Handler("chat.open")).Post("/conversations", chatH.Open)
			r.Get("/conversations/{id}/messages", chatH.ListMessages)
			r.With(idem.Handler("chat.send")).Post("/conversations/{id}/messages", chatH.Send)
			r.With(idem.Handler("chat.react")).Post("/messages/{id}/reactions", chatH.React)
			r.Delete("/messages/{id}", chatH.DeleteMessage)
			r.Get("/media/{key}", chatH.Media)
		})
	})

	return r
}
