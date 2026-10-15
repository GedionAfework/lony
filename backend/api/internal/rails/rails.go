package rails

// Rail describes a money-transfer or storage destination users can save and share.
type Rail struct {
	Code         string   `json:"code"`
	Label        string   `json:"label"`
	ProfileType  string   `json:"profile_type"`
	Category     string   `json:"category"`
	Countries    []string `json:"countries"` // empty = global / multi-country
	IdentifierHint string `json:"identifier_hint"`
	CurrencyHint string   `json:"currency_hint,omitempty"`
}

// Catalog is a practical cross-border set of common rails (not exhaustive KYC/licensed coverage).
var Catalog = []Rail{
	{Code: "bank_local", Label: "Local bank account", ProfileType: "bank_account", Category: "bank", IdentifierHint: "Account number"},
	{Code: "iban", Label: "IBAN", ProfileType: "iban", Category: "bank", Countries: []string{"AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO", "CH", "GB", "AE", "SA", "QA", "KW", "BH", "JO", "PS", "IL", "TR", "PK", "BR", "CR", "DO", "GT", "HN", "SV", "NI", "VG", "KZ", "GE", "MD", "UA", "AL", "ME", "MK", "RS", "XK", "BA", "AD", "MC", "SM", "VA"}, IdentifierHint: "IBAN"},
	{Code: "sepa", Label: "SEPA transfer", ProfileType: "sepa", Category: "bank", Countries: []string{"AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"}, IdentifierHint: "IBAN"},
	{Code: "swift", Label: "SWIFT / BIC + account", ProfileType: "swift", Category: "bank", IdentifierHint: "Account or IBAN + BIC"},
	{Code: "ach", Label: "ACH / routing + account", ProfileType: "bank_account", Category: "bank", Countries: []string{"US"}, IdentifierHint: "Routing and account number", CurrencyHint: "USD"},
	{Code: "uk_sort", Label: "UK sort code + account", ProfileType: "bank_account", Category: "bank", Countries: []string{"GB"}, IdentifierHint: "Sort code and account number", CurrencyHint: "GBP"},
	{Code: "cbe", Label: "Commercial Bank of Ethiopia", ProfileType: "bank_account", Category: "bank", Countries: []string{"ET"}, IdentifierHint: "CBE account number", CurrencyHint: "ETB"},
	{Code: "telebirr", Label: "telebirr", ProfileType: "mobile_money", Category: "mobile_money", Countries: []string{"ET"}, IdentifierHint: "Phone number", CurrencyHint: "ETB"},
	{Code: "cbe_birr", Label: "CBE Birr", ProfileType: "mobile_money", Category: "mobile_money", Countries: []string{"ET"}, IdentifierHint: "Phone or wallet ID", CurrencyHint: "ETB"},
	{Code: "mpesa_ke", Label: "M-Pesa (Kenya)", ProfileType: "mobile_money", Category: "mobile_money", Countries: []string{"KE"}, IdentifierHint: "Phone number", CurrencyHint: "KES"},
	{Code: "mpesa_tz", Label: "M-Pesa (Tanzania)", ProfileType: "mobile_money", Category: "mobile_money", Countries: []string{"TZ"}, IdentifierHint: "Phone number", CurrencyHint: "TZS"},
	{Code: "mtn_momo", Label: "MTN MoMo", ProfileType: "mobile_money", Category: "mobile_money", Countries: []string{"GH", "UG", "RW", "ZM", "CI", "CM", "BJ", "CG", "GA", "GN", "LR", "SZ", "ZA"}, IdentifierHint: "Phone number"},
	{Code: "airtel_money", Label: "Airtel Money", ProfileType: "mobile_money", Category: "mobile_money", Countries: []string{"KE", "UG", "TZ", "RW", "ZM", "MW", "NG", "TD", "CG", "GA", "NE", "MG"}, IdentifierHint: "Phone number"},
	{Code: "orange_money", Label: "Orange Money", ProfileType: "mobile_money", Category: "mobile_money", Countries: []string{"CI", "SN", "ML", "BF", "GN", "CM", "MG", "CD", "BJ", "NE"}, IdentifierHint: "Phone number"},
	{Code: "wave", Label: "Wave", ProfileType: "mobile_money", Category: "mobile_money", Countries: []string{"SN", "CI", "ML", "BF", "GM"}, IdentifierHint: "Phone number"},
	{Code: "gcash", Label: "GCash", ProfileType: "mobile_money", Category: "mobile_money", Countries: []string{"PH"}, IdentifierHint: "Mobile number", CurrencyHint: "PHP"},
	{Code: "paymaya", Label: "Maya / PayMaya", ProfileType: "mobile_money", Category: "mobile_money", Countries: []string{"PH"}, IdentifierHint: "Mobile number", CurrencyHint: "PHP"},
	{Code: "easypaisa", Label: "Easypaisa", ProfileType: "mobile_money", Category: "mobile_money", Countries: []string{"PK"}, IdentifierHint: "Mobile account", CurrencyHint: "PKR"},
	{Code: "jazzcash", Label: "JazzCash", ProfileType: "mobile_money", Category: "mobile_money", Countries: []string{"PK"}, IdentifierHint: "Mobile account", CurrencyHint: "PKR"},
	{Code: "bKash", Label: "bKash", ProfileType: "mobile_money", Category: "mobile_money", Countries: []string{"BD"}, IdentifierHint: "Wallet number", CurrencyHint: "BDT"},
	{Code: "nagad", Label: "Nagad", ProfileType: "mobile_money", Category: "mobile_money", Countries: []string{"BD"}, IdentifierHint: "Wallet number", CurrencyHint: "BDT"},
	{Code: "alipay", Label: "Alipay", ProfileType: "mobile_wallet", Category: "mobile_money", Countries: []string{"CN", "HK"}, IdentifierHint: "Account ID or phone"},
	{Code: "wechat_pay", Label: "WeChat Pay", ProfileType: "mobile_wallet", Category: "mobile_money", Countries: []string{"CN", "HK"}, IdentifierHint: "WeChat ID or phone"},
	{Code: "upi", Label: "UPI (India)", ProfileType: "upi", Category: "instant", Countries: []string{"IN"}, IdentifierHint: "UPI ID (name@bank)", CurrencyHint: "INR"},
	{Code: "pix", Label: "Pix (Brazil)", ProfileType: "pix", Category: "instant", Countries: []string{"BR"}, IdentifierHint: "Pix key", CurrencyHint: "BRL"},
	{Code: "paypal", Label: "PayPal", ProfileType: "paypal", Category: "wallet", IdentifierHint: "Email or PayPal.Me link"},
	{Code: "wise", Label: "Wise", ProfileType: "wise", Category: "wallet", IdentifierHint: "Email or account details"},
	{Code: "revolut", Label: "Revolut", ProfileType: "other", Category: "wallet", IdentifierHint: "Revtag or account details"},
	{Code: "skrill", Label: "Skrill", ProfileType: "other", Category: "wallet", IdentifierHint: "Email"},
	{Code: "neteller", Label: "Neteller", ProfileType: "other", Category: "wallet", IdentifierHint: "Email or account ID"},
	{Code: "payoneer", Label: "Payoneer", ProfileType: "other", Category: "wallet", IdentifierHint: "Email or account ID"},
	{Code: "western_union", Label: "Western Union receive details", ProfileType: "other", Category: "remittance", IdentifierHint: "Name + pickup instructions"},
	{Code: "moneygram", Label: "MoneyGram receive details", ProfileType: "other", Category: "remittance", IdentifierHint: "Name + pickup instructions"},
	{Code: "ria", Label: "Ria receive details", ProfileType: "other", Category: "remittance", IdentifierHint: "Name + pickup instructions"},
	{Code: "worldremit", Label: "WorldRemit / Sendwave", ProfileType: "other", Category: "remittance", IdentifierHint: "Phone or account details"},
	{Code: "remitly", Label: "Remitly", ProfileType: "other", Category: "remittance", IdentifierHint: "Phone or bank details"},
	{Code: "dahabshiil", Label: "Dahabshiil", ProfileType: "other", Category: "remittance", Countries: []string{"SO", "ET", "DJ", "KE", "GB", "US", "AE"}, IdentifierHint: "Agent / account reference"},
	{Code: "venmo", Label: "Venmo", ProfileType: "venmo", Category: "wallet", Countries: []string{"US"}, IdentifierHint: "Venmo username", CurrencyHint: "USD"},
	{Code: "cash_app", Label: "Cash App", ProfileType: "cash_app", Category: "wallet", Countries: []string{"US", "GB"}, IdentifierHint: "$Cashtag"},
	{Code: "zelle", Label: "Zelle", ProfileType: "other", Category: "wallet", Countries: []string{"US"}, IdentifierHint: "Email or phone", CurrencyHint: "USD"},
	{Code: "interac", Label: "Interac e-Transfer", ProfileType: "other", Category: "bank", Countries: []string{"CA"}, IdentifierHint: "Email or phone", CurrencyHint: "CAD"},
	{Code: "chime", Label: "Chime", ProfileType: "other", Category: "wallet", Countries: []string{"US"}, IdentifierHint: "Account details", CurrencyHint: "USD"},
	{Code: "stripe", Label: "Stripe payout / link", ProfileType: "other", Category: "wallet", IdentifierHint: "Email or payout ID"},
	{Code: "awash", Label: "Awash Bank", ProfileType: "bank_account", Category: "bank", Countries: []string{"ET"}, IdentifierHint: "Account number", CurrencyHint: "ETB"},
	{Code: "dashen", Label: "Dashen Bank", ProfileType: "bank_account", Category: "bank", Countries: []string{"ET"}, IdentifierHint: "Account number", CurrencyHint: "ETB"},
	{Code: "boa_et", Label: "Bank of Abyssinia", ProfileType: "bank_account", Category: "bank", Countries: []string{"ET"}, IdentifierHint: "Account number", CurrencyHint: "ETB"},
	{Code: "coop_et", Label: "Coop Bank of Oromia", ProfileType: "bank_account", Category: "bank", Countries: []string{"ET"}, IdentifierHint: "Account number", CurrencyHint: "ETB"},
	{Code: "emirates_nbd", Label: "Emirates NBD", ProfileType: "bank_account", Category: "bank", Countries: []string{"AE"}, IdentifierHint: "IBAN / account", CurrencyHint: "AED"},
	{Code: "fab", Label: "First Abu Dhabi Bank", ProfileType: "bank_account", Category: "bank", Countries: []string{"AE"}, IdentifierHint: "IBAN / account", CurrencyHint: "AED"},
	{Code: "enbd_ksa", Label: "Saudi bank account (IBAN)", ProfileType: "iban", Category: "bank", Countries: []string{"SA"}, IdentifierHint: "SA IBAN", CurrencyHint: "SAR"},
	{Code: "m_pesa_global", Label: "M-Pesa (other markets)", ProfileType: "mobile_money", Category: "mobile_money", Countries: []string{"KE", "TZ", "GH", "EG", "LS", "MZ", "CD"}, IdentifierHint: "Phone number"},
	{Code: "vodafone_cash", Label: "Vodafone Cash", ProfileType: "mobile_money", Category: "mobile_money", Countries: []string{"EG", "GH"}, IdentifierHint: "Phone number"},
	{Code: "chime_debit", Label: "Debit card receive (label only)", ProfileType: "card", Category: "card", IdentifierHint: "Last 4 + bank name — never full PAN"},
	{Code: "btc", Label: "Bitcoin", ProfileType: "crypto_wallet", Category: "crypto", IdentifierHint: "BTC address"},
	{Code: "eth", Label: "Ethereum / EVM", ProfileType: "crypto_wallet", Category: "crypto", IdentifierHint: "0x address"},
	{Code: "usdt_trc20", Label: "USDT (TRC-20)", ProfileType: "crypto_wallet", Category: "crypto", IdentifierHint: "TRON address"},
	{Code: "usdt_erc20", Label: "USDT (ERC-20)", ProfileType: "crypto_wallet", Category: "crypto", IdentifierHint: "0x address"},
	{Code: "usdc", Label: "USDC", ProfileType: "crypto_wallet", Category: "crypto", IdentifierHint: "Wallet address"},
	{Code: "sol", Label: "Solana", ProfileType: "crypto_wallet", Category: "crypto", IdentifierHint: "SOL address"},
	{Code: "card_receive", Label: "Card payout details", ProfileType: "card", Category: "card", IdentifierHint: "Last 4 and issuer label only — never full PAN in chat"},
	{Code: "other", Label: "Other", ProfileType: "other", Category: "other", IdentifierHint: "Identifier your counterparty understands"},
}

// ForCountry returns global rails plus country-specific ones.
func ForCountry(country string) []Rail {
	country = normalizeCountry(country)
	out := make([]Rail, 0, len(Catalog))
	for _, r := range Catalog {
		if len(r.Countries) == 0 {
			out = append(out, r)
			continue
		}
		if country == "" {
			out = append(out, r)
			continue
		}
		for _, c := range r.Countries {
			if c == country {
				out = append(out, r)
				break
			}
		}
	}
	return out
}

func normalizeCountry(c string) string {
	if len(c) != 2 {
		return ""
	}
	b0, b1 := c[0], c[1]
	if b0 >= 'a' && b0 <= 'z' {
		b0 -= 32
	}
	if b1 >= 'a' && b1 <= 'z' {
		b1 -= 32
	}
	return string([]byte{b0, b1})
}

// ValidProfileType reports whether a bank_profiles.profile_type value is allowed.
func ValidProfileType(t string) bool {
	switch t {
	case "bank_account", "iban", "mobile_money", "mobile_wallet", "crypto_wallet", "card",
		"paypal", "wise", "cash_app", "venmo", "upi", "pix", "sepa", "swift", "other":
		return true
	default:
		return false
	}
}
