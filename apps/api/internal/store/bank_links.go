package store

import (
	"context"
	"strings"

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
