package store

import (
	"context"
	"strings"
	"time"

	"equilend/api/internal/banklink"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type bankLinkAdapter struct{ Inner *SQLStore }

func BankLinkAdapter(s *SQLStore) banklink.Store { return bankLinkAdapter{Inner: s} }

func (a bankLinkAdapter) InsertConnection(ctx context.Context, c banklink.Connection) (banklink.Connection, error) {
	return a.Inner.InsertBankLink(ctx, c)
}
func (a bankLinkAdapter) ListConnections(ctx context.Context, userID uuid.UUID) ([]banklink.Connection, error) {
	return a.Inner.ListBankLinks(ctx, userID)
}
func (a bankLinkAdapter) GetConnection(ctx context.Context, userID, id uuid.UUID) (banklink.Connection, error) {
	return a.Inner.GetBankLink(ctx, userID, id)
}
func (a bankLinkAdapter) UpdateConnectionStatus(ctx context.Context, userID, id uuid.UUID, status string) error {
	_, err := a.Inner.pool.Exec(ctx, `
		UPDATE bank_link_connections SET status=$3, updated_at=now()
		WHERE id=$1 AND user_id=$2
	`, id, userID, status)
	return err
}
func (a bankLinkAdapter) SetConnectionAccess(ctx context.Context, id uuid.UUID, accessToken, itemID, institution string) error {
	return a.Inner.SetBankLinkAccess(ctx, id, accessToken, itemID, institution)
}
func (a bankLinkAdapter) DeleteConnection(ctx context.Context, userID, id uuid.UUID) error {
	_, err := a.Inner.pool.Exec(ctx, `DELETE FROM bank_link_connections WHERE id=$1 AND user_id=$2`, id, userID)
	return err
}
func (a bankLinkAdapter) GetAccessToken(ctx context.Context, userID, id uuid.UUID) (string, error) {
	return a.Inner.GetBankLinkAccessToken(ctx, userID, id)
}
func (a bankLinkAdapter) GetSyncCursor(ctx context.Context, userID, id uuid.UUID) (string, error) {
	return a.Inner.GetBankLinkSyncCursor(ctx, userID, id)
}
func (a bankLinkAdapter) SetSyncState(ctx context.Context, userID, id uuid.UUID, cursor string, accountID *uuid.UUID, syncedAt time.Time) error {
	return a.Inner.SetBankLinkSyncState(ctx, userID, id, cursor, accountID, syncedAt)
}

func (s *SQLStore) InsertBankLink(ctx context.Context, c banklink.Connection) (banklink.Connection, error) {
	provider := strings.TrimSpace(c.Provider)
	if provider == "" {
		provider = "plaid"
	}
	status := strings.TrimSpace(c.Status)
	if status == "" {
		status = "active"
	}
	err := s.pool.QueryRow(ctx, `
		INSERT INTO bank_link_connections (user_id, provider, institution_label, status)
		VALUES ($1, $2, $3, $4)
		RETURNING id, user_id, provider, COALESCE(item_id,''), COALESCE(institution_label,''), status, account_id, last_synced_at, created_at
	`, c.UserID, provider, c.Institution, status).Scan(
		&c.ID, &c.UserID, &c.Provider, &c.ItemID, &c.Institution, &c.Status, &c.AccountID, &c.LastSyncedAt, &c.CreatedAt,
	)
	return c, err
}

func (s *SQLStore) ListBankLinks(ctx context.Context, userID uuid.UUID) ([]banklink.Connection, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, user_id, provider, COALESCE(item_id,''), COALESCE(institution_label,''), status, account_id, last_synced_at, created_at
		FROM bank_link_connections WHERE user_id=$1 ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []banklink.Connection
	for rows.Next() {
		var c banklink.Connection
		if err := rows.Scan(&c.ID, &c.UserID, &c.Provider, &c.ItemID, &c.Institution, &c.Status, &c.AccountID, &c.LastSyncedAt, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *SQLStore) GetBankLink(ctx context.Context, userID, id uuid.UUID) (banklink.Connection, error) {
	var c banklink.Connection
	err := s.pool.QueryRow(ctx, `
		SELECT id, user_id, provider, COALESCE(item_id,''), COALESCE(institution_label,''), status, account_id, last_synced_at, created_at
		FROM bank_link_connections WHERE id=$1 AND user_id=$2
	`, id, userID).Scan(&c.ID, &c.UserID, &c.Provider, &c.ItemID, &c.Institution, &c.Status, &c.AccountID, &c.LastSyncedAt, &c.CreatedAt)
	if err == pgx.ErrNoRows {
		return c, err
	}
	return c, err
}

func (s *SQLStore) SetBankLinkAccess(ctx context.Context, id uuid.UUID, accessToken, itemID, institution string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE bank_link_connections
		SET access_token_enc=$2, item_id=$3, institution_label=COALESCE(NULLIF($4,''), institution_label),
		    status='active', updated_at=now()
		WHERE id=$1
	`, id, accessToken, itemID, institution)
	return err
}

func (s *SQLStore) GetBankLinkAccessToken(ctx context.Context, userID, id uuid.UUID) (string, error) {
	var token *string
	err := s.pool.QueryRow(ctx, `
		SELECT access_token_enc FROM bank_link_connections WHERE id=$1 AND user_id=$2
	`, id, userID).Scan(&token)
	if err != nil {
		return "", err
	}
	if token == nil {
		return "", nil
	}
	return *token, nil
}

func (s *SQLStore) GetBankLinkSyncCursor(ctx context.Context, userID, id uuid.UUID) (string, error) {
	var cursor *string
	err := s.pool.QueryRow(ctx, `
		SELECT sync_cursor FROM bank_link_connections WHERE id=$1 AND user_id=$2
	`, id, userID).Scan(&cursor)
	if err != nil {
		return "", err
	}
	if cursor == nil {
		return "", nil
	}
	return *cursor, nil
}

func (s *SQLStore) SetBankLinkSyncState(ctx context.Context, userID, id uuid.UUID, cursor string, accountID *uuid.UUID, syncedAt time.Time) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE bank_link_connections
		SET sync_cursor=$3,
		    account_id=COALESCE($4, account_id),
		    last_synced_at=$5,
		    updated_at=now()
		WHERE id=$1 AND user_id=$2
	`, id, userID, cursor, accountID, syncedAt)
	return err
}

func (s *SQLStore) CashflowNoteExists(ctx context.Context, userID, accountID uuid.UUID, note string) (bool, error) {
	var n int
	err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM cashflow_entries
		WHERE user_id=$1 AND account_id=$2 AND note=$3 AND COALESCE(is_template,false)=false
	`, userID, accountID, note).Scan(&n)
	return n > 0, err
}
