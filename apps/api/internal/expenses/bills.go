package expenses

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"time"

	"equilend/api/internal/httpx"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type BillDTO struct {
	ID           uuid.UUID  `json:"id"`
	Kind         string     `json:"kind"`
	Title        string     `json:"title"`
	Amount       string     `json:"amount"`
	CurrencyCode string     `json:"currency_code"`
	Category     string     `json:"category"`
	DueAt        time.Time  `json:"due_at"`
	Recurrence   *string    `json:"recurrence,omitempty"`
	Paused       bool       `json:"paused"`
	Status       string     `json:"status"`
	AccountID    *uuid.UUID `json:"account_id,omitempty"`
	TemplateID   *uuid.UUID `json:"template_id,omitempty"`
	IsTemplate   bool       `json:"is_template"`
}

func skipAdvance(recurrence string, from time.Time) time.Time {
	base := from.UTC()
	switch recurrence {
	case RecurrenceWeekly:
		return base.AddDate(0, 0, 7)
	case RecurrenceYearly:
		return base.AddDate(1, 0, 0)
	default:
		return base.AddDate(0, 1, 0)
	}
}

func sameUTCDay(a, b time.Time) bool {
	ay, am, ad := a.UTC().Date()
	by, bm, bd := b.UTC().Date()
	return ay == by && am == bm && ad == bd
}

func billFromEntry(e Entry, due, now time.Time, paused bool) BillDTO {
	nowUTC := now.UTC()
	today := time.Date(nowUTC.Year(), nowUTC.Month(), nowUTC.Day(), 0, 0, 0, 0, time.UTC)
	dueUTC := due.UTC()
	dueDay := time.Date(dueUTC.Year(), dueUTC.Month(), dueUTC.Day(), 0, 0, 0, 0, time.UTC)
	status := "upcoming"
	if paused || e.Paused {
		status = "paused"
		paused = true
	} else if dueDay.Before(today) {
		status = "overdue"
	} else if e.Status == StatusExpected {
		status = "expected"
	}
	tid := e.TemplateID
	if e.IsTemplate {
		id := e.ID
		tid = &id
	}
	return BillDTO{
		ID:           e.ID,
		Kind:         e.Kind,
		Title:        e.Title,
		Amount:       e.Amount.StringFixed(Scale),
		CurrencyCode: e.CurrencyCode,
		Category:     e.Category,
		DueAt:        due.UTC(),
		Recurrence:   e.Recurrence,
		Paused:       paused,
		Status:       status,
		AccountID:    e.AccountID,
		TemplateID:   tid,
		IsTemplate:   e.IsTemplate,
	}
}

func (s *Service) ListBills(ctx context.Context, userID uuid.UUID, days int) ([]BillDTO, error) {
	if days <= 0 {
		days = 60
	}
	if days > 180 {
		days = 180
	}
	now := s.now().UTC()
	from := now.AddDate(0, 0, -21)
	to := now.AddDate(0, 0, days+1)
	tTrue := true
	templates, err := s.store.List(ctx, userID, ListQuery{Templates: &tTrue, Limit: 500})
	if err != nil {
		return nil, err
	}
	occurrences, err := s.store.List(ctx, userID, ListQuery{From: &from, To: &to, Limit: 500})
	if err != nil {
		return nil, err
	}

	pausedIDs := map[uuid.UUID]struct{}{}
	for _, tmpl := range templates {
		if tmpl.Paused {
			pausedIDs[tmpl.ID] = struct{}{}
		}
	}

	var bills []BillDTO
	occKeys := map[string]struct{}{}
	for _, e := range occurrences {
		if e.IsTemplate || e.Status == StatusSkipped || e.Status == StatusConfirmed {
			continue
		}
		if e.Status != StatusExpected {
			continue
		}
		if e.TemplateID != nil {
			if _, ok := pausedIDs[*e.TemplateID]; ok {
				continue
			}
		}
		due := e.OccurredAt.UTC()
		bills = append(bills, billFromEntry(e, due, now, false))
		if e.TemplateID != nil {
			occKeys[e.TemplateID.String()+"|"+due.Format("2006-01-02")] = struct{}{}
		}
	}
	for _, tmpl := range templates {
		due := now
		if tmpl.NextOccurrenceAt != nil {
			due = tmpl.NextOccurrenceAt.UTC()
		}
		if tmpl.Paused {
			bills = append(bills, billFromEntry(tmpl, due, now, true))
			continue
		}
		if tmpl.NextOccurrenceAt == nil {
			continue
		}
		if due.Before(from) || !due.Before(to) {
			continue
		}
		key := tmpl.ID.String() + "|" + due.Format("2006-01-02")
		if _, dup := occKeys[key]; dup {
			continue
		}
		bills = append(bills, billFromEntry(tmpl, due, now, false))
	}
	sort.Slice(bills, func(i, j int) bool {
		if bills[i].Paused != bills[j].Paused {
			return !bills[i].Paused
		}
		return bills[i].DueAt.Before(bills[j].DueAt)
	})
	return bills, nil
}

