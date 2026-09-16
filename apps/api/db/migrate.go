package db

import (
	"context"
	"embed"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql migrations/*.sql
var files embed.FS

func Migrate(ctx context.Context, databaseURL string) error {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return fmt.Errorf("open db: %w", err)
	}
	defer pool.Close()

	if _, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version text PRIMARY KEY,
			applied_at timestamptz NOT NULL DEFAULT now()
		)
	`); err != nil {
		return fmt.Errorf("schema_migrations: %w", err)
	}

	has00001, err := applied(ctx, pool, "00001")
	if err != nil {
		return err
	}
	if !has00001 {
		schemaSQL, err := files.ReadFile("schema.sql")
		if err != nil {
			return fmt.Errorf("embed schema: %w", err)
		}
		tx, err := pool.Begin(ctx)
		if err != nil {
			return err
		}
		defer tx.Rollback(ctx)
		if _, err := tx.Exec(ctx, string(schemaSQL)); err != nil {
			return fmt.Errorf("apply 00001: %w", err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ('00001'), ('00002')`); err != nil {
			return fmt.Errorf("record baseline: %w", err)
		}
		return tx.Commit(ctx)
	}

	has00002, err := applied(ctx, pool, "00002")
	if err != nil {
		return err
	}
	if has00002 {
		return nil
	}

	sql00002, err := files.ReadFile("migrations/00002_friendships.sql")
	if err != nil {
		return fmt.Errorf("embed 00002: %w", err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, string(sql00002)); err != nil {
		return fmt.Errorf("apply 00002: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ('00002')`); err != nil {
		return fmt.Errorf("record 00002: %w", err)
	}
	return tx.Commit(ctx)
}

func applied(ctx context.Context, pool *pgxpool.Pool, version string) (bool, error) {
	var n int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM schema_migrations WHERE version = $1`, version).Scan(&n); err != nil {
		return false, fmt.Errorf("check migration %s: %w", version, err)
	}
	return n > 0, nil
}
