import { classifySms } from './smsClassify';

// Typical message shapes (personal details invented). Run with:
//   node --experimental-strip-types scripts/run-ts-test.mjs src/smsClassify.test.ts

type Case = { name: string; sender: string; body: string; verdict: 'transaction' | 'review' | 'ignore'; kind?: 'income' | 'expense'; amount?: string };

const cases: Case[] = [
  // Real money that moved: saved automatically.
  { name: 'CBE debit', sender: 'CBE', verdict: 'transaction', kind: 'expense', amount: '500.00',
    body: 'Dear Abebe your Account 1*****1234 has been debited with ETB 500.00. Your Current Balance is ETB 9,500.00 Thank you for Banking with CBE! https://apps.cbe.com.et:100/?id=FT12345' },
  { name: 'CBE credit', sender: 'CBE', verdict: 'transaction', kind: 'income', amount: '2000.00',
    body: 'Dear Abebe your Account 1*****1234 has been Credited with ETB 2,000.00 from Sara. Your Current Balance is ETB 11,500.00. Thank you for Banking with CBE!' },
  { name: 'Telebirr sent', sender: '127', verdict: 'transaction', kind: 'expense', amount: '250.00',
    body: 'Dear Abebe You have transferred ETB 250.00 to Sara (2519****1234) on 30/10/2026 10:15:02. Your transaction number is DJK12345. Your current E-Money Account balance is ETB 1,000.00.' },
  { name: 'Telebirr received', sender: '127', verdict: 'transaction', kind: 'income', amount: '1000.00',
    body: 'Dear Abebe You have received ETB 1,000.00 from Sara(2519****1234) on 30/10/2026 09:00:00. Your transaction number is DJK999. Your current balance is ETB 2,000.00.' },
  { name: 'Telebirr paid airtime', sender: '127', verdict: 'transaction', kind: 'expense', amount: '50.00',
    body: 'Dear Abebe You have paid ETB 50.00 for airtime recharge on 30/10/2026. Your transaction number is DJK1. Your telebirr balance is ETB 950.00.' },
  { name: 'M-Pesa sent', sender: 'MPESA', verdict: 'transaction', kind: 'expense', amount: '1200.00',
    body: 'QAB12CD34E Confirmed. Ksh1,200.00 sent to JANE DOE 0712345678 on 30/10/26 at 10:00 AM. New M-PESA balance is Ksh3,400.00. Transaction cost, Ksh0.00.' },

  // Not money that moved: never saved.
  { name: 'OTP', sender: 'CBE', verdict: 'ignore',
    body: 'Your one-time password is 482910. Do not share this code with anyone. ETB 500.00 transfer pending.' },
  { name: 'failed transfer', sender: '127', verdict: 'ignore',
    body: 'Dear Abebe your transfer of ETB 500.00 to Sara failed due to insufficient balance. Please try again.' },
  { name: 'payment request', sender: '127', verdict: 'ignore',
    body: 'Sara has requested ETB 200.00 from you. Open telebirr to approve this payment request.' },
  { name: 'shop order received', sender: 'JUMIA', verdict: 'ignore',
    body: 'Your order 12345 has been received! Total KES 2,500.00. Get 20% off your next order, download the app.' },
  { name: 'telecom airtime balance', sender: 'ethio telecom', verdict: 'ignore',
    body: 'Dear customer, your airtime balance is ETB 12.50 and data balance is 250 MB. Dial *804# to buy a package.' },
  { name: 'airtime bonus', sender: 'ethio telecom', verdict: 'ignore',
    body: 'Congratulations! You have received ETB 10.00 airtime bonus. Enjoy 1GB free data this weekend.' },
  { name: 'promotion that says you received', sender: '127', verdict: 'ignore',
    body: 'Pay with telebirr and win up to ETB 1,000! You have received a chance. Offer ends soon.' },
  { name: 'promotion', sender: '127', verdict: 'ignore',
    body: 'Pay with telebirr and win up to ETB 1,000,000! Send money and get 5% cashback. Offer ends soon.' },

  // Looks like money but we are not sure: the user decides once.
  { name: 'unknown sender', sender: 'SHOPPAY', verdict: 'review',
    body: 'You have received ETB 300.00 from Kebede. Thank you.' },
  // Banks never text from a personal number: a "bank alert" from one is a scam or a chat.
  { name: 'from a personal number', sender: '+251911234567', verdict: 'ignore',
    body: 'You have received ETB 300.00 from CBE account 1*****1234.' },
  { name: 'reversal', sender: 'CBE', verdict: 'review',
    body: 'Dear Abebe ETB 500.00 has been reversed and credited to your account 1*****1234. Your Current Balance is ETB 10,000.00.' },
];

let failed = 0;
for (const c of cases) {
  const got = classifySms(c.body, c.sender);
  const problems: string[] = [];
  if (got.verdict !== c.verdict) problems.push(`verdict ${got.verdict} (${got.reason}), want ${c.verdict}`);
  if (c.kind && got.parsed.kind !== c.kind) problems.push(`kind ${got.parsed.kind}, want ${c.kind}`);
  if (c.amount && got.parsed.amount !== c.amount) problems.push(`amount ${got.parsed.amount}, want ${c.amount}`);
  if (problems.length) {
    failed++;
    console.error(`✗ ${c.name}: ${problems.join('; ')}`);
  } else {
    console.log(`✓ ${c.name}`);
  }
}
if (failed) {
  console.error(`${failed} of ${cases.length} failed`);
  process.exit(1);
}
console.log(`all ${cases.length} passed`);
