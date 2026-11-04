import type { MoneyAccount } from './api';

/**
 * Which of the user's accounts a bank message belongs to.
 *
 * Rules, in order:
 *  1. The account's own last 4 digits (from its saved account number, else digits in its name).
 *  2. The bank, by canonical name ("CBE" = "Commercial Bank of Ethiopia", but never "CBE Birr"),
 *     only when exactly one account of that bank and currency exists.
 *  3. Otherwise no guess: the message is shown for the user to pick the account.
 */

type AccountLike = Pick<MoneyAccount, 'name' | 'institution_label' | 'account_type' | 'currency_code'> & {
  account_number?: string | null;
};

/** Longest names first, so "cbe birr" wins over "cbe". */
const ALIASES: [string, string[]][] = [
  ['cbe birr', ['cbe birr', 'cbebirr']],
  ['telebirr', ['telebirr', 'tele birr', 'ethio telecom', 'ethiotelecom']],
  ['m-pesa', ['m-pesa', 'mpesa', 'safaricom']],
  ['cbe', ['commercial bank of ethiopia', 'commercial bank', 'cbe']],
  ['abyssinia', ['bank of abyssinia', 'abyssinia', 'boa']],
  ['hibret', ['hibret', 'united bank']],
  ['coop', ['cooperative bank of oromia', 'cooperative bank', 'coopbank', 'coop']],
  ['nib', ['nib international', 'nib']],
  ['awash', ['awash']],
  ['dashen', ['dashen']],
  ['wegagen', ['wegagen']],
  ['zemen', ['zemen']],
  ['bunna', ['bunna']],
  ['enat', ['enat']],
  ['berhan', ['berhan']],
  ['oromia', ['oromia international', 'oromia bank', 'oromia']],
  ['amhara', ['amhara bank', 'amhara']],
  ['lion', ['lion international', 'lion bank', 'lion']],
  ['tsedey', ['tsedey']],
  ['siinqee', ['siinqee']],
  ['zamzam', ['zamzam']],
  ['hijra', ['hijra']],
  ['gadaa', ['gadaa']],
  ['amole', ['amole']],
  ['hellocash', ['hellocash', 'hello cash']],
];

function clean(s: string): string {
  return ` ${s.toLowerCase().replace(/[^a-z0-9ሀ-፿]+/g, ' ').trim()} `;
}

/** One name per bank or wallet, so differently written labels compare equal. */
export function canonicalInstitution(raw?: string | null): string | null {
  if (!raw || !raw.trim()) return null;
  const text = clean(raw);
  for (const [canon, names] of ALIASES) {
    for (const n of names) {
      if (text.includes(clean(n))) return canon;
    }
  }
  // Unknown bank: its own name without filler words or digits.
  const plain = text
    .replace(/\b(bank|banking|s ?c|plc|ltd|international|account|acct|card|wallet|savings?|current|\d+)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain || null;
}

/** The account's last 4 digits: its saved number first, else digits in its name or label. */
export function accountLast4(a: AccountLike): string | null {
  const own = (a.account_number || '').replace(/\D/g, '');
  if (own.length >= 4) return own.slice(-4);
  const digits = `${a.name} ${a.institution_label || ''}`.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

export function accountInstitution(a: AccountLike): string | null {
  return canonicalInstitution(a.institution_label) || canonicalInstitution(a.name);
}

function sameCurrency(a: AccountLike, currency: string): boolean {
  return a.currency_code.toUpperCase() === currency.toUpperCase();
}

/** Non-cash accounts of this bank and currency. */
export function accountsOfInstitution<T extends AccountLike>(accounts: T[], institution: string | null, currency: string): T[] {
  const want = canonicalInstitution(institution);
  if (!want || want === 'bank' || want === 'account' || want === 'card') return [];
  return accounts.filter((a) => a.account_type !== 'cash' && sameCurrency(a, currency) && accountInstitution(a) === want);
}

export type AccountMatch<T> =
  | { kind: 'found'; account: T }
  /** Several accounts could be it; the user picks. */
  | { kind: 'ambiguous'; candidates: T[] }
  | { kind: 'none' };

export function matchAccount<T extends AccountLike>(
  accounts: T[],
  opts: { institution: string | null; last4: string | null; currency: string },
): AccountMatch<T> {
  const { institution, currency } = opts;
  const last4 = (opts.last4 || '').replace(/\D/g, '').slice(-4);
  const sameBank = accountsOfInstitution(accounts, institution, currency);
  if (last4.length === 4) {
    const byDigits = accounts.filter((a) => a.account_type !== 'cash' && sameCurrency(a, currency) && accountLast4(a) === last4);
    if (byDigits.length === 1) return { kind: 'found', account: byDigits[0] };
    if (byDigits.length > 1) {
      const narrowed = byDigits.filter((a) => sameBank.includes(a));
      return narrowed.length === 1 ? { kind: 'found', account: narrowed[0] } : { kind: 'ambiguous', candidates: byDigits };
    }
    // No account carries these digits. One account of this bank without known digits is
    // almost certainly it; an account with other digits is a different account.
    const unnumbered = sameBank.filter((a) => !accountLast4(a));
    if (unnumbered.length === 1) return { kind: 'found', account: unnumbered[0] };
    if (unnumbered.length > 1) return { kind: 'ambiguous', candidates: unnumbered };
    // Every account of this bank has other digits: this is an account Lony does not have yet.
    return { kind: 'none' };
  }
  if (sameBank.length === 1) return { kind: 'found', account: sameBank[0] };
  if (sameBank.length > 1) return { kind: 'ambiguous', candidates: sameBank };
  return { kind: 'none' };
}
