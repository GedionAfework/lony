package accounts

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"unicode"

	"equilend/api/internal/httpx"
	"equilend/api/internal/loans"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// A credit card balance already includes purchases and installment plans on that card.
// A self-recorded debt for the same money must be linked to the card so net worth
// subtracts it once. See docs/net-worth-integrity.md.

// PossibleDuplicate is an open, unlinked self-recorded debt that looks like part of a card.
type PossibleDuplicate struct {
	LoanID       uuid.UUID    `json:"loan_id"`
	LoanTitle    string       `json:"loan_title"`
	Outstanding  string       `json:"outstanding"`
	CurrencyCode string       `json:"currency_code"`
	Cards        []AccountDTO `json:"cards"`
}

// CheckCardForDebt lets the loans service link a debt only to the user's own active
// credit card in the debt's currency.
func (s *Service) CheckCardForDebt(ctx context.Context, userID, accountID uuid.UUID, currency string) error {
	bad := func(msg string) error {
		return httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{"account_id": msg})
	}
	rec, err := s.store.Get(ctx, userID, accountID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && rec.ArchivedAt != nil) {
		return bad("account not found")
	}
	if err != nil {
		return err
	}
	if rec.AccountType != TypeCreditCard {
		return bad("must be a credit card")
	}
	if !strings.EqualFold(rec.CurrencyCode, currency) {
		return bad("card currency must match the debt currency")
	}
	return nil
}

// DebtMatches returns the user's active credit cards that look like the given
// institution, so a new-debt form can ask whether the debt is already on that card.
func (s *Service) DebtMatches(ctx context.Context, userID uuid.UUID, institution, currency string) ([]AccountDTO, error) {
	rows, err := s.store.List(ctx, userID, false)
	if err != nil {
		return nil, err
	}
	out := []AccountDTO{}
	for _, a := range rows {
		if a.AccountType != TypeCreditCard {
			continue
		}
		if currency != "" && !strings.EqualFold(a.CurrencyCode, currency) {
			continue
		}
		if cardMatches(a, institution) {
			out = append(out, toDTO(a))
		}
	}
	return out, nil
}

// PossibleDuplicates lists open self-recorded debts that match one of the user's cards
// and that the user has neither linked nor marked as separate.
func (s *Service) PossibleDuplicates(ctx context.Context, userID uuid.UUID) ([]PossibleDuplicate, error) {
	if s.loans == nil {
		return []PossibleDuplicate{}, nil
	}
	rows, err := s.loans.AllForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := []PossibleDuplicate{}
	for _, row := range rows {
		if !row.IsInstitutional() || row.BorrowerID != userID || row.LinkedAccountID != nil || row.AccountLinkDismissed {
			continue
		}
		if !isOpenLoan(row, userID, true) || row.CurrencyCode == nil || row.Remaining() == nil {
			continue
		}
		label := ""
		if row.InstitutionLabel != nil {
			label = *row.InstitutionLabel
		}
		cards, err := s.DebtMatches(ctx, userID, label, *row.CurrencyCode)
		if err != nil {
			return nil, err
		}
		if len(cards) == 0 {
			continue
		}
		title := label
		if row.Title != nil && strings.TrimSpace(*row.Title) != "" {
			title = *row.Title
		}
		out = append(out, PossibleDuplicate{
			LoanID:       row.ID,
			LoanTitle:    title,
			Outstanding:  row.Remaining().StringFixed(Scale),
			CurrencyCode: strings.ToUpper(*row.CurrencyCode),
			Cards:        cards,
		})
	}
	return out, nil
}

// coveredByCard reports whether a loan is already inside an active card's balance.
func coveredByCard(row loans.Record, activeCards map[uuid.UUID]bool) bool {
	return row.LinkedAccountID != nil && activeCards[*row.LinkedAccountID]
}

func cardMatches(a Account, institution string) bool {
	want := normalizeName(institution)
	if len(want) < 2 {
		return false
	}
	for _, label := range []string{a.Name, deref(a.InstitutionLabel)} {
		have := normalizeName(label)
		if len(have) < 2 {
			continue
		}
		if strings.Contains(have, want) || strings.Contains(want, have) {
			return true
		}
	}
	return false
}

func normalizeName(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
