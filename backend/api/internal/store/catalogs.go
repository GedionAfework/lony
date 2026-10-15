package store

import (
	"context"
	"strings"

	"equilend/api/internal/admin"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s *SQLStore) ListCatalogTypes(ctx context.Context, kind string, activeOnly bool) ([]admin.CatalogType, error) {
	q := `
		SELECT id, kind, code, label, sort_order, active, created_at, updated_at
		FROM catalog_types
		WHERE ($1 = '' OR kind = $1)
		  AND ($2 = false OR active = true)
		ORDER BY sort_order ASC, label ASC`
	rows, err := s.pool.Query(ctx, q, kind, activeOnly)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []admin.CatalogType
	for rows.Next() {
		var t admin.CatalogType
		if err := rows.Scan(&t.ID, &t.Kind, &t.Code, &t.Label, &t.SortOrder, &t.Active, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *SQLStore) CreateCatalogType(ctx context.Context, kind, code, label string, sortOrder int) (admin.CatalogType, error) {
	var t admin.CatalogType
	err := s.pool.QueryRow(ctx, `
		INSERT INTO catalog_types (kind, code, label, sort_order)
		VALUES ($1, $2, $3, $4)
		RETURNING id, kind, code, label, sort_order, active, created_at, updated_at
	`, kind, code, label, sortOrder).Scan(
		&t.ID, &t.Kind, &t.Code, &t.Label, &t.SortOrder, &t.Active, &t.CreatedAt, &t.UpdatedAt,
	)
	return t, err
}

func (s *SQLStore) UpdateCatalogType(ctx context.Context, id uuid.UUID, label *string, sortOrder *int, active *bool) (admin.CatalogType, error) {
	var t admin.CatalogType
	err := s.pool.QueryRow(ctx, `
		UPDATE catalog_types SET
			label = COALESCE($2, label),
			sort_order = COALESCE($3, sort_order),
			active = COALESCE($4, active),
			updated_at = now()
		WHERE id = $1
		RETURNING id, kind, code, label, sort_order, active, created_at, updated_at
	`, id, label, sortOrder, active).Scan(
		&t.ID, &t.Kind, &t.Code, &t.Label, &t.SortOrder, &t.Active, &t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		return admin.CatalogType{}, err
	}
	return t, nil
}

func (s *SQLStore) ListCatalogInstitutions(ctx context.Context, typeKind, typeCode string, activeOnly bool) ([]admin.CatalogInstitution, error) {
	q := `
		SELECT id, code, label, type_kind, type_code, country_code, sort_order, active, created_at, updated_at
		FROM catalog_institutions
		WHERE ($1 = '' OR type_kind = $1)
		  AND ($2 = '' OR type_code = $2)
		  AND ($3 = false OR active = true)
		ORDER BY sort_order ASC, label ASC`
	rows, err := s.pool.Query(ctx, q, typeKind, typeCode, activeOnly)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []admin.CatalogInstitution
	for rows.Next() {
		var it admin.CatalogInstitution
		if err := rows.Scan(
			&it.ID, &it.Code, &it.Label, &it.TypeKind, &it.TypeCode, &it.CountryCode,
			&it.SortOrder, &it.Active, &it.CreatedAt, &it.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

func (s *SQLStore) CreateCatalogInstitution(ctx context.Context, code, label, typeKind, typeCode string, country *string, sortOrder int) (admin.CatalogInstitution, error) {
	var it admin.CatalogInstitution
	err := s.pool.QueryRow(ctx, `
		INSERT INTO catalog_institutions (code, label, type_kind, type_code, country_code, sort_order)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, code, label, type_kind, type_code, country_code, sort_order, active, created_at, updated_at
	`, code, label, typeKind, typeCode, country, sortOrder).Scan(
		&it.ID, &it.Code, &it.Label, &it.TypeKind, &it.TypeCode, &it.CountryCode,
		&it.SortOrder, &it.Active, &it.CreatedAt, &it.UpdatedAt,
	)
	return it, err
}

func (s *SQLStore) UpdateCatalogInstitution(
	ctx context.Context,
	id uuid.UUID,
	label *string,
	typeKind, typeCode *string,
	country *string,
	sortOrder *int,
	active *bool,
) (admin.CatalogInstitution, error) {
	// country: nil = leave unchanged; pointer to "" = clear; otherwise set value
	clearCountry := country != nil && strings.TrimSpace(*country) == ""
	var countryArg any
	if country == nil {
		countryArg = nil
	} else if clearCountry {
		countryArg = ""
	} else {
		countryArg = *country
	}

	var it admin.CatalogInstitution
	err := s.pool.QueryRow(ctx, `
		UPDATE catalog_institutions SET
			label = COALESCE($2, label),
			type_kind = COALESCE($3, type_kind),
			type_code = COALESCE($4, type_code),
			country_code = CASE
				WHEN $5::boolean THEN NULL
				WHEN $6::text IS NULL THEN country_code
				ELSE $6::text
			END,
			sort_order = COALESCE($7, sort_order),
			active = COALESCE($8, active),
			updated_at = now()
		WHERE id = $1
		RETURNING id, code, label, type_kind, type_code, country_code, sort_order, active, created_at, updated_at
	`, id, label, typeKind, typeCode, clearCountry, countryArg, sortOrder, active).Scan(
		&it.ID, &it.Code, &it.Label, &it.TypeKind, &it.TypeCode, &it.CountryCode,
		&it.SortOrder, &it.Active, &it.CreatedAt, &it.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return admin.CatalogInstitution{}, err
		}
		return admin.CatalogInstitution{}, err
	}
	return it, nil
}
