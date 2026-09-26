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
	if err := writeCSV(zw, "ledger_cashflow.csv", cashflowCSV(bundle.Cashflow)); err != nil {
		return nil, err
	}
	if err := writeCSV(zw, "ledger_transfers.csv", transfersCSV(bundle.Transfers)); err != nil {
		return nil, err
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

// ExportLedgerCSVZip returns a zip containing only ledger CSV files.
func (s *Service) ExportLedgerCSVZip(ctx context.Context, userID uuid.UUID) ([]byte, error) {
	bundle, err := s.ExportJSON(ctx, userID)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	if err := writeCSV(zw, "cashflow.csv", cashflowCSV(bundle.Cashflow)); err != nil {
		return nil, err
	}
	if err := writeCSV(zw, "transfers.csv", transfersCSV(bundle.Transfers)); err != nil {
		return nil, err
	}
	if err := writeCSV(zw, "accounts.csv", accountsCSV(bundle.Accounts)); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func writeCSV(zw *zip.Writer, name string, body string) error {
	w, err := zw.Create(name)
	if err != nil {
		return err
	}
	_, err = w.Write([]byte(body))
	return err
}

func csvEscape(v string) string {
	if strings.ContainsAny(v, ",\"\n\r") {
		return `"` + strings.ReplaceAll(v, `"`, `""`) + `"`
	}
	return v
}

func strAny(m map[string]any, key string) string {
	v, ok := m[key]
	if !ok || v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	case fmt.Stringer:
		return t.String()
	default:
		return fmt.Sprint(t)
	}
}

func cashflowCSV(rows []map[string]any) string {
	var b strings.Builder
	b.WriteString("id,kind,title,amount,currency_code,status,account_id,category,occurred_at,note\n")
	for _, r := range rows {
		b.WriteString(strings.Join([]string{
			csvEscape(strAny(r, "id")),
			csvEscape(strAny(r, "kind")),
			csvEscape(strAny(r, "title")),
			csvEscape(strAny(r, "amount")),
			csvEscape(strAny(r, "currency_code")),
			csvEscape(strAny(r, "status")),
			csvEscape(strAny(r, "account_id")),
			csvEscape(strAny(r, "category")),
			csvEscape(strAny(r, "occurred_at")),
			csvEscape(strAny(r, "note")),
		}, ","))
		b.WriteByte('\n')
	}
	return b.String()
}

func transfersCSV(rows []map[string]any) string {
	var b strings.Builder
	b.WriteString("id,from_account_id,to_account_id,amount,currency_code,occurred_at,note\n")
	for _, r := range rows {
		b.WriteString(strings.Join([]string{
			csvEscape(strAny(r, "id")),
			csvEscape(strAny(r, "from_account_id")),
			csvEscape(strAny(r, "to_account_id")),
			csvEscape(strAny(r, "amount")),
			csvEscape(strAny(r, "currency_code")),
			csvEscape(strAny(r, "occurred_at")),
			csvEscape(strAny(r, "note")),
		}, ","))
		b.WriteByte('\n')
	}
	return b.String()
}

func accountsCSV(rows []map[string]any) string {
	var b strings.Builder
	b.WriteString("id,name,account_type,currency_code,balance,institution_label\n")
	for _, r := range rows {
		b.WriteString(strings.Join([]string{
			csvEscape(strAny(r, "id")),
			csvEscape(strAny(r, "name")),
			csvEscape(strAny(r, "account_type")),
			csvEscape(strAny(r, "currency_code")),
			csvEscape(strAny(r, "balance")),
			csvEscape(strAny(r, "institution_label")),
		}, ","))
		b.WriteByte('\n')
	}
	return b.String()
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
