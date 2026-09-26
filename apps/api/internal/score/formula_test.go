package score

import (
	"testing"

	"github.com/shopspring/decimal"
)

func TestComputeHealthyUserGetsAOrB(t *testing.T) {
	snap := Compute(Inputs{
		Currency:         "ETB",
		CashOnHand:       decimal.NewFromInt(150000),
		MonthExpense:     decimal.NewFromInt(30000),
		TrailingIncome:   decimal.NewFromInt(120000),
		TrailingExpense:  decimal.NewFromInt(90000),
		OpenPayables:     decimal.NewFromInt(10000),
		ExpectedIncome:   3,
		ConfirmedIncome:  3,
		LoggedDays30:     18,
		ActiveGoals:      1,
		GoalsOnTrack:     1,
		GoalsProgressAvg: 60,
		RepaymentsTotal:  6,
		RepaymentsOK:     6,
		LoanTouches:      4,
	})
	if snap.Grade != GradeA && snap.Grade != GradeB {
		t.Fatalf("expected A or B for healthy user, got %s (points %.1f)", snap.Grade, snap.Points)
	}
	if snap.ThinHistory {
		t.Fatal("expected thin_history=false")
	}
}

func TestComputeStressedUserGetsDOrE(t *testing.T) {
	snap := Compute(Inputs{
		Currency:          "ETB",
		CashOnHand:        decimal.Zero,
		MonthExpense:      decimal.NewFromInt(40000),
		TrailingIncome:    decimal.NewFromInt(60000),
		TrailingExpense:   decimal.NewFromInt(90000),
		OpenPayables:      decimal.NewFromInt(200000),
		OverdueLoanCount:  2,
		ActiveBorrowCount: 3,
		ExpectedIncome:    3,
		ConfirmedIncome:   0,
		LoggedDays30:      2,
		ActiveGoals:       0,
		RepaymentsTotal:   5,
		RepaymentsOK:      1,
		LoanTouches:       5,
	})
	if snap.Grade != GradeD && snap.Grade != GradeE {
		t.Fatalf("expected D or E for stressed user, got %s (points %.1f)", snap.Grade, snap.Points)
	}
}

func TestThinHistoryCapsAtB(t *testing.T) {
	snap := Compute(Inputs{
		Currency:         "ETB",
		CashOnHand:       decimal.NewFromInt(200000),
		MonthExpense:     decimal.NewFromInt(20000),
		TrailingIncome:   decimal.NewFromInt(100000),
		TrailingExpense:  decimal.NewFromInt(50000),
		RepaymentsTotal:  0,
		LoanTouches:      0,
		ExpectedIncome:   2,
		ConfirmedIncome:  2,
		LoggedDays30:     20,
	})
	if snap.Grade == GradeA {
		t.Fatal("thin history must not receive A")
	}
	if !snap.ThinHistory {
		t.Fatal("expected thin_history")
	}
}

func TestGradeFromPoints(t *testing.T) {
	cases := []struct {
		pts float64
		g   string
	}{
		{90, GradeA}, {85, GradeA}, {70, GradeB}, {55, GradeC}, {40, GradeD}, {10, GradeE},
	}
	for _, c := range cases {
		if got := gradeFromPoints(c.pts); got != c.g {
			t.Fatalf("points %.0f: want %s got %s", c.pts, c.g, got)
		}
	}
}
