/** Parse bank / wallet SMS from any country. */

import { ANY_CUR, NUM, currencyTokenSource, detectCurrency, normalizeAmount } from './smsMoney';

/** Optional currency in front of a number, for patterns where the currency is not the point. */
const OPT_CUR = `(?:${ANY_CUR}\\s?)?`;

/** "money received" words in English, French, Spanish, Portuguese, Swahili, Amharic. */
const INCOME_WORDS =
  /\b(?:received|credited|deposit(?:ed)?|direct deposit|money received|ach credit|refund(?:ed)?)\b|re[çc]u|cr[ée]dit[ée]|d[ée]p[ôo]t|versement re[çc]u|virement re[çc]u|recibi(?:ste|do)|has recibido|abono|acreditad[oa]|dep[óo]sito|recebeu|recebid[oa]|creditad[oa]|umepokea|imepokelewa|ተቀብለዋል|ገቢ ተደርጓል|ገቢ ሆኗል/i;
/** "money spent / sent" words in the same languages. */
const EXPENSE_WORDS =
  /\b(?:debited|withdrawn|withdrawal|withdrew|money sent|transfered|transferred|purchase(?:d)?|paid|sent|bought|recharged|topped up|spent|charged)\b|d[ée]bit[ée]|envoy[ée]|pay[ée]|retrait|achat|paiement|enviaste|pagaste|retiro|compra|cargo|debitad[oa]|d[ée]bito|enviou|pagou|saque|umetuma|umelipa|imetumwa|ከፍለዋል|ልከዋል|አስተላልፈዋል|ወጪ ተደርጓል|ገዝተዋል/i;

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
  /** When the bank says the transfer happened (ISO). Empty if the text has no date. */
  occurredAt: string | null;
  /** True only when the SMS names *your* account (never a person you paid). */
  accountOwned: boolean;
  /** Last-4s of accounts / phones you sent to or received from. Never create these. */
  counterpartyLast4s: string[];
  /** institutionHint came from the SMS sender, not the text. The sender is your own bank or wallet. */
  fromSender?: boolean;
};

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
  if (/\bcbe\s*birr\b/i.test(raw)) return { type: 'mobile_money', institution: 'CBE Birr' };
  if (/\bmpesa|m-pesa\b/i.test(raw)) return { type: 'mobile_money', institution: 'M-Pesa' };
  if (/\bcash\s*app\b/i.test(raw)) return { type: 'wallet', institution: 'Cash App' };
  if (/\bvenmo\b/i.test(raw)) return { type: 'wallet', institution: 'Venmo' };
  if (/\bpaypal\b/i.test(raw)) return { type: 'wallet', institution: 'PayPal' };
  const wallets: [RegExp, string][] = [
    [/\bmtn\s*(?:momo|mobile money)|\bmomo\b/i, 'MTN MoMo'],
    [/\bairtel\s*money\b/i, 'Airtel Money'],
    [/\borange\s*money\b/i, 'Orange Money'],
    [/\bmoov\s*money\b/i, 'Moov Money'],
    [/\bwave\b/i, 'Wave'],
    [/\bvodafone\s*cash\b|\btelecel\s*cash\b/i, 'Vodafone Cash'],
    [/\becocash\b/i, 'EcoCash'],
    [/\btigo\s*pesa|\bmixx\b/i, 'Tigo Pesa'],
    [/\bhalo\s*pesa\b/i, 'HaloPesa'],
    [/\bopay\b/i, 'OPay'],
    [/\bpalmpay\b/i, 'PalmPay'],
    [/\bchipper\b/i, 'Chipper Cash'],
    [/\bgcash\b/i, 'GCash'],
    [/\bmaya\b|\bpaymaya\b/i, 'Maya'],
    [/\bpaytm\b/i, 'Paytm'],
    [/\bphonepe\b/i, 'PhonePe'],
    [/\bbkash\b/i, 'bKash'],
    [/\bnagad\b/i, 'Nagad'],
    [/\bjazzcash\b/i, 'JazzCash'],
    [/\beasypaisa\b/i, 'Easypaisa'],
    [/\bhellocash\b/i, 'HelloCash'],
    [/\bamole\b/i, 'Amole'],
  ];
  for (const [re, name] of wallets) if (re.test(raw)) return { type: 'mobile_money', institution: name };
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
  if (/\bbunna\b/i.test(raw)) return { type: 'bank', institution: 'Bunna' };
  if (/\bnib\s*bank|\bnib\b/i.test(raw)) return { type: 'bank', institution: 'Nib' };
  if (/\benat\b/i.test(raw)) return { type: 'bank', institution: 'Enat' };
  if (/\bberhan\b/i.test(raw)) return { type: 'bank', institution: 'Berhan' };
  if (/\boromia\b/i.test(raw)) return { type: 'bank', institution: 'Oromia' };
  if (/\blion\s*bank\b/i.test(raw)) return { type: 'bank', institution: 'Lion' };
  if (/\bamhara\s*bank\b/i.test(raw)) return { type: 'bank', institution: 'Amhara' };
  if (/\btsedey\b/i.test(raw)) return { type: 'bank', institution: 'Tsedey' };
  if (/\bsiinqee\b/i.test(raw)) return { type: 'bank', institution: 'Siinqee' };
  if (/\bzamzam\b/i.test(raw)) return { type: 'bank', institution: 'ZamZam' };
  if (/\bhijra\b/i.test(raw)) return { type: 'bank', institution: 'Hijra' };
  if (/\bgadaa\b/i.test(raw)) return { type: 'bank', institution: 'Gadaa' };
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
  // Strip balance and fee clauses so they can't win the amount match.
  const figure = `${OPT_CUR}(?:${NUM})(?:\\s?${ANY_CUR})?`;
  const withoutBalance = raw
    .replace(
      new RegExp(
        `\\b(?:avail(?:able)?\\.?\\s*bal(?:ance)?|(?:new|current|available|ledger|remaining|closing|updated|account|e-?money)?\\s*balance|solde|saldo|salio)\\b[^\\d]{0,40}?${figure}`,
        'gi',
      ),
      ' ',
    )
    .replace(/ቀሪ\s*ሂሳብ[^\d]{0,20}[\d.,\s]+/g, ' ')
    .replace(
      new RegExp(`\\b(?:transaction cost|service charge|fees?|charges?|frais|commission|tarifa|comisi[óo]n|VAT|tax)\\b[^\\d]{0,20}?${figure}`, 'gi'),
      ' ',
    )
    .replace(/\bwith a (?:total|S\.?\s*charge|VAT)[^.]*?/gi, ' ');

  const currency = detectCurrency(withoutBalance) || detectCurrency(raw);
  const verbs = String.raw`(?:transfered|transferred|received|paid|sent|debited|credited|deposited|withdrawn|withdrew|purchase(?:d)?|bought|spent|charged|refunded)`;
  const patterns: RegExp[] = [];
  if (currency) {
    const cur = currencyTokenSource(currency);
    patterns.push(
      new RegExp(`\\b${verbs}\\s+(?:with\\s+|of\\s+|for\\s+)?${cur}\\s?(${NUM})`, 'i'),
      new RegExp(`${cur}\\s?(${NUM})`, 'i'),
      new RegExp(`(${NUM})\\s?${cur}`, 'i'),
    );
  }
  // No currency printed: only a figure with cents right after a money verb, never a phone number.
  patterns.push(new RegExp(`\\b${verbs}\\s+(?:with\\s+|of\\s+)?(\\d[\\d,.]*[.,]\\d{2})\\b`, 'i'));
  patterns.push(/\b(?:amount|amt|montant|monto|valor|kiasi)[:\s]+(\d[\d,.\s]*\d)/i);

  for (const re of patterns) {
    const m = withoutBalance.match(re);
    if (!m) continue;
    const amt = normalizeAmount(m[1]);
    if (amt) return { amount: amt, currency };
  }
  return { amount: null, currency };
}

