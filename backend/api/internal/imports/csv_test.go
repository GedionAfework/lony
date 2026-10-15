package imports

import (
	"strings"
	"testing"
)

func TestParseCSVSignedAmount(t *testing.T) {
	csv := `Date,Amount,Description
2026-01-05,-12.50,Coffee
2026-01-06,1000.00,Salary
2026-01-07,0,Skip zero
`
	rows, errs, err := ParseCSV(strings.NewReader(csv))
	if err != nil {
		t.Fatal(err)
	}
	if len(errs) != 0 {
		t.Fatalf("unexpected errs: %v", errs)
	}
	if len(rows) != 2 {
		t.Fatalf("got %d rows", len(rows))
	}
	if rows[0].Kind != "expense" || rows[0].Amount.StringFixed(2) != "12.50" || rows[0].Title != "Coffee" {
		t.Fatalf("row0 %+v", rows[0])
	}
	if rows[1].Kind != "income" || rows[1].Amount.StringFixed(2) != "1000.00" {
		t.Fatalf("row1 %+v", rows[1])
	}
}

func TestParseCSVDebitCredit(t *testing.T) {
	csv := `Transaction Date,Debit,Credit,Payee
02/01/2026,40.00,,Shop
03/01/2026,,250.00,Transfer In
`
	rows, errs, err := ParseCSV(strings.NewReader(csv))
	if err != nil {
		t.Fatal(err)
	}
	if len(errs) != 0 {
		t.Fatalf("errs %v", errs)
	}
	if len(rows) != 2 {
		t.Fatalf("got %d", len(rows))
	}
	if rows[0].Kind != "expense" || rows[0].Title != "Shop" {
		t.Fatalf("%+v", rows[0])
	}
	if rows[1].Kind != "income" {
		t.Fatalf("%+v", rows[1])
	}
}

func TestFingerprintStable(t *testing.T) {
	csv := `date,amount,description
2026-03-01,-5.00,Tea
`
	rows, _, err := ParseCSV(strings.NewReader(csv))
	if err != nil || len(rows) != 1 {
		t.Fatal(err, rows)
	}
	a := fingerprint(rows[0])
	b := fingerprint(rows[0])
	if a == "" || a != b {
		t.Fatalf("fp %q vs %q", a, b)
	}
}

func TestParseCSVMissingColumns(t *testing.T) {
	rows, errs, err := ParseCSV(strings.NewReader("foo,bar\n1,2\n"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 0 || len(errs) == 0 {
		t.Fatalf("expected column error, got rows=%d errs=%v", len(rows), errs)
	}
}
