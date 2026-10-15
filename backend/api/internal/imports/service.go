package imports

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"time"

	"equilend/api/internal/accounts"
	"equilend/api/internal/expenses"
	"equilend/api/internal/httpx"

	"github.com/google/uuid"
)

type CashflowCreator interface {
	Create(ctx context.Context, userID uuid.UUID, in expenses.CreateInput) (expenses.EntryDTO, error)
	List(ctx context.Context, userID uuid.UUID, q expenses.ListQuery) ([]expenses.EntryDTO, error)
}

type AccountService interface {
	Get(ctx context.Context, userID, id uuid.UUID) (accounts.AccountDTO, error)
	SetBalance(ctx context.Context, userID, id uuid.UUID, in accounts.SetBalanceInput) (accounts.AccountDTO, error)
}

type Service struct {
	cashflow CashflowCreator
	accounts AccountService
	now      func() time.Time
}

func NewService(cashflow CashflowCreator, accounts AccountService) *Service {
	return &Service{cashflow: cashflow, accounts: accounts, now: time.Now}
}

type ImportInput struct {
	CSV         string
	SetBalance  *string // optional ending balance to set after import
	BalanceNote *string
}

type ImportResult struct {
	Imported int                   `json:"imported"`
	Skipped  int                   `json:"skipped"`
	Errors   []string              `json:"errors"`
	Account  accounts.AccountDTO   `json:"account"`
}

func (s *Service) ImportCSV(ctx context.Context, userID, accountID uuid.UUID, in ImportInput) (ImportResult, error) {
	acct, err := s.accounts.Get(ctx, userID, accountID)
	if err != nil {
		return ImportResult{}, err
	}
	csvText := strings.TrimSpace(in.CSV)
	if csvText == "" {
		return ImportResult{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"csv": "required",
		})
	}
	rows, parseErrs, err := ParseCSV(strings.NewReader(csvText))
	if err != nil {
		return ImportResult{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"csv": err.Error(),
		})
	}
	result := ImportResult{Errors: append([]string{}, parseErrs...), Account: acct}
	if len(rows) == 0 {
		if len(result.Errors) == 0 {
			result.Errors = append(result.Errors, "no transaction rows found")
		}
		return result, nil
	}

	seen := map[string]struct{}{}
	existing, err := s.loadFingerprints(ctx, userID, accountID, rows)
	if err != nil {
		return ImportResult{}, err
	}
	for k := range existing {
		seen[k] = struct{}{}
	}

	aid := accountID
	for _, row := range rows {
		fp := fingerprint(row)
		if _, ok := seen[fp]; ok {
			result.Skipped++
			continue
		}
		note := fmt.Sprintf("statement-import:%s", fp)
		_, err := s.cashflow.Create(ctx, userID, expenses.CreateInput{
			Kind:         row.Kind,
			Title:        row.Title,
			Amount:       row.Amount.StringFixed(2),
			CurrencyCode: acct.CurrencyCode,
			Category:     "Imported",
			AccountID:    &aid,
			Note:         &note,
			OccurredAt:   row.Date,
		})
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("%s %s: %v", row.Date.Format("2006-01-02"), row.Title, err))
			continue
		}
		seen[fp] = struct{}{}
		result.Imported++
	}

	if in.SetBalance != nil && strings.TrimSpace(*in.SetBalance) != "" {
		note := "statement import ending balance"
		if in.BalanceNote != nil && strings.TrimSpace(*in.BalanceNote) != "" {
			note = strings.TrimSpace(*in.BalanceNote)
		}
		updated, err := s.accounts.SetBalance(ctx, userID, accountID, accounts.SetBalanceInput{
			Balance: strings.TrimSpace(*in.SetBalance),
			Note:    &note,
		})
		if err != nil {
			result.Errors = append(result.Errors, "set_balance: "+err.Error())
		} else {
			result.Account = updated
		}
	} else if result.Imported > 0 {
		// Refresh account after cashflow deltas
		if refreshed, err := s.accounts.Get(ctx, userID, accountID); err == nil {
			result.Account = refreshed
		}
	}
	return result, nil
}

func fingerprint(row ParsedRow) string {
	key := fmt.Sprintf("%s|%s|%s|%s",
		row.Date.Format("2006-01-02"),
		row.Kind,
		row.Amount.StringFixed(2),
		strings.ToLower(strings.TrimSpace(row.Title)),
	)
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:8])
}

func (s *Service) loadFingerprints(ctx context.Context, userID, accountID uuid.UUID, rows []ParsedRow) (map[string]struct{}, error) {
	out := map[string]struct{}{}
	if len(rows) == 0 {
		return out, nil
	}
	minT, maxT := rows[0].Date, rows[0].Date
	for _, r := range rows[1:] {
		if r.Date.Before(minT) {
			minT = r.Date
		}
		if r.Date.After(maxT) {
			maxT = r.Date
		}
	}
	from := minT.Add(-24 * time.Hour)
	to := maxT.Add(48 * time.Hour)
	falseVal := false
	existing, err := s.cashflow.List(ctx, userID, expenses.ListQuery{
		From:      &from,
		To:        &to,
		Templates: &falseVal,
		Limit:     500,
	})
	if err != nil {
		return nil, err
	}
	for _, e := range existing {
		if e.AccountID == nil || *e.AccountID != accountID {
			continue
		}
		if e.Note != nil && strings.HasPrefix(*e.Note, "statement-import:") {
			fp := strings.TrimPrefix(*e.Note, "statement-import:")
			out[fp] = struct{}{}
			continue
		}
		// Also match legacy rows by date+kind+amount+title
		amt := e.Amount
		title := strings.ToLower(strings.TrimSpace(e.Title))
		day := e.OccurredAt.UTC().Format("2006-01-02")
		key := fmt.Sprintf("%s|%s|%s|%s", day, e.Kind, amt, title)
		sum := sha256.Sum256([]byte(key))
		out[hex.EncodeToString(sum[:8])] = struct{}{}
	}
	return out, nil
}
