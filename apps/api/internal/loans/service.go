package loans

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"equilend/api/internal/httpx"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
)

type FriendshipGate interface {
	CanCreateLoan(ctx context.Context, a, b uuid.UUID) (bool, error)
}

type Service struct {
	store Store
	gate  FriendshipGate
	now   func() time.Time
}

func NewService(store Store, gate FriendshipGate) *Service {
	return &Service{store: store, gate: gate, now: time.Now}
}

func (s *Service) Create(ctx context.Context, actor uuid.UUID, in CreateInput) (LoanDTO, error) {
	role := strings.ToLower(strings.TrimSpace(in.Role))
	if role != RoleBorrower && role != RoleLender {
		return LoanDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"role": "must be borrower or lender",
		})
	}
	if in.CounterpartyID == uuid.Nil || in.CounterpartyID == actor {
		return LoanDTO{}, httpx.E(http.StatusUnprocessableEntity, "VALIDATION", "choose a friend as the other party")
	}
	ok, err := s.gate.CanCreateLoan(ctx, actor, in.CounterpartyID)
	if err != nil {
		return LoanDTO{}, err
	}
	if !ok {
		return LoanDTO{}, httpx.E(http.StatusForbidden, "NOT_FRIENDS", "you can only start a loan with an accepted friend")
	}

	rec := Record{
		ReferenceCode: randomRef(),
		InitiatorID:   actor,
		Status:        StatusPending,
	}
	if role == RoleBorrower {
		rec.BorrowerID = actor
		rec.LenderID = in.CounterpartyID
	} else {
		rec.LenderID = actor
		rec.BorrowerID = in.CounterpartyID
	}

	var terms *Terms
	if hasAnyTerms(in) {
		parsed, err := s.parseTerms(TermsInput{
			Principal:           strVal(in.Principal),
			CurrencyCode:        strVal(in.CurrencyCode),
			InterestRatePercent: strVal(in.InterestRatePercent),
			DueAt:               timeVal(in.DueAt),
			Note:                in.Note,
		})
		if err != nil {
			return LoanDTO{}, err
		}
		parsed.ProposedByUserID = actor
		parsed.Status = TermsProposed
		parsed.Version = 1
		applyTerms(&rec, parsed)
		terms = &parsed
	} else if in.Note != nil {
		note, err := normalizeNote(in.Note)
		if err != nil {
			return LoanDTO{}, err
		}
		rec.Note = note
	}

	payload, _ := json.Marshal(map[string]any{"role": role})
	events := []Event{{ActorID: &actor, Type: EventCreated, Payload: payload}}
	if terms != nil {
		termPayload, _ := json.Marshal(termsSnapshot(rec))
		events = append(events, Event{ActorID: &actor, Type: EventTermsProposed, Payload: termPayload})
	}
	created, err := s.store.InsertLoan(ctx, rec, terms, events)
	if err != nil {
		return LoanDTO{}, err
	}
	return s.toDTO(ctx, actor, created, true)
}

func (s *Service) Propose(ctx context.Context, actor, loanID uuid.UUID, in TermsInput) (LoanDTO, error) {
	rec, err := s.mustGet(ctx, actor, loanID)
	if err != nil {
		return LoanDTO{}, err
	}
	if rec.Status != StatusPending {
		return LoanDTO{}, httpx.E(http.StatusConflict, "INVALID_STATE", "terms can only be set while the loan is pending")
	}
	parsed, err := s.parseTerms(in)
	if err != nil {
		return LoanDTO{}, err
	}
	parsed.ProposedByUserID = actor
	parsed.Status = TermsProposed
	parsed.Version = 1
	if rec.TermsVersion != nil {
		parsed.Version = *rec.TermsVersion + 1
	}
	applyTerms(&rec, parsed)
	payload, _ := json.Marshal(termsSnapshot(rec))
	updated, err := s.store.ProposeTerms(ctx, rec, parsed, Event{ActorID: &actor, Type: EventTermsProposed, Payload: payload})
	if err != nil {
		return LoanDTO{}, err
	}
	return s.toDTO(ctx, actor, updated, true)
}

func (s *Service) Accept(ctx context.Context, actor, loanID uuid.UUID) (LoanDTO, error) {
	rec, err := s.mustGet(ctx, actor, loanID)
	if err != nil {
		return LoanDTO{}, err
	}
	if rec.Status != StatusPending {
		return LoanDTO{}, httpx.E(http.StatusConflict, "INVALID_STATE", "this loan cannot be accepted")
	}
	if rec.CurrentTermsID == nil || rec.ProposedByUserID == nil {
		return LoanDTO{}, httpx.E(http.StatusConflict, "INVALID_STATE", "terms must be proposed before accept")
	}
	if *rec.ProposedByUserID == actor {
		return LoanDTO{}, httpx.E(http.StatusForbidden, "FORBIDDEN", "you cannot accept terms you proposed")
	}
	now := s.now().UTC()
	rec.Status = StatusActive
	rec.AcceptedTermsID = rec.CurrentTermsID
	rec.AcceptedAt = &now
	payload, _ := json.Marshal(termsSnapshot(rec))
	updated, err := s.store.ApplyTransition(ctx, rec, rec.CurrentTermsID, Event{ActorID: &actor, Type: EventAccepted, Payload: payload})
	if err != nil {
		return LoanDTO{}, err
	}
	return s.toDTO(ctx, actor, updated, true)
}

