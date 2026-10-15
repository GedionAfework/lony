package expenses

import (
	"testing"
	"time"
)

func TestPaydayWindow(t *testing.T) {
	now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	from, to := paydayWindow(now, 25)
	wantFrom := time.Date(2026, 9, 25, 0, 0, 0, 0, time.UTC)
	wantTo := time.Date(2026, 10, 25, 0, 0, 0, 0, time.UTC)
	if !from.Equal(wantFrom) || !to.Equal(wantTo) {
		t.Fatalf("before payday: got %v–%v want %v–%v", from, to, wantFrom, wantTo)
	}
	now = time.Date(2026, 10, 25, 8, 0, 0, 0, time.UTC)
	from, to = paydayWindow(now, 25)
	wantFrom = time.Date(2026, 10, 25, 0, 0, 0, 0, time.UTC)
	wantTo = time.Date(2026, 11, 25, 0, 0, 0, 0, time.UTC)
	if !from.Equal(wantFrom) || !to.Equal(wantTo) {
		t.Fatalf("on payday: got %v–%v want %v–%v", from, to, wantFrom, wantTo)
	}
}

func TestCyclePace(t *testing.T) {
	from := time.Date(2026, 9, 25, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 10, 25, 0, 0, 0, 0, time.UTC)
	now := time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC)
	elapsed, total, left, pct := cyclePace(now, from, to)
	if total != 30 {
		t.Fatalf("total=%d want 30", total)
	}
	if elapsed != 15 {
		t.Fatalf("elapsed=%d want 15", elapsed)
	}
	if left != 15 {
		t.Fatalf("left=%d want 15", left)
	}
	if pct != 50 {
		t.Fatalf("pace=%d want 50", pct)
	}
}
