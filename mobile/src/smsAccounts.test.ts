import { canonicalInstitution, matchAccount } from './smsAccounts';
import { classifySms } from './smsClassify';

// Run with: node --experimental-strip-types scripts/run-ts-test.mjs src/smsAccounts.test.ts

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`✓ ${name}`);
  else {
    failed++;
    console.log(`✗ ${name} ${detail}`);
  }
}

type A = { id: string; name: string; institution_label?: string | null; account_type: 'bank' | 'mobile_money' | 'cash'; currency_code: string; account_number?: string | null };
const cbe1: A = { id: 'cbe1', name: 'CBE', institution_label: 'Commercial Bank of Ethiopia', account_type: 'bank', currency_code: 'ETB', account_number: '1000123451234' };
const cbe2: A = { id: 'cbe2', name: 'CBE savings', institution_label: 'CBE', account_type: 'bank', currency_code: 'ETB', account_number: '1000999995678' };
const cbeBirr: A = { id: 'cbebirr', name: 'CBE Birr', institution_label: 'CBE Birr', account_type: 'mobile_money', currency_code: 'ETB' };
const tele: A = { id: 'tele', name: 'Telebirr', institution_label: 'Telebirr', account_type: 'mobile_money', currency_code: 'ETB' };
const awash: A = { id: 'awash', name: 'Awash Bank', institution_label: 'Awash', account_type: 'bank', currency_code: 'ETB' };

check('CBE and its full name are one bank', canonicalInstitution('CBE') === canonicalInstitution('Commercial Bank of Ethiopia'));
check('CBE Birr is not CBE', canonicalInstitution('CBE Birr') !== canonicalInstitution('CBE'));

const id = (m: ReturnType<typeof matchAccount<A>>) => (m.kind === 'found' ? m.account.id : m.kind);

check('last 4 picks the right CBE account', id(matchAccount([cbe1, cbe2, cbeBirr], { institution: 'CBE', last4: '5678', currency: 'ETB' })) === 'cbe2');
check('two CBE accounts, no digits: ask', id(matchAccount([cbe1, cbe2], { institution: 'CBE', last4: null, currency: 'ETB' })) === 'ambiguous');
check('CBE message never lands in CBE Birr', id(matchAccount([cbeBirr, cbe1], { institution: 'CBE', last4: null, currency: 'ETB' })) === 'cbe1');
check('one Awash account without number takes Awash digits', id(matchAccount([awash, cbe1], { institution: 'Awash', last4: '4321', currency: 'ETB' })) === 'awash');
check('unknown digits at a bank where every account has other digits: new account', id(matchAccount([cbe1, cbe2], { institution: 'CBE', last4: '4321', currency: 'ETB' })) === 'none');
check('other currency never matches', id(matchAccount([tele], { institution: 'Telebirr', last4: null, currency: 'USD' })) === 'none');

// The sender decides the bank, not words in the message.
const cbeToTele = classifySms(
  'Dear Abebe your Account 1*****1234 has been debited with ETB 300.00 transferred to telebirr wallet 0911****12. Your Current Balance is ETB 900.00. Thank you for Banking with CBE!',
  'CBE',
);
check('CBE alert mentioning telebirr stays CBE', cbeToTele.parsed.institutionHint === 'CBE' && cbeToTele.parsed.accountType === 'bank', JSON.stringify(cbeToTele.parsed.institutionHint));

const withLink = classifySms(
  'Dear Abebe your Account 1*****1234 has been Credited with ETB 1,500.00 from Sara. Your Current Balance is ETB 3,000.00. For receipt visit https://apps.cbe.com.et:100/?id=FT999 Thank you for Banking with CBE!',
  'CBE',
);
check('receipt link from CBE is not an advert', withLink.verdict === 'transaction', withLink.reason);

if (failed) {
  console.log(`${failed} failed`);
  process.exitCode = 1;
} else console.log('all passed');
