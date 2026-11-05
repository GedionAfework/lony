package admin

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"equilend/api/internal/auth"
	"equilend/api/internal/httpx"

	"github.com/google/uuid"
)

// ---------------------------------------------------------------- definitions

// Control is one platform switch stored in platform_settings.
type Control struct {
	Key         string   `json:"key"`
	Label       string   `json:"label"`
	Description string   `json:"description"`
	Group       string   `json:"group"`
	Kind        string   `json:"kind"` // "bool" or "text"
	Danger      bool     `json:"danger"`
	Paths       []string `json:"paths,omitempty"`
	Value       string   `json:"value"`
	Enabled     bool     `json:"enabled"`
}

const (
	ControlMaintenance    = "maintenance_mode"
	ControlMaintenanceMsg = "maintenance_message"
	ControlSignupsOff     = "signups_disabled"

	defaultMaintenanceMsg = "Lony is down for scheduled maintenance. Please try again shortly."
)

// feature is a part of the app that can be paused. While paused, requests
// that change data (POST/PUT/PATCH/DELETE) on its paths get a 503; reads keep
// working so people can still see their data.
type feature struct {
	key, label, description string
	prefixes, suffixes      []string
}

var features = []feature{
	{"pause.loans", "Loans & repayments", "Stops new loans, term changes and repayment claims.",
		[]string{"/loans", "/repayments"}, nil},
	{"pause.friends", "Friend requests", "Stops new friend requests, invites and friendship changes.",
		[]string{"/friend-requests", "/friendships", "/users/invite-phone"}, nil},
	{"pause.chat", "Chat", "Stops sending messages and opening conversations.",
		[]string{"/conversations"}, nil},
	{"pause.bank_links", "Bank linking", "Stops connecting, syncing and disconnecting banks.",
		[]string{"/bank-links"}, nil},
	{"pause.imports", "Imports & scanning", "Stops statement imports, SMS ingest, receipt scans and voice entry.",
		[]string{"/cashflow/sms-ingest", "/cashflow/receipt-scan", "/cashflow/voice-parse"}, []string{"/import"}},
	{"pause.goal_prices", "Goal price lookups", "Stops product link previews, market search and price refreshes.",
		[]string{"/goals/preview-url", "/goals/extract", "/goals/market-search", "/goals/refresh-prices"}, []string{"/refresh-price"}},
}

func controlDefs() []Control {
	out := []Control{
		{Key: ControlMaintenance, Label: "Maintenance mode", Group: "platform", Kind: "bool", Danger: true,
			Description: "Blocks the app for everyone except admins. Users see the message below."},
		{Key: ControlMaintenanceMsg, Label: "Maintenance message", Group: "platform", Kind: "text",
			Description: "Shown to users while maintenance mode is on."},
		{Key: ControlSignupsOff, Label: "Pause email sign-ups", Group: "platform", Kind: "bool", Danger: true,
			Description: "New accounts can't register with email and password. Existing users can still sign in."},
	}
	for _, f := range features {
		paths := append([]string{}, f.prefixes...)
		for _, s := range f.suffixes {
			paths = append(paths, "*"+s)
		}
		out = append(out, Control{Key: f.key, Label: f.label, Description: f.description, Group: "features", Kind: "bool", Paths: paths})
	}
	return out
}

func isControlKey(key string) (Control, bool) {
	for _, c := range controlDefs() {
		if c.Key == key {
			return c, true
		}
	}
	return Control{}, false
}

func truthy(v string) bool {
	v = strings.TrimSpace(strings.ToLower(v))
	return v == "true" || v == "1" || v == "on" || v == "yes"
}

// ---------------------------------------------------------------- cache

type settingsCache struct {
	mu   sync.Mutex
	at   time.Time
	vals map[string]string
}

const settingsTTL = 5 * time.Second

func (s *Service) settings(ctx context.Context) map[string]string {
	s.cache.mu.Lock()
	defer s.cache.mu.Unlock()
	if s.cache.vals != nil && time.Since(s.cache.at) < settingsTTL {
		return s.cache.vals
	}
	vals, err := s.store.ListSettings(ctx)
	if err != nil {
		// Keep serving the last known values rather than failing open/closed on a blip.
		if s.cache.vals != nil {
			return s.cache.vals
		}
		return map[string]string{}
	}
	s.cache.vals = vals
	s.cache.at = time.Now()
	return vals
}

func (s *Service) invalidateSettings() {
	s.cache.mu.Lock()
	s.cache.vals = nil
	s.cache.mu.Unlock()
}

