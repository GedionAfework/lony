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

// ComputeEMI returns a reducing-balance monthly payment for annualRatePercent over n months.
// When rate is zero, EMI is principal / n.
func ComputeEMI(principal, annualRatePercent decimal.Decimal, months int) decimal.Decimal {
	if months <= 0 {
		return principal
	}
	n := decimal.NewFromInt(int64(months))
	if annualRatePercent.LessThanOrEqual(zero) {
		return principal.Div(n).Round(Scale)
	}
	r := annualRatePercent.Div(hundred).Div(decimal.NewFromInt(12))
	one := decimal.NewFromInt(1)
	pow := one.Add(r).Pow(n)
	num := principal.Mul(r).Mul(pow)
	den := pow.Sub(one)
	if den.Equal(zero) {
		return principal.Div(n).Round(Scale)
	}
	return num.Div(den).Round(Scale)
}

// BuildInstallmentSchedule builds monthly dues starting one month after start (or on start if firstDueOnStart).
func BuildInstallmentSchedule(principal, annualRatePercent, emi decimal.Decimal, months int, start time.Time) []InstallmentPlan {
	out := make([]InstallmentPlan, 0, months)
	balance := principal
	r := annualRatePercent.Div(hundred).Div(decimal.NewFromInt(12))
	due := start.UTC()
	for i := 1; i <= months; i++ {
		due = due.AddDate(0, 1, 0)
		interestPart := balance.Mul(r).Round(Scale)
		principalPart := emi.Sub(interestPart).Round(Scale)
		if i == months || principalPart.GreaterThan(balance) {
			principalPart = balance
			emi = principalPart.Add(interestPart).Round(Scale)
		}
		if principalPart.IsNegative() {
			principalPart = zero
		}
		out = append(out, InstallmentPlan{
			Sequence:         i,
			DueAt:            due,
			Amount:           emi,
			PrincipalPortion: principalPart,
			InterestPortion:  interestPart,
		})
		balance = balance.Sub(principalPart).Round(Scale)
		if balance.IsNegative() || balance.Equal(zero) {
			balance = zero
		}
	}
	return out
}

type InstallmentPlan struct {
	Sequence         int
	DueAt            time.Time
	Amount           decimal.Decimal
	PrincipalPortion decimal.Decimal
	InterestPortion  decimal.Decimal
}

func NormalizeAmount(d decimal.Decimal) decimal.Decimal {
	return d.Round(Scale)
}
