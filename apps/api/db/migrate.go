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
			return fmt.Errorf("apply baseline schema: %w", err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ('00001'), ('00002'), ('00003'), ('00004'), ('00005'), ('00006'), ('00007'), ('00008'), ('00009'), ('00010'), ('00011')`); err != nil {
			return fmt.Errorf("record baseline: %w", err)
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
		return applyLaterMigrations(ctx, pool)
	}

	if err := applyMigration(ctx, pool, "00002", "migrations/00002_friendships.sql"); err != nil {
		return err
	}
	if err := applyMigration(ctx, pool, "00003", "migrations/00003_loans.sql"); err != nil {
		return err
	}
	if err := applyMigration(ctx, pool, "00004", "migrations/00004_bank_profiles.sql"); err != nil {
		return err
	}
	if err := applyMigration(ctx, pool, "00005", "migrations/00005_repayments.sql"); err != nil {
		return err
	}
	if err := applyMigration(ctx, pool, "00006", "migrations/00006_notifications.sql"); err != nil {
		return err
	}
	if err := applyMigration(ctx, pool, "00007", "migrations/00007_chat.sql"); err != nil {
		return err
	}
	if err := applyMigration(ctx, pool, "00008", "migrations/00008_media_oauth.sql"); err != nil {
		return err
	}
	if err := applyMigration(ctx, pool, "00009", "migrations/00009_loan_chat.sql"); err != nil {
		return err
	}
	if err := applyMigration(ctx, pool, "00010", "migrations/00010_account_profile.sql"); err != nil {
		return err
	}
	if err := applyMigration(ctx, pool, "00011", "migrations/00011_notes_chat.sql"); err != nil {
		return err
	}
	return applyLaterMigrations(ctx, pool)
}

func applyLaterMigrations(ctx context.Context, pool *pgxpool.Pool) error {
	if err := applyMigration(ctx, pool, "00012", "migrations/00012_phone_invites.sql"); err != nil {
		return err
	}
	if err := applyMigration(ctx, pool, "00013", "migrations/00013_long_term_loans.sql"); err != nil {
		return err
	}
	if err := applyMigration(ctx, pool, "00014", "migrations/00014_institution_co_lenders.sql"); err != nil {
		return err
	}
	return applyMigration(ctx, pool, "00015", "migrations/00015_alone_loans_and_currencies.sql")
}

func applyMigration(ctx context.Context, pool *pgxpool.Pool, version, path string) error {
	ok, err := applied(ctx, pool, version)
	if err != nil {
		return err
	}
	if ok {
		return nil
	}
	sqlb, err := files.ReadFile(path)
	if err != nil {
		return fmt.Errorf("embed %s: %w", version, err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, string(sqlb)); err != nil {
		return fmt.Errorf("apply %s: %w", version, err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, version); err != nil {
		return fmt.Errorf("record %s: %w", version, err)
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
