package expenses

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// The phone and the server must use the same wording table.
func TestSMSPhrasesMatchMobile(t *testing.T) {
	src, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "mobile", "src", "smsPhrases.ts"))
	if err != nil {
		t.Skip("mobile app not next to the API (split repos): compare sms_phrases.json by hand")
	}
	start := bytes.Index(src, []byte("/* PHRASES-JSON-START */"))
	end := bytes.Index(src, []byte("/* PHRASES-JSON-END */"))
	if start < 0 || end < start {
		t.Fatal("markers missing in smsPhrases.ts")
	}
	var mobile, server any
	if err := json.Unmarshal(src[start+len("/* PHRASES-JSON-START */"):end], &mobile); err != nil {
		t.Fatalf("mobile table is not valid JSON: %v", err)
	}
	if err := json.Unmarshal(smsPhrasesJSON, &server); err != nil {
		t.Fatal(err)
	}
	a, _ := json.Marshal(mobile)
	b, _ := json.Marshal(server)
	if !bytes.Equal(a, b) {
		t.Fatal("sms_phrases.json differs from mobile/src/smsPhrases.ts — copy the JSON block over")
	}
}

// Same messages as mobile/src/smsLanguages.test.ts: real transfers pass, the rest is refused.
func TestSMSNotATransferLanguages(t *testing.T) {
	real := []string{
		"ውድ ደንበኛ ከሳራ 1,000.00 ብር ተቀብለዋል። ቀሪ ሂሳብዎ 2,000.00 ብር ነው።",
		"ውድ ደንበኛ በቴሌብር 50.00 ብር ለየአየር ሰዓት ከፍለዋል።",
		"Maamila keenya, ETB 500.00 Saaraa irraa argattaniittu.",
		"ዝኸበርኩም ዓሚል 500.00 ብር ካብ ሳራ ተቐቢልኩም።",
		"[-EVCPlus-] Waxaad $50.00 ka heshay Axmed (252612345678).",
		"تم خصم ٢٥٠٫٠٠ جنيه من حسابك رقم ***1234 عملية شراء.",
		"Vous avez envoyé 10 000 FCFA à Ada. Nouveau solde: 70 000 FCFA.",
		"Has recibido $500.00 de Juan en tu cuenta terminada en 1234.",
		"Você recebeu um Pix de R$ 150,00 de Maria.",
		"Umetuma Ksh500.00 kwa JANE DOE 0712345678.",
		"आपके खाते XX1234 से ₹500.00 डेबिट किए गए।",
		"Dana masuk Rp 250.000,00 dari BUDI ke rekening 1234.",
		"Покупка 1 250,00 руб в магазине. Баланс: 10 750,00 руб",
		"您尾号1234的账户转入人民币500.00元，余额1,500.00元。",
		"Kartenzahlung 45,90 EUR bei REWE. Kontostand 3.354,10 EUR",
	}
	for _, msg := range real {
		if why := SMSNotATransfer(msg); why != "" {
			t.Errorf("real transfer refused (%s): %s", why, msg)
		}
	}
	never := map[string]string{
		"ውድ ደንበኛ 250.00 ብር ለሳራ የላኩት ገንዘብ አልተሳካም።":                         "failed or declined",
		"Maamila keenya, ETB 300.00 erguun hin milkoofne.":                "failed or declined",
		"[-EVCPlus-] Lacag dirista $20.00 ma guulaysan.":                  "failed or declined",
		"رمز التحقق الخاص بك هو 482910. لا تشارك هذا الرمز مع أي شخص.":    "security code",
		"Gagnez jusqu'à 1 000 000 FCFA avec Orange Money! Offre valable.": "promotion",
		"Tu compra por $320.50 fue rechazada por fondos insuficientes.":   "failed or declined",
		"Операция на 1 250,00 руб отклонена: недостаточно средств.":       "failed or declined",
		"验证码482910，请勿泄露给他人。":                                              "security code",
		"Transaksi Rp 100.000,00 gagal. Saldo tidak cukup.":               "failed or declined",
		"በቴሌብር ይክፈሉ እና እስከ 1,000,000 ብር ያሸንፉ! ቅናሽ ያግኙ።":                   "promotion",
	}
	for msg, want := range never {
		if got := SMSNotATransfer(msg); got != want {
			t.Errorf("%q: got %q, want %q", msg, got, want)
		}
	}
}
