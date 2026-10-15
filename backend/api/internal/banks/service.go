package banks

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"equilend/api/internal/httpx"
	"equilend/api/internal/loans"
	"equilend/api/internal/rails"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type FriendshipGate interface {
	CanCreateLoan(ctx context.Context, a, b uuid.UUID) (bool, error)
}

type LoanLookup interface {
	Record(ctx context.Context, actor, id uuid.UUID) (loans.Record, error)
}

type Service struct {
	store    Store
	loans    LoanLookup
	gate     FriendshipGate
	key      []byte
	now      func() time.Time
	notifier ShareNotifier
}

type ShareNotifier interface {
	OnBankShared(ctx context.Context, owner, recipient uuid.UUID, loanID *uuid.UUID, ref, last4, label string) error
}

func NewService(store Store, loans LoanLookup, gate FriendshipGate, key []byte) *Service {
	return &Service{store: store, loans: loans, gate: gate, key: key, now: time.Now}
}

func (s *Service) SetNotifier(n ShareNotifier) {
	s.notifier = n
}

func (s *Service) Create(ctx context.Context, actor uuid.UUID, in CreateInput) (ProfileDTO, error) {
	rec, err := s.parseProfile(actor, in)
	if err != nil {
		return ProfileDTO{}, err
	}
	event := s.event(rec.ID, actor, EventCreated, map[string]any{"last4": rec.Last4, "profile_type": rec.Type})
	saved, err := s.store.InsertProfile(ctx, rec, event)
	if err != nil {
		return ProfileDTO{}, err
	}
	return toDTO(saved, false, true), nil
}

func (s *Service) List(ctx context.Context, actor uuid.UUID, includeArchived bool) ([]ProfileDTO, error) {
	rows, err := s.store.ListProfiles(ctx, actor, includeArchived)
	if err != nil {
		return nil, err
	}
	out := make([]ProfileDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, toDTO(row, false, true))
	}
	return out, nil
}

func (s *Service) Get(ctx context.Context, actor, id uuid.UUID) (ProfileDTO, error) {
	row, canReveal, err := s.accessible(ctx, actor, id)
	if err != nil {
		return ProfileDTO{}, err
	}
	return toDTO(row, false, canReveal), nil
}

func (s *Service) Reveal(ctx context.Context, actor, id uuid.UUID, issuedAt time.Time) (ProfileDTO, error) {
	if err := requireRecentAuth(issuedAt, s.now()); err != nil {
		return ProfileDTO{}, err
	}
	row, canReveal, err := s.accessible(ctx, actor, id)
	if err != nil {
		return ProfileDTO{}, err
	}
	if !canReveal {
		return ProfileDTO{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "bank profile not found")
	}
	plain, err := Decrypt(s.key, row.IdentifierCipher)
	if err != nil {
		return ProfileDTO{}, httpx.E(http.StatusInternalServerError, "INTERNAL", "could not read payment profile")
	}
	shareID := s.shareIDForReveal(ctx, actor, row)
	if err := s.store.InsertProfileEvent(ctx, s.eventWithShare(row.ID, shareID, actor, EventRevealed, map[string]any{"last4": row.Last4})); err != nil {
		return ProfileDTO{}, err
	}
	dto := toDTO(row, false, true)
	dto.AccountIdentifier = &plain
	return dto, nil
}

func (s *Service) Patch(ctx context.Context, actor, id uuid.UUID, in PatchInput) (ProfileDTO, error) {
	row, err := s.owned(ctx, actor, id)
	if err != nil {
		return ProfileDTO{}, err
	}
	if row.ArchivedAt != nil {
		return ProfileDTO{}, httpx.E(http.StatusConflict, "ARCHIVED", "archived payment profiles cannot be edited")
	}
	next := CreateInput{
		Type:            row.Type,
		Label:           row.Label,
		InstitutionName: row.InstitutionName,
		CurrencyCode:    row.CurrencyCode,
	}
	if in.Type != nil {
		next.Type = *in.Type
	}
	if in.Label != nil {
		next.Label = *in.Label
	}
	if in.InstitutionName != nil {
		next.InstitutionName = in.InstitutionName
	}
	if in.CurrencyCode != nil {
		next.CurrencyCode = in.CurrencyCode
	}
	if in.Identifier != nil {
		next.Identifier = *in.Identifier
	} else {
		plain, err := Decrypt(s.key, row.IdentifierCipher)
		if err != nil {
			return ProfileDTO{}, httpx.E(http.StatusInternalServerError, "INTERNAL", "could not read payment profile")
		}
		next.Identifier = plain
	}
	parsed, err := s.parseProfile(actor, next)
	if err != nil {
		return ProfileDTO{}, err
	}
	row.Type = parsed.Type
	row.Label = parsed.Label
	row.InstitutionName = parsed.InstitutionName
	row.IdentifierCipher = parsed.IdentifierCipher
	row.Last4 = parsed.Last4
	row.CurrencyCode = parsed.CurrencyCode
	saved, err := s.store.UpdateProfile(ctx, row, s.event(row.ID, actor, EventUpdated, map[string]any{"last4": row.Last4}))
	if err != nil {
		return ProfileDTO{}, err
	}
	return toDTO(saved, false, true), nil
}

