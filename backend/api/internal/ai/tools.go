package ai

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
)

// MetricTool names for server-side feature gathering (never exposed as free SQL).
const (
	ToolOverview       = "get_overview"
	ToolCategorySpend  = "get_category_spend"
	ToolCashflowSeries = "get_cashflow_series"
	ToolGoals          = "get_goals"
	ToolDebts          = "get_debts"
	ToolScore          = "get_score_components"
)

// RunMetricTool executes one sanitized metric tool for the authenticated user.
func (s *Service) RunMetricTool(ctx context.Context, userID uuid.UUID, name, currency string) (json.RawMessage, error) {
	currency = normalizeCurrency(currency)
	snap, err := s.BuildFeatureSnapshot(ctx, userID, currency)
	if err != nil {
		return nil, err
	}
	var payload any
	switch name {
	case ToolOverview:
		payload = snap.Overview
	case ToolCategorySpend:
		payload = snap.Categories
	case ToolCashflowSeries:
		payload = snap.Series
	case ToolGoals:
		payload = snap.Goals
	case ToolDebts:
		payload = snap.Debts
	case ToolScore:
		payload = snap.Score
	default:
		return nil, fmt.Errorf("unknown tool %q", name)
	}
	return json.Marshal(payload)
}

func normalizeCurrency(c string) string {
	if len(c) == 3 {
		return c
	}
	return "USD"
}
