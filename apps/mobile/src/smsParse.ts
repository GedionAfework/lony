/** Parse bank / wallet SMS — tuned for Ethiopian CBE, Telebirr, and similar apps. */

export type SmsAccountType = 'bank' | 'mobile_money' | 'wallet' | 'card' | 'other';

export type ParsedSmsTransfer = {
  kind: 'income' | 'expense' | null;
  amount: string | null;
  currency: string | null;
  accountLast4: string | null;
  accountNumber: string | null;
  otherAccountLast4: string | null;
  counterparty: string | null;
  accountType: SmsAccountType;
  institutionHint: string | null;
  confidence: number;
  /** Short UI summary — never the raw SMS. */
  summaryTitle: string | null;
  /** Bank-stated remaining balance (not the transfer amount). */
  statedBalance: string | null;
};

function normalizeAmount(raw: string): string | null {
  const cleaned = raw.replace(/,/g, '').replace(/\s/g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(2);
}

function last4(digits: string): string | null {
  const d = digits.replace(/\D/g, '');
  if (d.length < 4) return null;
  return d.slice(-4);
}

function cleanName(raw: string): string {
  return raw
    .replace(/\*{2,}/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.,;:]+$/g, '')
    .trim()
    .slice(0, 60);
}

export function classifySmsAccountType(text: string): { type: SmsAccountType; institution: string | null } {
  const raw = text || '';
  if (/\btelebirr|tele\s*birr|ethio\s*telecom|e-money\b/i.test(raw)) {
    return { type: 'mobile_money', institution: 'Telebirr' };
  }
  if (/\bmpesa|m-pesa\b/i.test(raw)) return { type: 'mobile_money', institution: 'M-Pesa' };
  if (/\bcash\s*app\b/i.test(raw)) return { type: 'wallet', institution: 'Cash App' };
  if (/\bvenmo\b/i.test(raw)) return { type: 'wallet', institution: 'Venmo' };
  if (/\bpaypal\b/i.test(raw)) return { type: 'wallet', institution: 'PayPal' };
  if (/\bairtel\s*money|mtn\s*momo|hellocash|amole\b/i.test(raw)) {
    return { type: 'mobile_money', institution: 'Mobile money' };
  }
  if (/\bcbe\b|commercial\s*bank\s*of\s*ethiopia|banking with cbe/i.test(raw)) {
    return { type: 'bank', institution: 'CBE' };
  }
  if (/\bdashen\b/i.test(raw)) return { type: 'bank', institution: 'Dashen' };
  if (/\bawash\b/i.test(raw)) return { type: 'bank', institution: 'Awash' };
  if (/\babyssinia\b/i.test(raw)) return { type: 'bank', institution: 'Abyssinia' };
  if (/\bhibret\b/i.test(raw)) return { type: 'bank', institution: 'Hibret' };
  if (/\bwegagen\b/i.test(raw)) return { type: 'bank', institution: 'Wegagen' };
  if (/\bzemen\b/i.test(raw)) return { type: 'bank', institution: 'Zemen' };
  if (/\bcoop(?:erative)?\s*bank\b/i.test(raw)) return { type: 'bank', institution: 'Coop' };
  if (/\bchase\b/i.test(raw)) return { type: 'bank', institution: 'Chase' };
  if (/\bwells\s*fargo\b/i.test(raw)) return { type: 'bank', institution: 'Wells Fargo' };
  if (/\bbank of america|\bbofa\b/i.test(raw)) return { type: 'bank', institution: 'Bank of America' };
  if (/\bcapital one\b/i.test(raw)) return { type: 'bank', institution: 'Capital One' };
  if (/\bciti(?:bank)?\b/i.test(raw)) return { type: 'bank', institution: 'Citi' };
  if (/\bus bank\b/i.test(raw)) return { type: 'bank', institution: 'US Bank' };
  if (/\bpnc\b/i.test(raw)) return { type: 'bank', institution: 'PNC' };
  if (/\btd bank\b/i.test(raw)) return { type: 'bank', institution: 'TD Bank' };
  if (/\bally\b/i.test(raw)) return { type: 'bank', institution: 'Ally' };
  if (/\bschwab\b/i.test(raw)) return { type: 'bank', institution: 'Schwab' };
  if (/\bdiscover\b/i.test(raw)) return { type: 'card', institution: 'Discover' };
  if (/\bamerican express|\bamex\b/i.test(raw)) return { type: 'card', institution: 'Amex' };
  if (/\bsofi\b/i.test(raw)) return { type: 'bank', institution: 'SoFi' };
  if (/\bchime\b/i.test(raw)) return { type: 'bank', institution: 'Chime' };
  if (/\bwise\b|transferwise/i.test(raw)) return { type: 'wallet', institution: 'Wise' };
  if (/\brevolut\b/i.test(raw)) return { type: 'wallet', institution: 'Revolut' };
  if (/\b(?:a\/c|acct|account|card ending)\b/i.test(raw)) return { type: 'bank', institution: null };
  return { type: 'other', institution: null };
}

