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

	log.Printf("lony worker scanning overdue loans (%s)", cfg.AppEnv)
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	run := func() {
		n, err := loanSvc.MarkOverdue(context.Background())
		if err != nil {
			log.Printf("overdue scan: %v", err)
			return
		}
		if n > 0 {
			log.Printf("marked %d loan(s) overdue", n)
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
