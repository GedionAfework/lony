package expenses

import (
	"testing"
	"time"

	"github.com/shopspring/decimal"
)

func TestHeatLevel(t *testing.T) {
	max := decimal.NewFromInt(100)
	if heatLevel(decimal.Zero, max) != 0 {
		t.Fatal("zero spend")
	}
	if heatLevel(decimal.NewFromInt(10), max) != 1 {
		t.Fatal("low")
	}
	if heatLevel(decimal.NewFromInt(40), max) != 2 {
		t.Fatal("mid")
	}
	if heatLevel(decimal.NewFromInt(70), max) != 3 {
		t.Fatal("high")
	}
	if heatLevel(decimal.NewFromInt(100), max) != 4 {
		t.Fatal("max")
	}
}

func TestCalendarWindowTZ(t *testing.T) {
	now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	from, to, loc, err := calendarWindow("", "", "Africa/Addis_Ababa", now)
	if err != nil {
		t.Fatal(err)
	}
	if loc.String() != "Africa/Addis_Ababa" {
		t.Fatalf("tz=%s", loc)
	}
	if from.Format("2006-01-02") != "2026-10-01" || to.Format("2006-01-02") != "2026-11-01" {
		t.Fatalf("window %v–%v", from, to)
	}
	from, to, _, err = calendarWindow("2026-09-11", "2026-10-11", "Africa/Addis_Ababa", now)
	if err != nil {
		t.Fatal(err)
	}
	if from.Format("2006-01-02") != "2026-09-11" || to.Format("2006-01-02") != "2026-10-11" {
		t.Fatalf("custom window %v–%v", from, to)
	}
}

func TestNormalizeTZ(t *testing.T) {
	if got := normalizeTZ("Africa/Addis_Ababa"); got != "Africa/Addis_Ababa" {
		t.Fatalf("got %s", got)
	}
	if got := normalizeTZ("not a zone; drop table"); got != "UTC" {
		t.Fatalf("invalid: %s", got)
	}
}
