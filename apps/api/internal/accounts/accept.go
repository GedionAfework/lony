package accounts

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"unicode"
	"unicode/utf8"

	"equilend/api/internal/banks"
	"equilend/api/internal/httpx"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type BankProfiles interface {
	Create(ctx context.Context, actor uuid.UUID, in banks.CreateInput) (banks.ProfileDTO, error)
}

type AccountNumberNotifier interface {
	NotifyAccountNumberNeeded(ctx context.Context, userID, accountID, profileID uuid.UUID, label string) error
}

func (s *Service) SetBankProfiles(b BankProfiles) {
	s.banks = b
}

func (s *Service) SetAccountNotifier(n AccountNumberNotifier) {
	s.accountNotify = n
}

// AcceptForLoans promotes a money account into a shareable payment profile.
type AcceptForLoansInput struct {
	FullName            string
	AccountIdentifier   string
	ProfitPercentYearly *string
	InstitutionName     *string
	ProfileType         string
}

type AcceptForLoansResult struct {
	Account     AccountDTO       `json:"account"`
	BankProfile banks.ProfileDTO `json:"bank_profile"`
	Masked      bool             `json:"account_number_masked"`
}

func (s *Service) AcceptForLoans(ctx context.Context, userID, accountID uuid.UUID, in AcceptForLoansInput) (AcceptForLoansResult, error) {
	if s.banks == nil {
		return AcceptForLoansResult{}, httpx.E(http.StatusServiceUnavailable, "UNAVAILABLE", "payment profiles not configured")
	}
	rec, err := s.store.Get(ctx, userID, accountID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AcceptForLoansResult{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "account not found")
		}
		return AcceptForLoansResult{}, err
	}
	fullName := strings.TrimSpace(in.FullName)
	if fullName == "" || utf8.RuneCountInString(fullName) > 120 {
		return AcceptForLoansResult{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"full_name": "required, max 120 characters",
		})
	}
	ident := strings.TrimSpace(in.AccountIdentifier)
	if ident == "" {
		return AcceptForLoansResult{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"account_identifier": "required",
		})
	}
	profileType := strings.TrimSpace(in.ProfileType)
	if profileType == "" {
		switch rec.AccountType {
		case TypeMobileMoney:
			profileType = banks.TypeMobileMoney
		case TypeWallet:
			profileType = banks.TypeMobileWallet
		default:
			profileType = banks.TypeBankAccount
		}
	}
	label := fullName
	if rec.InstitutionLabel != nil && strings.TrimSpace(*rec.InstitutionLabel) != "" {
		label = fullName + " · " + strings.TrimSpace(*rec.InstitutionLabel)
	}
	inst := in.InstitutionName
	if inst == nil {
		inst = rec.InstitutionLabel
	}
	cur := rec.CurrencyCode
	profile, err := s.banks.Create(ctx, userID, banks.CreateInput{
		Type:            profileType,
		Label:           label,
		InstitutionName: inst,
		Identifier:      ident,
		CurrencyCode:    &cur,
		IsPreferred:     true,
	})
	if err != nil {
		return AcceptForLoansResult{}, err
	}
	pid := profile.ID
	upd := UpdateInput{
		Name:          &fullName,
		BankProfileID: &pid,
	}
	if in.ProfitPercentYearly != nil && strings.TrimSpace(*in.ProfitPercentYearly) != "" {
		rate := strings.TrimSpace(*in.ProfitPercentYearly)
		comp := CompoundNone
		upd.InterestRatePercent = &rate
		upd.Compounding = &comp
	}
	account, err := s.Update(ctx, userID, accountID, upd)
	if err != nil {
		return AcceptForLoansResult{}, err
	}
	masked := looksMaskedIdentifier(ident)
	if masked && s.accountNotify != nil {
		_ = s.accountNotify.NotifyAccountNumberNeeded(ctx, userID, accountID, profile.ID, label)
	}
	return AcceptForLoansResult{
		Account:     account,
		BankProfile: profile,
		Masked:      masked,
	}, nil
}

func looksMaskedIdentifier(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return true
	}
	for _, r := range s {
		if r == '*' || r == 'x' || r == 'X' || r == '•' || r == '●' {
			return true
		}
	}
	digits := 0
	for _, r := range s {
		if unicode.IsDigit(r) {
			digits++
		}
	}
	return digits > 0 && digits < 6
}
