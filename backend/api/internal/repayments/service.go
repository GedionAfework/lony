package repayments

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"equilend/api/internal/httpx"
	"equilend/api/internal/loans"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
)

type Service struct {
	store      Store
	loans      LoanAccess
	notifier   Notifier
	bond       BondHook
	categories CategoryResolver
	now        func() time.Time
}

const (
	KindExpense = "expense"
	KindIncome  = "income"
)

// CategoryResolver maps a category name/id to the user's cashflow category.
type CategoryResolver interface {
	ResolveCategory(ctx context.Context, userID uuid.UUID, kind, name string, id *uuid.UUID) (string, *uuid.UUID, error)
}

type Notifier interface {
	OnClaimed(ctx context.Context, loan loans.Record) error
	OnConfirmed(ctx context.Context, loan loans.Record) error
	OnRejected(ctx context.Context, loan loans.Record) error
}

type BondHook interface {
	OnRepaymentConfirmed(ctx context.Context, borrowerID, lenderID uuid.UUID) error
}

func NewService(store Store, loans LoanAccess) *Service {
	return &Service{store: store, loans: loans, now: time.Now}
}

func (s *Service) SetNotifier(n Notifier) {
	s.notifier = n
}

func (s *Service) SetBond(b BondHook) {
	s.bond = b
}

func (s *Service) SetCategories(c CategoryResolver) {
	s.categories = c
}

func (s *Service) Claim(ctx context.Context, actor, loanID uuid.UUID, in ClaimInput) (DTO, error) {
	_, _ = s.loans.MarkOverdue(ctx)
	loan, err := s.loans.Record(ctx, actor, loanID)
	if err != nil {
		return DTO{}, err
	}
	if loan.BorrowerID != actor {
		return DTO{}, httpx.E(http.StatusForbidden, "FORBIDDEN", "only the borrower can claim a repayment")
	}
	if loan.Status != loans.StatusActive && loan.Status != loans.StatusOverdue {
		return DTO{}, httpx.E(http.StatusConflict, "INVALID_STATE", "repayment can only be claimed on an open loan")
	}
	if _, err := s.store.GetPendingForLoan(ctx, loanID); err == nil {
		return DTO{}, httpx.E(http.StatusConflict, "PENDING_EXISTS", "a repayment claim is already waiting for confirmation")
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return DTO{}, err
	}

	outstanding := outstandingOf(loan)
	if !outstanding.GreaterThan(decimal.Zero) {
		return DTO{}, httpx.E(http.StatusConflict, "INVALID_STATE", "there is nothing left to repay")
	}

	amount := outstanding
	if in.Amount != nil && strings.TrimSpace(*in.Amount) != "" {
		parsed, err := decimal.NewFromString(strings.TrimSpace(*in.Amount))
		if err != nil || !parsed.GreaterThan(decimal.Zero) {
			return DTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"amount": "must be a positive decimal",
			})
		}
		amount = parsed.Round(loans.Scale)
	}
	if amount.GreaterThan(outstanding) {
		return DTO{}, httpx.E(http.StatusConflict, "EXCEEDS_OUTSTANDING", "claim would exceed the outstanding balance")
	}

	var note *string
	if in.Note != nil {
		n := strings.TrimSpace(*in.Note)
		if utf8.RuneCountInString(n) > 500 {
			return DTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"note": "max 500 characters",
			})
		}
		if n != "" {
			note = &n
		}
	}

	if in.PayFromAccountID != nil && in.PaidEntryID != nil {
		return DTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"pay_from_account_id": "use either pay_from_account_id or paid_entry_id, not both",
		})
	}

	now := s.now().UTC()
	rec := Record{
		ID:                uuid.New(),
		LoanID:            loanID,
		SubmittedByUserID: actor,
		Amount:            amount,
		Status:            StatusPending,
		Note:              note,
		ProofAttachmentID: in.ProofAttachmentID,
		ProofObjectKey:    in.ProofObjectKey,
		ProofName:         in.ProofName,
		SubmittedAt:       now,
		PaidEntryID:       in.PaidEntryID,
	}
	var entry *EntryWrite
	if in.PayFromAccountID != nil {
		title := ""
		if in.Title != nil {
			title = *in.Title
		}
		category := ""
		if in.Category != nil {
			category = *in.Category
		}
		entry, err = s.newEntry(ctx, actor, loan, KindExpense, *in.PayFromAccountID, amount, title, category, in.CategoryID, in.OccurredAt)
		if err != nil {
			return DTO{}, err
		}
	}
	if in.PaidEntryID != nil {
		if err := s.checkLinkable(ctx, actor, loan, *in.PaidEntryID, KindExpense, amount, true); err != nil {
			return DTO{}, err
		}
	}

	events := []loans.Event{{ActorID: &actor, Type: EventClaimed, Payload: claimPayload(rec)}}
	institutional := loan.IsInstitutional()
	if institutional {
		// Self-recorded debt: the user is both sides, nobody else has to agree.
		confirmed, err := applyConfirm(&rec, &loan, actor, now)
		if err != nil {
			return DTO{}, err
		}
		events = append(events, loans.Event{ActorID: &actor, Type: EventConfirmed, Payload: confirmed})
	} else {
		loan.Status = loans.StatusRepaymentPending
	}
	saved, updatedLoan, err := s.store.InsertRepayment(ctx, rec, loan, events, entry)
	if err != nil {
		return DTO{}, err
	}
	if s.notifier != nil && !institutional {
		_ = s.notifier.OnClaimed(ctx, updatedLoan)
	}
	return toDTO(saved, actor, updatedLoan), nil
}

