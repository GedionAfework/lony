package expenses

import "testing"

// Same message shapes as mobile/src/smsClassify.test.ts.
func TestSMSNotATransfer(t *testing.T) {
	real := []string{
		"Dear Abebe your Account 1*****1234 has been debited with ETB 500.00. Your Current Balance is ETB 9,500.00 Thank you for Banking with CBE! https://apps.cbe.com.et:100/?id=FT12345",
		"Dear Abebe You have received ETB 1,000.00 from Sara(2519****1234) on 30/10/2026 09:00:00. Your current balance is ETB 2,000.00.",
		"Dear Abebe You have paid ETB 50.00 for airtime recharge on 30/10/2026. Your telebirr balance is ETB 950.00.",
		"QAB12CD34E Confirmed. Ksh1,200.00 sent to JANE DOE 0712345678 on 30/10/26 at 10:00 AM. New M-PESA balance is Ksh3,400.00.",
		"Dear Abebe ETB 500.00 has been reversed and credited to your account 1*****1234.",
	}
	for _, msg := range real {
		if why := SMSNotATransfer(msg); why != "" {
			t.Errorf("real transfer rejected (%s): %s", why, msg)
		}
	}
	never := map[string]string{
		"Your one-time password is 482910. Do not share this code with anyone.":                                   "security code",
		"Dear Abebe your transfer of ETB 500.00 to Sara failed due to insufficient balance.":                       "failed or declined",
		"Sara has requested ETB 200.00 from you. Open telebirr to approve this payment request.":                   "request or reminder, no money moved",
		"Dear customer, your airtime balance is ETB 12.50 and data balance is 250 MB. Dial *804# to buy a package.": "airtime or data notice",
		"Pay with telebirr and win up to ETB 1,000,000! Get 5% cashback. Offer ends soon.":                         "promotion",
	}
	for msg, want := range never {
		if got := SMSNotATransfer(msg); got != want {
			t.Errorf("%q: got %q, want %q", msg, got, want)
		}
	}
}