/**
 * Prefer the transfer principal — never the "Current Balance" figure.
 * CBE: "You have transfered ETB 250.00 to …"
 * Telebirr: "You have received ETB 1,000.00 from …" / "You have paid ETB …"
 */
function extractTransferAmount(raw: string): { amount: string | null; currency: string | null } {
  // Strip balance clauses so they can't win the amount match.
  const withoutBalance = raw
    .replace(/\b(?:your\s+)?(?:current\s+)?(?:e-?money\s+)?(?:account\s+)?balance\s+is\s+[A-Z$€£]*\s*[\d,]+\.?\d*/gi, ' ')
    .replace(/\bAvail(?:able)?\.?\s*Bal(?:ance)?[:\s]+[A-Z$€£]*\s*[\d,]+\.?\d*/gi, ' ')
    .replace(/\b(?:available|current|ledger)\s+balance\s*[:.]?\s*\$?\s*[\d,]+\.?\d*/gi, ' ')
    .replace(/\bwith a (?:total|S\.?\s*charge|VAT)[^.]*?/gi, ' ');

  const patterns = [
    /\b(?:transfered|transferred|received|paid|sent|debited|credited|purchase(?:d)?|withdrew)\s+(?:with\s+)?(?:ETB|USD|EUR|GBP|Br|\$)\s*([\d,]+\.?\d*)/i,
    /\b(?:has been|was)\s+(?:debited|credited)\s+(?:with\s+)?(?:ETB|USD|EUR|GBP|Br|\$)\s*([\d,]+\.?\d*)/i,
    /\b(?:purchase|transaction|deposit|withdrawal) of\s+(?:ETB|USD|EUR|GBP|Br|\$)?\s*([\d,]+\.?\d*)/i,
    /\b(?:ETB|USD|EUR|GBP|Br)\s*([\d,]+\.?\d*)\s+(?:to|from|for)\b/i,
    /\$\s*([\d,]+\.?\d*)/,
    /\b(?:amount|amt|sum|transferred amount)[:\s]+(?:ETB|USD|EUR|GBP|Br|\$)?\s*([\d,]+\.?\d*)/i,
    /(?:ETB|USD|EUR|GBP|Br)\s*([\d,]{1,}(?:\.\d{1,2})?)/i,
  ];
  for (const re of patterns) {
    const m = withoutBalance.match(re);
    if (m) {
      const amt = normalizeAmount(m[1]);
      if (!amt) continue;
      const cur = detectCurrency(raw, withoutBalance);
      return { amount: amt, currency: cur };
    }
  }
  return { amount: null, currency: null };
}

