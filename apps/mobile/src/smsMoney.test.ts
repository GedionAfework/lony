import { detectCurrency, normalizeAmount } from './smsMoney';
import { parseTransferSms } from './smsParse';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const money = [
  ['$32.10 at Amazon. Avail Bal $100', 'USD'],
  ['Paid £45.00 to TFL. Balance £210.50', 'GBP'],
  ['Débité 89,90 €. Solde 1.240,10 €', 'EUR'],
  ['Confirmed. Ksh1,200.00 sent to Jane. New M-PESA balance is Ksh3,400.00', 'KES'],
  ['You received NGN 25,000.00 from Ada. Available balance NGN 80,000.00', 'NGN'],
  ['CAD 150.00 deposited. Balance CAD 2,010.00', 'CAD'],
  ['You have transfered ETB 250.00. Balance is ETB 10,000.00', 'ETB'],
  ['You paid 500 Birr. Balance 2,000 Birr', 'ETB'],
] as const;

for (const [text, want] of money) {
  const got = detectCurrency(text);
  assert(got === want, `detectCurrency(${JSON.stringify(text)}) = ${got}, want ${want}`);
}

const parsed = [
  ['Chase Alert: You made a $32.10 purchase at AMAZON. Card ending in 1234. Avail Bal: $5,432.10', 'expense', '32.10', 'USD'],
  ['Barclays: £45.00 paid to TFL. Available balance £210.50', 'expense', '45.00', 'GBP'],
  ['Confirmed. Ksh1,200.00 sent to JANE DOE. New M-PESA balance is Ksh3,400.00', 'expense', '1200.00', 'KES'],
  ['You have received NGN 25,000.00 from ADA. Available balance NGN 80,000.00', 'income', '25000.00', 'NGN'],
  ['You have transfered ETB 250.00 to KEBede. Your account balance is ETB 10,000.00', 'expense', '250.00', 'ETB'],
] as const;

for (const [text, kind, amount, currency] of parsed) {
  const p = parseTransferSms(text);
  assert(
    p.kind === kind && p.amount === amount && p.currency === currency,
    `parse ${JSON.stringify(text)}\n  got ${p.kind} ${p.amount} ${p.currency}\n  want ${kind} ${amount} ${currency}`,
  );
}

assert(normalizeAmount('1.234,56') === '1234.56', 'EU amount');
assert(normalizeAmount('1,234.56') === '1234.56', 'US amount');
assert(detectCurrency('ALL CLEAR now') === null, 'ALL without a number is not a currency');

console.log('smsMoney ok');
