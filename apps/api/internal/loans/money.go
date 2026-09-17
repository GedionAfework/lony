package loans

import (
	"time"

	"github.com/shopspring/decimal"
)

const (
	Scale         int32 = 4
	InterestBasis       = "flat_percent"
	MaxNoteLen          = 500
	DueSoonWindow       = 7 * 24 * time.Hour
)

var (
	hundred = decimal.NewFromInt(100)
	zero    = decimal.Zero
)

func ComputeExpected(principal, ratePercent decimal.Decimal) (interest, total decimal.Decimal) {
	interest = principal.Mul(ratePercent).Div(hundred).Round(Scale)
	total = principal.Add(interest)
	return
}

func NormalizeAmount(d decimal.Decimal) decimal.Decimal {
	return d.Round(Scale)
}