function detectCurrency(raw: string, hint?: string): string | null {
  const s = `${raw} ${hint || ''}`;
  if (/\bETB\b|\bBr\b/i.test(s)) return 'ETB';
  if (/\bUSD\b/i.test(s) || /\$/.test(s)) return 'USD';
  if (/\bEUR\b|€/.test(s)) return 'EUR';
  if (/\bGBP\b|£/.test(s)) return 'GBP';
  return null;
}

/** Remaining balance the bank printed — never the transfer principal. */
export function extractSmsStatedBalance(text: string): string | null {
  const raw = text || '';
  const patterns = [
    /\b(?:your\s+)?(?:current\s+)?(?:e-?money\s+)?(?:account\s+)?balance\s+is\s+(?:ETB|USD|EUR|GBP|Br|\$)?\s*([\d,]+\.?\d*)/i,
    /\bAvail(?:able)?\.?\s*Bal(?:ance)?\s*[:.]?\s*(?:ETB|USD|EUR|GBP|Br|\$)?\s*([\d,]+\.?\d*)/i,
    /\b(?:available|current|ledger)\s+balance\s*[:.]?\s*(?:ETB|USD|EUR|GBP|Br|\$)?\s*([\d,]+\.?\d*)/i,
    /\b(?:new|remaining|updated|closing)\s+balance\s*[:.]?\s*(?:ETB|USD|EUR|GBP|Br|\$)?\s*([\d,]+\.?\d*)/i,
    /\$\s*([\d,]+\.?\d*)\s*(?:available|avail(?:able)?\s+bal)/i,
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (!m) continue;
    const amt = normalizeAmount(m[1]);
    if (amt) return amt;
  }
  return null;
}

function extractDirection(raw: string): 'income' | 'expense' | null {
  // Order matters — check specific phrases first.
  if (
    /\byou have (?:received|been credited)\b/i.test(raw) ||
    /\bhas been credited\b/i.test(raw) ||
    /\b(?:credited|deposit(?:ed)?|direct deposit|money received|ach credit)\b/i.test(raw) ||
    /\breceived\s+(?:ETB|USD|Br|\$)/i.test(raw)
  ) {
    return 'income';
  }
  if (
    /\byou have (?:transfered|transferred|sent|paid|been debited)\b/i.test(raw) ||
    /\bhas been debited\b/i.test(raw) ||
    /\b(?:debited|withdrawn|withdrawal|money sent|transfered|transferred|purchase(?:d)?)\b/i.test(raw) ||
    /\b(?:paid|sent)\s+(?:ETB|USD|Br|\$)/i.test(raw) ||
    (/\bfrom your account\b/i.test(raw) && /\bto\b/i.test(raw))
  ) {
    return 'expense';
  }
  if (/\bcredited\b/i.test(raw)) return 'income';
  if (/\bdebited\b/i.test(raw)) return 'expense';
  return null;
}

