package privacy

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"equilend/api/internal/httpx"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type ExportBundle struct {
	ExportedAt string         `json:"exported_at"`
	Profile    map[string]any `json:"profile"`
	Accounts   []map[string]any `json:"accounts"`
	Cashflow   []map[string]any `json:"cashflow"`
	Transfers  []map[string]any `json:"transfers"`
	Budgets    []map[string]any `json:"budgets"`
	Goals      []map[string]any `json:"goals"`
	Loans      []map[string]any `json:"loans"`
	Repayments []map[string]any `json:"repayments"`
	AIInsights []map[string]any `json:"ai_insights"`
	Trust      map[string]any   `json:"trust,omitempty"`
}

type Store interface {
	BuildExport(ctx context.Context, userID uuid.UUID) (ExportBundle, error)
	SoftDeleteUser(ctx context.Context, userID uuid.UUID) error
	RevokeAllSessions(ctx context.Context, userID uuid.UUID) error
	GetSetting(ctx context.Context, key string) (string, error)
	SetSetting(ctx context.Context, key, value string) error
}

type Service struct {
	store Store
	now   func() time.Time
}

func NewService(store Store) *Service {
	return &Service{store: store, now: time.Now}
}

func (s *Service) ExportJSON(ctx context.Context, userID uuid.UUID) (ExportBundle, error) {
	bundle, err := s.store.BuildExport(ctx, userID)
	if err != nil {
		return ExportBundle{}, err
	}
	bundle.ExportedAt = s.now().UTC().Format(time.RFC3339)
	return bundle, nil
}

func (s *Service) ExportZip(ctx context.Context, userID uuid.UUID) ([]byte, error) {
	bundle, err := s.ExportJSON(ctx, userID)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	write := func(name string, v any) error {
		b, err := json.MarshalIndent(v, "", "  ")
		if err != nil {
			return err
		}
		w, err := zw.Create(name)
		if err != nil {
			return err
		}
		_, err = w.Write(b)
		return err
	}
	if err := write("profile.json", bundle.Profile); err != nil {
		return nil, err
	}
	if err := write("accounts.json", bundle.Accounts); err != nil {
		return nil, err
	}
	if err := write("cashflow.json", bundle.Cashflow); err != nil {
		return nil, err
	}
	if err := write("transfers.json", bundle.Transfers); err != nil {
		return nil, err
	}
	if err := write("budgets.json", bundle.Budgets); err != nil {
		return nil, err
	}
	if err := write("goals.json", bundle.Goals); err != nil {
		return nil, err
	}
	if err := write("loans.json", bundle.Loans); err != nil {
		return nil, err
	}
	if err := write("repayments.json", bundle.Repayments); err != nil {
		return nil, err
	}
	if err := write("ai_insights.json", bundle.AIInsights); err != nil {
		return nil, err
	}
	if bundle.Trust != nil {
		if err := write("trust.json", bundle.Trust); err != nil {
			return nil, err
		}
	}
	meta := map[string]string{"exported_at": bundle.ExportedAt, "format": "lony-export-v1"}
	if err := write("meta.json", meta); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func (s *Service) DeleteAccount(ctx context.Context, userID uuid.UUID) error {
	if err := s.store.RevokeAllSessions(ctx, userID); err != nil {
		return err
	}
	if err := s.store.SoftDeleteUser(ctx, userID); err != nil {
		if err == pgx.ErrNoRows {
			return httpx.E(http.StatusNotFound, "NOT_FOUND", "account not found")
		}
		return err
	}
	return nil
}

func (s *Service) AIDisabled(ctx context.Context) (bool, error) {
	v, err := s.store.GetSetting(ctx, "ai_disabled")
	if err != nil {
		if err == pgx.ErrNoRows {
			return false, nil
		}
		return false, err
	}
	return strings.EqualFold(strings.TrimSpace(v), "true") || v == "1", nil
}

func (s *Service) SetAIDisabled(ctx context.Context, disabled bool) error {
	val := "false"
	if disabled {
		val = "true"
	}
	return s.store.SetSetting(ctx, "ai_disabled", val)
}

func ErrAIDisabled() error {
	return httpx.E(http.StatusServiceUnavailable, "AI_DISABLED", "AI features are temporarily disabled")
}

func Filename(userID uuid.UUID) string {
	return fmt.Sprintf("lony-export-%s.zip", userID.String()[:8])
}