func (s *Service) Archive(ctx context.Context, actor, id uuid.UUID) (ProfileDTO, error) {
	row, err := s.owned(ctx, actor, id)
	if err != nil {
		return ProfileDTO{}, err
	}
	if row.ArchivedAt != nil {
		return toDTO(row, false, true), nil
	}
	now := s.now().UTC()
	row.ArchivedAt = &now
	row.IsPreferred = false
	saved, err := s.store.UpdateProfile(ctx, row, s.event(row.ID, actor, EventArchived, map[string]any{"last4": row.Last4}))
	if err != nil {
		return ProfileDTO{}, err
	}
	return toDTO(saved, false, true), nil
}

func (s *Service) SetPreferred(ctx context.Context, actor, id uuid.UUID) (ProfileDTO, error) {
	row, err := s.owned(ctx, actor, id)
	if err != nil {
		return ProfileDTO{}, err
	}
	if row.ArchivedAt != nil {
		return ProfileDTO{}, httpx.E(http.StatusConflict, "ARCHIVED", "archived payment profiles cannot be preferred")
	}
	saved, err := s.store.SetPreferred(ctx, actor, id, s.event(id, actor, EventPreferred, map[string]any{"last4": row.Last4}))
	if err != nil {
		return ProfileDTO{}, err
	}
	return toDTO(saved, false, true), nil
}

func (s *Service) Share(ctx context.Context, actor, profileID uuid.UUID, in ShareInput) (ShareDTO, error) {
	row, err := s.owned(ctx, actor, profileID)
	if err != nil {
		return ShareDTO{}, err
	}
	if row.ArchivedAt != nil {
		return ShareDTO{}, httpx.E(http.StatusConflict, "ARCHIVED", "archived payment profiles cannot be shared")
	}
	if in.RecipientID == uuid.Nil || in.RecipientID == actor {
		return ShareDTO{}, httpx.E(http.StatusUnprocessableEntity, "VALIDATION", "choose someone else to share with")
	}
	if in.LoanID != nil {
		rec, err := s.loans.Record(ctx, actor, *in.LoanID)
		if err != nil {
			return ShareDTO{}, err
		}
		if rec.LenderID != actor {
			return ShareDTO{}, httpx.E(http.StatusForbidden, "FORBIDDEN", "only the lender can share a payment profile on this loan")
		}
		if rec.Status != loans.StatusActive && rec.Status != loans.StatusOverdue {
			return ShareDTO{}, httpx.E(http.StatusConflict, "INVALID_STATE", "share a payment profile after the loan is accepted")
		}
		if in.RecipientID != rec.BorrowerID {
			return ShareDTO{}, httpx.E(http.StatusUnprocessableEntity, "VALIDATION", "loan payment profiles can only be shared with the borrower")
		}
	} else {
		ok, err := s.gate.CanCreateLoan(ctx, actor, in.RecipientID)
		if err != nil {
			return ShareDTO{}, err
		}
		if !ok {
			return ShareDTO{}, httpx.E(http.StatusForbidden, "NOT_FRIENDS", "you can only share a payment profile with an accepted friend")
		}
	}

	existing, err := s.store.GetActiveShare(ctx, profileID, in.RecipientID, in.LoanID)
	if err == nil {
		return s.toShareDTO(existing, row), nil
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return ShareDTO{}, err
	}

	share := Share{
		BankProfileID: profileID,
		OwnerID:       actor,
		RecipientID:   in.RecipientID,
		LoanID:        in.LoanID,
	}
	payload := map[string]any{"last4": row.Last4, "recipient_id": in.RecipientID.String()}
	if in.LoanID != nil {
		payload["loan_id"] = in.LoanID.String()
	}
	saved, err := s.store.InsertShare(ctx, share, s.event(profileID, actor, EventShared, payload))
	if err != nil {
		return ShareDTO{}, err
	}
	if s.notifier != nil {
		ref := "a loan"
		if in.LoanID != nil {
			if rec, err := s.loans.Record(ctx, actor, *in.LoanID); err == nil {
				ref = rec.ReferenceCode
			}
		}
		_ = s.notifier.OnBankShared(ctx, actor, in.RecipientID, in.LoanID, ref, row.Last4, row.Label)
	}
	return s.toShareDTO(saved, row), nil
}

