package store

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"equilend/api/internal/loans"
	"equilend/api/internal/store/sqlc"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
)

func (s *SQLStore) GetParty(ctx context.Context, id uuid.UUID) (loans.Party, error) {
	row, err := s.q.GetUserByID(ctx, id)
	if err != nil {
		return loans.Party{}, err
	}
	return loans.Party{ID: row.ID, DisplayName: row.DisplayName, Username: row.Username}, nil
}

func (s *SQLStore) InsertLoan(ctx context.Context, rec loans.Record, terms *loans.Terms, events []loans.Event) (loans.Record, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return loans.Record{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	row, err := q.InsertLoan(ctx, sqlc.InsertLoanParams{
		ReferenceCode: rec.ReferenceCode,
		BorrowerID:    rec.BorrowerID,
		LenderID:      rec.LenderID,
		InitiatorID:   rec.InitiatorID,
		Status:        rec.Status,
	})
	if err != nil {
		return loans.Record{}, err
	}
	mapped := mapLoan(row)
	copySchedule(&mapped, rec)
	if terms != nil {
		termRow, err := q.InsertLoanTerms(ctx, insertTermsParams(row.ID, *terms))
		if err != nil {
			return loans.Record{}, err
		}
		mapped.CurrentTermsID = &termRow.ID
		mapped.Principal = rec.Principal
		mapped.CurrencyCode = rec.CurrencyCode
		mapped.InterestRatePercent = rec.InterestRatePercent
		mapped.InterestAmount = rec.InterestAmount
		mapped.ExpectedTotal = rec.ExpectedTotal
		mapped.OutstandingAmount = rec.OutstandingAmount
		mapped.DueAt = rec.DueAt
		mapped.Note = rec.Note
		mapped.TermsVersion = rec.TermsVersion
		mapped.ProposedByUserID = rec.ProposedByUserID
		mapped.AcceptedTermsID = rec.AcceptedTermsID
		mapped.AcceptedAt = rec.AcceptedAt
		mapped.Status = rec.Status
		copySchedule(&mapped, rec)
		if mapped.Status == loans.StatusActive && mapped.CurrentTermsID != nil {
			mapped.AcceptedTermsID = mapped.CurrentTermsID
			if _, err := q.AcceptLoanTerms(ctx, *mapped.CurrentTermsID); err != nil {
				return loans.Record{}, err
			}
		}
		updated, err := q.UpdateLoan(ctx, updateLoanParams(mapped))
		if err != nil {
			return loans.Record{}, err
		}
		mapped = mapLoan(updated)
		copySchedule(&mapped, rec)
		if mapped.Status == loans.StatusActive && mapped.CurrentTermsID != nil {
			mapped.AcceptedTermsID = mapped.CurrentTermsID
		}
		if err := patchScheduleMetaTx(ctx, tx, mapped); err != nil {
			return loans.Record{}, err
		}
		if err := patchTermsScheduleTx(ctx, tx, termRow.ID, *terms); err != nil {
			return loans.Record{}, err
		}
	} else if rec.Note != nil {
		mapped.Note = rec.Note
		updated, err := q.UpdateLoan(ctx, updateLoanParams(mapped))
		if err != nil {
			return loans.Record{}, err
		}
		mapped = mapLoan(updated)
		copySchedule(&mapped, rec)
		if err := patchScheduleMetaTx(ctx, tx, mapped); err != nil {
			return loans.Record{}, err
		}
	} else if hasSchedule(rec) {
		if err := patchScheduleMetaTx(ctx, tx, mapped); err != nil {
			return loans.Record{}, err
		}
	}
	if err := insertEvents(ctx, q, row.ID, events); err != nil {
		return loans.Record{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return loans.Record{}, err
	}
	_ = loadScheduleMeta(ctx, s, &mapped)
	return mapped, nil
}

func (s *SQLStore) GetLoan(ctx context.Context, id uuid.UUID) (loans.Record, error) {
	row, err := s.q.GetLoanByID(ctx, id)
	if err != nil {
		return loans.Record{}, err
	}
	mapped := mapLoan(row)
	_ = loadScheduleMeta(ctx, s, &mapped)
	return mapped, nil
}

func (s *SQLStore) ListLoans(ctx context.Context, userID uuid.UUID, status, role string) ([]loans.Record, error) {
	rows, err := s.q.ListLoansForUser(ctx, sqlc.ListLoansForUserParams{
		UserID: userID,
		Status: emptyNil(status),
		Role:   emptyNil(role),
	})
	if err != nil {
		return nil, err
	}
	out := make([]loans.Record, 0, len(rows))
	for _, row := range rows {
		mapped := mapLoan(row)
		_ = loadScheduleMeta(ctx, s, &mapped)
		out = append(out, mapped)
	}
	return out, nil
}

func (s *SQLStore) ListTerms(ctx context.Context, loanID uuid.UUID) ([]loans.Terms, error) {
	rows, err := s.q.ListLoanTerms(ctx, loanID)
	if err != nil {
		return nil, err
	}
	out := make([]loans.Terms, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapTerms(row))
	}
	return out, nil
}

func (s *SQLStore) ListEvents(ctx context.Context, loanID uuid.UUID) ([]loans.Event, error) {
	rows, err := s.q.ListLoanEvents(ctx, loanID)
	if err != nil {
		return nil, err
	}
	out := make([]loans.Event, 0, len(rows))
	for _, row := range rows {
		payload := json.RawMessage(row.Payload)
		if len(payload) == 0 {
			payload = json.RawMessage(`{}`)
		}
		out = append(out, loans.Event{
			ID:        row.ID,
			LoanID:    row.LoanID,
			ActorID:   row.ActorID,
			Type:      row.EventType,
			Payload:   payload,
			CreatedAt: row.CreatedAt,
		})
	}
	return out, nil
}

func (s *SQLStore) ProposeTerms(ctx context.Context, rec loans.Record, terms loans.Terms, event loans.Event) (loans.Record, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return loans.Record{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if err := q.SupersedeProposedLoanTerms(ctx, rec.ID); err != nil {
		return loans.Record{}, err
	}
	termRow, err := q.InsertLoanTerms(ctx, insertTermsParams(rec.ID, terms))
	if err != nil {
		return loans.Record{}, err
	}
	rec.CurrentTermsID = &termRow.ID
	rec.LoanKind = terms.LoanKind
	rec.InterestPeriodMonths = terms.InterestPeriodMonths
	rec.InstallmentCount = terms.InstallmentCount
	rec.InstallmentAmount = terms.InstallmentAmount
	rec.InstitutionLabel = terms.InstitutionLabel
	rec.StartAt = terms.StartAt
	updated, err := q.UpdateLoan(ctx, updateLoanParams(rec))
	if err != nil {
		return loans.Record{}, err
	}
	mapped := mapLoan(updated)
	copySchedule(&mapped, rec)
	if err := patchScheduleMetaTx(ctx, tx, mapped); err != nil {
		return loans.Record{}, err
	}
	if err := patchTermsScheduleTx(ctx, tx, termRow.ID, terms); err != nil {
		return loans.Record{}, err
	}
	if err := insertEvents(ctx, q, rec.ID, []loans.Event{event}); err != nil {
		return loans.Record{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return loans.Record{}, err
	}
	return mapped, nil
}

func (s *SQLStore) ApplyTransition(ctx context.Context, rec loans.Record, acceptedTermsID *uuid.UUID, event loans.Event) (loans.Record, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return loans.Record{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if acceptedTermsID != nil {
		if _, err := q.AcceptLoanTerms(ctx, *acceptedTermsID); err != nil {
			return loans.Record{}, err
		}
	}
	updated, err := q.UpdateLoan(ctx, updateLoanParams(rec))
	if err != nil {
		return loans.Record{}, err
	}
	mapped := mapLoan(updated)
	copySchedule(&mapped, rec)
	if err := patchScheduleMetaTx(ctx, tx, mapped); err != nil {
		return loans.Record{}, err
	}
	if err := insertEvents(ctx, q, rec.ID, []loans.Event{event}); err != nil {
		return loans.Record{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return loans.Record{}, err
	}
	return mapped, nil
}

func (s *SQLStore) SaveScheduleMeta(ctx context.Context, rec loans.Record) (loans.Record, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return loans.Record{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	updated, err := q.UpdateLoan(ctx, updateLoanParams(rec))
	if err != nil {
		return loans.Record{}, err
	}
	mapped := mapLoan(updated)
	copySchedule(&mapped, rec)
	if err := patchScheduleMetaTx(ctx, tx, mapped); err != nil {
		return loans.Record{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return loans.Record{}, err
	}
	return mapped, nil
}

func (s *SQLStore) ListInstallments(ctx context.Context, loanID uuid.UUID) ([]loans.Installment, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, loan_id, sequence_no, due_at, amount::text, principal_portion::text, interest_portion::text, status, paid_at, created_at
		FROM loan_installments
		WHERE loan_id = $1
		ORDER BY sequence_no ASC
	`, loanID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []loans.Installment
	for rows.Next() {
		var row loans.Installment
		var amount, principal, interest string
		if err := rows.Scan(
			&row.ID, &row.LoanID, &row.Sequence, &row.DueAt,
			&amount, &principal, &interest, &row.Status, &row.PaidAt, &row.CreatedAt,
		); err != nil {
			return nil, err
		}
		row.Amount = mustDec(amount)
		row.PrincipalPortion = mustDec(principal)
		row.InterestPortion = mustDec(interest)
		out = append(out, row)
	}
	return out, rows.Err()
}

func (s *SQLStore) ReplaceInstallments(ctx context.Context, loanID uuid.UUID, rows []loans.Installment) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM loan_installments WHERE loan_id = $1`, loanID); err != nil {
		return err
	}
	for _, row := range rows {
		if _, err := tx.Exec(ctx, `
			INSERT INTO loan_installments (
				loan_id, sequence_no, due_at, amount, principal_portion, interest_portion, status
			) VALUES ($1, $2, $3, $4, $5, $6, $7)
		`, loanID, row.Sequence, row.DueAt, row.Amount.StringFixed(loans.Scale), row.PrincipalPortion.StringFixed(loans.Scale), row.InterestPortion.StringFixed(loans.Scale), row.Status); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *SQLStore) MarkOverdue(ctx context.Context, now time.Time) (int, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	rows, err := q.MarkLoansOverdue(ctx, now)
	if err != nil {
		return 0, err
	}
	for _, row := range rows {
		if err := insertEvents(ctx, q, row.ID, []loans.Event{{Type: loans.EventOverdue, Payload: json.RawMessage(`{}`)}}); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return len(rows), nil
}

func insertEvents(ctx context.Context, q *sqlc.Queries, loanID uuid.UUID, events []loans.Event) error {
	for _, ev := range events {
		payload := []byte(ev.Payload)
		if len(payload) == 0 {
			payload = []byte(`{}`)
		}
		if _, err := q.InsertLoanEvent(ctx, sqlc.InsertLoanEventParams{
			LoanID:    loanID,
			ActorID:   ev.ActorID,
			EventType: ev.Type,
			Payload:   payload,
		}); err != nil {
			return err
		}
	}
	return nil
}

func insertTermsParams(loanID uuid.UUID, terms loans.Terms) sqlc.InsertLoanTermsParams {
	return sqlc.InsertLoanTermsParams{
		LoanID:              loanID,
		Version:             terms.Version,
		PrincipalAmount:     terms.Principal.StringFixed(loans.Scale),
		CurrencyCode:        terms.CurrencyCode,
		InterestRatePercent: terms.InterestRatePercent.StringFixed(loans.Scale),
		InterestAmount:      terms.InterestAmount.StringFixed(loans.Scale),
		ExpectedTotal:       terms.ExpectedTotal.StringFixed(loans.Scale),
		DueAt:               terms.DueAt,
		Note:                terms.Note,
		ProposedByUserID:    terms.ProposedByUserID,
		Status:              terms.Status,
	}
}

func updateLoanParams(rec loans.Record) sqlc.UpdateLoanParams {
	return sqlc.UpdateLoanParams{
		ID:                  rec.ID,
		Status:              rec.Status,
		PrincipalAmount:     decPtr(rec.Principal),
		CurrencyCode:        rec.CurrencyCode,
		InterestRatePercent: decPtr(rec.InterestRatePercent),
		InterestAmount:      decPtr(rec.InterestAmount),
		ExpectedTotal:       decPtr(rec.ExpectedTotal),
		OutstandingAmount:   decPtr(rec.OutstandingAmount),
		DueAt:               rec.DueAt,
		Note:                rec.Note,
		CurrentTermsID:      rec.CurrentTermsID,
		AcceptedTermsID:     rec.AcceptedTermsID,
		TermsVersion:        rec.TermsVersion,
		ProposedByUserID:    rec.ProposedByUserID,
		AcceptedAt:          rec.AcceptedAt,
	}
}

func mapLoan(row sqlc.Loan) loans.Record {
	return loans.Record{
		ID:                  row.ID,
		ReferenceCode:       row.ReferenceCode,
		BorrowerID:          row.BorrowerID,
		LenderID:            row.LenderID,
		InitiatorID:         row.InitiatorID,
		Status:              row.Status,
		Principal:           parseDec(row.PrincipalAmount),
		CurrencyCode:        trimPtr(row.CurrencyCode),
		InterestRatePercent: parseDec(row.InterestRatePercent),
		InterestAmount:      parseDec(row.InterestAmount),
		ExpectedTotal:       parseDec(row.ExpectedTotal),
		OutstandingAmount:   parseDec(row.OutstandingAmount),
		DueAt:               row.DueAt,
		Note:                row.Note,
		LoanKind:            loans.KindOneTime,
		CurrentTermsID:      row.CurrentTermsID,
		AcceptedTermsID:     row.AcceptedTermsID,
		TermsVersion:        row.TermsVersion,
		ProposedByUserID:    row.ProposedByUserID,
		AcceptedAt:          row.AcceptedAt,
		CreatedAt:           row.CreatedAt,
		UpdatedAt:           row.UpdatedAt,
	}
}

func mapTerms(row sqlc.LoanTerm) loans.Terms {
	principal, _ := decimal.NewFromString(row.PrincipalAmount)
	rate, _ := decimal.NewFromString(row.InterestRatePercent)
	interest, _ := decimal.NewFromString(row.InterestAmount)
	total, _ := decimal.NewFromString(row.ExpectedTotal)
	return loans.Terms{
		ID:                  row.ID,
		LoanID:              row.LoanID,
		Version:             row.Version,
		Principal:           principal,
		CurrencyCode:        strings.TrimSpace(row.CurrencyCode),
		InterestRatePercent: rate,
		InterestAmount:      interest,
		ExpectedTotal:       total,
		DueAt:               row.DueAt,
		Note:                row.Note,
		LoanKind:            loans.KindOneTime,
		ProposedByUserID:    row.ProposedByUserID,
		Status:              row.Status,
		CreatedAt:           row.CreatedAt,
	}
}

func copySchedule(dst *loans.Record, src loans.Record) {
	if src.LoanKind != "" {
		dst.LoanKind = src.LoanKind
	}
	dst.InterestPeriodMonths = src.InterestPeriodMonths
	dst.InstallmentCount = src.InstallmentCount
	dst.InstallmentAmount = src.InstallmentAmount
	dst.InstitutionLabel = src.InstitutionLabel
	dst.InstitutionType = src.InstitutionType
	if src.PartyMode != "" {
		dst.PartyMode = src.PartyMode
	}
	dst.StartAt = src.StartAt
	dst.CoLenderIDs = src.CoLenderIDs
}

func hasSchedule(rec loans.Record) bool {
	return rec.LoanKind != "" && rec.LoanKind != loans.KindOneTime ||
		rec.InterestPeriodMonths != nil ||
		rec.InstallmentCount != nil ||
		rec.InstitutionLabel != nil ||
		rec.StartAt != nil
}

func patchScheduleMetaTx(ctx context.Context, tx pgx.Tx, rec loans.Record) error {
	kind := rec.LoanKind
	if kind == "" {
		kind = loans.KindOneTime
	}
	mode := rec.PartyMode
	if mode == "" {
		mode = loans.PartyPeer
	}
	_, err := tx.Exec(ctx, `
		UPDATE loans SET
			loan_kind = $2,
			interest_period_months = $3,
			installment_count = $4,
			installment_amount = $5,
			institution_label = $6,
			start_at = $7,
			institution_type = $8,
			party_mode = $9,
			updated_at = now()
		WHERE id = $1
	`, rec.ID, kind, rec.InterestPeriodMonths, rec.InstallmentCount, decPtr(rec.InstallmentAmount), rec.InstitutionLabel, rec.StartAt, rec.InstitutionType, mode)
	return err
}

func patchTermsScheduleTx(ctx context.Context, tx pgx.Tx, termID uuid.UUID, terms loans.Terms) error {
	kind := terms.LoanKind
	if kind == "" {
		kind = loans.KindOneTime
	}
	_, err := tx.Exec(ctx, `
		UPDATE loan_terms SET
			loan_kind = $2,
			interest_period_months = $3,
			installment_count = $4,
			installment_amount = $5,
			institution_label = $6,
			start_at = $7
		WHERE id = $1
	`, termID, kind, terms.InterestPeriodMonths, terms.InstallmentCount, decPtr(terms.InstallmentAmount), terms.InstitutionLabel, terms.StartAt)
	return err
}

func loadScheduleMeta(ctx context.Context, s *SQLStore, rec *loans.Record) error {
	var kind string
	var period, count *int32
	var amount *string
	var institution *string
	var instType *string
	var partyMode string
	var start *time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT loan_kind, interest_period_months, installment_count, installment_amount::text,
		       institution_label, start_at, institution_type, party_mode
		FROM loans WHERE id = $1
	`, rec.ID).Scan(&kind, &period, &count, &amount, &institution, &start, &instType, &partyMode)
	if err != nil {
		return err
	}
	if kind == "" {
		kind = loans.KindOneTime
	}
	rec.LoanKind = kind
	rec.InterestPeriodMonths = period
	rec.InstallmentCount = count
	rec.InstallmentAmount = parseDec(amount)
	rec.InstitutionLabel = institution
	rec.InstitutionType = instType
	rec.PartyMode = partyMode
	rec.StartAt = start
	ids, _ := s.ListCoLenders(ctx, rec.ID)
	rec.CoLenderIDs = ids
	return nil
}

func (s *SQLStore) ListCoLenders(ctx context.Context, loanID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT user_id FROM loan_co_lenders WHERE loan_id = $1 ORDER BY position ASC, user_id ASC
	`, loanID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (s *SQLStore) ReplaceCoLenders(ctx context.Context, loanID uuid.UUID, userIDs []uuid.UUID) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM loan_co_lenders WHERE loan_id = $1`, loanID); err != nil {
		return err
	}
	for i, id := range userIDs {
		if _, err := tx.Exec(ctx, `
			INSERT INTO loan_co_lenders (loan_id, user_id, position) VALUES ($1, $2, $3)
		`, loanID, id, i); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func mustDec(raw string) decimal.Decimal {
	d, err := decimal.NewFromString(raw)
	if err != nil {
		return decimal.Zero
	}
	return d
}

func parseDec(raw *string) *decimal.Decimal {
	if raw == nil || *raw == "" {
		return nil
	}
	d, err := decimal.NewFromString(*raw)
	if err != nil {
		return nil
	}
	return &d
}

func decPtr(d *decimal.Decimal) *string {
	if d == nil {
		return nil
	}
	s := d.StringFixed(loans.Scale)
	return &s
}

func emptyNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func trimPtr(v *string) *string {
	if v == nil {
		return nil
	}
	s := strings.TrimSpace(*v)
	return &s
}

var _ loans.Store = (*SQLStore)(nil)
