/** Heuristic parse of bank / wallet SMS for amount, direction, and *your* account. */

export type SmsAccountType = 'bank' | 'mobile_money' | 'wallet' | 'card' | 'other';

export type ParsedSmsTransfer = {
  kind: 'income' | 'expense' | null;
  amount: string | null;
  currency: string | null;
  accountLast4: string | null;
  accountNumber: string | null;
  /** Digits belonging to the counterparty — never treat as your account. */
  otherAccountLast4: string | null;
  counterparty: string | null;
  accountType: SmsAccountType;
  institutionHint: string | null;
  confidence: number;
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  '₹': 'INR',
  '₦': 'NGN',
  R: 'ZAR',
  Br: 'ETB',
  ETB: 'ETB',
  USD: 'USD',
  EUR: 'EUR',
  GBP: 'GBP',
  KES: 'KES',
  GHS: 'GHS',
  NGN: 'NGN',
  ZAR: 'ZAR',
  AED: 'AED',
};

const CREDIT_RE =
  /\b(money received|received|credited|credit|deposit|deposited|incoming|you (?:have )?received|sent to you|transfer(?:red)? (?:to|into) (?:your|you)|payment received|inflow)\b/i;
const DEBIT_RE =
  /\b(money sent|sent|debited|debit|withdrawn|withdrawal|paid|payment (?:of|to)|transfer(?:red)? (?:from|out)|outgoing|you (?:have )?sent|charged)\b/i;

const MOBILE_MONEY_RE =
  /\b(telebirr|tele\s*birr|mpesa|m-pesa|cbe\s*birr|cbebirr|airtel\s*money|mtn\s*momo|orange\s*money|wave|hellocash|amole)\b/i;
const WALLET_RE = /\b(paypal|venmo|cash\s*app|wallet|ewallet|e-wallet)\b/i;
const CARD_RE = /\b(visa|mastercard|card\s*ending|debit\s*card|credit\s*card)\b/i;
const BANK_RE =
  /\b(bank|cbe|dashen|awash|abyssinia|nib|cooperative|boa|wegagen|enat|zemen|bunna|berhan|hijra|siinqee|oam|commercial\s*bank)\b/i;

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

type AcctHit = { digits: string; index: number; ownHint: boolean; otherHint: boolean };

