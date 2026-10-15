-- name: InsertBankProfile :one
INSERT INTO bank_profiles (
  user_id, profile_type, label, institution_name, account_identifier_encrypted,
  account_last4, currency_code, is_preferred
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: GetBankProfileByID :one
SELECT * FROM bank_profiles
WHERE id = $1;

-- name: ListBankProfilesForUser :many
SELECT * FROM bank_profiles
WHERE user_id = $1
  AND ($2::boolean OR archived_at IS NULL)
ORDER BY is_preferred DESC, created_at DESC;

-- name: UpdateBankProfile :one
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
RETURNING *;

-- name: ClearPreferredBankProfiles :exec
UPDATE bank_profiles
SET is_preferred = false, updated_at = now()
WHERE user_id = $1 AND archived_at IS NULL AND is_preferred;

-- name: InsertBankProfileShare :one
INSERT INTO bank_profile_shares (
  bank_profile_id, owner_id, recipient_id, loan_id
) VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetBankProfileShareByID :one
SELECT * FROM bank_profile_shares
WHERE id = $1;

-- name: GetActiveBankProfileShare :one
SELECT * FROM bank_profile_shares
WHERE bank_profile_id = $1
  AND recipient_id = $2
  AND revoked_at IS NULL
  AND (
    ($3::uuid IS NULL AND loan_id IS NULL)
    OR loan_id = $3
  )
LIMIT 1;

-- name: ListBankProfileSharesForOwner :many
SELECT * FROM bank_profile_shares
WHERE owner_id = $1
ORDER BY created_at DESC;

-- name: ListBankProfileSharesForRecipient :many
SELECT * FROM bank_profile_shares
WHERE recipient_id = $1 AND revoked_at IS NULL
ORDER BY created_at DESC;

-- name: ActiveBankProfileShareForLoan :one
SELECT s.* FROM bank_profile_shares s
JOIN bank_profiles p ON p.id = s.bank_profile_id
WHERE s.loan_id = $1
  AND s.recipient_id = $2
  AND s.revoked_at IS NULL
  AND p.archived_at IS NULL
ORDER BY p.is_preferred DESC, s.created_at DESC
LIMIT 1;

-- name: RevokeBankProfileShare :one
UPDATE bank_profile_shares
SET revoked_at = now()
WHERE id = $1 AND revoked_at IS NULL
RETURNING *;

-- name: InsertBankProfileEvent :one
INSERT INTO bank_profile_events (
  bank_profile_id, share_id, actor_id, event_type, payload
) VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: ListBankProfileEvents :many
SELECT * FROM bank_profile_events
WHERE bank_profile_id = $1
ORDER BY created_at;