func (s *Service) Revoke(ctx context.Context, actor, shareID uuid.UUID) (ShareDTO, error) {
	share, err := s.store.GetShare(ctx, shareID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ShareDTO{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "share not found")
	}
	if err != nil {
		return ShareDTO{}, err
	}
	if share.OwnerID != actor {
		return ShareDTO{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "share not found")
	}
	row, err := s.store.GetProfile(ctx, share.BankProfileID)
	if err != nil {
		return ShareDTO{}, err
	}
	if share.RevokedAt != nil {
		return s.toShareDTO(share, row), nil
	}
	payload := map[string]any{"last4": row.Last4, "recipient_id": share.RecipientID.String()}
	saved, err := s.store.RevokeShare(ctx, shareID, s.eventWithShare(row.ID, &shareID, actor, EventRevoked, payload))
	if err != nil {
		return ShareDTO{}, err
	}
	return s.toShareDTO(saved, row), nil
}

func (s *Service) ListShares(ctx context.Context, actor uuid.UUID, incoming bool) ([]ShareDTO, error) {
	var rows []Share
	var err error
	if incoming {
		rows, err = s.store.ListSharesForRecipient(ctx, actor)
	} else {
		rows, err = s.store.ListSharesForOwner(ctx, actor)
	}
	if err != nil {
		return nil, err
	}
	out := make([]ShareDTO, 0, len(rows))
	for _, row := range rows {
		profile, err := s.store.GetProfile(ctx, row.BankProfileID)
		if err != nil {
			return nil, err
		}
		out = append(out, s.toShareDTO(row, profile))
	}
	return out, nil
}

func (s *Service) LoanPaymentProfile(ctx context.Context, actor, loanID uuid.UUID, reveal bool, issuedAt time.Time) (ProfileDTO, error) {
	rec, err := s.loans.Record(ctx, actor, loanID)
	if err != nil {
		return ProfileDTO{}, err
	}
	if rec.BorrowerID != actor {
		return ProfileDTO{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "payment profile not found")
	}
	share, err := s.store.ActiveShareForLoan(ctx, loanID, actor)
	if errors.Is(err, pgx.ErrNoRows) {
		return ProfileDTO{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "payment profile not found")
	}
	if err != nil {
		return ProfileDTO{}, err
	}
	if reveal {
		return s.Reveal(ctx, actor, share.BankProfileID, issuedAt)
	}
	return s.Get(ctx, actor, share.BankProfileID)
}

func (s *Service) Events(ctx context.Context, actor, id uuid.UUID) ([]EventDTO, error) {
	if _, err := s.owned(ctx, actor, id); err != nil {
		return nil, err
	}
	rows, err := s.store.ListProfileEvents(ctx, id)
	if err != nil {
		return nil, err
	}
	out := make([]EventDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, EventDTO{
			ID:        row.ID,
			Type:      row.Type,
			ShareID:   row.ShareID,
			ActorID:   row.ActorID,
			Payload:   row.Payload,
			CreatedAt: row.CreatedAt,
		})
	}
	return out, nil
}

func (s *Service) accessible(ctx context.Context, actor, id uuid.UUID) (Profile, bool, error) {
	row, err := s.store.GetProfile(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return Profile{}, false, httpx.E(http.StatusNotFound, "NOT_FOUND", "bank profile not found")
	}
	if err != nil {
		return Profile{}, false, err
	}
	if row.UserID == actor {
		return row, true, nil
	}
	incoming, err := s.store.ListSharesForRecipient(ctx, actor)
	if err != nil {
		return Profile{}, false, err
	}
	for _, share := range incoming {
		if share.BankProfileID == id && share.RevokedAt == nil {
			return row, true, nil
		}
	}
	return Profile{}, false, httpx.E(http.StatusNotFound, "NOT_FOUND", "bank profile not found")
}

func (s *Service) owned(ctx context.Context, actor, id uuid.UUID) (Profile, error) {
	row, err := s.store.GetProfile(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return Profile{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "bank profile not found")
	}
	if err != nil {
		return Profile{}, err
	}
	if row.UserID != actor {
		return Profile{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "bank profile not found")
	}
	return row, nil
}