const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function validStamp(year: number, monthIndex: number, day: number, h = 0, min = 0, sec = 0): string | null {
  const nowY = new Date().getFullYear();
  if (year < 2000 || year > nowY + 1 || monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return null;
  const dt = new Date(year, monthIndex, day, h, min, sec);
  if (Number.isNaN(dt.getTime()) || dt.getMonth() !== monthIndex || dt.getDate() !== day) return null;
  if (dt.getTime() > Date.now() + 48 * 60 * 60 * 1000) return null;
  return dt.toISOString();
}

/** Bank date inside the SMS. Ethiopian alerts are day/month/year ("29/01/2024 14:30:00"). */
export function extractSmsOccurredAt(text: string): string | null {
  const raw = text || '';
  const dmy = raw.match(
    /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (dmy) {
    let day = Number(dmy[1]);
    let month = Number(dmy[2]);
    const year = Number(dmy[3]);
    if (month > 12 && day <= 12) {
      const swap = day;
      day = month;
      month = swap;
    }
    const stamp = validStamp(year, month - 1, day, Number(dmy[4] || 0), Number(dmy[5] || 0), Number(dmy[6] || 0));
    if (stamp) return stamp;
  }
  const named = raw.match(
    /\b(\d{1,2})[-\s](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-\s,](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/i,
  );
  if (named) {
    const stamp = validStamp(
      Number(named[3]),
      MONTH_INDEX[named[2].slice(0, 3).toLowerCase()] ?? -1,
      Number(named[1]),
      Number(named[4] || 0),
      Number(named[5] || 0),
      Number(named[6] || 0),
    );
    if (stamp) return stamp;
  }
  const iso = raw.match(/\b(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (iso) {
    const stamp = validStamp(
      Number(iso[1]),
      Number(iso[2]) - 1,
      Number(iso[3]),
      Number(iso[4] || 0),
      Number(iso[5] || 0),
      Number(iso[6] || 0),
    );
    if (stamp) return stamp;
  }
  return null;
}

/** Bank date if the text has one, otherwise when the phone received the SMS. */
export function smsOccurredAt(text: string, smsDateMs?: number): string {
  const fromText = extractSmsOccurredAt(text);
  if (fromText) return fromText;
  if (smsDateMs && smsDateMs > 946684800000) return new Date(smsDateMs).toISOString();
  return new Date().toISOString();
}

/** Remaining balance the bank printed — never the transfer principal. */
export function extractSmsStatedBalance(text: string): string | null {
  const raw = text || '';
  const cur = OPT_CUR;
  const patterns = [
    new RegExp(`\\b(?:your\\s+)?(?:current\\s+)?(?:e-?money\\s+)?(?:account\\s+)?balance\\s+is\\s+${cur}(${NUM})`, 'i'),
    new RegExp(`\\bAvail(?:able)?\\.?\\s*Bal(?:ance)?\\s*[:.]?\\s*${cur}(${NUM})`, 'i'),
    new RegExp(`\\b(?:available|current|ledger|new|remaining|updated|closing|account)\\s+(?:[A-Za-z-]+\\s+)?balance\\s*(?:is\\s*)?[:.]?\\s*${cur}(${NUM})`, 'i'),
    new RegExp(`\\bbalance\\s*[:.]\\s*${cur}(${NUM})`, 'i'),
    new RegExp(`\\b(?:nouveau\\s+)?solde(?:\\s+disponible)?\\s*(?:est\\s*(?:de\\s*)?)?[:.]?\\s*${cur}(${NUM})`, 'i'),
    new RegExp(`\\bsaldo(?:\\s+(?:disponible|dispon[íi]vel|actual|atual))?\\s*(?:es\\s*(?:de\\s*)?|[ée]\\s*(?:de\\s*)?)?[:.]?\\s*${cur}(${NUM})`, 'i'),
    new RegExp(`\\bsalio\\s+(?:lako\\s+)?(?:ni\\s+)?${cur}(${NUM})`, 'i'),
    new RegExp(`(${NUM})\\s?${ANY_CUR}?\\s*(?:available|avail(?:able)?\\s+bal)`, 'i'),
    new RegExp(`ቀሪ\\s*ሂሳብ(?:ዎ)?\\s*${cur}(${NUM})`),
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
  // What happened to *your* account wins over words about the other side ("credited to Abebe").
  if (
    /\byou have (?:received|been credited)\b/i.test(raw) ||
    /\b(?:your\s+)?(?:account|a\/c|acct|card|wallet)\b[^.]{0,40}\b(?:has been|was|is)\s+credited\b/i.test(raw) ||
    /\b(?:direct deposit|money received|ach credit|payment received)\b/i.test(raw)
  ) {
    return 'income';
  }
  if (
    /\byou have (?:transfered|transferred|sent|paid|been debited|bought|purchased|recharged|topped up|withdrawn)\b/i.test(raw) ||
    /\b(?:your\s+)?(?:account|a\/c|acct|card|wallet)\b[^.]{0,40}\b(?:has been|was|is)\s+(?:debited|charged)\b/i.test(raw) ||
    /\b(?:sent|paid)\s+to\b/i.test(raw) ||
    (/\bfrom your account\b/i.test(raw) && /\bto\b/i.test(raw))
  ) {
    return 'expense';
  }
  // Otherwise the first money word in the message decides.
  const inAt = raw.search(INCOME_WORDS);
  const outAt = raw.search(EXPENSE_WORDS);
  if (inAt < 0 && outAt < 0) return null;
  if (inAt < 0) return 'expense';
  if (outAt < 0) return 'income';
  return inAt < outAt ? 'income' : 'expense';
}

/**
 * Mobile-money country codes (Ethiopia, Kenya, Tanzania, Uganda, Rwanda, Burundi, Ghana, Nigeria,
 * South Africa, Zambia, Zimbabwe, Malawi, India, Pakistan, Bangladesh, Philippines, Egypt)
 * and local forms ("09…", "07…").
 */
const PHONE_PREFIX = String.raw`(?:251|254|255|256|250|257|233|234|27|260|263|265|91|92|880|63|20|0[1-9]|9)`;

/** Phone numbers are people you paid or who paid you — never your bank account. */
function isPhoneToken(token: string): boolean {
  const d = token.replace(/\D/g, '');
  if (d.length < 9 || d.length > 13) return false;
  return new RegExp(`^${PHONE_PREFIX}`).test(d) || token.trim().startsWith('+');
}

/** Last 4 of a bank/card token. Rejects phones and bare short numbers with no mask. */
function accountTokenLast4(token: string): { last4: string; number: string | null } | null {
  if (!token || isPhoneToken(token)) return null;
  const digits = token.replace(/\D/g, '');
  if (digits.length < 4) return null;
  const masked = /[*xX]/.test(token);
  // "1234" alone is a year, OTP, or ref — not an account. Masked or long tokens are.
  if (!masked && digits.length < 8 && digits.length !== 4) return null;
  if (!masked && digits.length < 8) return null;
  return { last4: digits.slice(-4), number: digits.length > 4 ? digits : null };
}

/** Drop "to NAME Account 1***9214" and "to 2519…" so those digits can't become yours. */
function stripCounterpartyAccounts(raw: string): string {
  return raw
    .replace(/\bto\s+[A-Za-z][^.\n]{0,60}?\b(?:account|a\/c|acct)\s+[*xX0-9]{4,24}/gi, ' ')
    .replace(/\b(?:to|receiver(?:'s)?|beneficiary)\s+(?:account|a\/c|acct)\s+[*xX0-9]{4,24}/gi, ' ')
    .replace(new RegExp(`\\(\\s*\\+?${PHONE_PREFIX}[\\d*]{6,14}\\s*\\)`, 'g'), ' ')
    .replace(new RegExp(`\\b(?:to|from)\\s+\\+?${PHONE_PREFIX}[\\d*]{6,14}\\b`, 'gi'), ' ');
}

function extractOwnAccount(raw: string): { last4: string | null; number: string | null; owned: boolean } {
  const none = { last4: null, number: null, owned: false };
  const body = stripCounterpartyAccounts(raw);
  const ending = body.match(/\b(?:card|account|acct|a\/c)\s+ending(?:\s+in)?\s+(\d{4})\b/i);
  if (ending) return { last4: ending[1], number: null, owned: true };

  const yours =
    body.match(
      /\b(?:from\s+)?your\s+(?:account|a\/c|acct|acc)(?:\s*(?:no|number|#)\.?)?\s*[:\s-]*([*xX0-9]{4,24})/i,
    ) ||
    body.match(/\byour\s+(?:account|a\/c|acct)\s+([*xX0-9]{4,24})\s+has been\s+(?:debited|credited)/i) ||
    body.match(
      /\b(?:debited|credited)\s+from\s+(?:your\s+)?(?:account|a\/c|acct)\s+([*xX0-9]{4,24})/i,
    ) ||
    body.match(/\b(?:a\/c|acct)\s+(\*{2,}\d{4})\b/i);
  if (!yours) return none;
  if (/^\d{4}$/.test(yours[1]) && /\bending(?:\s+in)?\s+\d{4}\b/i.test(body)) {
    return { last4: yours[1], number: null, owned: true };
  }
  const parsed = accountTokenLast4(yours[1]);
  if (!parsed) return none;
  return { last4: parsed.last4, number: parsed.number, owned: true };
}

function extractCounterpartyLast4s(raw: string, ownLast4: string | null): string[] {
  const found = new Set<string>();
  const remember = (token: string) => {
    const d = token.replace(/\D/g, '');
    const l4 = d.length >= 4 ? d.slice(-4) : null;
    if (!l4 || l4 === ownLast4) return;
    found.add(l4);
  };
  for (const m of raw.matchAll(
    /\b(?:to\s+[A-Za-z][^.\n]{0,60}?\b)?(?:account|a\/c|acct)\s+([*xX0-9]{4,24})/gi,
  )) {
    const start = m.index ?? 0;
    const before = raw.slice(Math.max(0, start - 16), start);
    if (/\byour\s+$/i.test(before)) continue;
    remember(m[1]);
  }
  for (const m of raw.matchAll(new RegExp(`\\+?${PHONE_PREFIX}[\\d*]{7,14}`, 'g'))) {
    if (isPhoneToken(m[0])) remember(m[0]);
  }
  return [...found];
}

function extractCounterparty(raw: string, kind: 'income' | 'expense' | null): string | null {
  if (kind === 'expense') {
    const to =
      raw.match(
        /\b(?:transfered|transferred|sent|paid)\s+(?:[A-Z]{3}|[^\s\d]{1,5})?\s*\d[\d,.]*\s+to\s+([+\dA-Za-z*][+\dA-Za-z0-9 *().'-]{1,50}?)(?:\s+on\b|\s+from\b|\s+Ref\b|\.|,|$)/i,
      ) ||
      raw.match(
        /\b\d[\d,.]*\s+(?:sent|paid)\s+to\s+([+\dA-Za-z*][+\dA-Za-z0-9 *().'-]{1,50}?)(?:\s+on\b|\s+for\b|\.|,|$)/i,
      ) ||
      raw.match(/\bto\s+([+\dA-Za-z*][+\dA-Za-z0-9 *().'-]{1,40}?)(?:\s+on\b|\s+from\b|\s+Ref\b|\.|,|$)/i) ||
      raw.match(
        /\bpaid\s+(?:[A-Z]{3}|[^\s\d]{1,5})?\s*\d[\d,.]*\s+for\s+([A-Za-z0-9][A-Za-z0-9 .'-]{1,40}?)(?:\s+on\b|\.|,|$)/i,
      );
    if (to) return cleanName(to[1]);
  }
  if (kind === 'income') {
    // Wallets often say "from +2519…" / "from 0712…" with no name.
    const phone = raw.match(/\bfrom\s+(\+?\d[\d*]{7,14})\b/i);
    if (phone) return cleanName(phone[1]);

    const from =
      raw.match(
        /\breceived\s+(?:[A-Z]{3}|[^\s\d]{1,5})?\s*\d[\d,.]*\s+from\s+([+\dA-Za-z*][+\dA-Za-z0-9 *().'-]{1,50}?)(?:\s+on\b|\.|,|$)/i,
      ) ||
      raw.match(/\bcredited\b[\s\S]{0,80}?\bfrom\s+([+\dA-Za-z*][+\dA-Za-z0-9 *().'-]{1,40}?)(?:\s+on\b|\.|,|$)/i) ||
      raw.match(/\bfrom\s+([+\dA-Za-z*][+\dA-Za-z0-9 *().'-]{1,40}?)(?:\s+on\b|\.|,|$)/i);
    if (from) {
      const name = cleanName(from[1].replace(/\(\s*\+?\d[\d*]+\s*\)/g, '').trim());
      if (name && !/^your\b/i.test(name) && !/^account\b/i.test(name)) return name;
    }
  }
  return null;
}

/** Reject OTP / balance-only / non-transfer spam. */
export function isTransferSms(text: string): boolean {
  const raw = (text || '').trim();
  if (raw.length < 24) return false;
  if (OTP_RE.test(raw)) return false;
  if (!/\d/.test(raw)) return false;
  // Balance notices alone ("your balance is …") are not a transfer.
  return INCOME_WORDS.test(raw) || EXPENSE_WORDS.test(raw) || /\b(?:zelle|ach|transaction of)\b/i.test(raw);
}

const OTP_RE =
  /\b(?:otp|one[-\s]?time|verification code|pin code|security code|code de (?:v[ée]rification|confirmation)|c[óo]digo de (?:verificaci[óo]n|seguran[çc]a|acceso)|nambari ya siri)\b/i;

/** SMS that can discover an account (transfer, card alert, or balance notice). */
export function isAccountHintSms(text: string): boolean {
  const raw = (text || '').trim();
  if (raw.length < 20) return false;
  if (OTP_RE.test(raw)) return false;
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
    occurredAt: extractSmsOccurredAt(raw),
    accountOwned: false,
    counterpartyLast4s: [],
  };
  const own = extractOwnAccount(raw);
  out.accountLast4 = own.last4;
  out.accountNumber = own.number;
  out.accountOwned = own.owned;
  out.counterpartyLast4s = extractCounterpartyLast4s(raw, own.last4);
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
  if (own.owned && own.last4) score += 0.15;
  out.otherAccountLast4 = out.counterpartyLast4s.find((l4) => l4 !== own.last4) || null;

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
  // Telebirr / M-Pesa: the SMS is yours, but the phone number in it is the other person.
  // One wallet per service — never an account per recipient.
  if (
    !out.accountLast4 &&
    (out.accountType === 'mobile_money' || out.accountType === 'wallet') &&
    out.institutionHint &&
    /\byou have\b|\byour (?:current\s+)?(?:e-?money\s+|m-pesa\s+|wallet\s+)?(?:account\s+)?balance\b|\bnew\b[^.]{0,20}\bbalance\b|\bconfirmed\b|vous avez|votre solde|has recibido|tu saldo|voc[êe] recebeu|seu saldo|umepokea|umetuma|salio lako/i.test(raw)
  ) {
    out.accountOwned = true;
  }
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
