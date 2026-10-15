package expenses

import (
	"context"
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

func parseISODate(raw string) (time.Time, error) {
	raw = strings.TrimSpace(raw)
	t, err := time.Parse("2006-01-02", raw)
	if err != nil {
		return time.Time{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"date": "use YYYY-MM-DD",
		})
	}
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC), nil
}

func tripBounds(starts, ends time.Time) (from, to time.Time) {
	from = starts.UTC()
	to = ends.UTC().AddDate(0, 0, 1)
	return from, to
}

func dateInTrip(day, starts, ends time.Time) bool {
	d := time.Date(day.UTC().Year(), day.UTC().Month(), day.UTC().Day(), 0, 0, 0, 0, time.UTC)
	s := time.Date(starts.UTC().Year(), starts.UTC().Month(), starts.UTC().Day(), 0, 0, 0, 0, time.UTC)
	e := time.Date(ends.UTC().Year(), ends.UTC().Month(), ends.UTC().Day(), 0, 0, 0, 0, time.UTC)
	return !d.Before(s) && !d.After(e)
}

func (s *Service) resolveTripID(ctx context.Context, userID uuid.UUID, kind, currency string, occurred time.Time, explicit *uuid.UUID) (*uuid.UUID, error) {
	if explicit != nil {
		trip, err := s.store.GetTrip(ctx, userID, *explicit)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
					"trip_id": "trip not found",
				})
			}
			return nil, err
		}
		return &trip.ID, nil
	}
	if kind != KindExpense {
		return nil, nil
	}
	rows, err := s.store.ListTrips(ctx, userID)
	if err != nil {
		return nil, err
	}
	var match *uuid.UUID
	for i := range rows {
		row := rows[i]
		if !strings.EqualFold(row.CurrencyCode, currency) {
			continue
		}
		if !dateInTrip(occurred, row.StartsOn, row.EndsOn) {
			continue
		}
		if match != nil {
			return nil, nil
		}
		id := row.ID
		match = &id
	}
	return match, nil
}

func (s *Service) ListTrips(ctx context.Context, userID uuid.UUID) ([]TripDTO, error) {
	rows, err := s.store.ListTrips(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]TripDTO, 0, len(rows))
	now := s.now().UTC()
	for _, row := range rows {
		dto, err := s.tripDTO(ctx, userID, row, now)
		if err != nil {
			return nil, err
		}
		out = append(out, dto)
	}
	return out, nil
}

func (s *Service) CreateTrip(ctx context.Context, userID uuid.UUID, in TripInput) (TripDTO, error) {
	rec, err := s.buildTrip(userID, uuid.Nil, in, time.Time{}, time.Time{})
	if err != nil {
		return TripDTO{}, err
	}
	now := s.now().UTC()
	rec.CreatedAt = now
	rec.UpdatedAt = now
	saved, err := s.store.InsertTrip(ctx, rec)
	if err != nil {
		return TripDTO{}, err
	}
	from, to := tripBounds(saved.StartsOn, saved.EndsOn)
	_ = s.store.AssignTripEntries(ctx, userID, saved.ID, saved.CurrencyCode, from, to)
	return s.tripDTO(ctx, userID, saved, now)
}

func (s *Service) UpdateTrip(ctx context.Context, userID, id uuid.UUID, in TripInput) (TripDTO, error) {
	existing, err := s.store.GetTrip(ctx, userID, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return TripDTO{}, httpx.E(http.StatusNotFound, "NOT_FOUND", "trip not found")
		}
		return TripDTO{}, err
	}
	rec, err := s.buildTrip(userID, id, in, existing.CreatedAt, existing.UpdatedAt)
	if err != nil {
		return TripDTO{}, err
	}
	if strings.TrimSpace(in.Title) == "" {
		rec.Title = existing.Title
	}
	if strings.TrimSpace(in.CurrencyCode) == "" {
		rec.CurrencyCode = existing.CurrencyCode
	}
	if strings.TrimSpace(in.LimitAmount) == "" {
		rec.LimitAmount = existing.LimitAmount
	}
	if strings.TrimSpace(in.StartsOn) == "" {
		rec.StartsOn = existing.StartsOn
	}
	if strings.TrimSpace(in.EndsOn) == "" {
		rec.EndsOn = existing.EndsOn
	}
	if in.Note == nil {
		rec.Note = existing.Note
	}
	if rec.EndsOn.Before(rec.StartsOn) {
		return TripDTO{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"ends_on": "must be on or after the start date",
		})
	}
	rec.UpdatedAt = s.now().UTC()
	saved, err := s.store.UpdateTrip(ctx, rec)
	if err != nil {
		return TripDTO{}, err
	}
	from, to := tripBounds(saved.StartsOn, saved.EndsOn)
	_ = s.store.AssignTripEntries(ctx, userID, saved.ID, saved.CurrencyCode, from, to)
	return s.tripDTO(ctx, userID, saved, rec.UpdatedAt)
}

