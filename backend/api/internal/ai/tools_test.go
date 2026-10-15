package ai

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestFeatureSnapshotOmitsRawIdentifiers(t *testing.T) {
	snap := FeatureSnapshot{
		Currency: "ETB",
		Overview: map[string]any{"income": "1000", "expense": "400"},
		Debts:    map[string]any{"payables": "50", "receivables": "0"},
		Goals:    []map[string]any{{"title": "Emergency", "progress_percent": 20.0}},
	}
	raw, err := json.Marshal(snap)
	if err != nil {
		t.Fatal(err)
	}
	s := string(raw)
	for _, bad := range []string{"account_number", "iban", "payment_id", "statement", "routing"} {
		if strings.Contains(strings.ToLower(s), bad) {
			t.Fatalf("snapshot should not contain %q: %s", bad, s)
		}
	}
}

func TestMetricToolNames(t *testing.T) {
	names := []string{ToolOverview, ToolCategorySpend, ToolCashflowSeries, ToolGoals, ToolDebts, ToolScore}
	if len(names) != 6 {
		t.Fatalf("expected 6 tools, got %d", len(names))
	}
}
