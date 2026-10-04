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
  if (/\bcbe\b|commercial\s*bank\s*of\s*ethiopia|banking with cbe/i.test(raw)) {
    return { type: 'bank', institution: 'CBE' };
  }
  if (/\bdashen\b/i.test(raw)) return { type: 'bank', institution: 'Dashen' };
  if (/\bawash\b/i.test(raw)) return { type: 'bank', institution: 'Awash' };
  if (/\babyssinia|boa\b/i.test(raw)) return { type: 'bank', institution: 'Abyssinia' };
  if (/\bmpesa|m-pesa|airtel\s*money|mtn\s*momo|hellocash|amole\b/i.test(raw)) {
    return { type: 'mobile_money', institution: 'Mobile money' };
  }
  if (/\b(?:a\/c|account)\b/i.test(raw)) return { type: 'bank', institution: 'Bank' };
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
    .replace(/\bwith a (?:total|S\.?\s*charge|VAT)[^.]*?/gi, ' ');

  const patterns = [
    /\b(?:transfered|transferred|received|paid|sent|debited|credited)\s+(?:with\s+)?(?:ETB|USD|EUR|GBP|Br)\s*([\d,]+\.?\d*)/i,
    /\b(?:has been|was)\s+(?:debited|credited)\s+(?:with\s+)?(?:ETB|USD|EUR|GBP|Br)\s*([\d,]+\.?\d*)/i,
    /\btransaction of\s+(?:ETB|USD|EUR|GBP|Br)\s*([\d,]+\.?\d*)/i,
    /\b(?:ETB|USD|EUR|GBP|Br)\s*([\d,]+\.?\d*)\s+(?:to|from|for)\b/i,
    /\b(?:amount|amt|sum|transferred amount)[:\s]+(?:ETB|USD|EUR|GBP|Br)?\s*([\d,]+\.?\d*)/i,
    /(?:ETB|USD|EUR|GBP|Br)\s*([\d,]{1,}(?:\.\d{1,2})?)/i,
  ];
  for (const re of patterns) {
    const m = withoutBalance.match(re);
    if (m) {
      const amt = normalizeAmount(m[1]);
      if (!amt) continue;
      const cur =
        withoutBalance.match(/\b(ETB|USD|EUR|GBP)\b/i)?.[1]?.toUpperCase() ||
        (/\bBr\b/.test(withoutBalance) ? 'ETB' : null);
      return { amount: amt, currency: cur };
    }
  }
  return { amount: null, currency: null };
}

function extractDirection(raw: string): 'income' | 'expense' | null {
  // Order matters — check specific phrases first.
  if (
    /\byou have (?:received|been credited)\b/i.test(raw) ||
    /\bhas been credited\b/i.test(raw) ||
    /\b(?:credited|deposit(?:ed)?|money received)\b/i.test(raw) ||
    /\breceived\s+(?:ETB|USD|Br)/i.test(raw)
  ) {
    return 'income';
  }
  if (
    /\byou have (?:transfered|transferred|sent|paid|been debited)\b/i.test(raw) ||
    /\bhas been debited\b/i.test(raw) ||
    /\b(?:debited|withdrawn|money sent|transfered|transferred)\b/i.test(raw) ||
    /\b(?:paid|sent)\s+(?:ETB|USD|Br)/i.test(raw) ||
    (/\bfrom your account\b/i.test(raw) && /\bto\b/i.test(raw))
  ) {
    return 'expense';
  }
  if (/\bcredited\b/i.test(raw)) return 'income';
  if (/\bdebited\b/i.test(raw)) return 'expense';
  return null;
}

function extractOwnAccount(raw: string): { last4: string | null; number: string | null } {
  // ONLY patterns that clearly mean *your* account — never beneficiary / sender A/c.
  const yours =
    raw.match(/\bfrom your account\s+([0-9*xX]{4,24})\b/i) ||
    raw.match(/\byour account\s+([0-9*xX]{4,24})\b/i) ||
    raw.match(/\byour (?:a\/c|acct|acc)(?:\s*(?:no|number|#)?)?[:\s]*([0-9*xX]{4,24})\b/i) ||
    raw.match(/\byour account\s+([0-9*xX]{4,24})\s+has been\s+(?:debited|credited)\b/i) ||
    raw.match(/\byour account\s+([0-9])\*{3,}([0-9]{4})\b/i);
  if (yours) {
    // Last alt has two capture groups (digit + last4).
    if (yours.length >= 3 && yours[2] && /^\d{4}$/.test(yours[2])) {
      return { last4: yours[2], number: null };
    }
    const digits = yours[1].replace(/\D/g, '');
    return { last4: last4(digits), number: digits.length > 4 ? digits : null };
  }
  // Do NOT fall back to the first masked number in the SMS — that is often the counterparty.
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
    !/\b(received|transfered|transferred|paid|sent|debited|credited|transaction of)\b/i.test(raw)
  ) {
    return false;
  }
  return /\b(received|transfered|transferred|paid|sent|debited|credited|money (?:received|sent)|transaction of)\b/i.test(
    raw,
  );
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
  };
  if (!raw || !isTransferSms(raw)) return out;

  let score = 0.2;
  out.kind = extractDirection(raw);
  if (out.kind) score += 0.35;

  const { amount, currency } = extractTransferAmount(raw);
  out.amount = amount;
  out.currency = currency || (/\bETB\b|\bBr\b/i.test(raw) ? 'ETB' : null);
  if (out.amount) score += 0.4;
  if (out.currency) score += 0.05;

  const own = extractOwnAccount(raw);
  out.accountLast4 = own.last4;
  out.accountNumber = own.number;
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