func (s *Service) parseProfile(actor uuid.UUID, in CreateInput) (Profile, error) {
	fields := map[string]string{}
	typ := strings.ToLower(strings.TrimSpace(in.Type))
	if !rails.ValidProfileType(typ) {
		fields["profile_type"] = "unsupported payment account type"
	}
	label := strings.TrimSpace(in.Label)
	if label == "" || utf8.RuneCountInString(label) > 120 {
		fields["label"] = "required, max 120 characters"
	}
	ident := strings.TrimSpace(in.Identifier)
	if utf8.RuneCountInString(ident) < 4 || utf8.RuneCountInString(ident) > 128 {
		fields["account_identifier"] = "required, 4 to 128 characters"
	}
	var institution *string
	if in.InstitutionName != nil {
		name := strings.TrimSpace(*in.InstitutionName)
		if utf8.RuneCountInString(name) > 120 {
			fields["institution_name"] = "max 120 characters"
		} else if name != "" {
			institution = &name
		}
	}
	var currency *string
	if in.CurrencyCode != nil {
		code := strings.ToUpper(strings.TrimSpace(*in.CurrencyCode))
		if code != "" && len(code) != 3 {
			fields["currency_code"] = "must be a 3-letter code"
		} else if code != "" {
			currency = &code
		}
	}
	var country *string
	if in.CountryCode != nil {
		c := strings.ToUpper(strings.TrimSpace(*in.CountryCode))
		if c != "" && len(c) != 2 {
			fields["country_code"] = "must be a 2-letter ISO country code"
		} else if c != "" {
			country = &c
		}
	}
	var rail *string
	if in.RailCode != nil {
		r := strings.TrimSpace(*in.RailCode)
		if utf8.RuneCountInString(r) > 64 {
			fields["rail_code"] = "max 64 characters"
		} else if r != "" {
			rail = &r
		}
	}
	if len(fields) > 0 {
		return Profile{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", fields)
	}
	cipher, err := Encrypt(s.key, ident)
	if err != nil {
		return Profile{}, err
	}
	return Profile{
		UserID:           actor,
		Type:             typ,
		Label:            label,
		InstitutionName:  institution,
		IdentifierCipher: cipher,
		Last4:            Last4(ident),
		CurrencyCode:     currency,
		CountryCode:      country,
		RailCode:         rail,
		IsPreferred:      in.IsPreferred,
	}, nil
}

func (s *Service) event(profileID, actor uuid.UUID, typ string, payload map[string]any) Event {
	return s.eventWithShare(profileID, nil, actor, typ, payload)
}

func (s *Service) eventWithShare(profileID uuid.UUID, shareID *uuid.UUID, actor uuid.UUID, typ string, payload map[string]any) Event {
	raw, _ := json.Marshal(payload)
	aid := actor
	return Event{
		BankProfileID: profileID,
		ShareID:       shareID,
		ActorID:       &aid,
		Type:          typ,
		Payload:       raw,
	}
}

func (s *Service) shareIDForReveal(ctx context.Context, actor uuid.UUID, row Profile) *uuid.UUID {
	if row.UserID == actor {
		return nil
	}
	incoming, err := s.store.ListSharesForRecipient(ctx, actor)
	if err != nil {
		return nil
	}
	for _, share := range incoming {
		if share.BankProfileID == row.ID && share.RevokedAt == nil {
			id := share.ID
			return &id
		}
	}
	return nil
}

func (s *Service) toShareDTO(share Share, profile Profile) ShareDTO {
	return ShareDTO{
		ID:        share.ID,
		Profile:   toDTO(profile, false, false),
		OwnerID:   share.OwnerID,
		Recipient: share.RecipientID,
		LoanID:    share.LoanID,
		CreatedAt: share.CreatedAt,
		RevokedAt: share.RevokedAt,
	}
}

func toDTO(row Profile, withIdentifier bool, canReveal bool) ProfileDTO {
	dto := ProfileDTO{
		ID:              row.ID,
		Type:            row.Type,
		Label:           row.Label,
		InstitutionName: row.InstitutionName,
		AccountLast4:    row.Last4,
		CurrencyCode:    row.CurrencyCode,
		CountryCode:     row.CountryCode,
		RailCode:        row.RailCode,
		IsPreferred:     row.IsPreferred,
		ArchivedAt:      row.ArchivedAt,
		CreatedAt:       row.CreatedAt,
		CanReveal:       canReveal,
	}
	if withIdentifier {
		// Identifier is attached by Reveal after decrypt; never copy ciphertext.
	}
	return dto
}

func requireRecentAuth(issuedAt, now time.Time) error {
	if issuedAt.IsZero() || now.Sub(issuedAt) > RevealWindow {
		return httpx.E(http.StatusForbidden, "REAUTH_REQUIRED", "confirm your identity to reveal the account number")
	}
	return nil
}
