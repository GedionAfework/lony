package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"equilend/api/db"
	"equilend/api/internal/config"
	"equilend/api/internal/friends"
	"equilend/api/internal/jobs"
	"equilend/api/internal/loans"
	"equilend/api/internal/notifications"
	"equilend/api/internal/reconcile"
	"equilend/api/internal/store"

	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	if err := db.Migrate(ctx, cfg.DatabaseURL); err != nil {
		cancel()
		log.Fatalf("migrate: %v", err)
	}
	cancel()

	pool, err := pgxpool.New(context.Background(), cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db pool: %v", err)
	}
	defer pool.Close()

	sqlStore := store.New(pool)
	loanSvc := loans.NewService(sqlStore, friends.NewService(sqlStore))
	notifySvc := notifications.NewService(sqlStore, notifications.NewPusher(cfg.ExpoAccessToken))
	reconcileSvc := reconcile.New(sqlStore)

	handlers := jobs.Handlers{Loans: loanSvc, Notify: notifySvc, Balance: reconcileSvc}
	mux := asynq.NewServeMux()
	handlers.Register(mux)

	srv := jobs.NewServer(cfg.RedisURL)
	scheduler := jobs.NewScheduler(cfg.RedisURL)
	if err := jobs.EnqueuePeriodic(scheduler); err != nil {
		log.Fatalf("asynq schedule: %v", err)
	}

	log.Printf("lony worker asynq+reminders (%s) redis=%s", cfg.AppEnv, jobs.RedisAddr(cfg.RedisURL))

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		if err := scheduler.Run(); err != nil {
			log.Printf("asynq scheduler stopped: %v", err)
		}
	}()
	go func() {
		if err := srv.Run(mux); err != nil {
			log.Fatalf("asynq server: %v", err)
		}
	}()

	<-stop
	srv.Shutdown()
	scheduler.Shutdown()
}