func (s *Service) Confirm(ctx context.Context, actor, repaymentID uuid.UUID, in ConfirmInput) (DTO, error) {
	rec, loan, err := s.loadPending(ctx, actor, repaymentID)
	if err != nil {
		return DTO{}, err
	}
	if loan.LenderID != actor {
		return DTO{}, httpx.E(http.StatusForbidden, "FORBIDDEN", "only the lender can confirm a repayment")
	}
	// Self-recorded debts have one person on both sides; only peer loans need a second person.
	if rec.SubmittedByUserID == actor && !loan.IsInstitutional() {
		return DTO{}, httpx.E(http.StatusForbidden, "FORBIDDEN", "you cannot confirm your own repayment claim")
	}
	if in.ReceivedAccountID != nil && in.ReceivedEntryID != nil {
		return DTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"received_account_id": "use either received_account_id or received_entry_id, not both",
		})
	}
	// On a self-recorded debt the user's own expense already moved the money; adding
	// income for it would count the payment twice.
	if loan.IsInstitutional() && (in.ReceivedAccountID != nil || in.ReceivedEntryID != nil) {
		return DTO{}, httpx.E(http.StatusUnprocessableEntity, "VALIDATION", "nothing to receive on a self-recorded debt")
	}

	now := s.now().UTC()
	var entry *EntryWrite
	if in.ReceivedAccountID != nil {
		entry, err = s.newEntry(ctx, actor, loan, KindIncome, *in.ReceivedAccountID, rec.Amount, "", "", nil, nil)
		if err != nil {
			return DTO{}, err
		}
	}
	if in.ReceivedEntryID != nil {
		if err := s.checkLinkable(ctx, actor, loan, *in.ReceivedEntryID, KindIncome, rec.Amount, false); err != nil {
			return DTO{}, err
		}
		rec.ReceivedEntryID = in.ReceivedEntryID
	}
	payload, err := applyConfirm(&rec, &loan, actor, now)
	if err != nil {
		return DTO{}, err
	}
	saved, updatedLoan, err := s.store.FinishRepayment(ctx, rec, loan, loans.Event{
		ActorID: &actor,
		Type:    EventConfirmed,
		Payload: payload,
	}, entry)
	if err != nil {
		return DTO{}, err
	}
	if s.notifier != nil && !loan.IsInstitutional() {
		_ = s.notifier.OnConfirmed(ctx, updatedLoan)
	}
	if s.bond != nil && updatedLoan.BorrowerID != updatedLoan.LenderID {
		_ = s.bond.OnRepaymentConfirmed(ctx, updatedLoan.BorrowerID, updatedLoan.LenderID)
	}
	return toDTO(saved, actor, updatedLoan), nil
}

// applyConfirm marks rec confirmed and reduces what is still owed on loan.
func applyConfirm(rec *Record, loan *loans.Record, actor uuid.UUID, now time.Time) (json.RawMessage, error) {
	remaining := outstandingOf(*loan).Sub(rec.Amount)
	if remaining.IsNegative() {
		return nil, httpx.E(http.StatusConflict, "EXCEEDS_OUTSTANDING", "claim exceeds the outstanding balance")
	}
	rec.Status = StatusConfirmed
	rec.ConfirmedByUserID = &actor
	rec.ConfirmedAt = &now
	loan.OutstandingAmount = &remaining
	if remaining.IsZero() {
		loan.Status = loans.StatusCompleted
	} else if loan.DueAt != nil && !loan.DueAt.After(now) {
		loan.Status = loans.StatusOverdue
	} else {
		loan.Status = loans.StatusActive
	}
	payload, _ := json.Marshal(map[string]any{
		"repayment_id": rec.ID.String(),
		"amount":       rec.Amount.StringFixed(loans.Scale),
		"outstanding":  remaining.StringFixed(loans.Scale),
	})
	return payload, nil
}

