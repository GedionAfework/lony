package expenses

import "testing"

func TestParseTransferSMS_CBEOut(t *testing.T) {
	raw := "Dear Customer, You have transfered ETB 250.00 to BETELHEM FKADU on 29/01/2024 14:30:00. Your account 1*********9388 balance is ETB 10,000.00. Thank you for banking with CBE!"
	p := ParseTransferSMS(raw)
	if p.Kind != KindExpense {
		t.Fatalf("kind=%q want expense", p.Kind)
	}
	if p.Amount != "250.00" {
		t.Fatalf("amount=%q want 250.00 (not balance)", p.Amount)
	}
	if p.AccountLast4 != "9388" {
		t.Fatalf("account_last4=%q want 9388", p.AccountLast4)
	}
	if p.Counterparty == "" {
		t.Fatalf("expected counterparty")
	}
	if p.SummaryTitle == "" || p.SummaryTitle[0:2] != "To" {
		t.Fatalf("summary=%q", p.SummaryTitle)
	}
	if p.StatedBalance != "10000.00" {
		t.Fatalf("stated=%q want 10000.00", p.StatedBalance)
	}
}

func TestParseTransferSMS_TelebirrIn(t *testing.T) {
	raw := "You have received ETB 1,000.00 from JOHN DOE (2519****1234) on 12/01/2024. Your current e-money account balance is ETB 5,000.00. Thank you for using telebirr."
	p := ParseTransferSMS(raw)
	if p.Kind != KindIncome {
		t.Fatalf("kind=%q want income", p.Kind)
	}
	if p.Amount != "1000.00" {
		t.Fatalf("amount=%q want 1000.00", p.Amount)
	}
	if p.Counterparty == "" {
		t.Fatalf("expected counterparty, got empty")
	}
	if p.StatedBalance != "5000.00" {
		t.Fatalf("stated=%q want 5000.00", p.StatedBalance)
	}
}

func TestParseTransferSMS_TelebirrPhoneOnly(t *testing.T) {
	raw := "You have received ETB 1,500.00 from +251912345678. Ref: AB12CD34EF. Your current e-money balance is ETB 3,000.00"
	p := ParseTransferSMS(raw)
	if p.Kind != KindIncome {
		t.Fatalf("kind=%q want income", p.Kind)
	}
	if p.Amount != "1500.00" {
		t.Fatalf("amount=%q want 1500.00 (not balance)", p.Amount)
	}
	if p.Counterparty == "" {
		t.Fatalf("expected phone counterparty")
	}
	if p.StatedBalance != "3000.00" {
		t.Fatalf("stated=%q want 3000.00", p.StatedBalance)
	}
}

func TestIsTransferSMS_RejectsOTP(t *testing.T) {
	if IsTransferSMS("Your OTP is 123456. Do not share.") {
		t.Fatal("OTP should be rejected")
	}
}

func TestParseTransferSMS_USChaseCard(t *testing.T) {
	raw := "Chase Alert: You made a $32.10 purchase at AMAZON. Card ending in 1234. Avail Bal: $5,432.10"
	p := ParseTransferSMS(raw)
	if p.Kind != KindExpense {
		t.Fatalf("kind=%q want expense", p.Kind)
	}
	if p.Amount != "32.10" {
		t.Fatalf("amount=%q want 32.10 (not balance)", p.Amount)
	}
	if p.AccountLast4 != "1234" {
		t.Fatalf("account_last4=%q want 1234", p.AccountLast4)
	}
	if p.CurrencyCode != "USD" {
		t.Fatalf("currency=%q want USD", p.CurrencyCode)
	}
	if p.StatedBalance != "5432.10" {
		t.Fatalf("stated=%q want 5432.10", p.StatedBalance)
	}
}

func TestParseTransferSMS_OwnAccountNotReceiver(t *testing.T) {
	// Receiver masked number appears first; own account is after "Your account".
	raw := "You have transfered ETB 3000.00 to BETELHEM FKADU Account 1*********9214 on 29/01/2024. Your account 1*********1815 balance is ETB 10,000.00. Thank you for banking with CBE!"
	p := ParseTransferSMS(raw)
	if p.AccountLast4 != "1815" {
		t.Fatalf("account_last4=%q want 1815 (own), not receiver", p.AccountLast4)
	}
}
