package imports

import (
	"encoding/csv"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/shopspring/decimal"
)

// ParsedRow is one statement line ready to post as cashflow.
type ParsedRow struct {
	Date   time.Time
	Amount decimal.Decimal // always positive
	Kind   string          // income | expense
	Title  string
	Raw    string
}

// ParseCSV reads a bank statement CSV with flexible headers.
// Supported amount styles:
//   - signed amount column (negative = expense)
//   - separate debit / credit columns
// Required: a date column. Description/payee/memo optional.
func ParseCSV(r io.Reader) ([]ParsedRow, []string, error) {
	cr := csv.NewReader(r)
	cr.TrimLeadingSpace = true
	cr.FieldsPerRecord = -1
	records, err := cr.ReadAll()
	if err != nil {
		return nil, nil, fmt.Errorf("csv: %w", err)
	}
	if len(records) == 0 {
		return nil, []string{"empty csv"}, nil
	}

	headerIdx := 0
	cols := mapHeaders(records[0])
	if !hasDateCol(cols) && len(records) > 1 {
		// try second row as header (some exports put a title row first)
		cols = mapHeaders(records[1])
		if hasDateCol(cols) {
			headerIdx = 1
		} else {
			cols = mapHeaders(records[0])
			headerIdx = 0
		}
	}
	if !hasDateCol(cols) {
		return nil, []string{"missing date column (date / posted / transaction date)"}, nil
	}
	if cols.amount < 0 && cols.debit < 0 && cols.credit < 0 {
		return nil, []string{"missing amount or debit/credit columns"}, nil
	}

	var out []ParsedRow
	var errs []string
	for i := headerIdx + 1; i < len(records); i++ {
		row := records[i]
		if rowEmpty(row) {
			continue
		}
		line := i + 1
		rawDate := cell(row, cols.date)
		dt, err := parseDate(rawDate)
		if err != nil {
			errs = append(errs, fmt.Sprintf("row %d: bad date %q", line, rawDate))
			continue
		}
		title := firstNonEmpty(
			cell(row, cols.description),
			cell(row, cols.payee),
			cell(row, cols.memo),
			"Imported",
		)
		title = strings.TrimSpace(title)
		if len(title) > 120 {
			title = title[:120]
		}

		var signed decimal.Decimal
		switch {
		case cols.amount >= 0:
			signed, err = parseAmount(cell(row, cols.amount))
			if err != nil {
				errs = append(errs, fmt.Sprintf("row %d: bad amount", line))
				continue
			}
		default:
			debit, dErr := parseAmountOptional(cell(row, cols.debit))
			credit, cErr := parseAmountOptional(cell(row, cols.credit))
			if dErr != nil || cErr != nil {
				errs = append(errs, fmt.Sprintf("row %d: bad debit/credit", line))
				continue
			}
			if !debit.IsZero() && !credit.IsZero() {
				errs = append(errs, fmt.Sprintf("row %d: both debit and credit set", line))
				continue
			}
			if debit.IsZero() && credit.IsZero() {
				continue
			}
			if !debit.IsZero() {
				signed = debit.Neg()
			} else {
				signed = credit
			}
		}
		if signed.IsZero() {
			continue
		}
		kind := "expense"
		amt := signed
		if signed.IsPositive() {
			kind = "income"
		} else {
			amt = signed.Neg()
		}
		out = append(out, ParsedRow{
			Date:   dt,
			Amount: amt,
			Kind:   kind,
			Title:  title,
			Raw:    strings.Join(row, ","),
		})
	}
	return out, errs, nil
}

type colMap struct {
	date, amount, debit, credit, description, payee, memo int
}

func mapHeaders(row []string) colMap {
	m := colMap{date: -1, amount: -1, debit: -1, credit: -1, description: -1, payee: -1, memo: -1}
	for i, h := range row {
		key := normalizeHeader(h)
		switch key {
		case "date", "posted", "posteddate", "transactiondate", "transdate", "valuedate", "bookingdate":
			if m.date < 0 {
				m.date = i
			}
		case "amount", "amt", "value", "transactionamount":
			if m.amount < 0 {
				m.amount = i
			}
		case "debit", "withdrawal", "outflow", "moneyout":
			if m.debit < 0 {
				m.debit = i
			}
		case "credit", "deposit", "inflow", "moneyin":
			if m.credit < 0 {
				m.credit = i
			}
		case "description", "details", "narration", "particulars", "transactiondetails":
			if m.description < 0 {
				m.description = i
			}
		case "payee", "merchant", "name", "counterparty":
			if m.payee < 0 {
				m.payee = i
			}
		case "memo", "note", "reference", "ref":
			if m.memo < 0 {
				m.memo = i
			}
		}
	}
	return m
}

func normalizeHeader(h string) string {
	h = strings.ToLower(strings.TrimSpace(h))
	var b strings.Builder
	for _, r := range h {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func hasDateCol(c colMap) bool { return c.date >= 0 }

func cell(row []string, i int) string {
	if i < 0 || i >= len(row) {
		return ""
	}
	return strings.TrimSpace(row[i])
}

func rowEmpty(row []string) bool {
	for _, c := range row {
		if strings.TrimSpace(c) != "" {
			return false
		}
	}
	return true
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func parseAmount(raw string) (decimal.Decimal, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return decimal.Zero, fmt.Errorf("empty")
	}
	raw = strings.ReplaceAll(raw, ",", "")
	raw = strings.ReplaceAll(raw, " ", "")
	raw = strings.TrimPrefix(raw, "+")
	return decimal.NewFromString(raw)
}

func parseAmountOptional(raw string) (decimal.Decimal, error) {
	if strings.TrimSpace(raw) == "" {
		return decimal.Zero, nil
	}
	return parseAmount(raw)
}

func parseDate(raw string) (time.Time, error) {
	raw = strings.TrimSpace(raw)
	formats := []string{
		"2006-01-02",
		"2006/01/02",
		"02/01/2006",
		"01/02/2006",
		"02-01-2006",
		"01-02-2006",
		"2006-01-02T15:04:05Z",
		"2006-01-02 15:04:05",
		time.RFC3339,
	}
	for _, f := range formats {
		if t, err := time.Parse(f, raw); err == nil {
			return time.Date(t.Year(), t.Month(), t.Day(), 12, 0, 0, 0, time.UTC), nil
		}
	}
	return time.Time{}, fmt.Errorf("unrecognized date")
}
