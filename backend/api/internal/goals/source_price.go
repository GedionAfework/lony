package goals

import (
	"context"
	"strings"
	"time"

	"equilend/api/internal/fx"

	"github.com/shopspring/decimal"
)

// RateSource gives exchange rates against a base currency (the fx client).
type RateSource interface {
	Rates(ctx context.Context, base string) (map[string]decimal.Decimal, time.Time, error)
}

func (s *Service) SetFX(r RateSource) {
	s.fx = r
}

// convert turns amount in `from` into `to`. ok is false when no rate is available, so the
// caller can keep the original figure instead of guessing.
func (s *Service) convert(ctx context.Context, amount decimal.Decimal, from, to string) (decimal.Decimal, bool) {
	from, to = strings.ToUpper(strings.TrimSpace(from)), strings.ToUpper(strings.TrimSpace(to))
	if from == "" || to == "" || from == to {
		return amount, from == to && from != ""
	}
	if s.fx == nil {
		return decimal.Zero, false
	}
	rctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	rates, _, err := s.fx.Rates(rctx, to)
	if err != nil || rates == nil {
		return decimal.Zero, false
	}
	v, err := fx.Convert(amount, from, to, rates)
	if err != nil {
		return decimal.Zero, false
	}
	return v.Round(2), true
}

// listingCurrency is the currency the tracked listing is priced in.
func listingCurrency(rec Goal) string {
	if rec.SourceCurrency != nil && strings.TrimSpace(*rec.SourceCurrency) != "" {
		return strings.ToUpper(*rec.SourceCurrency)
	}
	return rec.CurrencyCode
}
