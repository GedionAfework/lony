package ai

import (
	"testing"

	"equilend/api/internal/expenses"
)

func TestDecodeLoose_ModelTypeMixups(t *testing.T) {
	var r expenses.ReceiptExtract
	raw := `{"kind":"expense","title":"Shoa Supermarket","amount":1250.5,"currency_code":"ETB","merchant":null,"confidence":"0.9","note":{"x":1}}`
	if !decodeLoose(raw, &r, "confidence") {
		t.Fatal("decode failed")
	}
	if r.Amount != "1250.5" || r.Title != "Shoa Supermarket" || r.Confidence != 0.9 || r.CurrencyCode != "ETB" {
		t.Fatalf("got %+v", r)
	}

	var v expenses.VoiceExtract
	if !decodeLoose(`{"kind":"income","amount":3000,"title":"Salary","confidence":"85%"}`, &v, "confidence") {
		t.Fatal("voice decode failed")
	}
	if v.Amount != "3000" || v.Kind != "income" || v.Confidence != 0.85 {
		t.Fatalf("got %+v", v)
	}

	if decodeLoose(`not json`, &v) {
		t.Fatal("garbage decoded")
	}
}

func TestNormalizeAmount(t *testing.T) {
	cases := map[string]string{
		"12.5":         "12.50",
		"$12.50":       "12.50",
		"ETB 1,250.00": "1250.00",
		"Br 3,500":     "3500.00",
		"12,50 €":      "12.50",
		"1.234,56":     "1234.56",
		"1 250":        "1250.00",
		"USD 99.":      "99.00",
		"0":            "",
		"":             "",
		"n/a":          "",
	}
	for in, want := range cases {
		if got := normalizeAmount(in); got != want {
			t.Errorf("normalizeAmount(%q) = %q, want %q", in, got, want)
		}
	}
}
