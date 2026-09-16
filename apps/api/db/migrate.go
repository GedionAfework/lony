package db

import (
	"context"
	"embed"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schemaFile embed.FS

func Migrate(ctx context.Context, databaseURL string) error {
	schemaSQL, err := schemaFile.ReadFile("schema.sql")
	if err != nil {
		return fmt.Errorf("embed schema: %w", err)
	}

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

	var applied int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM schema_migrations WHERE version = '00001'`).Scan(&applied); err != nil {
		return fmt.Errorf("check migration: %w", err)
	}
	if applied > 0 {
		return nil
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, string(schemaSQL)); err != nil {
		return fmt.Errorf("apply 00001: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ('00001')`); err != nil {
		return fmt.Errorf("record 00001: %w", err)
	}
	return tx.Commit(ctx)
}