func (s *Service) Reject(ctx context.Context, actor, loanID uuid.UUID) (LoanDTO, error) {
	rec, err := s.mustGet(ctx, actor, loanID)
	if err != nil {
		return LoanDTO{}, err
	}
	if rec.Status != StatusPending {
		return LoanDTO{}, httpx.E(http.StatusConflict, "INVALID_STATE", "this loan cannot be rejected")
	}
	if rec.ProposedByUserID != nil && *rec.ProposedByUserID == actor {
		return LoanDTO{}, httpx.E(http.StatusForbidden, "FORBIDDEN", "cancel the request instead of rejecting your own terms")
	}
	rec.Status = StatusRejected
	updated, err := s.store.ApplyTransition(ctx, rec, nil, Event{ActorID: &actor, Type: EventRejected, Payload: json.RawMessage(`{}`)})
	if err != nil {
		return LoanDTO{}, err
	}
	return s.toDTO(ctx, actor, updated, true)
}

func (s *Service) Cancel(ctx context.Context, actor, loanID uuid.UUID) (LoanDTO, error) {
	rec, err := s.mustGet(ctx, actor, loanID)
	if err != nil {
		return LoanDTO{}, err
	}
	if rec.Status != StatusPending {
		return LoanDTO{}, httpx.E(http.StatusConflict, "INVALID_STATE", "only a pending loan can be cancelled")
	}
	rec.Status = StatusCancelled
	updated, err := s.store.ApplyTransition(ctx, rec, nil, Event{ActorID: &actor, Type: EventCancelled, Payload: json.RawMessage(`{}`)})
	if err != nil {
		return LoanDTO{}, err
	}
	return s.toDTO(ctx, actor, updated, true)
}

func (s *Service) Get(ctx context.Context, actor, loanID uuid.UUID) (LoanDTO, error) {
	_, _ = s.MarkOverdue(ctx)
	rec, err := s.mustGet(ctx, actor, loanID)
	if err != nil {
		return LoanDTO{}, err
	}
	return s.toDTO(ctx, actor, rec, true)
}

func (s *Service) List(ctx context.Context, actor uuid.UUID, q ListQuery) ([]LoanDTO, error) {
	_, _ = s.MarkOverdue(ctx)
	q.Status = strings.TrimSpace(strings.ToLower(q.Status))
	q.Role = strings.TrimSpace(strings.ToLower(q.Role))
	q.Currency = strings.ToUpper(strings.TrimSpace(q.Currency))
	q.Filter = strings.TrimSpace(strings.ToLower(q.Filter))
	if q.Status != "" && !validStatus(q.Status) {
		return nil, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"status": "unknown loan status",
		})
	}
	if q.Role != "" && q.Role != RoleBorrower && q.Role != RoleLender {
		return nil, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"role": "must be borrower or lender",
		})
	}
	if q.Currency != "" && q.Currency != "ETB" && q.Currency != "USD" {
		return nil, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"currency": "must be ETB or USD",
		})
	}
	if q.Filter != "" && !validListFilter(q.Filter) {
		return nil, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"filter": "unknown loan filter",
		})
	}
	fetchStatus, fetchRole := q.Status, q.Role
	if q.Filter != "" || q.Currency != "" {
		fetchStatus, fetchRole = "", ""
	}
	rows, err := s.store.ListLoans(ctx, actor, fetchStatus, fetchRole)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	out := make([]LoanDTO, 0, len(rows))
	for _, row := range rows {
		if !matchListQuery(actor, row, now, q) {
			continue
		}
		dto, err := s.toDTO(ctx, actor, row, false)
		if err != nil {
			return nil, err
		}
		out = append(out, dto)
	}
	return out, nil
}

func (s *Service) AllForUser(ctx context.Context, actor uuid.UUID) ([]Record, error) {
	_, _ = s.MarkOverdue(ctx)
	return s.store.ListLoans(ctx, actor, "", "")
}

func (s *Service) Party(ctx context.Context, id uuid.UUID) (Party, error) {
	return s.store.GetParty(ctx, id)
}

