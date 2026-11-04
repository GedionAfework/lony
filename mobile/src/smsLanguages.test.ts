import { classifySms } from './smsClassify';
import { SMS_PHRASES } from './smsPhrases';

// Bank/wallet messages in each supported language, written from typical wording (not
// copied from real inboxes). Run with:
//   node --experimental-strip-types scripts/run-ts-test.mjs src/smsLanguages.test.ts

type V = 'transaction' | 'review' | 'ignore';
type Case = [lang: string, name: string, sender: string, body: string, verdict: V, kind?: 'income' | 'expense', amount?: string];

const cases: Case[] = [
  ['am', 'in', '127', 'ውድ ደንበኛ ከሳራ 1,000.00 ብር ተቀብለዋል። ቀሪ ሂሳብዎ 2,000.00 ብር ነው።', 'transaction', 'income', '1000.00'],
  ['am', 'out', '127', 'ውድ ደንበኛ 250.00 ብር ለሳራ ልከዋል። ቀሪ ሂሳብዎ 750.00 ብር ነው።', 'transaction', 'expense', '250.00'],
  ['am', 'failed', '127', 'ውድ ደንበኛ 250.00 ብር ለሳራ የላኩት ገንዘብ አልተሳካም።', 'ignore'],
  ['am', 'promo', '127', 'በቴሌብር ይክፈሉ እና እስከ 1,000,000 ብር ያሸንፉ! ቅናሽ ያግኙ።', 'ignore'],
  ['om', 'in', '127', 'Maamila keenya, ETB 500.00 Saaraa irraa argattaniittu. Haftee herregaa keessanii ETB 1,500.00.', 'transaction', 'income', '500.00'],
  ['om', 'out', 'CBE', 'Maamila keenya, herrega keessan 1*****1234 irraa ETB 300.00 ergitaniittu. Haftee ETB 1,200.00.', 'transaction', 'expense', '300.00'],
  ['om', 'failed', '127', 'Maamila keenya, ETB 300.00 erguun hin milkoofne. Haftee gahaa miti.', 'ignore'],
  ['ti', 'in', '127', 'ዝኸበርኩም ዓሚል 500.00 ብር ካብ ሳራ ተቐቢልኩም። ተረፍ ሕሳብኩም 1,500.00 ብር እዩ።', 'transaction', 'income', '500.00'],
  ['ti', 'out', '127', 'ዝኸበርኩም ዓሚል 200.00 ብር ናብ ሳራ ሰዲድኩም። ተረፍ ሕሳብኩም 1,300.00 ብር እዩ።', 'transaction', 'expense', '200.00'],
  ['so', 'in', 'EVCPLUS', '[-EVCPlus-] Waxaad $50.00 ka heshay Axmed (252612345678). Haraagaagu waa $120.00.', 'transaction', 'income', '50.00'],
  ['so', 'out', 'EVCPLUS', '[-EVCPlus-] Waxaad $20.00 u dirtay Faadumo (252612345678). Haraagaagu waa $100.00.', 'transaction', 'expense', '20.00'],
  ['so', 'failed', 'EVCPLUS', '[-EVCPlus-] Lacag dirista $20.00 ma guulaysan. Haraagaagu kuguma filna.', 'ignore'],
  ['ar', 'in', 'CIB', 'تم إيداع 500.00 جنيه في حسابك رقم ***1234. رصيدك الحالي 1,500.00 جنيه', 'transaction', 'income', '500.00'],
  ['ar', 'out', 'CIB', 'تم خصم ٢٥٠٫٠٠ جنيه من حسابك رقم ***1234 عملية شراء. رصيدك ١٬٢٥٠٫٠٠ جنيه', 'transaction', 'expense', '250.00'],
  ['ar', 'otp', 'CIB', 'رمز التحقق الخاص بك هو 482910. لا تشارك هذا الرمز مع أي شخص.', 'ignore'],
  ['fr', 'in', 'ORANGEMONEY', 'Vous avez reçu 25 000 FCFA de Ada. Nouveau solde: 80 000 FCFA.', 'transaction', 'income', '25000.00'],
  ['fr', 'out', 'ORANGEMONEY', 'Vous avez envoyé 10 000 FCFA à Ada. Nouveau solde: 70 000 FCFA.', 'transaction', 'expense', '10000.00'],
  ['fr', 'failed', 'ORANGEMONEY', 'Votre transfert de 10 000 FCFA à Ada a échoué. Solde insuffisant.', 'ignore'],
  ['fr', 'promo', 'ORANGEMONEY', "Gagnez jusqu'à 1 000 000 FCFA avec Orange Money! Offre valable ce mois.", 'ignore'],
  ['es', 'in', 'BBVA', 'Has recibido $500.00 de Juan en tu cuenta terminada en 1234. Saldo: $1,500.00', 'transaction', 'income', '500.00'],
  ['es', 'out', 'BBVA', 'Compra por $320.50 en SUPERMERCADO con tu tarjeta terminada en 1234. Saldo: $1,179.50', 'transaction', 'expense', '320.50'],
  ['es', 'failed', 'BBVA', 'Tu compra por $320.50 fue rechazada por fondos insuficientes.', 'ignore'],
  ['pt', 'in', 'NUBANK', 'Você recebeu um Pix de R$ 150,00 de Maria. Saldo: R$ 1.150,00', 'transaction', 'income', '150.00'],
  ['pt', 'out', 'NUBANK', 'Compra aprovada de R$ 89,90 em PADARIA no cartão final 1234.', 'transaction', 'expense', '89.90'],
  ['pt', 'failed', 'NUBANK', 'Compra de R$ 89,90 recusada: saldo insuficiente.', 'ignore'],
  ['sw', 'in', 'MPESA', 'QAB12 Imethibitishwa. Umepokea Ksh1,000.00 kutoka JANE DOE 0712345678. Salio lako la M-PESA ni Ksh2,000.00.', 'transaction', 'income', '1000.00'],
  ['sw', 'out', 'MPESA', 'QAB13 Imethibitishwa. Umetuma Ksh500.00 kwa JANE DOE 0712345678. Salio lako la M-PESA ni Ksh1,500.00.', 'transaction', 'expense', '500.00'],
  ['hi', 'in', 'HDFCBK', 'आपके खाते XX1234 में ₹2,000.00 जमा किए गए। उपलब्ध शेष ₹5,000.00', 'transaction', 'income', '2000.00'],
  ['hi', 'out', 'HDFCBK', 'आपके खाते XX1234 से ₹500.00 डेबिट किए गए। उपलब्ध शेष ₹4,500.00', 'transaction', 'expense', '500.00'],
  ['bn', 'in', 'BKASH', 'আপনি ৳১,০০০.০০ পেয়েছেন 01712345678 থেকে। ব্যালেন্স ৳৩,০০০.০০', 'transaction', 'income', '1000.00'],
  ['bn', 'out', 'BKASH', 'আপনি ৳৫০০.০০ পাঠিয়েছেন 01712345678 নম্বরে। ব্যালেন্স ৳২,৫০০.০০', 'transaction', 'expense', '500.00'],
  ['ur', 'in', 'JAZZCASH', 'آپ کو Rs. 1,500.00 موصول ہوئے احمد سے۔ آپ کا بیلنس Rs. 3,000.00 ہے۔', 'transaction', 'income', '1500.00'],
  ['id', 'in', 'BCA', 'Dana masuk Rp 250.000,00 dari BUDI ke rekening 1234. Saldo Rp 1.250.000,00', 'transaction', 'income', '250000.00'],
  ['id', 'out', 'BCA', 'Transfer keluar Rp 100.000,00 ke SITI dari rekening 1234 berhasil.', 'transaction', 'expense', '100000.00'],
  ['id', 'failed', 'BCA', 'Transaksi Rp 100.000,00 gagal. Saldo tidak cukup.', 'ignore'],
  ['tr', 'in', 'GARANTI', 'Hesabınıza 1.500,00 TL gelen havale yapıldı. Bakiye: 3.500,00 TL', 'transaction', 'income', '1500.00'],
  ['tr', 'out', 'GARANTI', 'Kartınızla 250,00 TL harcama yapıldı. Kullanılabilir limit 4.750,00 TL', 'transaction', 'expense', '250.00'],
  ['ru', 'in', '900', 'Зачисление 5 000,00 руб от Ивана. Баланс: 12 000,00 руб', 'transaction', 'income', '5000.00'],
  ['ru', 'out', '900', 'Покупка 1 250,00 руб в магазине. Баланс: 10 750,00 руб', 'transaction', 'expense', '1250.00'],
  ['ru', 'failed', '900', 'Операция на 1 250,00 руб отклонена: недостаточно средств.', 'ignore'],
  ['zh', 'in', '95588', '您尾号1234的账户转入人民币500.00元，余额1,500.00元。', 'transaction', 'income', '500.00'],
  ['zh', 'out', '95588', '您尾号1234的账户消费人民币88.00元，余额1,412.00元。', 'transaction', 'expense', '88.00'],
  ['zh', 'otp', '95588', '验证码482910，请勿泄露给他人。', 'ignore'],
  ['de', 'in', 'SPARKASSE', 'Gutschrift von 1.200,00 EUR auf Ihr Konto ***1234 eingegangen. Kontostand 3.400,00 EUR', 'transaction', 'income', '1200.00'],
  ['de', 'out', 'SPARKASSE', 'Kartenzahlung 45,90 EUR bei REWE. Kontostand 3.354,10 EUR', 'transaction', 'expense', '45.90'],
  ['it', 'in', 'INTESA', 'Hai ricevuto un bonifico di 300,00 EUR da Marco. Saldo 1.300,00 EUR', 'transaction', 'income', '300.00'],
  ['it', 'out', 'INTESA', 'Addebito di 59,99 EUR per acquisto su carta ***1234. Saldo 1.240,01 EUR', 'transaction', 'expense', '59.99'],
  // Safety net: a known bank writing in wording we do not know is asked about, not dropped.
  ['xx', 'unknown language', 'CBE', 'Kirkkuu 1*****1234 ETB 750.00 qopheessaa. Haftee ETB 2,000.00.', 'review', undefined, '750.00'],
  ['xx', 'balance only', 'CBE', 'Dear customer your current balance is ETB 2,000.00 Thank you for banking with CBE', 'ignore'],
];

let failed = 0;
const covered = new Set<string>();
for (const [lang, name, sender, body, verdict, kind, amount] of cases) {
  covered.add(lang);
  const got = classifySms(body, sender);
  const problems: string[] = [];
  if (got.verdict !== verdict) problems.push(`verdict ${got.verdict} (${got.reason}), want ${verdict}`);
  if (kind && got.parsed.kind !== kind) problems.push(`kind ${got.parsed.kind}, want ${kind}`);
  if (amount && got.parsed.amount !== amount) problems.push(`amount ${got.parsed.amount}, want ${amount}`);
  if (problems.length) {
    failed++;
    console.error(`✗ [${lang}] ${name}: ${problems.join('; ')}`);
  }
}
for (const lang of Object.keys(SMS_PHRASES)) {
  if (!covered.has(lang)) {
    failed++;
    console.error(`✗ [${lang}] ${SMS_PHRASES[lang].name} has no test`);
  }
}
if (failed) {
  console.error(`${failed} problem(s) in ${cases.length} cases`);
  process.exit(1);
}
console.log(`all ${cases.length} cases passed across ${covered.size - 1} languages`);