func (s *Service) DeleteTrip(ctx context.Context, userID, id uuid.UUID) error {
	if err := s.store.DeleteTrip(ctx, userID, id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return httpx.E(http.StatusNotFound, "NOT_FOUND", "trip not found")
		}
		return err
	}
	return nil
}

func (s *Service) buildTrip(userID, id uuid.UUID, in TripInput, created, updated time.Time) (Trip, error) {
	title := strings.TrimSpace(in.Title)
	if title != "" && utf8.RuneCountInString(title) > 80 {
		return Trip{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"title": "max 80 characters",
		})
	}
	if id == uuid.Nil && title == "" {
		return Trip{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"title": "required",
		})
	}
	currency := strings.ToUpper(strings.TrimSpace(in.CurrencyCode))
	if currency != "" && len(currency) != 3 {
		return Trip{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"currency_code": "must be a 3-letter currency code",
		})
	}
	if id == uuid.Nil && len(currency) != 3 {
		return Trip{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"currency_code": "must be a 3-letter currency code",
		})
	}
	var limit decimal.Decimal
	if strings.TrimSpace(in.LimitAmount) != "" {
		amt, err := parsePositive(in.LimitAmount)
		if err != nil {
			return Trip{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"limit_amount": "must be a positive decimal",
			})
		}
		limit = amt
	} else if id == uuid.Nil {
		return Trip{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"limit_amount": "must be a positive decimal",
		})
	}
	var starts, ends time.Time
	if strings.TrimSpace(in.StartsOn) != "" {
		d, err := parseISODate(in.StartsOn)
		if err != nil {
			return Trip{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"starts_on": "use YYYY-MM-DD",
			})
		}
		starts = d
	}
	if strings.TrimSpace(in.EndsOn) != "" {
		d, err := parseISODate(in.EndsOn)
		if err != nil {
			return Trip{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"ends_on": "use YYYY-MM-DD",
			})
		}
		ends = d
	}
	if id == uuid.Nil {
		if starts.IsZero() || ends.IsZero() {
			return Trip{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"starts_on": "start and end dates are required",
			})
		}
		if ends.Before(starts) {
			return Trip{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"ends_on": "must be on or after the start date",
			})
		}
		if ends.After(starts.AddDate(0, 0, 366)) {
			return Trip{}, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"ends_on": "trips can last at most 366 days",
			})
		}
	}
	note, err := cleanNote(in.Note)
	if err != nil {
		return Trip{}, err
	}
	return Trip{
		ID:           id,
		UserID:       userID,
		Title:        title,
		CurrencyCode: currency,
		LimitAmount:  limit,
		StartsOn:     starts,
		EndsOn:       ends,
		Note:         note,
		CreatedAt:    created,
		UpdatedAt:    updated,
	}, nil
}

func (s *Service) tripDTO(ctx context.Context, userID uuid.UUID, rec Trip, now time.Time) (TripDTO, error) {
	spent, err := s.store.TripSpend(ctx, userID, rec.ID)
	if err != nil {
		return TripDTO{}, err
	}
	from, to := tripBounds(rec.StartsOn, rec.EndsOn)
	elapsed, total, left, pacePct := cyclePace(now, from, to)
	remaining := rec.LimitAmount.Sub(spent)
	paceAmt := rec.LimitAmount.Mul(decimal.NewFromInt(int64(pacePct))).Div(decimal.NewFromInt(100))
	pct := spentPctOf(spent, rec.LimitAmount)
	alert := ""
	if pct >= 100 {
		alert = "hit"
	} else if pct >= 80 {
		alert = "80"
	}
	return TripDTO{
		ID:           rec.ID,
		Title:        rec.Title,
		CurrencyCode: rec.CurrencyCode,
		LimitAmount:  rec.LimitAmount.StringFixed(Scale),
		StartsOn:     rec.StartsOn.Format("2006-01-02"),
		EndsOn:       rec.EndsOn.Format("2006-01-02"),
		Note:         rec.Note,
		Spent:        spent.StringFixed(Scale),
		Remaining:    remaining.StringFixed(Scale),
		DaysTotal:    total,
		DaysElapsed:  elapsed,
		DaysLeft:     left,
		PacePct:      pacePct,
		PaceAmount:   paceAmt.StringFixed(Scale),
		SpentPct:     pct,
		Ahead:        spent.GreaterThan(paceAmt) && now.Before(to),
		Alert:        alert,
		CreatedAt:    rec.CreatedAt,
		UpdatedAt:    rec.UpdatedAt,
	}, nil
}