func (s *Service) Record(ctx context.Context, actor, id uuid.UUID) (Record, error) {
	return s.mustGet(ctx, actor, id)
}

func (s *Service) MarkOverdue(ctx context.Context) (int, error) {
	return s.store.MarkOverdue(ctx, s.now().UTC())
}

func (s *Service) mustGet(ctx context.Context, actor, id uuid.UUID) (Record, error) {
	row, err := s.store.GetLoan(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return Record{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "loan not found")
	}
	if err != nil {
		return Record{}, err
	}
	if !row.IsParty(actor) {
		return Record{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "loan not found")
	}
	return row, nil
}

func (s *Service) parseTerms(in TermsInput) (Terms, error) {
	fields := map[string]string{}
	principal, err := parsePositiveDecimal(in.Principal)
	if err != nil {
		fields["principal"] = "must be a positive amount"
	}
	rate, err := parseRate(in.InterestRatePercent)
	if err != nil {
		fields["interest_rate_percent"] = "must be between 0 and 100"
	}
	currency := strings.ToUpper(strings.TrimSpace(in.CurrencyCode))
	if currency != "ETB" && currency != "USD" {
		fields["currency_code"] = "must be ETB or USD"
	}
	if in.DueAt.IsZero() || !in.DueAt.After(s.now()) {
		fields["due_at"] = "must be in the future"
	}
	note, err := normalizeNote(in.Note)
	if err != nil {
		fields["note"] = "must be 500 characters or fewer"
	}
	if len(fields) > 0 {
		return Terms{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", fields)
	}
	interest, total := ComputeExpected(principal, rate)
	return Terms{
		Principal:           principal,
		CurrencyCode:        currency,
		InterestRatePercent: rate,
		InterestAmount:      interest,
		ExpectedTotal:       total,
		DueAt:               in.DueAt.UTC(),
		Note:                note,
	}, nil
}

func (s *Service) toDTO(ctx context.Context, actor uuid.UUID, rec Record, detail bool) (LoanDTO, error) {
	borrower, err := s.store.GetParty(ctx, rec.BorrowerID)
	if err != nil {
		return LoanDTO{}, err
	}
	lender, err := s.store.GetParty(ctx, rec.LenderID)
	if err != nil {
		return LoanDTO{}, err
	}
	awaiting := rec.AwaitingUserID()
	dto := LoanDTO{
		ID:                  rec.ID,
		ReferenceCode:       rec.ReferenceCode,
		Status:              rec.Status,
		Borrower:            borrower,
		Lender:              lender,
		YourRole:            rec.RoleOf(actor),
		InterestBasis:       InterestBasis,
		Principal:           decStr(rec.Principal),
		CurrencyCode:        rec.CurrencyCode,
		InterestRatePercent: decStr(rec.InterestRatePercent),
		InterestAmount:      decStr(rec.InterestAmount),
		ExpectedTotal:       decStr(rec.ExpectedTotal),
		DueAt:               rec.DueAt,
		Note:                rec.Note,
		TermsVersion:        rec.TermsVersion,
		ProposedByUserID:    rec.ProposedByUserID,
		AwaitingUserID:      awaiting,
		AcceptedAt:          rec.AcceptedAt,
		CreatedAt:           rec.CreatedAt,
		CanAccept:           rec.Status == StatusPending && rec.CurrentTermsID != nil && awaiting != nil && *awaiting == actor,
		CanReject:           rec.Status == StatusPending && (rec.ProposedByUserID == nil || *rec.ProposedByUserID != actor),
		CanCancel:           rec.Status == StatusPending,
		CanProposeTerms:     rec.Status == StatusPending,
	}
	if !detail {
		return dto, nil
	}
	terms, err := s.store.ListTerms(ctx, rec.ID)
	if err != nil {
		return LoanDTO{}, err
	}
	dto.Terms = make([]TermsDTO, 0, len(terms))
	for _, term := range terms {
		dto.Terms = append(dto.Terms, TermsDTO{
			ID:                  term.ID,
			Version:             term.Version,
			Status:              term.Status,
			InterestBasis:       InterestBasis,
			Principal:           term.Principal.StringFixed(Scale),
			CurrencyCode:        term.CurrencyCode,
			InterestRatePercent: term.InterestRatePercent.StringFixed(Scale),
			InterestAmount:      term.InterestAmount.StringFixed(Scale),
			ExpectedTotal:       term.ExpectedTotal.StringFixed(Scale),
			DueAt:               term.DueAt,
			Note:                term.Note,
			ProposedByUserID:    term.ProposedByUserID,
			CreatedAt:           term.CreatedAt,
		})
	}
	events, err := s.store.ListEvents(ctx, rec.ID)
	if err != nil {
		return LoanDTO{}, err
	}
	dto.Events = make([]EventDTO, 0, len(events))
	for _, ev := range events {
		dto.Events = append(dto.Events, EventDTO{
			ID:        ev.ID,
			Type:      ev.Type,
			ActorID:   ev.ActorID,
			Payload:   ev.Payload,
			CreatedAt: ev.CreatedAt,
		})
	}
	return dto, nil
}

func applyTerms(rec *Record, terms Terms) {
	rec.Principal = &terms.Principal
	rec.CurrencyCode = &terms.CurrencyCode
	rec.InterestRatePercent = &terms.InterestRatePercent
	rec.InterestAmount = &terms.InterestAmount
	rec.ExpectedTotal = &terms.ExpectedTotal
	rec.OutstandingAmount = &terms.ExpectedTotal
	rec.DueAt = &terms.DueAt
	rec.Note = terms.Note
	rec.TermsVersion = &terms.Version
	rec.ProposedByUserID = &terms.ProposedByUserID
}

func hasAnyTerms(in CreateInput) bool {
	return strVal(in.Principal) != "" || strVal(in.CurrencyCode) != "" || strVal(in.InterestRatePercent) != "" || in.DueAt != nil
}

func parsePositiveDecimal(raw string) (decimal.Decimal, error) {
	d, err := decimal.NewFromString(strings.TrimSpace(raw))
	if err != nil || !d.GreaterThan(zero) {
		return decimal.Decimal{}, errors.New("invalid")
	}
	return NormalizeAmount(d), nil
}

func parseRate(raw string) (decimal.Decimal, error) {
	d, err := decimal.NewFromString(strings.TrimSpace(raw))
	if err != nil || d.LessThan(zero) || d.GreaterThan(hundred) {
		return decimal.Decimal{}, errors.New("invalid")
	}
	return NormalizeAmount(d), nil
}

func normalizeNote(note *string) (*string, error) {
	if note == nil {
		return nil, nil
	}
	v := strings.TrimSpace(*note)
	if v == "" {
		return nil, nil
	}
	if utf8.RuneCountInString(v) > MaxNoteLen {
		return nil, errors.New("too long")
	}
	return &v, nil
}

func validStatus(status string) bool {
	switch status {
	case StatusPending, StatusActive, StatusOverdue, StatusRepaymentPending, StatusRejected, StatusCancelled, StatusCompleted:
		return true
	default:
		return false
	}
}

func validListFilter(filter string) bool {
	switch filter {
	case "receivables", "payables", "due_soon", "pending_action", "pending_confirmations":
		return true
	default:
		return false
	}
}

func matchListQuery(actor uuid.UUID, row Record, now time.Time, q ListQuery) bool {
	if q.Status != "" && row.Status != q.Status {
		return false
	}
	if q.Role != "" && row.RoleOf(actor) != q.Role {
		return false
	}
	if q.Currency != "" && (row.CurrencyCode == nil || *row.CurrencyCode != q.Currency) {
		return false
	}
	switch q.Filter {
	case "":
		return true
	case "receivables":
		return isOpenLoan(row) && row.LenderID == actor
	case "payables":
		return isOpenLoan(row) && row.BorrowerID == actor
	case "due_soon":
		return row.Status == StatusActive && row.DueAt != nil && row.DueAt.After(now) && !row.DueAt.After(now.Add(DueSoonWindow))
	case "pending_action":
		if row.Status != StatusPending {
			return false
		}
		if awaiting := row.AwaitingUserID(); awaiting != nil && *awaiting == actor {
			return true
		}
		return row.CurrentTermsID == nil && row.InitiatorID != actor
	case "pending_confirmations":
		return row.Status == StatusRepaymentPending && row.LenderID == actor
	default:
		return false
	}
}

func isOpenLoan(row Record) bool {
	return row.Status == StatusActive || row.Status == StatusOverdue || row.Status == StatusRepaymentPending
}

func decStr(d *decimal.Decimal) *string {
	if d == nil {
		return nil
	}
	s := d.StringFixed(Scale)
	return &s
}

func strVal(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

func timeVal(v *time.Time) time.Time {
	if v == nil {
		return time.Time{}
	}
	return *v
}

func termsSnapshot(rec Record) map[string]any {
	return map[string]any{
		"principal":             decStr(rec.Principal),
		"currency_code":         rec.CurrencyCode,
		"interest_basis":        InterestBasis,
		"interest_rate_percent": decStr(rec.InterestRatePercent),
		"interest_amount":       decStr(rec.InterestAmount),
		"expected_total":        decStr(rec.ExpectedTotal),
		"due_at":                rec.DueAt,
	}
}

const refAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

func randomRef() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	out := make([]byte, 6)
	for i := range out {
		out[i] = refAlphabet[int(b[i])%len(refAlphabet)]
	}
	return "LN-" + string(out)
}
