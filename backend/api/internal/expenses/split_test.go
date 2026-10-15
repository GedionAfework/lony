package expenses

import (
	"testing"

	"github.com/shopspring/decimal"
)

func TestSumSplitLegs(t *testing.T) {
	sum, err := sumSplitLegs([]SplitLegInput{
		{Amount: "40.00"},
		{Amount: "60"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !sum.Equal(decimal.RequireFromString("100.00")) {
		t.Fatalf("sum=%s", sum)
	}
	if _, err := sumSplitLegs([]SplitLegInput{{Amount: "10"}}); err == nil {
		t.Fatal("need two lines")
	}
	if _, err := sumSplitLegs([]SplitLegInput{{Amount: "10"}, {Amount: "0"}}); err == nil {
		t.Fatal("zero line")
	}
}
