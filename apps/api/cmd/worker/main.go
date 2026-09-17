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
	"equilend/api/internal/loans"
	"equilend/api/internal/notifications"
	"equilend/api/internal/reconcile"
	"equilend/api/internal/store"

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
	notifySvc := notifications.NewService(sqlStore, notifications.LogPusher{})
	reconcileSvc := reconcile.New(sqlStore)

	log.Printf("lony worker overdue+reminders+reconcile (%s)", cfg.AppEnv)
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	run := func() {
		bg := context.Background()
		if n, err := loanSvc.MarkOverdue(bg); err != nil {
			log.Printf("overdue scan: %v", err)
		} else if n > 0 {
			log.Printf("marked %d loan(s) overdue", n)
		}
		if n, err := notifySvc.ProcessDueJobs(bg); err != nil {
			log.Printf("reminder jobs: %v", err)
		} else if n > 0 {
			log.Printf("delivered %d reminder job(s)", n)
		}
		if n, err := notifySvc.Reconcile(bg); err != nil {
			log.Printf("reminder reconcile: %v", err)
		} else if n > 0 {
			log.Printf("rebuilt %d missing reminder job(s)", n)
		}
		if mismatches, err := reconcileSvc.Report(bg); err != nil {
			log.Printf("balance reconcile: %v", err)
		} else if len(mismatches) > 0 {
			for _, m := range mismatches {
				log.Printf("balance mismatch loan=%s ref=%s status=%s stored=%s computed=%s",
					m.LoanID, m.ReferenceCode, m.Status, m.StoredOutstanding, m.ComputedOutstanding)
			}
		}
	}
	run()

	for {
		select {
		case <-ticker.C:
			run()
		case <-stop:
			return
		}
	}
}
