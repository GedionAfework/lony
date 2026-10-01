/** Heuristic parse of bank / wallet SMS for amount, direction, and account digits. */

export type ParsedSmsTransfer = {
  kind: 'income' | 'expense' | null;
  amount: string | null;
  currency: string | null;
  accountLast4: string | null;
  accountNumber: string | null;
  counterparty: string | null;
  confidence: number;
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  '₹': 'INR',
  '₦': 'NGN',
  'R': 'ZAR',
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
  /\b(received|credited|credit|deposit|deposited|incoming|you (?:have )?received|sent to you|transfer(?:red)? (?:to|into) (?:your|you)|payment received|inflow)\b/i;
const DEBIT_RE =
  /\b(sent|debited|debit|withdrawn|withdrawal|paid|payment (?:of|to)|transfer(?:red)? (?:from|out)|outgoing|you (?:have )?sent|charged)\b/i;

function normalizeAmount(raw: string): string | null {
  const cleaned = raw.replace(/,/g, '').replace(/\s/g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(2);
}

export function parseTransferSms(text: string): ParsedSmsTransfer {
  const raw = (text || '').trim();
  const out: ParsedSmsTransfer = {
    kind: null,
    amount: null,
    currency: null,
    accountLast4: null,
    accountNumber: null,
    counterparty: null,
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

  const acct =
    raw.match(/\b(?:a\/c|acct|account|acc)(?:\s*(?:no|number|#)?)?[:\s.*-]*([0-9]{4,20})\b/i) ||
    raw.match(/\b([0-9]{10,16})\b/) ||
    raw.match(/\*{2,}([0-9]{4})\b/) ||
    raw.match(/\bend(?:ing)?(?:\s*in)?\s*([0-9]{4})\b/i);
  if (acct) {
    const digits = acct[1].replace(/\D/g, '');
    if (digits.length >= 4) {
      out.accountNumber = digits.length > 4 ? digits : null;
      out.accountLast4 = digits.slice(-4);
      score += 0.15;
    }
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
