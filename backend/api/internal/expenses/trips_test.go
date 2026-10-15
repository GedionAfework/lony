package expenses

import (
	"testing"
	"time"
)

func TestParseISODate(t *testing.T) {
	d, err := parseISODate("2026-10-15")
	if err != nil {
		t.Fatal(err)
	}
	if d.Year() != 2026 || d.Month() != time.October || d.Day() != 15 {
		t.Fatalf("got %v", d)
	}
	if _, err := parseISODate("15/10/2026"); err == nil {
		t.Fatal("expected invalid date")
	}
}

func TestTripBounds(t *testing.T) {
	from, to := tripBounds(
		time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC),
		time.Date(2026, 10, 7, 0, 0, 0, 0, time.UTC),
	)
	if !from.Equal(time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("from=%v", from)
	}
	if !to.Equal(time.Date(2026, 10, 8, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("to=%v", to)
	}
	if !dateInTrip(time.Date(2026, 10, 7, 15, 0, 0, 0, time.UTC), from, time.Date(2026, 10, 7, 0, 0, 0, 0, time.UTC)) {
		t.Fatal("end date should be inclusive")
	}
	if dateInTrip(time.Date(2026, 10, 8, 0, 0, 0, 0, time.UTC), from, time.Date(2026, 10, 7, 0, 0, 0, 0, time.UTC)) {
		t.Fatal("day after end should be outside")
	}
}
