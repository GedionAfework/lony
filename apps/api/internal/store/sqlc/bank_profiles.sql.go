package sqlc

import (
	"context"
	"time"

	"github.com/google/uuid"
)

func scanBankProfile(scan func(dest ...any) error) (BankProfile, error) {
	var i BankProfile
	err := scan(
		&i.ID,
		&i.UserID,
		&i.ProfileType,
		&i.Label,
		&i.InstitutionName,
		&i.AccountIdentifierEncrypted,
		&i.AccountLast4,
		&i.CurrencyCode,
		&i.IsPreferred,
		&i.ArchivedAt,
		&i.CreatedAt,
		&i.UpdatedAt,
	)
	return i, err
}

func scanBankProfileShare(scan func(dest ...any) error) (BankProfileShare, error) {
	var i BankProfileShare
	err := scan(&i.ID, &i.BankProfileID, &i.OwnerID, &i.RecipientID, &i.LoanID, &i.CreatedAt, &i.RevokedAt)
	return i, err
}

func scanBankProfileEvent(scan func(dest ...any) error) (BankProfileEvent, error) {
	var i BankProfileEvent
	err := scan(&i.ID, &i.BankProfileID, &i.ShareID, &i.ActorID, &i.EventType, &i.Payload, &i.CreatedAt)
	return i, err
}

const insertBankProfile = `-- name: InsertBankProfile :one
INSERT INTO bank_profiles (
  user_id, profile_type, label, institution_name, account_identifier_encrypted,
  account_last4, currency_code, is_preferred
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, user_id, profile_type, label, institution_name, account_identifier_encrypted, account_last4, currency_code, is_preferred, archived_at, created_at, updated_at
`

type InsertBankProfileParams struct {
	UserID                     uuid.UUID `json:"user_id"`
	ProfileType                string    `json:"profile_type"`
	Label                      string    `json:"label"`
	InstitutionName            *string   `json:"institution_name"`
	AccountIdentifierEncrypted []byte    `json:"account_identifier_encrypted"`
	AccountLast4               string    `json:"account_last4"`
	CurrencyCode               *string   `json:"currency_code"`
	IsPreferred                bool      `json:"is_preferred"`
}

func (q *Queries) InsertBankProfile(ctx context.Context, arg InsertBankProfileParams) (BankProfile, error) {
	row := q.db.QueryRow(ctx, insertBankProfile,
		arg.UserID, arg.ProfileType, arg.Label, arg.InstitutionName, arg.AccountIdentifierEncrypted, arg.AccountLast4, arg.CurrencyCode, arg.IsPreferred,
	)
	return scanBankProfile(row.Scan)
}

const getBankProfileByID = `-- name: GetBankProfileByID :one
SELECT id, user_id, profile_type, label, institution_name, account_identifier_encrypted, account_last4, currency_code, is_preferred, archived_at, created_at, updated_at FROM bank_profiles
WHERE id = $1
`

func (q *Queries) GetBankProfileByID(ctx context.Context, id uuid.UUID) (BankProfile, error) {
	row := q.db.QueryRow(ctx, getBankProfileByID, id)
	return scanBankProfile(row.Scan)
}

const listBankProfilesForUser = `-- name: ListBankProfilesForUser :many
SELECT id, user_id, profile_type, label, institution_name, account_identifier_encrypted, account_last4, currency_code, is_preferred, archived_at, created_at, updated_at FROM bank_profiles
WHERE user_id = $1
  AND ($2::boolean OR archived_at IS NULL)
ORDER BY is_preferred DESC, created_at DESC
`

type ListBankProfilesForUserParams struct {
	UserID          uuid.UUID `json:"user_id"`
	IncludeArchived bool      `json:"include_archived"`
}

