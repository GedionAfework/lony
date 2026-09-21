package jobs

import (
	"context"
	"encoding/json"
	"log"
	"strings"
	"time"

	"equilend/api/internal/loans"
	"equilend/api/internal/notifications"
	"equilend/api/internal/reconcile"

	"github.com/hibiken/asynq"
)

const (
	TypeTickOverdue   = "lony:tick_overdue"
	TypeTickReminders = "lony:tick_reminders"
	TypeTickReconcile = "lony:tick_reconcile"
	TypeTickBalance   = "lony:tick_balance"
)

type Handlers struct {
	Loans   *loans.Service
	Notify  *notifications.Service
	Balance *reconcile.Service
}

func NewServer(redisURL string) *asynq.Server {
	return asynq.NewServer(
		asynq.RedisClientOpt{Addr: RedisAddr(redisURL)},
		asynq.Config{
			Concurrency: 4,
			Queues: map[string]int{
				"critical": 6,
				"default":  3,
			},
		},
	)
}

func NewScheduler(redisURL string) *asynq.Scheduler {
	return asynq.NewScheduler(asynq.RedisClientOpt{Addr: RedisAddr(redisURL)}, nil)
}

func (h Handlers) Register(mux *asynq.ServeMux) {
	mux.HandleFunc(TypeTickOverdue, h.handleOverdue)
	mux.HandleFunc(TypeTickReminders, h.handleReminders)
	mux.HandleFunc(TypeTickReconcile, h.handleReconcile)
	mux.HandleFunc(TypeTickBalance, h.handleBalance)
}

func (h Handlers) handleOverdue(ctx context.Context, _ *asynq.Task) error {
	n, err := h.Loans.MarkOverdue(ctx)
	if err != nil {
		return err
	}
	if n > 0 {
		log.Printf("asynq: marked %d loan(s) overdue", n)
	}
	return nil
}

func (h Handlers) handleReminders(ctx context.Context, _ *asynq.Task) error {
	n, err := h.Notify.ProcessDueJobs(ctx)
	if err != nil {
		return err
	}
	if n > 0 {
		log.Printf("asynq: delivered %d reminder job(s)", n)
	}
	return nil
}

func (h Handlers) handleReconcile(ctx context.Context, _ *asynq.Task) error {
	n, err := h.Notify.Reconcile(ctx)
	if err != nil {
		return err
	}
	if n > 0 {
		log.Printf("asynq: rebuilt %d missing reminder job(s)", n)
	}
	return nil
}

func (h Handlers) handleBalance(ctx context.Context, _ *asynq.Task) error {
	mismatches, err := h.Balance.Report(ctx)
	if err != nil {
		return err
	}
	for _, m := range mismatches {
		log.Printf("asynq balance mismatch loan=%s ref=%s status=%s stored=%s computed=%s",
			m.LoanID, m.ReferenceCode, m.Status, m.StoredOutstanding, m.ComputedOutstanding)
	}
	return nil
}

func EnqueuePeriodic(scheduler *asynq.Scheduler) error {
	tasks := []struct {
		cron string
		typ  string
	}{
		{"*/1 * * * *", TypeTickOverdue},
		{"*/1 * * * *", TypeTickReminders},
		{"*/5 * * * *", TypeTickReconcile},
		{"*/5 * * * *", TypeTickBalance},
	}
	for _, t := range tasks {
		payload, _ := json.Marshal(map[string]any{"at": time.Now().UTC()})
		if _, err := scheduler.Register(t.cron, asynq.NewTask(t.typ, payload), asynq.Queue("critical")); err != nil {
			return err
		}
	}
	return nil
}

func RedisAddr(redisURL string) string {
	u := strings.TrimSpace(redisURL)
	u = strings.TrimPrefix(u, "redis://")
	if i := strings.IndexByte(u, '/'); i >= 0 {
		u = u[:i]
	}
	if u == "" {
		return "127.0.0.1:6379"
	}
	return u
}
