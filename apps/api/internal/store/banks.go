package store

import (
	"context"
	"errors"

	"equilend/api/internal/banks"
	"equilend/api/internal/store/sqlc"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
)

func (s *SQLStore) InsertProfile(ctx context.Context, rec banks.Profile, event banks.Event) (banks.Profile, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return banks.Profile{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if rec.IsPreferred {
		if err := q.ClearPreferredBankProfiles(ctx, rec.UserID); err != nil {
			return banks.Profile{}, err
		}
	}
	row, err := q.InsertBankProfile(ctx, sqlc.InsertBankProfileParams{
		UserID:                     rec.UserID,
		ProfileType:                rec.Type,
		Label:                      rec.Label,
		InstitutionName:            rec.InstitutionName,
		AccountIdentifierEncrypted: rec.IdentifierCipher,
		AccountLast4:               rec.Last4,
		CurrencyCode:               rec.CurrencyCode,
		CountryCode:                rec.CountryCode,
		RailCode:                   rec.RailCode,
		IsPreferred:                rec.IsPreferred,
	})
	if err != nil {
		return banks.Profile{}, err
	}
	event.BankProfileID = row.ID
	if err := insertBankEvent(ctx, q, event); err != nil {
		return banks.Profile{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return banks.Profile{}, err
	}
	return mapBankProfile(row), nil
}

func (s *SQLStore) GetProfile(ctx context.Context, id uuid.UUID) (banks.Profile, error) {
	row, err := s.q.GetBankProfileByID(ctx, id)
	if err != nil {
		return banks.Profile{}, err
	}
	return mapBankProfile(row), nil
}

func (s *SQLStore) ListProfiles(ctx context.Context, userID uuid.UUID, includeArchived bool) ([]banks.Profile, error) {
	rows, err := s.q.ListBankProfilesForUser(ctx, sqlc.ListBankProfilesForUserParams{
		UserID:          userID,
		IncludeArchived: includeArchived,
	})
	if err != nil {
		return nil, err
	}
	out := make([]banks.Profile, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapBankProfile(row))
	}
	return out, nil
}

func (s *SQLStore) UpdateProfile(ctx context.Context, rec banks.Profile, event banks.Event) (banks.Profile, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return banks.Profile{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	row, err := q.UpdateBankProfile(ctx, updateParams(rec))
	if err != nil {
		return banks.Profile{}, err
	}
	if err := insertBankEvent(ctx, q, event); err != nil {
		return banks.Profile{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return banks.Profile{}, err
	}
	return mapBankProfile(row), nil
}

func (s *SQLStore) SetPreferred(ctx context.Context, userID, profileID uuid.UUID, event banks.Event) (banks.Profile, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return banks.Profile{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if err := q.ClearPreferredBankProfiles(ctx, userID); err != nil {
		return banks.Profile{}, err
	}
	row, err := q.GetBankProfileByID(ctx, profileID)
	if err != nil {
		return banks.Profile{}, err
	}
	rec := mapBankProfile(row)
	rec.IsPreferred = true
	updated, err := q.UpdateBankProfile(ctx, updateParams(rec))
	if err != nil {
		return banks.Profile{}, err
	}
	if err := insertBankEvent(ctx, q, event); err != nil {
		return banks.Profile{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return banks.Profile{}, err
	}
	return mapBankProfile(updated), nil
}

func (s *SQLStore) InsertShare(ctx context.Context, rec banks.Share, event banks.Event) (banks.Share, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return banks.Share{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	row, err := q.InsertBankProfileShare(ctx, sqlc.InsertBankProfileShareParams{
		BankProfileID: rec.BankProfileID,
		OwnerID:       rec.OwnerID,
		RecipientID:   rec.RecipientID,
		LoanID:        rec.LoanID,
	})
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return s.GetActiveShare(ctx, rec.BankProfileID, rec.RecipientID, rec.LoanID)
		}
		return banks.Share{}, err
	}
	event.ShareID = &row.ID
	if err := insertBankEvent(ctx, q, event); err != nil {
		return banks.Share{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return banks.Share{}, err
	}
	return mapBankShare(row), nil
}

func (s *SQLStore) GetShare(ctx context.Context, id uuid.UUID) (banks.Share, error) {
	row, err := s.q.GetBankProfileShareByID(ctx, id)
	if err != nil {
		return banks.Share{}, err
	}
	return mapBankShare(row), nil
}

func (s *SQLStore) GetActiveShare(ctx context.Context, profileID, recipientID uuid.UUID, loanID *uuid.UUID) (banks.Share, error) {
	row, err := s.q.GetActiveBankProfileShare(ctx, sqlc.GetActiveBankProfileShareParams{
		BankProfileID: profileID,
		RecipientID:   recipientID,
		LoanID:        loanID,
	})
	if err != nil {
		return banks.Share{}, err
	}
	return mapBankShare(row), nil
}

func (s *SQLStore) ListSharesForOwner(ctx context.Context, ownerID uuid.UUID) ([]banks.Share, error) {
	rows, err := s.q.ListBankProfileSharesForOwner(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	return mapBankShares(rows), nil
}

func (s *SQLStore) ListSharesForRecipient(ctx context.Context, recipientID uuid.UUID) ([]banks.Share, error) {
	rows, err := s.q.ListBankProfileSharesForRecipient(ctx, recipientID)
	if err != nil {
		return nil, err
	}
	return mapBankShares(rows), nil
}

func (s *SQLStore) ActiveShareForLoan(ctx context.Context, loanID, recipientID uuid.UUID) (banks.Share, error) {
	row, err := s.q.ActiveBankProfileShareForLoan(ctx, sqlc.ActiveBankProfileShareForLoanParams{
		LoanID:      loanID,
		RecipientID: recipientID,
	})
	if err != nil {
		return banks.Share{}, err
	}
	return mapBankShare(row), nil
}

func (s *SQLStore) RevokeShare(ctx context.Context, id uuid.UUID, event banks.Event) (banks.Share, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return banks.Share{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	row, err := q.RevokeBankProfileShare(ctx, id)
	if err != nil {
		return banks.Share{}, err
	}
	if err := insertBankEvent(ctx, q, event); err != nil {
		return banks.Share{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return banks.Share{}, err
	}
	return mapBankShare(row), nil
}

func (s *SQLStore) ListProfileEvents(ctx context.Context, profileID uuid.UUID) ([]banks.Event, error) {
	rows, err := s.q.ListBankProfileEvents(ctx, profileID)
	if err != nil {
		return nil, err
	}
	out := make([]banks.Event, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapBankEvent(row))
	}
	return out, nil
}

func (s *SQLStore) InsertProfileEvent(ctx context.Context, event banks.Event) error {
	return insertBankEvent(ctx, s.q, event)
}

func insertBankEvent(ctx context.Context, q *sqlc.Queries, event banks.Event) error {
	payload := event.Payload
	if len(payload) == 0 {
		payload = []byte("{}")
	}
	_, err := q.InsertBankProfileEvent(ctx, sqlc.InsertBankProfileEventParams{
		BankProfileID: event.BankProfileID,
		ShareID:       event.ShareID,
		ActorID:       event.ActorID,
		EventType:     event.Type,
		Payload:       payload,
	})
	return err
}

func updateParams(rec banks.Profile) sqlc.UpdateBankProfileParams {
	return sqlc.UpdateBankProfileParams{
		ID:                         rec.ID,
		ProfileType:                rec.Type,
		Label:                      rec.Label,
		InstitutionName:            rec.InstitutionName,
		AccountIdentifierEncrypted: rec.IdentifierCipher,
		AccountLast4:               rec.Last4,
		CurrencyCode:               rec.CurrencyCode,
		CountryCode:                rec.CountryCode,
		RailCode:                   rec.RailCode,
		IsPreferred:                rec.IsPreferred,
		ArchivedAt:                 rec.ArchivedAt,
	}
}

func mapBankProfile(row sqlc.BankProfile) banks.Profile {
	return banks.Profile{
		ID:               row.ID,
		UserID:           row.UserID,
		Type:             row.ProfileType,
		Label:            row.Label,
		InstitutionName:  row.InstitutionName,
		IdentifierCipher: row.AccountIdentifierEncrypted,
		Last4:            row.AccountLast4,
		CurrencyCode:     row.CurrencyCode,
		CountryCode:      row.CountryCode,
		RailCode:         row.RailCode,
		IsPreferred:      row.IsPreferred,
		ArchivedAt:       row.ArchivedAt,
		CreatedAt:        row.CreatedAt,
		UpdatedAt:        row.UpdatedAt,
	}
}

func mapBankShare(row sqlc.BankProfileShare) banks.Share {
	return banks.Share{
		ID:            row.ID,
		BankProfileID: row.BankProfileID,
		OwnerID:       row.OwnerID,
		RecipientID:   row.RecipientID,
		LoanID:        row.LoanID,
		CreatedAt:     row.CreatedAt,
		RevokedAt:     row.RevokedAt,
	}
}

func mapBankShares(rows []sqlc.BankProfileShare) []banks.Share {
	out := make([]banks.Share, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapBankShare(row))
	}
	return out
}

func mapBankEvent(row sqlc.BankProfileEvent) banks.Event {
	return banks.Event{
		ID:            row.ID,
		BankProfileID: row.BankProfileID,
		ShareID:       row.ShareID,
		ActorID:       row.ActorID,
		Type:          row.EventType,
		Payload:       row.Payload,
		CreatedAt:     row.CreatedAt,
	}
}
