package admin

import (
	"context"
	"encoding/json"
	"runtime"
	"runtime/debug"
	"time"

	"github.com/google/uuid"
)

// RuntimeInfo describes the API process itself.
type RuntimeInfo struct {
	Env         string    `json:"env"`
	GoVersion   string    `json:"go_version"`
	OS          string    `json:"os"`
	Arch        string    `json:"arch"`
	CPUs        int       `json:"cpus"`
	Goroutines  int       `json:"goroutines"`
	HeapAlloc   uint64    `json:"heap_alloc_bytes"`
	HeapSys     uint64    `json:"heap_sys_bytes"`
	Sys         uint64    `json:"sys_bytes"`
	NumGC       uint32    `json:"num_gc"`
	LastGCPause uint64    `json:"last_gc_pause_ns"`
	StartedAt   time.Time `json:"started_at"`
	UptimeSec   int64     `json:"uptime_sec"`
	Revision    string    `json:"revision,omitempty"`
	BuildTime   string    `json:"build_time,omitempty"`
	Modified    bool      `json:"modified,omitempty"`
}

type PoolInfo struct {
	Total    int32 `json:"total"`
	Idle     int32 `json:"idle"`
	Acquired int32 `json:"acquired"`
	Max      int32 `json:"max"`
}

type TableInfo struct {
	Name  string `json:"name"`
	Rows  int64  `json:"rows"`
	Bytes int64  `json:"bytes"`
}

type DBInfo struct {
	OK              bool        `json:"ok"`
	Error           string      `json:"error,omitempty"`
	LatencyMs       float64     `json:"latency_ms"`
	Version         string      `json:"version"`
	SizeBytes       int64       `json:"size_bytes"`
	Pool            PoolInfo    `json:"pool"`
	Migration       string      `json:"migration"`
	MigrationAt     *time.Time  `json:"migration_at,omitempty"`
	MigrationsCount int         `json:"migrations_count"`
	Tables          []TableInfo `json:"tables"`
}

type JobFailure struct {
	ID        uuid.UUID `json:"id"`
	Kind      string    `json:"kind"`
	Attempts  int       `json:"attempts"`
	LastError string    `json:"last_error"`
	RunAt     time.Time `json:"run_at"`
}

type JobsInfo struct {
	Pending        int          `json:"pending"`
	Due            int          `json:"due"`
	Failed         int          `json:"failed"`
	Completed24h   int          `json:"completed_24h"`
	Cancelled      int          `json:"cancelled"`
	OldestDueAt    *time.Time   `json:"oldest_due_at,omitempty"`
	RecentFailures []JobFailure `json:"recent_failures"`
}

type SessionInfo struct {
	Active     int `json:"active"`
	Used24h    int `json:"used_24h"`
	Used1h     int `json:"used_1h"`
	AdminsLive int `json:"admins_live"`
}

// Integration is an outside service the API depends on.
type Integration struct {
	Key        string `json:"key"`
	Label      string `json:"label"`
	Configured bool   `json:"configured"`
	Status     string `json:"status"` // ok | off | error
	Detail     string `json:"detail,omitempty"`
}

type SystemInfo struct {
	GeneratedAt  time.Time     `json:"generated_at"`
	Runtime      RuntimeInfo   `json:"runtime"`
	Database     DBInfo        `json:"database"`
	Jobs         JobsInfo      `json:"jobs"`
	Sessions     SessionInfo   `json:"sessions"`
	Integrations []Integration `json:"integrations"`
	Controls     []Control     `json:"controls"`
}

// SetEnvironment records static facts the system page reports.
func (s *Service) SetEnvironment(env string, integrations []Integration) {
	s.env = env
	s.integrations = integrations
}

func runtimeInfo(env string, started time.Time) RuntimeInfo {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	out := RuntimeInfo{
		Env:        env,
		GoVersion:  runtime.Version(),
		OS:         runtime.GOOS,
		Arch:       runtime.GOARCH,
		CPUs:       runtime.NumCPU(),
		Goroutines: runtime.NumGoroutine(),
		HeapAlloc:  m.HeapAlloc,
		HeapSys:    m.HeapSys,
		Sys:        m.Sys,
		NumGC:      m.NumGC,
		StartedAt:  started,
		UptimeSec:  int64(time.Since(started).Seconds()),
	}
	if m.NumGC > 0 {
		out.LastGCPause = m.PauseNs[(m.NumGC+255)%256]
	}
	if bi, ok := debug.ReadBuildInfo(); ok {
		for _, kv := range bi.Settings {
			switch kv.Key {
			case "vcs.revision":
				out.Revision = kv.Value
			case "vcs.time":
				out.BuildTime = kv.Value
			case "vcs.modified":
				out.Modified = kv.Value == "true"
			}
		}
	}
	return out
}

func (s *Service) System(ctx context.Context) (SystemInfo, error) {
	out := SystemInfo{GeneratedAt: time.Now().UTC(), Runtime: runtimeInfo(s.env, s.startedAt)}
	db, jobs, sessions, err := s.store.SystemSnapshot(ctx)
	if err != nil && db.Error == "" {
		db.Error = err.Error()
	}
	out.Database, out.Jobs, out.Sessions = db, jobs, sessions
	if out.Jobs.RecentFailures == nil {
		out.Jobs.RecentFailures = []JobFailure{}
	}
	if out.Database.Tables == nil {
		out.Database.Tables = []TableInfo{}
	}

	out.Integrations = append([]Integration{}, s.integrations...)
	if s.fx != nil {
		fxi := Integration{Key: "fx", Label: "Exchange rates", Configured: true, Status: "ok"}
		rates, asOf, ferr := s.fx.Rates(ctx, "USD")
		switch {
		case ferr != nil:
			fxi.Status, fxi.Detail = "error", ferr.Error()
		case len(rates) == 0:
			fxi.Status, fxi.Detail = "error", "no rates returned"
		default:
			fxi.Detail = "USD base"
			if !asOf.IsZero() {
				fxi.Detail += " · as of " + asOf.UTC().Format("2 Jan 15:04 MST")
			}
		}
		out.Integrations = append(out.Integrations, fxi)
	}
	if controls, cerr := s.Controls(ctx); cerr == nil {
		out.Controls = controls
	} else {
		out.Controls = []Control{}
	}
	return out, nil
}

func (s *Service) RetryFailedJobs(ctx context.Context, actor uuid.UUID) (int, error) {
	n, err := s.store.RetryFailedJobs(ctx)
	if err != nil {
		return 0, err
	}
	if n > 0 {
		meta, _ := json.Marshal(map[string]any{"jobs": n})
		s.audit(ctx, actor, ActionJobsRetry, nil, meta)
	}
	return n, nil
}
