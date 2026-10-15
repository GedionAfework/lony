package banklink

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"equilend/api/internal/httpx"

	"github.com/google/uuid"
)

type SyncResult struct {
	Imported     int        `json:"imported"`
	Skipped      int        `json:"skipped"`
	Connection   Connection `json:"connection"`
	HasMore      bool       `json:"has_more"`
	NextCursor   string     `json:"next_cursor,omitempty"`
}

type syncTxn struct {
	TransactionID string  `json:"transaction_id"`
	Name          string  `json:"name"`
	Amount        float64 `json:"amount"`
	Date          string  `json:"date"`
	Pending       bool    `json:"pending"`
	ISOCurrency   string  `json:"iso_currency_code"`
	MerchantName  string  `json:"merchant_name"`
}

type syncResp struct {
	Added      []syncTxn `json:"added"`
	Modified   []syncTxn `json:"modified"`
	NextCursor string    `json:"next_cursor"`
	HasMore    bool      `json:"has_more"`
	Error      *struct {
		ErrorMessage string `json:"error_message"`
	} `json:"error"`
}

// Sync pulls Plaid transactions into cashflow_entries (idempotent via note fingerprint).
func (s *Service) Sync(ctx context.Context, userID, connectionID uuid.UUID) (SyncResult, error) {
	if !s.Available() {
		return SyncResult{}, httpx.E(http.StatusServiceUnavailable, "BANK_LINK_UNAVAILABLE", "Plaid is not configured")
	}
	if s.accounts == nil || s.cashflow == nil {
		return SyncResult{}, httpx.E(http.StatusServiceUnavailable, "BANK_LINK_UNAVAILABLE", "ledger wiring missing")
	}
	conn, err := s.store.GetConnection(ctx, userID, connectionID)
	if err != nil {
		return SyncResult{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "bank link not found")
	}
	if conn.Status != "active" {
		return SyncResult{}, httpx.E(http.StatusConflict, "LINK_INACTIVE", "bank link is not active")
	}
	access, err := s.store.GetAccessToken(ctx, userID, connectionID)
	if err != nil || strings.TrimSpace(access) == "" {
		return SyncResult{}, httpx.E(http.StatusConflict, "LINK_TOKEN_MISSING", "reconnect this bank to sync")
	}

	accountID := conn.AccountID
	currency := "USD"
	if accountID == nil {
		label := conn.Institution
		if label == "" {
			label = "Linked bank"
		}
		// Prefer an existing same-institution bank account over creating a duplicate.
		existing, _ := s.accounts.FindByInstitution(ctx, userID, label, currency)
		if existing != nil {
			accountID = &existing.ID
			currency = existing.CurrencyCode
		} else {
			acct, cerr := s.accounts.Create(ctx, userID, AccountCreateInput{
				Name:             label,
				AccountType:      "bank",
				CurrencyCode:     currency,
				Balance:          "0",
				InstitutionLabel: &label,
			})
			if cerr != nil {
				return SyncResult{}, cerr
			}
			accountID = &acct.ID
			currency = acct.CurrencyCode
		}
	}

	cursor, _ := s.store.GetSyncCursor(ctx, userID, connectionID)
	result := SyncResult{}
	pages := 0
	for {
		pages++
		if pages > 20 {
			break
		}
		body := map[string]any{
			"client_id":    s.cfg.ClientID,
			"secret":       s.cfg.Secret,
			"access_token": access,
			"cursor":       cursor,
			"count":        100,
		}
		var out syncResp
		if err := s.plaidPOST(ctx, "/transactions/sync", body, &out); err != nil {
			return SyncResult{}, err
		}
		if out.Error != nil && out.Error.ErrorMessage != "" {
			return SyncResult{}, httpx.E(http.StatusBadGateway, "PLAID_ERROR", out.Error.ErrorMessage)
		}
		for _, txn := range out.Added {
			if txn.Pending || strings.TrimSpace(txn.TransactionID) == "" {
				result.Skipped++
				continue
			}
			note := fmt.Sprintf("plaid:%s", txn.TransactionID)
			exists, nerr := s.cashflow.NoteExists(ctx, userID, *accountID, note)
			if nerr != nil {
				return SyncResult{}, nerr
			}
			if exists {
				result.Skipped++
				continue
			}
			kind := "expense"
			amt := txn.Amount
			if amt < 0 {
				kind = "income"
				amt = -amt
			}
			if amt <= 0 || math.IsNaN(amt) {
				result.Skipped++
				continue
			}
			title := strings.TrimSpace(txn.MerchantName)
			if title == "" {
				title = strings.TrimSpace(txn.Name)
			}
			if title == "" {
				title = "Bank transaction"
			}
			if len(title) > 120 {
				title = title[:120]
			}
			cur := strings.ToUpper(strings.TrimSpace(txn.ISOCurrency))
			if len(cur) != 3 {
				cur = currency
			}
			occurred, perr := time.Parse("2006-01-02", txn.Date)
			if perr != nil {
				occurred = time.Now().UTC()
			}
			noteCopy := note
			if err := s.cashflow.Create(ctx, userID, CashflowCreateInput{
				Kind:         kind,
				Title:        title,
				Amount:       fmt.Sprintf("%.2f", amt),
				CurrencyCode: cur,
				Category:     "Imported",
				AccountID:    accountID,
				Note:         &noteCopy,
				OccurredAt:   occurred.UTC(),
			}); err != nil {
				return SyncResult{}, err
			}
			result.Imported++
		}
		cursor = out.NextCursor
		result.HasMore = out.HasMore
		result.NextCursor = cursor
		if !out.HasMore {
			break
		}
	}

	now := time.Now().UTC()
	if err := s.store.SetSyncState(ctx, userID, connectionID, cursor, accountID, now); err != nil {
		return SyncResult{}, err
	}
	conn, _ = s.store.GetConnection(ctx, userID, connectionID)
	result.Connection = conn
	return result, nil
}