func (q *Queries) ListBankProfilesForUser(ctx context.Context, arg ListBankProfilesForUserParams) ([]BankProfile, error) {
	rows, err := q.db.Query(ctx, listBankProfilesForUser, arg.UserID, arg.IncludeArchived)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []BankProfile{}
	for rows.Next() {
		item, err := scanBankProfile(rows.Scan)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

const updateBankProfile = `-- name: UpdateBankProfile :one
UPDATE bank_profiles
SET
  profile_type = $2,
  label = $3,
  institution_name = $4,
  account_identifier_encrypted = $5,
  account_last4 = $6,
  currency_code = $7,
  is_preferred = $8,
  archived_at = $9,
  updated_at = now()
WHERE id = $1
RETURNING id, user_id, profile_type, label, institution_name, account_identifier_encrypted, account_last4, currency_code, is_preferred, archived_at, created_at, updated_at
`

type UpdateBankProfileParams struct {
	ID                         uuid.UUID  `json:"id"`
	ProfileType                string     `json:"profile_type"`
	Label                      string     `json:"label"`
	InstitutionName            *string    `json:"institution_name"`
	AccountIdentifierEncrypted []byte     `json:"account_identifier_encrypted"`
	AccountLast4               string     `json:"account_last4"`
	CurrencyCode               *string    `json:"currency_code"`
	IsPreferred                bool       `json:"is_preferred"`
	ArchivedAt                 *time.Time `json:"archived_at"`
}

func (q *Queries) UpdateBankProfile(ctx context.Context, arg UpdateBankProfileParams) (BankProfile, error) {
	row := q.db.QueryRow(ctx, updateBankProfile,
		arg.ID, arg.ProfileType, arg.Label, arg.InstitutionName, arg.AccountIdentifierEncrypted, arg.AccountLast4, arg.CurrencyCode, arg.IsPreferred, arg.ArchivedAt,
	)
	return scanBankProfile(row.Scan)
}

const clearPreferredBankProfiles = `-- name: ClearPreferredBankProfiles :exec
UPDATE bank_profiles
SET is_preferred = false, updated_at = now()
WHERE user_id = $1 AND archived_at IS NULL AND is_preferred
`

func (q *Queries) ClearPreferredBankProfiles(ctx context.Context, userID uuid.UUID) error {
	_, err := q.db.Exec(ctx, clearPreferredBankProfiles, userID)
	return err
}

const insertBankProfileShare = `-- name: InsertBankProfileShare :one
INSERT INTO bank_profile_shares (
  bank_profile_id, owner_id, recipient_id, loan_id
) VALUES ($1, $2, $3, $4)
RETURNING id, bank_profile_id, owner_id, recipient_id, loan_id, created_at, revoked_at
`

type InsertBankProfileShareParams struct {
	BankProfileID uuid.UUID  `json:"bank_profile_id"`
	OwnerID       uuid.UUID  `json:"owner_id"`
	RecipientID   uuid.UUID  `json:"recipient_id"`
	LoanID        *uuid.UUID `json:"loan_id"`
}

func (q *Queries) InsertBankProfileShare(ctx context.Context, arg InsertBankProfileShareParams) (BankProfileShare, error) {
	row := q.db.QueryRow(ctx, insertBankProfileShare, arg.BankProfileID, arg.OwnerID, arg.RecipientID, arg.LoanID)
	return scanBankProfileShare(row.Scan)
}

const getBankProfileShareByID = `-- name: GetBankProfileShareByID :one
SELECT id, bank_profile_id, owner_id, recipient_id, loan_id, created_at, revoked_at FROM bank_profile_shares
WHERE id = $1
`

func (q *Queries) GetBankProfileShareByID(ctx context.Context, id uuid.UUID) (BankProfileShare, error) {
	row := q.db.QueryRow(ctx, getBankProfileShareByID, id)
	return scanBankProfileShare(row.Scan)
}

const getActiveBankProfileShare = `-- name: GetActiveBankProfileShare :one
SELECT id, bank_profile_id, owner_id, recipient_id, loan_id, created_at, revoked_at FROM bank_profile_shares
WHERE bank_profile_id = $1
  AND recipient_id = $2
  AND revoked_at IS NULL
  AND (
    ($3::uuid IS NULL AND loan_id IS NULL)
    OR loan_id = $3
  )
LIMIT 1
`

type GetActiveBankProfileShareParams struct {
	BankProfileID uuid.UUID  `json:"bank_profile_id"`
	RecipientID   uuid.UUID  `json:"recipient_id"`
	LoanID        *uuid.UUID `json:"loan_id"`
}

func (q *Queries) GetActiveBankProfileShare(ctx context.Context, arg GetActiveBankProfileShareParams) (BankProfileShare, error) {
	row := q.db.QueryRow(ctx, getActiveBankProfileShare, arg.BankProfileID, arg.RecipientID, arg.LoanID)
	return scanBankProfileShare(row.Scan)
}

const listBankProfileSharesForOwner = `-- name: ListBankProfileSharesForOwner :many
SELECT id, bank_profile_id, owner_id, recipient_id, loan_id, created_at, revoked_at FROM bank_profile_shares
WHERE owner_id = $1
ORDER BY created_at DESC
`

func (q *Queries) ListBankProfileSharesForOwner(ctx context.Context, ownerID uuid.UUID) ([]BankProfileShare, error) {
	rows, err := q.db.Query(ctx, listBankProfileSharesForOwner, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []BankProfileShare{}
	for rows.Next() {
		item, err := scanBankProfileShare(rows.Scan)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

const listBankProfileSharesForRecipient = `-- name: ListBankProfileSharesForRecipient :many
SELECT id, bank_profile_id, owner_id, recipient_id, loan_id, created_at, revoked_at FROM bank_profile_shares
WHERE recipient_id = $1 AND revoked_at IS NULL
ORDER BY created_at DESC
`

func (q *Queries) ListBankProfileSharesForRecipient(ctx context.Context, recipientID uuid.UUID) ([]BankProfileShare, error) {
	rows, err := q.db.Query(ctx, listBankProfileSharesForRecipient, recipientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []BankProfileShare{}
	for rows.Next() {
		item, err := scanBankProfileShare(rows.Scan)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

const activeBankProfileShareForLoan = `-- name: ActiveBankProfileShareForLoan :one
SELECT s.id, s.bank_profile_id, s.owner_id, s.recipient_id, s.loan_id, s.created_at, s.revoked_at FROM bank_profile_shares s
JOIN bank_profiles p ON p.id = s.bank_profile_id
WHERE s.loan_id = $1
  AND s.recipient_id = $2
  AND s.revoked_at IS NULL
  AND p.archived_at IS NULL
ORDER BY p.is_preferred DESC, s.created_at DESC
LIMIT 1
`

type ActiveBankProfileShareForLoanParams struct {
	LoanID      uuid.UUID `json:"loan_id"`
	RecipientID uuid.UUID `json:"recipient_id"`
}

func (q *Queries) ActiveBankProfileShareForLoan(ctx context.Context, arg ActiveBankProfileShareForLoanParams) (BankProfileShare, error) {
	row := q.db.QueryRow(ctx, activeBankProfileShareForLoan, arg.LoanID, arg.RecipientID)
	return scanBankProfileShare(row.Scan)
}

const revokeBankProfileShare = `-- name: RevokeBankProfileShare :one
UPDATE bank_profile_shares
SET revoked_at = now()
WHERE id = $1 AND revoked_at IS NULL
RETURNING id, bank_profile_id, owner_id, recipient_id, loan_id, created_at, revoked_at
`

func (q *Queries) RevokeBankProfileShare(ctx context.Context, id uuid.UUID) (BankProfileShare, error) {
	row := q.db.QueryRow(ctx, revokeBankProfileShare, id)
	return scanBankProfileShare(row.Scan)
}

const insertBankProfileEvent = `-- name: InsertBankProfileEvent :one
INSERT INTO bank_profile_events (
  bank_profile_id, share_id, actor_id, event_type, payload
) VALUES ($1, $2, $3, $4, $5)
RETURNING id, bank_profile_id, share_id, actor_id, event_type, payload, created_at
`

type InsertBankProfileEventParams struct {
	BankProfileID uuid.UUID  `json:"bank_profile_id"`
	ShareID       *uuid.UUID `json:"share_id"`
	ActorID       *uuid.UUID `json:"actor_id"`
	EventType     string     `json:"event_type"`
	Payload       []byte     `json:"payload"`
}

func (q *Queries) InsertBankProfileEvent(ctx context.Context, arg InsertBankProfileEventParams) (BankProfileEvent, error) {
	row := q.db.QueryRow(ctx, insertBankProfileEvent, arg.BankProfileID, arg.ShareID, arg.ActorID, arg.EventType, arg.Payload)
	return scanBankProfileEvent(row.Scan)
}

const listBankProfileEvents = `-- name: ListBankProfileEvents :many
SELECT id, bank_profile_id, share_id, actor_id, event_type, payload, created_at FROM bank_profile_events
WHERE bank_profile_id = $1
ORDER BY created_at
`

func (q *Queries) ListBankProfileEvents(ctx context.Context, bankProfileID uuid.UUID) ([]BankProfileEvent, error) {
	rows, err := q.db.Query(ctx, listBankProfileEvents, bankProfileID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []BankProfileEvent{}
	for rows.Next() {
		item, err := scanBankProfileEvent(rows.Scan)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
