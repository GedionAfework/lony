package banklink

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"equilend/api/internal/httpx"

	"github.com/google/uuid"
)

type Config struct {
	ClientID    string
	Secret      string
	Env         string // sandbox | development | production
	RedirectURI string
	PublicBase  string // API public URL for hosted Link page
}

type Connection struct {
	ID           uuid.UUID `json:"id"`
	UserID       uuid.UUID `json:"-"`
	Provider     string    `json:"provider"`
	ItemID       string    `json:"item_id,omitempty"`
	Institution  string    `json:"institution_label,omitempty"`
	Status       string    `json:"status"`
	AccountID    *uuid.UUID `json:"account_id,omitempty"`
	LastSyncedAt *time.Time `json:"last_synced_at,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

type Store interface {
	InsertConnection(ctx context.Context, c Connection) (Connection, error)
	ListConnections(ctx context.Context, userID uuid.UUID) ([]Connection, error)
	GetConnection(ctx context.Context, userID, id uuid.UUID) (Connection, error)
	UpdateConnectionStatus(ctx context.Context, userID, id uuid.UUID, status string) error
	SetConnectionAccess(ctx context.Context, id uuid.UUID, accessToken, itemID, institution string) error
	DeleteConnection(ctx context.Context, userID, id uuid.UUID) error
	GetAccessToken(ctx context.Context, userID, id uuid.UUID) (string, error)
	GetSyncCursor(ctx context.Context, userID, id uuid.UUID) (string, error)
	SetSyncState(ctx context.Context, userID, id uuid.UUID, cursor string, accountID *uuid.UUID, syncedAt time.Time) error
}

type AccountCreator interface {
	Create(ctx context.Context, userID uuid.UUID, in AccountCreateInput) (AccountRef, error)
	FindByInstitution(ctx context.Context, userID uuid.UUID, institution, currency string) (*AccountRef, error)
}

type CashflowCreator interface {
	Create(ctx context.Context, userID uuid.UUID, in CashflowCreateInput) error
	NoteExists(ctx context.Context, userID uuid.UUID, accountID uuid.UUID, notePrefix string) (bool, error)
}

type AccountCreateInput struct {
	Name             string
	AccountType      string
	CurrencyCode     string
	Balance          string
	InstitutionLabel *string
}

type AccountRef struct {
	ID           uuid.UUID
	CurrencyCode string
}

type CashflowCreateInput struct {
	Kind         string
	Title        string
	Amount       string
	CurrencyCode string
	Category     string
	AccountID    *uuid.UUID
	Note         *string
	OccurredAt   time.Time
}

type Service struct {
	store    Store
	cfg      Config
	http     *http.Client
	accounts AccountCreator
	cashflow CashflowCreator
}

func NewService(store Store, cfg Config) *Service {
	env := strings.ToLower(strings.TrimSpace(cfg.Env))
	if env == "" {
		env = "sandbox"
	}
	cfg.Env = env
	return &Service{
		store: store,
		cfg:   cfg,
		http:  &http.Client{Timeout: 45 * time.Second},
	}
}

func (s *Service) SetLedger(accounts AccountCreator, cashflow CashflowCreator) {
	s.accounts = accounts
	s.cashflow = cashflow
}

func (s *Service) Available() bool {
	return s != nil && strings.TrimSpace(s.cfg.ClientID) != "" && strings.TrimSpace(s.cfg.Secret) != ""
}

func (s *Service) Status() map[string]any {
	return map[string]any{
		"available": s.Available(),
		"provider":  "plaid",
		"env":       s.cfg.Env,
		"message": func() string {
			if s.Available() {
				return "Live bank linking is enabled (Plaid)."
			}
			return "Live bank OAuth is not configured. Use Accounts → Import for statement CSV, or set PLAID_CLIENT_ID and PLAID_SECRET."
		}(),
	}
}

type linkTokenResp struct {
	LinkToken string `json:"link_token"`
	Error     *struct {
		ErrorMessage string `json:"error_message"`
		ErrorCode    string `json:"error_code"`
	} `json:"error"`
}

func (s *Service) CreateSession(ctx context.Context, userID uuid.UUID) (map[string]any, error) {
	if !s.Available() {
		return nil, httpx.E(http.StatusServiceUnavailable, "BANK_LINK_UNAVAILABLE", "Plaid is not configured")
	}
	body := map[string]any{
		"client_id":     s.cfg.ClientID,
		"secret":        s.cfg.Secret,
		"client_name":   "Lony",
		"language":      "en",
		"country_codes": []string{"US", "CA", "GB"},
		"user":          map[string]string{"client_user_id": userID.String()},
		"products":      []string{"transactions"},
	}
	if s.cfg.RedirectURI != "" {
		body["redirect_uri"] = s.cfg.RedirectURI
	}
	var out linkTokenResp
	if err := s.plaidPOST(ctx, "/link/token/create", body, &out); err != nil {
		return nil, err
	}
	if out.Error != nil && out.Error.ErrorMessage != "" {
		return nil, httpx.E(http.StatusBadGateway, "PLAID_ERROR", out.Error.ErrorMessage)
	}
	if out.LinkToken == "" {
		return nil, httpx.E(http.StatusBadGateway, "PLAID_ERROR", "empty link token")
	}
	linkURL := "/api/v1/bank-links/link-ui?token=" + out.LinkToken
	if s.cfg.PublicBase != "" {
		linkURL = strings.TrimRight(s.cfg.PublicBase, "/") + linkURL
	}
	return map[string]any{
		"link_token": out.LinkToken,
		"link_url":   linkURL,
		"provider":   "plaid",
		"env":        s.cfg.Env,
	}, nil
}

type exchangeResp struct {
	AccessToken string `json:"access_token"`
	ItemID      string `json:"item_id"`
	Error       *struct {
		ErrorMessage string `json:"error_message"`
	} `json:"error"`
}

type itemResp struct {
	Item struct {
		InstitutionID string `json:"institution_id"`
	} `json:"item"`
}

type instResp struct {
	Institution struct {
		Name string `json:"name"`
	} `json:"institution"`
}

func (s *Service) Exchange(ctx context.Context, userID uuid.UUID, publicToken string) (Connection, error) {
	if !s.Available() {
		return Connection{}, httpx.E(http.StatusServiceUnavailable, "BANK_LINK_UNAVAILABLE", "Plaid is not configured")
	}
	publicToken = strings.TrimSpace(publicToken)
	if publicToken == "" {
		return Connection{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"public_token": "required",
		})
	}
	var ex exchangeResp
	if err := s.plaidPOST(ctx, "/item/public_token/exchange", map[string]any{
		"client_id":    s.cfg.ClientID,
		"secret":       s.cfg.Secret,
		"public_token": publicToken,
	}, &ex); err != nil {
		return Connection{}, err
	}
	if ex.Error != nil && ex.Error.ErrorMessage != "" {
		return Connection{}, httpx.E(http.StatusBadGateway, "PLAID_ERROR", ex.Error.ErrorMessage)
	}
	instLabel := "Linked bank"
	var item itemResp
	if err := s.plaidPOST(ctx, "/item/get", map[string]any{
		"client_id":    s.cfg.ClientID,
		"secret":       s.cfg.Secret,
		"access_token": ex.AccessToken,
	}, &item); err == nil && item.Item.InstitutionID != "" {
		var inst instResp
		if err := s.plaidPOST(ctx, "/institutions/get_by_id", map[string]any{
			"client_id":       s.cfg.ClientID,
			"secret":          s.cfg.Secret,
			"institution_id":  item.Item.InstitutionID,
			"country_codes":   []string{"US", "CA", "GB"},
		}, &inst); err == nil && inst.Institution.Name != "" {
			instLabel = inst.Institution.Name
		}
	}
	rec, err := s.store.InsertConnection(ctx, Connection{
		UserID: userID, Provider: "plaid", Status: "active", Institution: instLabel,
	})
	if err != nil {
		return Connection{}, err
	}
	if err := s.store.SetConnectionAccess(ctx, rec.ID, ex.AccessToken, ex.ItemID, instLabel); err != nil {
		return Connection{}, err
	}
	rec.ItemID = ex.ItemID
	rec.Institution = instLabel
	rec.Status = "active"
	return rec, nil
}

func (s *Service) List(ctx context.Context, userID uuid.UUID) ([]Connection, error) {
	return s.store.ListConnections(ctx, userID)
}

func (s *Service) Disconnect(ctx context.Context, userID, id uuid.UUID) error {
	return s.store.DeleteConnection(ctx, userID, id)
}

func (s *Service) plaidHost() string {
	switch s.cfg.Env {
	case "production":
		return "https://production.plaid.com"
	case "development":
		return "https://development.plaid.com"
	default:
		return "https://sandbox.plaid.com"
	}
}

func (s *Service) plaidPOST(ctx context.Context, path string, body any, dest any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.plaidHost()+path, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := s.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if err != nil {
		return err
	}
	if err := json.Unmarshal(payload, dest); err != nil {
		return fmt.Errorf("plaid decode: %w", err)
	}
	if res.StatusCode >= 300 {
		return httpx.E(http.StatusBadGateway, "PLAID_ERROR", strings.TrimSpace(string(payload)))
	}
	return nil
}

// LinkUIHTML is a minimal Plaid Link host page that redirects to the app deep link on success.
func LinkUIHTML(linkToken string) string {
	return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Connect bank · Lony</title>
<script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
<style>body{font-family:system-ui,sans-serif;padding:24px;background:#0f1624;color:#e8eef7}button{padding:12px 18px;border:0;border-radius:10px;background:#3b82f6;color:#fff;font-weight:600}</style>
</head><body>
<h1>Connect your bank</h1>
<p>Lony uses Plaid to link accounts securely. You can disconnect anytime.</p>
<button id="link">Continue</button>
<script>
const token = ` + jsonString(linkToken) + `;
const handler = Plaid.create({
  token,
  onSuccess: (public_token) => {
    window.location = 'lony://bank-link?public_token=' + encodeURIComponent(public_token);
  },
  onExit: () => { window.location = 'lony://bank-link?cancelled=1'; }
});
document.getElementById('link').onclick = () => handler.open();
handler.open();
</script>
</body></html>`
}

func jsonString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