function extractOwnAccount(raw: string): { last4: string | null; number: string | null } {
  // Patterns that clearly mean *your* account — never beneficiary / sender A/c.
  const yours =
    raw.match(/\bfrom your account\s+([0-9*xX]{4,24})\b/i) ||
    raw.match(/\byour account\s+([0-9*xX]{4,24})\b/i) ||
    raw.match(/\byour (?:a\/c|acct|acc)(?:\s*(?:no|number|#)?)?[:\s]*([0-9*xX]{4,24})\b/i) ||
    raw.match(/\byour account\s+([0-9*xX]{4,24})\s+has been\s+(?:debited|credited)\b/i) ||
    raw.match(/\byour account\s+([0-9])\*{3,}([0-9]{4})\b/i) ||
    raw.match(/\b(?:card|account|acct|a\/c)\s+ending(?:\s+in)?\s+(\d{4})\b/i) ||
    raw.match(/\bending(?:\s+in)?\s+(\d{4})\b/i);
  if (yours) {
    if (yours.length >= 3 && yours[2] && /^\d{4}$/.test(yours[2])) {
      return { last4: yours[2], number: null };
    }
    const digits = yours[1].replace(/\D/g, '');
    return { last4: last4(digits), number: digits.length > 4 ? digits : null };
  }
  const masked = [...raw.matchAll(/\b[0-9][0-9*xX]{3,20}([0-9]{4})\b/g)].map((m) => m[1]);
  const unique = [...new Set(masked)];
  // Only if the SMS has a single masked number — two usually means yours + counterparty.
  if (unique.length === 1) return { last4: unique[0], number: null };
  return { last4: null, number: null };
}

function extractOtherAccount(raw: string, ownLast4: string | null): string | null {
  // Counterparty account digits — recorded for exclusion only, never for discovery.
  const other =
    raw.match(/\b(?:to|receiver(?:'s)?)\s+(?:account|a\/c|acct)\s+([0-9*xX]{4,24})\b/i) ||
    raw.match(/\b(?:beneficiary|receiver)\s+(?:account|a\/c)?\s*([0-9*xX]{4,24})\b/i) ||
    raw.match(/\bto\s+account\s+([0-9*xX]{4,24})\b/i);
  if (!other) return null;
  const l4 = last4(other[1]);
  if (!l4 || (ownLast4 && l4 === ownLast4)) return null;
  return l4;
}

function extractCounterparty(raw: string, kind: 'income' | 'expense' | null): string | null {
  if (kind === 'expense') {
    const to =
      raw.match(
        /\b(?:transfered|transferred|sent|paid)\s+(?:ETB|USD|Br)?\s*[\d,]+\.?\d*\s+to\s+([+\dA-Za-z*][+\dA-Za-z0-9 *().'-]{1,50}?)(?:\s+on\b|\s+from\b|\s+Ref\b|\.|,|$)/i,
      ) ||
      raw.match(/\bto\s+([+\dA-Za-z*][+\dA-Za-z0-9 *().'-]{1,40}?)(?:\s+on\b|\s+from\b|\s+Ref\b|\.|,|$)/i) ||
      raw.match(
        /\bpaid\s+(?:ETB|USD|Br)?\s*[\d,]+\.?\d*\s+for\s+([A-Za-z0-9][A-Za-z0-9 .'-]{1,40}?)(?:\s+on\b|\.|,|$)/i,
      );
    if (to) return cleanName(to[1]);
  }
  if (kind === 'income') {
    // Telebirr often uses "from +2519…" with no name.
    const phone = raw.match(/\bfrom\s+(\+?251[\d*]{6,12}|\+?0?9[\d*]{7,10})\b/i);
    if (phone) return cleanName(phone[1]);

    const from =
      raw.match(
        /\breceived\s+(?:ETB|USD|Br)?\s*[\d,]+\.?\d*\s+from\s+([+\dA-Za-z*][+\dA-Za-z0-9 *().'-]{1,50}?)(?:\s+on\b|\.|,|$)/i,
      ) ||
      raw.match(/\bcredited\b[\s\S]{0,80}?\bfrom\s+([+\dA-Za-z*][+\dA-Za-z0-9 *().'-]{1,40}?)(?:\s+on\b|\.|,|$)/i) ||
      raw.match(/\bfrom\s+([+\dA-Za-z*][+\dA-Za-z0-9 *().'-]{1,40}?)(?:\s+on\b|\.|,|$)/i);
    if (from) {
      const name = cleanName(from[1].replace(/\(\s*251[\d*]+\s*\)/g, '').trim());
      if (name && !/^your\b/i.test(name) && !/^account\b/i.test(name)) return name;
    }
  }
  return null;
}

/** Reject OTP / balance-only / non-transfer spam. */
export function isTransferSms(text: string): boolean {
  const raw = (text || '').trim();
  if (raw.length < 24) return false;
  if (/\b(otp|one[-\s]?time|verification code|pin code)\b/i.test(raw)) return false;
  if (
    /\bbalance is\b/i.test(raw) &&
    !/\b(received|transfered|transferred|paid|sent|debited|credited|transaction of|purchase|deposit|withdraw)\b/i.test(
      raw,
    )
  ) {
    return false;
  }
  return /\b(received|transfered|transferred|paid|sent|debited|credited|money (?:received|sent)|transaction of|purchase(?:d)?|deposit(?:ed)?|withdraw(?:al|n)?|zelle|ach)\b/i.test(
    raw,
  );
}

/** SMS that can discover an account (transfer, card alert, or balance notice). */
export function isAccountHintSms(text: string): boolean {
  const raw = (text || '').trim();
  if (raw.length < 20) return false;
  if (/\b(otp|one[-\s]?time|verification code|pin code)\b/i.test(raw)) return false;
  if (isTransferSms(raw)) return true;
  if (extractSmsStatedBalance(raw)) return true;
  if (/\bending(?:\s+in)?\s+\d{4}\b/i.test(raw)) return true;
  if (/\byour account\b/i.test(raw) && /\b\d{4}\b/.test(raw)) return true;
  return false;
}

export function parseTransferSms(text: string): ParsedSmsTransfer {
  const raw = (text || '').trim();
  const typed = classifySmsAccountType(raw);
  const out: ParsedSmsTransfer = {
    kind: null,
    amount: null,
    currency: null,
    accountLast4: null,
    accountNumber: null,
    otherAccountLast4: null,
    counterparty: null,
    accountType: typed.type,
    institutionHint: typed.institution,
    confidence: 0,
    summaryTitle: null,
    statedBalance: extractSmsStatedBalance(raw),
  };
  const own = extractOwnAccount(raw);
  out.accountLast4 = own.last4;
  out.accountNumber = own.number;
  out.currency = detectCurrency(raw);
  if (!raw || !isTransferSms(raw)) return out;

  let score = 0.2;
  out.kind = extractDirection(raw);
  if (out.kind) score += 0.35;

  const { amount, currency } = extractTransferAmount(raw);
  out.amount = amount;
  out.currency = currency || out.currency;
  if (out.amount) score += 0.4;
  if (out.currency) score += 0.05;
  if (own.last4) score += 0.15;
  out.otherAccountLast4 = extractOtherAccount(raw, own.last4);

  out.counterparty = extractCounterparty(raw, out.kind);
  if (out.counterparty) score += 0.08;

  if (out.kind === 'income') {
    out.summaryTitle = out.counterparty ? `From ${out.counterparty}` : 'Money received';
  } else if (out.kind === 'expense') {
    out.summaryTitle = out.counterparty ? `To ${out.counterparty}` : 'Money sent';
  }

  // Don't invent confidence for incomplete parses.
  if (!out.amount || !out.kind) score = Math.min(score, 0.4);
  out.confidence = Math.min(1, score);
  return out;
}

export function smsFingerprint(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 500);
  let h = 0;
  for (let i = 0; i < normalized.length; i++) {
    h = (Math.imul(31, h) + normalized.charCodeAt(i)) | 0;
  }
  return `sms_${(h >>> 0).toString(16)}_${normalized.length}`;
}

export function accountTypeLabel(t: SmsAccountType): string {
  switch (t) {
    case 'mobile_money':
      return 'Mobile money';
    case 'wallet':
      return 'Wallet';
    case 'card':
      return 'Card';
    case 'bank':
      return 'Bank';
    default:
      return 'Account';
  }
}

/** Short note for storage / UI — never the full SMS. */
export function summarizeSmsNote(parsed: ParsedSmsTransfer): string {
  const bits: string[] = [];
  if (parsed.institutionHint) bits.push(parsed.institutionHint);
  if (parsed.accountLast4) bits.push(`acct …${parsed.accountLast4}`);
  if (parsed.counterparty) bits.push(parsed.counterparty);
  return bits.join(' · ').slice(0, 120) || 'Bank transfer';
}