/** Collect account-like digit runs with ownership hints from nearby words. */
function collectAccountHits(raw: string): AcctHit[] {
  const hits: AcctHit[] = [];
  const patterns = [
    /\b(?:your\s+)?(?:a\/c|acct|account|acc)(?:\s*(?:no|number|#)?)?[:\s.*-]*([0-9*]{4,20})\b/gi,
    /\*{2,}([0-9]{4})\b/g,
    /\bend(?:ing)?(?:\s*in)?\s*([0-9]{4})\b/gi,
    /\b([0-9]{10,16})\b/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(raw)) != null) {
      const digits = m[1].replace(/\D/g, '');
      if (digits.length < 4) continue;
      const start = Math.max(0, m.index - 28);
      const window = raw.slice(start, m.index + m[0].length + 12).toLowerCase();
      const ownHint =
        /\byour\b/.test(window) ||
        /\bto your\b/.test(window) ||
        /\bfrom your\b/.test(window) ||
        /\bcredited to\b/.test(window) ||
        /\bdebited from\b/.test(window);
      const otherHint =
        /\bfrom (?:a\/c|acct|account|acc)\b/.test(window) ||
        /\bto (?:a\/c|acct|account|acc)\b/.test(window) ||
        (/\b(?:sender|beneficiary|receiver)'?s?\b/.test(window) && !/\byour\b/.test(window));
      hits.push({ digits, index: m.index, ownHint, otherHint });
    }
  }
  // Dedupe by last4 preferring longer digit strings / own hints.
  const byLast4 = new Map<string, AcctHit>();
  for (const h of hits) {
    const key = h.digits.slice(-4);
    const prev = byLast4.get(key);
    if (!prev || (h.ownHint && !prev.ownHint) || h.digits.length > prev.digits.length) {
      byLast4.set(key, h);
    }
  }
  return [...byLast4.values()].sort((a, b) => a.index - b.index);
}

export function classifySmsAccountType(text: string): { type: SmsAccountType; institution: string | null } {
  const raw = text || '';
  if (MOBILE_MONEY_RE.test(raw)) {
    const m = raw.match(MOBILE_MONEY_RE);
    return { type: 'mobile_money', institution: m?.[1]?.trim() || 'Mobile money' };
  }
  if (WALLET_RE.test(raw)) {
    const m = raw.match(WALLET_RE);
    return { type: 'wallet', institution: m?.[1]?.trim() || 'Wallet' };
  }
  if (CARD_RE.test(raw)) {
    return { type: 'card', institution: 'Card' };
  }
  if (BANK_RE.test(raw)) {
    const m = raw.match(BANK_RE);
    return { type: 'bank', institution: m?.[1]?.trim() || 'Bank' };
  }
  // Generic transfer SMS with a/c → bank; otherwise other.
  if (/\b(?:a\/c|acct|account)\b/i.test(raw)) {
    return { type: 'bank', institution: 'Bank' };
  }
  return { type: 'other', institution: null };
}

/**
 * Pick *your* account digits from SMS.
 * Income: prefer "your a/c" / destination; never take the sender's account as yours.
 * Expense: prefer "your a/c" / source; never take the beneficiary account as yours.
 */
export function classifyOwnAccount(
  raw: string,
  kind: 'income' | 'expense' | null,
): { own: AcctHit | null; other: AcctHit | null } {
  const hits = collectAccountHits(raw);
  if (!hits.length) return { own: null, other: null };

  const ownHits = hits.filter((h) => h.ownHint);
  const otherHits = hits.filter((h) => h.otherHint && !h.ownHint);

  if (ownHits.length) {
    return { own: ownHits[0], other: otherHits[0] || hits.find((h) => h !== ownHits[0]) || null };
  }

  // Directional heuristics when "your" is missing.
  if (kind === 'income') {
    // Credit: first account after "to" / last account is often yours; "from … account" is other.
    const fromAcct = raw.match(
      /\bfrom\s+(?:a\/c|acct|account|acc)?[:\s.*-]*([0-9*]{4,20})/i,
    );
    const toAcct = raw.match(/\bto\s+(?:your\s+)?(?:a\/c|acct|account|acc)?[:\s.*-]*([0-9*]{4,20})/i);
    if (toAcct) {
      const dig = toAcct[1].replace(/\D/g, '');
      const own = hits.find((h) => h.digits.slice(-4) === dig.slice(-4)) || {
        digits: dig,
        index: toAcct.index ?? 0,
        ownHint: true,
        otherHint: false,
      };
      let other: AcctHit | null = null;
      if (fromAcct) {
        const od = fromAcct[1].replace(/\D/g, '');
        other = hits.find((h) => h.digits.slice(-4) === od.slice(-4)) || {
          digits: od,
          index: fromAcct.index ?? 0,
          ownHint: false,
          otherHint: true,
        };
      }
      return { own, other };
    }
    if (fromAcct && hits.length >= 2) {
      const od = fromAcct[1].replace(/\D/g, '').slice(-4);
      const other = hits.find((h) => h.digits.slice(-4) === od) || null;
      const own = hits.find((h) => h.digits.slice(-4) !== od) || null;
      return { own, other };
    }
  }

  if (kind === 'expense') {
    const toAcct = raw.match(/\bto\s+(?:a\/c|acct|account|acc)?[:\s.*-]*([0-9*]{4,20})/i);
    if (toAcct && hits.length >= 2) {
      const od = toAcct[1].replace(/\D/g, '').slice(-4);
      const other = hits.find((h) => h.digits.slice(-4) === od) || null;
      const own = hits.find((h) => h.digits.slice(-4) !== od) || hits[0];
      return { own, other };
    }
  }

  // Single account mentioned → treat as yours (bank alerts usually mention your a/c only).
  if (hits.length === 1) return { own: hits[0], other: null };

  // Multiple without hints: prefer one near "your"/balance; else first for debit, last for credit.
  if (kind === 'income') return { own: hits[hits.length - 1], other: hits[0] };
  return { own: hits[0], other: hits[hits.length - 1] };
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
  };
  if (!raw) return out;

  let score = 0;
  if (CREDIT_RE.test(raw)) {
    out.kind = 'income';
    score += 0.35;
  } else if (DEBIT_RE.test(raw)) {
    out.kind = 'expense';
    score += 0.35;
  }

  const amountMatch =
    raw.match(
      /(?:(?:ETB|USD|EUR|GBP|KES|GHS|NGN|ZAR|AED|Br|\$|€|£|¥|₹|₦)\s*)([\d]{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i,
    ) ||
    raw.match(
      /([\d]{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(?:ETB|USD|EUR|GBP|KES|GHS|NGN|ZAR|AED|Br)/i,
    ) ||
    raw.match(/\b(?:amount|amt|sum)[:\s]+([\d,]+\.?\d*)/i);

  if (amountMatch) {
    const amt = normalizeAmount(amountMatch[1]);
    if (amt) {
      out.amount = amt;
      score += 0.4;
    }
  }

  for (const [sym, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (raw.includes(sym) || new RegExp(`\\b${code}\\b`, 'i').test(raw)) {
      out.currency = code;
      score += 0.1;
      break;
    }
  }

  const { own, other } = classifyOwnAccount(raw, out.kind);
  if (own) {
    const l4 = last4(own.digits);
    out.accountLast4 = l4;
    out.accountNumber = own.digits.length > 4 ? own.digits : null;
    score += own.ownHint ? 0.2 : 0.12;
  }
  if (other) {
    out.otherAccountLast4 = last4(other.digits);
  }

  const fromTo =
    raw.match(/\b(?:from|to|by)\s+([A-Za-z][A-Za-z0-9 .&'-]{2,40})/i) ||
    raw.match(/\b(?:sender|receiver|beneficiary)[:\s]+([A-Za-z][A-Za-z0-9 .&'-]{2,40})/i);
  if (fromTo) {
    out.counterparty = fromTo[1].trim().replace(/\s+/g, ' ').slice(0, 80);
    score += 0.05;
  }

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