// newEntry validates the account and builds the cashflow entry written with the repayment.
func (s *Service) newEntry(ctx context.Context, actor uuid.UUID, loan loans.Record, kind string, accountID uuid.UUID, amount decimal.Decimal, title, category string, categoryID *uuid.UUID, occurredAt *time.Time) (*EntryWrite, error) {
	field := "pay_from_account_id"
	if kind == KindIncome {
		field = "received_account_id"
	}
	acct, err := s.store.RepaymentAccountInfo(ctx, actor, accountID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && acct.Archived) {
		return nil, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{field: "account not found"})
	}
	if err != nil {
		return nil, err
	}
	if loan.CurrencyCode == nil || !strings.EqualFold(acct.CurrencyCode, *loan.CurrencyCode) {
		return nil, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{field: "account currency must match the loan currency"})
	}
	title = strings.TrimSpace(title)
	if title == "" {
		title = defaultEntryTitle(loan, kind)
	}
	if utf8.RuneCountInString(title) > 120 {
		return nil, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{"title": "max 120 characters"})
	}
	if strings.TrimSpace(category) == "" && categoryID == nil {
		category = "Loan repayment"
	}
	if s.categories != nil {
		category, categoryID, err = s.categories.ResolveCategory(ctx, actor, kind, category, categoryID)
		if err != nil {
			return nil, err
		}
	}
	occurred := s.now().UTC()
	if occurredAt != nil && !occurredAt.IsZero() {
		occurred = occurredAt.UTC()
	}
	return &EntryWrite{
		UserID:       actor,
		AccountID:    accountID,
		Kind:         kind,
		Title:        title,
		Category:     category,
		CategoryID:   categoryID,
		Amount:       amount,
		CurrencyCode: strings.ToUpper(*loan.CurrencyCode),
		OccurredAt:   occurred,
		LoanID:       loan.ID,
	}, nil
}

func defaultEntryTitle(loan loans.Record, kind string) string {
	label := ""
	if loan.Title != nil && strings.TrimSpace(*loan.Title) != "" {
		label = strings.TrimSpace(*loan.Title)
	} else if loan.InstitutionLabel != nil && strings.TrimSpace(*loan.InstitutionLabel) != "" {
		label = strings.TrimSpace(*loan.InstitutionLabel)
	}
	prefix := "Loan payment"
	if kind == KindIncome {
		prefix = "Loan repayment received"
	}
	if label == "" {
		return prefix
	}
	out := prefix + " · " + label
	if utf8.RuneCountInString(out) > 120 {
		return prefix
	}
	return out
}

// checkLinkable makes sure an existing entry can back this repayment: the actor's own
// confirmed one-off entry of the right kind and currency, at least the repayment
// amount, and not already backing another live repayment. A borrower may reuse the
// expense of a rejected claim (resubmitting).
func (s *Service) checkLinkable(ctx context.Context, actor uuid.UUID, loan loans.Record, entryID uuid.UUID, kind string, amount decimal.Decimal, allowRejected bool) error {
	field := "paid_entry_id"
	if kind == KindIncome {
		field = "received_entry_id"
	}
	bad := func(msg string) error {
		return httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{field: msg})
	}
	info, err := s.store.RepaymentEntryInfo(ctx, entryID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && info.UserID != actor) {
		return bad("entry not found")
	}
	if err != nil {
		return err
	}
	if info.Kind != kind || info.IsTemplate || info.Status != "confirmed" {
		return bad("must be a recorded " + kind)
	}
	if loan.CurrencyCode == nil || !strings.EqualFold(info.CurrencyCode, *loan.CurrencyCode) {
		return bad("entry currency must match the loan currency")
	}
	if info.Amount.LessThan(amount) {
		return bad("entry amount is less than the repayment")
	}
	other, err := s.store.RepaymentForEntry(ctx, entryID)
	if err == nil && !(allowRejected && other.Status == StatusRejected) {
		return httpx.E(http.StatusConflict, "ENTRY_LINKED", "this entry already backs another repayment")
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	return nil
}