// ---------------------------------------------------------------- service

// Controls returns every platform switch with its current value. ai_disabled
// is included so the console can show it alongside the others.
func (s *Service) Controls(ctx context.Context) ([]Control, error) {
	vals, err := s.store.ListSettings(ctx)
	if err != nil {
		return nil, err
	}
	out := controlDefs()
	for i := range out {
		v := vals[out[i].Key]
		if out[i].Key == ControlMaintenanceMsg && strings.TrimSpace(v) == "" {
			v = defaultMaintenanceMsg
		}
		out[i].Value = v
		out[i].Enabled = out[i].Kind == "bool" && truthy(v)
	}
	ai := truthy(vals["ai_disabled"])
	out = append(out, Control{
		Key: "ai_disabled", Label: "Pause AI features", Group: "ai", Kind: "bool", Danger: true,
		Description: "Turns off insights, the coach, scanning and every other AI-powered feature.",
		Value:       map[bool]string{true: "true", false: "false"}[ai], Enabled: ai,
	})
	return out, nil
}

// SetControls updates several switches at once and writes one audit row.
func (s *Service) SetControls(ctx context.Context, actor uuid.UUID, changes map[string]string) ([]Control, error) {
	if len(changes) == 0 {
		return s.Controls(ctx)
	}
	before, err := s.store.ListSettings(ctx)
	if err != nil {
		return nil, err
	}
	diff := map[string]map[string]string{}
	for key, raw := range changes {
		def, ok := isControlKey(key)
		if !ok {
			return nil, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{key: "unknown control"})
		}
		val := strings.TrimSpace(raw)
		if def.Kind == "bool" {
			val = map[bool]string{true: "true", false: "false"}[truthy(val)]
		} else if len(val) > 500 {
			return nil, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{key: "500 characters max"})
		}
		if before[key] == val {
			continue
		}
		if err := s.store.SetSetting(ctx, key, val); err != nil {
			return nil, err
		}
		diff[key] = map[string]string{"from": before[key], "to": val}
	}
	s.invalidateSettings()
	if len(diff) > 0 {
		meta, _ := json.Marshal(map[string]any{"changes": diff})
		s.audit(ctx, actor, ActionControlsUpdate, nil, meta)
	}
	return s.Controls(ctx)
}

// ---------------------------------------------------------------- enforcement

func isMutating(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	}
	return false
}

func pausedFeature(vals map[string]string, path string) (feature, bool) {
	for _, f := range features {
		if !truthy(vals[f.key]) {
			continue
		}
		for _, p := range f.prefixes {
			if path == p || strings.HasPrefix(path, p+"/") {
				return f, true
			}
		}
		for _, sfx := range f.suffixes {
			if strings.HasSuffix(path, sfx) {
				return f, true
			}
		}
	}
	return feature{}, false
}

// PlatformGate enforces maintenance mode and paused features on authenticated
// API routes. Mount it after the auth middleware. Admin routes are never
// blocked so the console stays usable while the app is locked.
func (s *Service) PlatformGate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/api/v1")
		if strings.HasPrefix(path, "/admin") || path == "/auth/logout" || (path == "/me" && r.Method == http.MethodGet) {
			next.ServeHTTP(w, r)
			return
		}
		vals := s.settings(r.Context())
		if truthy(vals[ControlMaintenance]) {
			if ok, _ := s.IsAdmin(r.Context(), auth.UserIDFrom(r.Context())); !ok {
				msg := strings.TrimSpace(vals[ControlMaintenanceMsg])
				if msg == "" {
					msg = defaultMaintenanceMsg
				}
				w.Header().Set("Retry-After", "300")
				httpx.Error(w, httpx.E(http.StatusServiceUnavailable, "MAINTENANCE", msg))
				return
			}
		}
		if isMutating(r.Method) {
			if f, paused := pausedFeature(vals, path); paused {
				httpx.Error(w, httpx.E(http.StatusServiceUnavailable, "FEATURE_PAUSED", f.label+" is temporarily unavailable. Please try again later."))
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// SignupGate blocks email registration while sign-ups are paused.
func (s *Service) SignupGate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		vals := s.settings(r.Context())
		if truthy(vals[ControlSignupsOff]) || truthy(vals[ControlMaintenance]) {
			httpx.Error(w, httpx.E(http.StatusForbidden, "SIGNUPS_CLOSED", "New sign-ups are paused right now. Please try again later."))
			return
		}
		next.ServeHTTP(w, r)
	})
}