func (s *Service) Skip(ctx context.Context, userID, id uuid.UUID) (BillDTO, error) {
	rec, err := s.store.Get(ctx, userID, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return BillDTO{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "entry not found")
		}
		return BillDTO{}, err
	}
	if rec.Paused {
		return BillDTO{}, httpx.E(http.StatusUnprocessableEntity, "PAUSED", "resume this bill before skipping")
	}
	now := s.now().UTC()
	due := rec.OccurredAt.UTC()
	if rec.IsTemplate {
		if rec.NextOccurrenceAt != nil {
			due = rec.NextOccurrenceAt.UTC()
		}
		if rec.Recurrence == nil {
			return BillDTO{}, httpx.E(http.StatusUnprocessableEntity, "VALIDATION", "only repeating bills can be skipped")
		}
		next := skipAdvance(*rec.Recurrence, due)
		rec.NextOccurrenceAt = &next
		rec.UpdatedAt = now
		saved, err := s.store.Update(ctx, rec)
		if err != nil {
			return BillDTO{}, err
		}
		return billFromEntry(saved, next, now, false), nil
	}
	if rec.Status == StatusConfirmed {
		return BillDTO{}, httpx.E(http.StatusUnprocessableEntity, "CONFIRMED", "already recorded")
	}
	if rec.Status == StatusSkipped {
		return billFromEntry(rec, due, now, false), nil
	}
	rec.Status = StatusSkipped
	rec.UpdatedAt = now
	saved, err := s.store.Update(ctx, rec)
	if err != nil {
		return BillDTO{}, err
	}
	if rec.TemplateID != nil {
		tmpl, err := s.store.Get(ctx, userID, *rec.TemplateID)
		if err == nil && tmpl.Recurrence != nil {
			if tmpl.NextOccurrenceAt == nil || !tmpl.NextOccurrenceAt.After(due) {
				next := skipAdvance(*tmpl.Recurrence, due)
				tmpl.NextOccurrenceAt = &next
				tmpl.UpdatedAt = now
				_, _ = s.store.Update(ctx, tmpl)
			}
		}
	}
	return billFromEntry(saved, due, now, false), nil
}

func (s *Service) Postpone(ctx context.Context, userID, id uuid.UUID, days int) (BillDTO, error) {
	if days <= 0 {
		days = 7
	}
	if days > 90 {
		days = 90
	}
	rec, err := s.store.Get(ctx, userID, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return BillDTO{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "entry not found")
		}
		return BillDTO{}, err
	}
	if rec.Paused {
		return BillDTO{}, httpx.E(http.StatusUnprocessableEntity, "PAUSED", "resume this bill before postponing")
	}
	now := s.now().UTC()
	if rec.IsTemplate {
		base := now
		if rec.NextOccurrenceAt != nil {
			base = rec.NextOccurrenceAt.UTC()
		}
		next := base.AddDate(0, 0, days)
		rec.NextOccurrenceAt = &next
		rec.UpdatedAt = now
		saved, err := s.store.Update(ctx, rec)
		if err != nil {
			return BillDTO{}, err
		}
		return billFromEntry(saved, next, now, false), nil
	}
	if rec.Status != StatusExpected {
		return BillDTO{}, httpx.E(http.StatusUnprocessableEntity, "VALIDATION", "only an expected bill can be postponed")
	}
	oldDue := rec.OccurredAt.UTC()
	rec.OccurredAt = oldDue.AddDate(0, 0, days)
	rec.UpdatedAt = now
	saved, err := s.store.Update(ctx, rec)
	if err != nil {
		return BillDTO{}, err
	}
	if rec.TemplateID != nil {
		tmpl, err := s.store.Get(ctx, userID, *rec.TemplateID)
		if err == nil && tmpl.NextOccurrenceAt != nil && sameUTCDay(*tmpl.NextOccurrenceAt, oldDue) {
			next := saved.OccurredAt
			tmpl.NextOccurrenceAt = &next
			tmpl.UpdatedAt = now
			_, _ = s.store.Update(ctx, tmpl)
		}
	}
	return billFromEntry(saved, saved.OccurredAt, now, false), nil
}

func (s *Service) SetPaused(ctx context.Context, userID, id uuid.UUID, paused bool) (BillDTO, error) {
	rec, err := s.store.Get(ctx, userID, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return BillDTO{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "entry not found")
		}
		return BillDTO{}, err
	}
	tmpl := rec
	if !rec.IsTemplate {
		if rec.TemplateID == nil {
			return BillDTO{}, httpx.E(http.StatusUnprocessableEntity, "VALIDATION", "only a repeating bill can be paused")
		}
		tmpl, err = s.store.Get(ctx, userID, *rec.TemplateID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return BillDTO{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "entry not found")
			}
			return BillDTO{}, err
		}
	}
	now := s.now().UTC()
	if !paused && tmpl.Recurrence != nil && tmpl.NextOccurrenceAt != nil && tmpl.NextOccurrenceAt.Before(now) {
		next := nextOccurrence(*tmpl.Recurrence, now, now)
		tmpl.NextOccurrenceAt = &next
	}
	tmpl.Paused = paused
	tmpl.UpdatedAt = now
	saved, err := s.store.Update(ctx, tmpl)
	if err != nil {
		return BillDTO{}, err
	}
	due := now
	if saved.NextOccurrenceAt != nil {
		due = saved.NextOccurrenceAt.UTC()
	}
	return billFromEntry(saved, due, now, paused), nil
}
