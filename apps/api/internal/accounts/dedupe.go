package accounts

import (
	"context"
	"regexp"
	"strings"
	"unicode"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

var last4RE = regexp.MustCompile(`(?:\D|^)(\d{4})(?:\D|$)`)

// accountFingerprint groups duplicate money accounts for the same real-world account.
// Prefers last4 when present; otherwise type + currency + normalized institution/name.
func accountFingerprint(rec Account) string {
	atype := strings.ToLower(strings.TrimSpace(rec.AccountType))
	cur := strings.ToUpper(strings.TrimSpace(rec.CurrencyCode))
	if atype == TypeCash {
		return "cash|" + cur
	}
	last4 := extractLast4(rec.Name)
	if last4 == "" && rec.InstitutionLabel != nil {
		last4 = extractLast4(*rec.InstitutionLabel)
	}
	if last4 != "" {
		return atype + "|" + cur + "|••••" + last4
	}
	inst := normalizeInstitution(rec)
	return atype + "|" + cur + "|" + inst
}

func extractLast4(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	// Prefer trailing digits (…1234 or ****1234).
	digits := make([]rune, 0, 16)
	for _, r := range s {
		if unicode.IsDigit(r) {
			digits = append(digits, r)
		}
	}
	if len(digits) >= 4 {
		return string(digits[len(digits)-4:])
	}
	m := last4RE.FindStringSubmatch(s)
	if len(m) >= 2 {
		return m[1]
	}
	return ""
}

func normalizeInstitution(rec Account) string {
	raw := ""
	if rec.InstitutionLabel != nil {
		raw = *rec.InstitutionLabel
	}
	if raw == "" {
		raw = rec.Name
	}
	raw = strings.ToLower(strings.TrimSpace(raw))
	raw = strings.ReplaceAll(raw, "…", "")
	raw = strings.ReplaceAll(raw, "...", "")
	raw = strings.TrimSpace(strings.TrimPrefix(raw, "bank"))
	raw = strings.TrimSpace(strings.TrimPrefix(raw, "account"))
	raw = strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return r
		}
		return -1
	}, raw)
	if raw == "" {
		return "unknown"
	}
	return raw
}

func preferAccount(a, b Account) Account {
	// Prefer accepted payment profile, then richer balance, then older row.
	aHas := a.BankProfileID != nil
	bHas := b.BankProfileID != nil
	if aHas != bHas {
		if aHas {
			return a
		}
		return b
	}
	if a.Balance.GreaterThan(b.Balance) {
		return a
	}
	if b.Balance.GreaterThan(a.Balance) {
		return b
	}
	if a.CreatedAt.Before(b.CreatedAt) {
		return a
	}
	return b
}

// MergeDuplicates collapses same-fingerprint accounts: keeps one, archives the rest.
func (s *Service) MergeDuplicates(ctx context.Context, userID uuid.UUID) (int, error) {
	rows, err := s.store.List(ctx, userID, false)
	if err != nil {
		return 0, err
	}
	groups := map[string][]Account{}
	for _, r := range rows {
		key := accountFingerprint(r)
		groups[key] = append(groups[key], r)
	}
	merged := 0
	now := s.now().UTC()
	for _, group := range groups {
		if len(group) < 2 {
			continue
		}
		keeper := group[0]
		for _, cand := range group[1:] {
			keeper = preferAccount(keeper, cand)
		}
		sum := decimal.Zero
		var profile *uuid.UUID
		var interest = keeper.InterestRatePercent
		var compounding = keeper.Compounding
		var label = keeper.InstitutionLabel
		for _, cand := range group {
			if cand.Balance.GreaterThan(sum) {
				sum = cand.Balance
			}
			if cand.BankProfileID != nil {
				profile = cand.BankProfileID
			}
			if interest == nil && cand.InterestRatePercent != nil {
				interest = cand.InterestRatePercent
				compounding = cand.Compounding
			}
			if (label == nil || strings.TrimSpace(*label) == "") && cand.InstitutionLabel != nil {
				label = cand.InstitutionLabel
			}
			if cand.ID == keeper.ID {
				continue
			}
			if err := s.store.ReassignCashflows(ctx, cand.ID, keeper.ID); err != nil {
				return merged, err
			}
			if err := s.store.Archive(ctx, userID, cand.ID, now); err != nil {
				return merged, err
			}
			merged++
		}
		keeper.Balance = sum
		keeper.BalanceAsOf = now
		keeper.UpdatedAt = now
		keeper.BankProfileID = profile
		keeper.InterestRatePercent = interest
		keeper.Compounding = compounding
		keeper.InstitutionLabel = label
		if _, err := s.store.Update(ctx, keeper); err != nil {
			return merged, err
		}
		if _, err := s.store.SetBalance(ctx, keeper, BalanceEvent{
			AccountID: keeper.ID,
			UserID:    userID,
			Balance:   sum,
			Source:    "merge",
			CreatedAt: now,
		}); err != nil {
			return merged, err
		}
	}
	return merged, nil
}

// findExistingDuplicate returns an open account matching the create fingerprint.
func (s *Service) findExistingDuplicate(ctx context.Context, userID uuid.UUID, draft Account) (*Account, error) {
	rows, err := s.store.List(ctx, userID, false)
	if err != nil {
		return nil, err
	}
	want := accountFingerprint(draft)
	for i := range rows {
		if accountFingerprint(rows[i]) == want {
			return &rows[i], nil
		}
	}
	return nil, nil
}
