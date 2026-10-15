package appaudit

import (
	"context"
	_ "embed"
	"encoding/json"
	"log"
	"os"
	"sync"

	"github.com/axonops/audit"
	"github.com/google/uuid"
)

//go:embed taxonomy.yaml
var taxonomyYAML []byte

var (
	mu       sync.Mutex
	auditor  *audit.Auditor
	initOnce sync.Once
)

// Init starts a process-wide axonops auditor writing JSON events to stdout (and optional file).
func Init(appName string) error {
	var err error
	initOnce.Do(func() {
		tax, e := audit.ParseTaxonomyYAML(taxonomyYAML)
		if e != nil {
			err = e
			return
		}
		stdout, e := audit.NewStdoutOutput(audit.StdoutConfig{Writer: os.Stdout})
		if e != nil {
			err = e
			return
		}
		opts := []audit.Option{
			audit.WithTaxonomy(tax),
			audit.WithAppName(appName),
			audit.WithOutputs(stdout),
		}
		if host, _ := os.Hostname(); host != "" {
			opts = append(opts, audit.WithHost(host))
		}
		a, e := audit.New(opts...)
		if e != nil {
			err = e
			return
		}
		mu.Lock()
		auditor = a
		mu.Unlock()
		log.Printf("appaudit: axonops/audit enabled (stdout)")
	})
	return err
}

// Close shuts down the auditor.
func Close() {
	mu.Lock()
	a := auditor
	auditor = nil
	mu.Unlock()
	if a != nil {
		_ = a.Close()
	}
}

// Emit records a structured admin action via axonops/audit. Failures are logged, never returned.
func Emit(ctx context.Context, actor uuid.UUID, action string, target *uuid.UUID, meta json.RawMessage) {
	_ = ctx
	mu.Lock()
	a := auditor
	mu.Unlock()
	if a == nil {
		return
	}
	fields := []any{
		"actor_id", actor.String(),
		"outcome", "success",
		"action", action,
	}
	if target != nil {
		fields = append(fields, "target_id", target.String())
	}
	if len(meta) > 0 && string(meta) != "null" {
		fields = append(fields, "meta", string(meta))
	}
	ev, err := audit.NewEventKV("admin_action", fields...)
	if err != nil {
		log.Printf("appaudit: build event failed action=%s: %v", action, err)
		return
	}
	if err := a.AuditEvent(ev); err != nil {
		log.Printf("appaudit: emit failed action=%s: %v", action, err)
	}
}