func (s *Service) Reject(ctx context.Context, actor, repaymentID uuid.UUID, in RejectInput) (DTO, error) {
	rec, loan, err := s.loadPending(ctx, actor, repaymentID)
	if err != nil {
		return DTO{}, err
	}
	if loan.LenderID != actor {
		return DTO{}, httpx.E(http.StatusForbidden, "FORBIDDEN", "only the lender can reject a repayment")
	}
	reason := strings.TrimSpace(in.Reason)
	if reason == "" || utf8.RuneCountInString(reason) > 500 {
		return DTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"reason": "required, max 500 characters",
		})
	}

	now := s.now().UTC()
	rec.Status = StatusRejected
	rec.RejectedAt = &now
	rec.RejectionReason = &reason
	if loan.DueAt != nil && !loan.DueAt.After(now) {
		loan.Status = loans.StatusOverdue
	} else {
		loan.Status = loans.StatusActive
	}

	payload, _ := json.Marshal(map[string]any{
		"repayment_id": rec.ID.String(),
		"reason":       reason,
	})
	saved, updatedLoan, err := s.store.FinishRepayment(ctx, rec, loan, loans.Event{
		ActorID: &actor,
		Type:    EventRejected,
		Payload: payload,
	}, nil)
	if err != nil {
		return DTO{}, err
	}
	if s.notifier != nil {
		_ = s.notifier.OnRejected(ctx, updatedLoan)
	}
	return toDTO(saved, actor, updatedLoan), nil
}

// Resolve settles a rejected claim whose expense is still recorded: undo the expense
// (delete it and reverse the balance) or keep it as an ordinary expense.
func (s *Service) Resolve(ctx context.Context, actor, repaymentID uuid.UUID, action string) (DTO, error) {
	rec, err := s.store.Get(ctx, repaymentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return DTO{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "repayment not found")
	}
	if err != nil {
		return DTO{}, err
	}
	loan, err := s.loans.Record(ctx, actor, rec.LoanID)
	if err != nil {
		return DTO{}, err
	}
	if rec.SubmittedByUserID != actor {
		return DTO{}, httpx.E(http.StatusForbidden, "FORBIDDEN", "only the borrower can resolve this payment")
	}
	if rec.Status != StatusRejected || rec.PaidEntryID == nil {
		return DTO{}, httpx.E(http.StatusConflict, "INVALID_STATE", "nothing to resolve on this repayment")
	}
	var undo bool
	switch action {
	case ResolveUndoExpense:
		undo = true
	case ResolveKeepExpense:
		undo = false
	default:
		return DTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"action": "must be undo_expense or keep_expense",
		})
	}
	saved, err := s.store.ResolveRejected(ctx, rec, undo)
	if err != nil {
		return DTO{}, err
	}
	return toDTO(saved, actor, loan), nil
}

func (s *Service) ListForLoan(ctx context.Context, actor, loanID uuid.UUID) ([]DTO, error) {
	loan, err := s.loans.Record(ctx, actor, loanID)
	if err != nil {
		return nil, err
	}
	rows, err := s.store.ListForLoan(ctx, loanID)
	if err != nil {
		return nil, err
	}
	out := make([]DTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, toDTO(row, actor, loan))
	}
	return out, nil
}

func (s *Service) Get(ctx context.Context, actor, repaymentID uuid.UUID) (DTO, error) {
	rec, err := s.store.Get(ctx, repaymentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return DTO{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "repayment not found")
	}
	if err != nil {
		return DTO{}, err
	}
	loan, err := s.loans.Record(ctx, actor, rec.LoanID)
	if err != nil {
		return DTO{}, err
	}
	return toDTO(rec, actor, loan), nil
}

func (s *Service) loadPending(ctx context.Context, actor, repaymentID uuid.UUID) (Record, loans.Record, error) {
	rec, err := s.store.Get(ctx, repaymentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Record{}, loans.Record{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "repayment not found")
	}
	if err != nil {
		return Record{}, loans.Record{}, err
	}
	loan, err := s.loans.Record(ctx, actor, rec.LoanID)
	if err != nil {
		return Record{}, loans.Record{}, err
	}
	if rec.Status != StatusPending || loan.Status != loans.StatusRepaymentPending {
		return Record{}, loans.Record{}, httpx.E(http.StatusConflict, "INVALID_STATE", "this repayment is no longer pending")
	}
	return rec, loan, nil
}

func outstandingOf(loan loans.Record) decimal.Decimal {
	if loan.OutstandingAmount != nil {
		return *loan.OutstandingAmount
	}
	if loan.ExpectedTotal != nil {
		return *loan.ExpectedTotal
	}
	return decimal.Zero
}
