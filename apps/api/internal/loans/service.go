package loans

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"equilend/api/internal/chat"
	"equilend/api/internal/httpx"
	"equilend/api/internal/legal"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
)

type FriendshipGate interface {
	CanCreateLoan(ctx context.Context, a, b uuid.UUID) (bool, error)
}

type Hooks interface {
	AfterCreate(ctx context.Context, loan Record) error
	AfterAccept(ctx context.Context, loan Record) error
}

type Service struct {
	store Store
	gate  FriendshipGate
	hooks Hooks
	now   func() time.Time
}

func NewService(store Store, gate FriendshipGate) *Service {
	return &Service{store: store, gate: gate, now: time.Now}
}

func (s *Service) SetHooks(h Hooks) {
	s.hooks = h
}

func (s *Service) Create(ctx context.Context, actor uuid.UUID, in CreateInput) (LoanDTO, error) {
	role := strings.ToLower(strings.TrimSpace(in.Role))
	if role != RoleBorrower && role != RoleLender {
		return LoanDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"role": "must be borrower or lender",
		})
	}
	institution := strings.TrimSpace(strVal(in.InstitutionLabel))
	instType := strings.TrimSpace(strVal(in.InstitutionType))
	kind := normalizeLoanKind(strVal(in.LoanKind))
	partyMode := normalizePartyMode(strVal(in.PartyMode), kind)

	lenders := uniqueUUIDs(in.CoLenderIDs)
	if in.CounterpartyID != uuid.Nil && in.CounterpartyID != actor {
		lenders = uniqueUUIDs(append([]uuid.UUID{in.CounterpartyID}, lenders...))
	}
	filtered := make([]uuid.UUID, 0, len(lenders))
	for _, id := range lenders {
		if id != actor && id != uuid.Nil {
			filtered = append(filtered, id)
		}
	}
	lenders = filtered

	hasInstitution := institution != "" || instType != ""
	// Any long-term alone mode, or any request that names an institution without peers,
	// is institutional debt — never require a Lony counterparty.
	alone := (kind == KindLongTerm && partyMode == PartyAlone) ||
		(hasInstitution && len(lenders) == 0) ||
		(kind == KindLongTerm && len(lenders) == 0)
	if alone {
		kind = KindLongTerm
		partyMode = PartyAlone
		lenders = nil
		if institution == "" && instType != "" {
			institution = humanizeInstitutionType(instType)
		}
		if institution == "" {
			return LoanDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"institution_label": "select a financial institution",
			})
		}
	} else if kind == KindLongTerm && len(lenders) >= 1 {
		partyMode = PartyShared
	} else if len(lenders) == 0 {
		return LoanDTO{}, httpx.E(http.StatusUnprocessableEntity, "VALIDATION", "choose someone as the other party")
	}

	for _, id := range lenders {
		if _, err := s.store.GetParty(ctx, id); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return LoanDTO{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "user not found")
			}
			return LoanDTO{}, err
		}
	}

	rec := Record{
		ReferenceCode: randomRef(),
		InitiatorID:   actor,
		Status:        StatusPending,
		LoanKind:      kind,
		PartyMode:     partyMode,
	}
	if alone {
		role = RoleBorrower
		rec.BorrowerID = actor
		rec.LenderID = actor
		rec.InstitutionLabel = &institution
	} else if role == RoleBorrower {
		rec.BorrowerID = actor
		rec.LenderID = lenders[0]
		if len(lenders) > 1 {
			rec.CoLenderIDs = lenders[1:]
		}
	} else {
		rec.LenderID = actor
		rec.BorrowerID = lenders[0]
		if len(lenders) > 1 {
			rec.CoLenderIDs = lenders[1:]
		}
	}
	if institution != "" && rec.InstitutionLabel == nil {
		rec.InstitutionLabel = &institution
	}
	if instType != "" {
		rec.InstitutionType = &instType
	}

	var terms *Terms
	if hasAnyTerms(in) {
		parsed, err := s.parseTerms(TermsInput{
			Principal:            strVal(in.Principal),
			CurrencyCode:         strVal(in.CurrencyCode),
			InterestRatePercent:  strVal(in.InterestRatePercent),
			DueAt:                timeVal(in.DueAt),
			Note:                 in.Note,
			LoanKind:             kind,
			InterestPeriodMonths: in.InterestPeriodMonths,
			InstallmentCount:     in.InstallmentCount,
			InstitutionLabel:     rec.InstitutionLabel,
			StartAt:              in.StartAt,
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

	payload, _ := json.Marshal(map[string]any{"role": role, "loan_kind": kind, "party_mode": partyMode})
	events := []Event{{ActorID: &actor, Type: EventCreated, Payload: payload}}
	if terms != nil {
		termPayload, _ := json.Marshal(termsSnapshot(rec))
		events = append(events, Event{ActorID: &actor, Type: EventTermsProposed, Payload: termPayload})
	}

	if alone && terms != nil {
		now := s.now().UTC()
		rec.Status = StatusActive
		rec.AcceptedAt = &now
		events = append(events, Event{ActorID: &actor, Type: EventAccepted, Payload: json.RawMessage(`{"institutional":true}`)})
	}

	created, err := s.store.InsertLoan(ctx, rec, terms, events)
	if err != nil {
		return LoanDTO{}, err
	}
	if len(rec.CoLenderIDs) > 0 {
		if err := s.store.ReplaceCoLenders(ctx, created.ID, rec.CoLenderIDs); err != nil {
			return LoanDTO{}, err
		}
		created.CoLenderIDs = rec.CoLenderIDs
	}
	if alone && terms != nil {
		created, err = s.materializeSchedule(ctx, created)
		if err != nil {
			return LoanDTO{}, err
		}
	}
	if s.hooks != nil {
		_ = s.hooks.AfterCreate(ctx, created)
		if created.Status == StatusActive {
			_ = s.hooks.AfterAccept(ctx, created)
		}
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

func (s *Service) Accept(ctx context.Context, actor, loanID uuid.UUID, acceptedDisclaimer bool) (LoanDTO, error) {
	if !acceptedDisclaimer {
		return LoanDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"accepted_disclaimer": "you must accept the Lony product disclaimer to activate this loan",
		})
	}
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
	snap := termsSnapshot(rec)
	snap["disclaimer_accepted"] = true
	snap["disclaimer_version"] = legal.Version
	payload, _ := json.Marshal(snap)
	updated, err := s.store.ApplyTransition(ctx, rec, rec.CurrentTermsID, Event{ActorID: &actor, Type: EventAccepted, Payload: payload})
	if err != nil {
		return LoanDTO{}, err
	}
	updated, err = s.materializeSchedule(ctx, updated)
	if err != nil {
		return LoanDTO{}, err
	}
	if s.hooks != nil {
		_ = s.hooks.AfterAccept(ctx, updated)
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
	if q.Currency != "" && !isCurrencyCode(q.Currency) {
		return nil, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"currency": "must be a 3-letter currency code",
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

// LoanPeer returns the other party on a loan (for loan-scoped chat).
func (s *Service) LoanPeer(ctx context.Context, actor, loanID uuid.UUID) (peerID uuid.UUID, ref string, err error) {
	rec, err := s.mustGet(ctx, actor, loanID)
	if err != nil {
		return uuid.Nil, "", err
	}
	return rec.OtherParty(actor), rec.ReferenceCode, nil
}

// MoneyForLoan returns money involvement for a specific loan when still open.
func (s *Service) MoneyForLoan(ctx context.Context, actor, loanID uuid.UUID) (*chat.MoneyLink, error) {
	rec, err := s.mustGet(ctx, actor, loanID)
	if err != nil {
		return nil, err
	}
	return moneyLinkFromRecord(actor, rec), nil
}

// ActiveMoneyBetween returns all open loans between actor and peer (newest first).
func (s *Service) ActiveMoneyBetween(ctx context.Context, actor, peerID uuid.UUID) ([]chat.MoneyLink, error) {
	rows, err := s.store.ListLoans(ctx, actor, "", "")
	if err != nil {
		return nil, err
	}
	type ranked struct {
		link chat.MoneyLink
		at   time.Time
	}
	var rankedRows []ranked
	for i := range rows {
		rec := rows[i]
		if rec.OtherParty(actor) != peerID {
			continue
		}
		link := moneyLinkFromRecord(actor, rec)
		if link == nil {
			continue
		}
		rankedRows = append(rankedRows, ranked{link: *link, at: rec.UpdatedAt})
	}
	sort.Slice(rankedRows, func(i, j int) bool {
		return rankedRows[i].at.After(rankedRows[j].at)
	})
	out := make([]chat.MoneyLink, 0, len(rankedRows))
	for _, r := range rankedRows {
		out = append(out, r.link)
	}
	return out, nil
}

func isOpenMoneyStatus(status string) bool {
	switch status {
	case StatusActive, StatusOverdue, StatusRepaymentPending:
		return true
	default:
		return false
	}
}

func moneyLinkFromRecord(actor uuid.UUID, rec Record) *chat.MoneyLink {
	if !isOpenMoneyStatus(rec.Status) {
		return nil
	}
	role := "borrowed"
	if rec.RoleOf(actor) == RoleLender {
		role = "lent"
	}
	link := &chat.MoneyLink{
		LoanID:        rec.ID,
		Role:          role,
		Status:        rec.Status,
		ReferenceCode: rec.ReferenceCode,
		CurrencyCode:  rec.CurrencyCode,
		DueAt:         rec.DueAt,
	}
	if rec.Principal != nil {
		v := rec.Principal.StringFixed(2)
		link.Amount = &v
	}
	return link
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
	if !isCurrencyCode(currency) {
		fields["currency_code"] = "must be a 3-letter currency code"
	}
	note, err := normalizeNote(in.Note)
	if err != nil {
		fields["note"] = "must be 500 characters or fewer"
	}
	kind := normalizeLoanKind(in.LoanKind)
	var institution *string
	if label := strings.TrimSpace(strVal(in.InstitutionLabel)); label != "" {
		if utf8.RuneCountInString(label) > 120 {
			fields["institution_label"] = "must be 120 characters or fewer"
		} else {
			institution = &label
		}
	}
	start := s.now().UTC()
	if in.StartAt != nil && !in.StartAt.IsZero() {
		start = in.StartAt.UTC()
	}

	if kind == KindLongTerm {
		months := int32(0)
		if in.InstallmentCount != nil {
			months = *in.InstallmentCount
		} else if in.InterestPeriodMonths != nil {
			months = *in.InterestPeriodMonths
		}
		if months < 2 || months > 480 {
			fields["installment_count"] = "must be between 2 and 480 months"
		}
		if len(fields) > 0 {
			return Terms{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", fields)
		}
		emi := ComputeEMI(principal, rate, int(months))
		plan := BuildInstallmentSchedule(principal, rate, emi, int(months), start)
		totalInterest := zero
		total := zero
		for _, p := range plan {
			totalInterest = totalInterest.Add(p.InterestPortion)
			total = total.Add(p.Amount)
		}
		due := plan[len(plan)-1].DueAt
		nextDue := plan[0].DueAt
		_ = nextDue
		count := months
		period := months
		return Terms{
			Principal:            principal,
			CurrencyCode:         currency,
			InterestRatePercent:  rate,
			InterestAmount:       NormalizeAmount(totalInterest),
			ExpectedTotal:        NormalizeAmount(total),
			DueAt:                due,
			Note:                 note,
			LoanKind:             KindLongTerm,
			InterestPeriodMonths: &period,
			InstallmentCount:     &count,
			InstallmentAmount:    &emi,
			InstitutionLabel:     institution,
			StartAt:              &start,
		}, nil
	}

	dueAt := in.DueAt
	if dueAt.IsZero() && in.InterestPeriodMonths != nil && *in.InterestPeriodMonths > 0 {
		dueAt = start.AddDate(0, int(*in.InterestPeriodMonths), 0)
	}
	if !rate.Equal(zero) {
		if in.InterestPeriodMonths == nil || *in.InterestPeriodMonths < 1 {
			months := int32(1)
			if !dueAt.IsZero() {
				y1, m1, _ := start.Date()
				y2, m2, _ := dueAt.Date()
				diff := int32((y2-y1)*12 + int(m2-m1))
				if diff > 1 {
					months = diff
				}
			}
			in.InterestPeriodMonths = &months
		}
		if *in.InterestPeriodMonths < 1 || *in.InterestPeriodMonths > 480 {
			fields["interest_period_months"] = "must be between 1 and 480 months"
		}
	}
	if dueAt.IsZero() || !dueAt.After(s.now()) {
		fields["due_at"] = "must be in the future"
	}
	if len(fields) > 0 {
		return Terms{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", fields)
	}
	interest, total := ComputeExpected(principal, rate)
	return Terms{
		Principal:            principal,
		CurrencyCode:         currency,
		InterestRatePercent:  rate,
		InterestAmount:       interest,
		ExpectedTotal:        total,
		DueAt:                dueAt.UTC(),
		Note:                 note,
		LoanKind:             KindOneTime,
		InterestPeriodMonths: in.InterestPeriodMonths,
		InstitutionLabel:     institution,
		StartAt:              &start,
	}, nil
}

func (s *Service) materializeSchedule(ctx context.Context, rec Record) (Record, error) {
	if rec.LoanKind != KindLongTerm || rec.Principal == nil || rec.InterestRatePercent == nil || rec.InstallmentCount == nil {
		return rec, nil
	}
	months := int(*rec.InstallmentCount)
	if months < 2 {
		return rec, nil
	}
	start := s.now().UTC()
	if rec.StartAt != nil {
		start = rec.StartAt.UTC()
	}
	emi := ComputeEMI(*rec.Principal, *rec.InterestRatePercent, months)
	if rec.InstallmentAmount != nil {
		emi = *rec.InstallmentAmount
	}
	plan := BuildInstallmentSchedule(*rec.Principal, *rec.InterestRatePercent, emi, months, start)
	rows := make([]Installment, 0, len(plan))
	for _, p := range plan {
		rows = append(rows, Installment{
			Sequence:         int32(p.Sequence),
			DueAt:            p.DueAt,
			Amount:           p.Amount,
			PrincipalPortion: p.PrincipalPortion,
			InterestPortion:  p.InterestPortion,
			Status:           InstallmentScheduled,
		})
	}
	if err := s.store.ReplaceInstallments(ctx, rec.ID, rows); err != nil {
		return Record{}, err
	}
	if len(plan) > 0 {
		next := plan[0].DueAt
		rec.DueAt = &next
		emiCopy := emi
		rec.InstallmentAmount = &emiCopy
		return s.store.SaveScheduleMeta(ctx, rec)
	}
	return rec, nil
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
	basis := InterestBasis
	if rec.LoanKind == KindLongTerm {
		basis = "reducing_balance_monthly"
	}
	kind := rec.LoanKind
	if kind == "" {
		kind = KindOneTime
	}
	dto := LoanDTO{
		ID:                   rec.ID,
		ReferenceCode:        rec.ReferenceCode,
		Status:               rec.Status,
		Borrower:             borrower,
		Lender:               lender,
		YourRole:             rec.RoleOf(actor),
		InterestBasis:        basis,
		LoanKind:             kind,
		Principal:            decStr(rec.Principal),
		CurrencyCode:         rec.CurrencyCode,
		InterestRatePercent:  decStr(rec.InterestRatePercent),
		InterestAmount:       decStr(rec.InterestAmount),
		ExpectedTotal:        decStr(rec.ExpectedTotal),
		DueAt:                rec.DueAt,
		Note:                 rec.Note,
		InterestPeriodMonths: rec.InterestPeriodMonths,
		InstallmentCount:     rec.InstallmentCount,
		InstallmentAmount:    decStr(rec.InstallmentAmount),
		InstitutionLabel:     rec.InstitutionLabel,
		InstitutionType:      rec.InstitutionType,
		PartyMode:            rec.PartyMode,
		StartAt:              rec.StartAt,
		TermsVersion:         rec.TermsVersion,
		ProposedByUserID:     rec.ProposedByUserID,
		AwaitingUserID:       awaiting,
		AcceptedAt:           rec.AcceptedAt,
		CreatedAt:            rec.CreatedAt,
		CanAccept:            rec.Status == StatusPending && rec.CurrentTermsID != nil && awaiting != nil && *awaiting == actor,
		CanReject:            rec.Status == StatusPending && !rec.IsInstitutional() && (rec.ProposedByUserID == nil || *rec.ProposedByUserID != actor),
		CanCancel:            rec.Status == StatusPending,
		CanProposeTerms:      rec.Status == StatusPending,
	}
	if dto.PartyMode == "" {
		if dto.LoanKind == KindLongTerm && rec.IsInstitutional() {
			dto.PartyMode = PartyAlone
		} else {
			dto.PartyMode = PartyPeer
		}
	}
	coIDs := rec.CoLenderIDs
	if len(coIDs) == 0 {
		coIDs, _ = s.store.ListCoLenders(ctx, rec.ID)
	}
	if len(coIDs) > 0 {
		dto.CoLenders = make([]Party, 0, len(coIDs))
		for _, id := range coIDs {
			p, err := s.store.GetParty(ctx, id)
			if err != nil {
				continue
			}
			dto.CoLenders = append(dto.CoLenders, p)
		}
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
		termKind := term.LoanKind
		if termKind == "" {
			termKind = KindOneTime
		}
		termBasis := InterestBasis
		if termKind == KindLongTerm {
			termBasis = "reducing_balance_monthly"
		}
		dto.Terms = append(dto.Terms, TermsDTO{
			ID:                   term.ID,
			Version:              term.Version,
			Status:               term.Status,
			InterestBasis:        termBasis,
			LoanKind:             termKind,
			Principal:            term.Principal.StringFixed(Scale),
			CurrencyCode:         term.CurrencyCode,
			InterestRatePercent:  term.InterestRatePercent.StringFixed(Scale),
			InterestAmount:       term.InterestAmount.StringFixed(Scale),
			ExpectedTotal:        term.ExpectedTotal.StringFixed(Scale),
			DueAt:                term.DueAt,
			Note:                 term.Note,
			InterestPeriodMonths: term.InterestPeriodMonths,
			InstallmentCount:     term.InstallmentCount,
			InstallmentAmount:    decStr(term.InstallmentAmount),
			InstitutionLabel:     term.InstitutionLabel,
			StartAt:              term.StartAt,
			ProposedByUserID:     term.ProposedByUserID,
			CreatedAt:            term.CreatedAt,
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
	installments, err := s.store.ListInstallments(ctx, rec.ID)
	if err != nil {
		return LoanDTO{}, err
	}
	dto.Installments = make([]InstallmentDTO, 0, len(installments))
	for _, row := range installments {
		dto.Installments = append(dto.Installments, InstallmentDTO{
			ID:               row.ID,
			Sequence:         row.Sequence,
			DueAt:            row.DueAt,
			Amount:           row.Amount.StringFixed(Scale),
			PrincipalPortion: row.PrincipalPortion.StringFixed(Scale),
			InterestPortion:  row.InterestPortion.StringFixed(Scale),
			Status:           row.Status,
			PaidAt:           row.PaidAt,
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
	rec.LoanKind = terms.LoanKind
	if rec.LoanKind == "" {
		rec.LoanKind = KindOneTime
	}
	rec.InterestPeriodMonths = terms.InterestPeriodMonths
	rec.InstallmentCount = terms.InstallmentCount
	rec.InstallmentAmount = terms.InstallmentAmount
	if terms.InstitutionLabel != nil {
		rec.InstitutionLabel = terms.InstitutionLabel
	}
	rec.StartAt = terms.StartAt
}

func hasAnyTerms(in CreateInput) bool {
	return strVal(in.Principal) != "" || strVal(in.CurrencyCode) != "" || strVal(in.InterestRatePercent) != "" || in.DueAt != nil || strVal(in.LoanKind) == KindLongTerm || in.InstallmentCount != nil
}

func normalizeLoanKind(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case KindLongTerm, "long-term", "longterm", "emi":
		return KindLongTerm
	default:
		return KindOneTime
	}
}

func normalizePartyMode(raw, kind string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case PartyAlone, "solo", "myself":
		return PartyAlone
	case PartyShared, "with_others", "with-someone", "group":
		return PartyShared
	case PartyPeer:
		return PartyPeer
	default:
		if kind == KindLongTerm {
			return PartyAlone
		}
		return PartyPeer
	}
}

func humanizeInstitutionType(raw string) string {
	v := strings.TrimSpace(strings.ReplaceAll(raw, "_", " "))
	if v == "" {
		return "Institution"
	}
	parts := strings.Fields(v)
	for i, p := range parts {
		if len(p) == 0 {
			continue
		}
		parts[i] = strings.ToUpper(p[:1]) + strings.ToLower(p[1:])
	}
	return strings.Join(parts, " ")
}

func uniqueUUIDs(ids []uuid.UUID) []uuid.UUID {
	seen := map[uuid.UUID]struct{}{}
	out := make([]uuid.UUID, 0, len(ids))
	for _, id := range ids {
		if id == uuid.Nil {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
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
		"principal":              decStr(rec.Principal),
		"currency_code":          rec.CurrencyCode,
		"interest_basis":         InterestBasis,
		"interest_rate_percent":  decStr(rec.InterestRatePercent),
		"interest_amount":        decStr(rec.InterestAmount),
		"expected_total":         decStr(rec.ExpectedTotal),
		"due_at":                 rec.DueAt,
		"loan_kind":              rec.LoanKind,
		"interest_period_months": rec.InterestPeriodMonths,
		"installment_count":      rec.InstallmentCount,
		"installment_amount":     decStr(rec.InstallmentAmount),
		"institution_label":      rec.InstitutionLabel,
		"start_at":               rec.StartAt,
	}
}

const refAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

func isCurrencyCode(code string) bool {
	if len(code) != 3 {
		return false
	}
	for _, c := range code {
		if c < 'A' || c > 'Z' {
			return false
		}
	}
	return true
}

func randomRef() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	out := make([]byte, 6)
	for i := range out {
		out[i] = refAlphabet[int(b[i])%len(refAlphabet)]
	}
	return "LN-" + string(out)
}
