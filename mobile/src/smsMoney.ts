/** Currencies and amounts in bank / wallet SMS from any country. */

/** ISO 4217 codes. Matched only in UPPER CASE so words like "all", "top", or "try" never count. */
const ISO_CODES = new Set(
  (
    'AED AFN AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD ' +
    'CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP ' +
    'GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KRW KWD KYD ' +
    'KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO ' +
    'NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE ' +
    'SLL SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND ' +
    'VUV WST XAF XCD XOF XPF YER ZAR ZMW ZWL'
  ).split(' '),
);
// Common English words in all-caps SMS that are also ISO codes.
const ISO_WORDS = new Set(['ALL', 'TOP', 'CUP', 'BOB', 'SOS', 'PEN', 'GEL', 'TRY', 'MAD', 'MOP', 'CAD']);

/** Local symbols and names, case-insensitive. Longer ones are tried first ("US$" before "$"). */
const ALIASES: [string, string][] = [
  ['US$', 'USD'], ['USD$', 'USD'], ['CA$', 'CAD'], ['C$', 'CAD'], ['A$', 'AUD'], ['AU$', 'AUD'],
  ['NZ$', 'NZD'], ['HK$', 'HKD'], ['S$', 'SGD'], ['MX$', 'MXN'], ['R$', 'BRL'], ['NT$', 'TWD'],
  ['J$', 'JMD'], ['TT$', 'TTD'], ['GH₵', 'GHS'], ['GH¢', 'GHS'], ['₵', 'GHS'], ['Ksh', 'KES'],
  ['Kshs', 'KES'], ['KSh', 'KES'], ['USh', 'UGX'], ['Ush', 'UGX'], ['TSh', 'TZS'], ['Tsh', 'TZS'],
  ['Birr', 'ETB'], ['ብር', 'ETB'], ['Br', 'ETB'], ['₦', 'NGN'], ['Naira', 'NGN'], ['₹', 'INR'],
  ['Rs.', 'INR'], ['Rs', 'INR'], ['₨', 'PKR'], ['₱', 'PHP'], ['Rp', 'IDR'], ['RM', 'MYR'],
  ['₩', 'KRW'], ['¥', 'JPY'], ['RMB', 'CNY'], ['元', 'CNY'], ['₫', 'VND'], ['฿', 'THB'],
  ['₺', 'TRY'], ['TL', 'TRY'], ['zł', 'PLN'], ['₽', 'RUB'], ['₴', 'UAH'], ['₪', 'ILS'],
  ['€', 'EUR'], ['£', 'GBP'], ['Dhs', 'AED'], ['Dh', 'AED'], ['FCFA', 'XOF'], ['CFA', 'XOF'],
  ['Kwacha', 'ZMW'], ['Cedis', 'GHS'], ['$', 'USD'],
].sort((a, b) => b[0].length - a[0].length) as [string, string][];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isAsciiWord = (s: string) => /^[A-Za-z.]+$/.test(s);

/** A number as banks write it: 1,234.56 · 1.234,56 · 1 234,56 · 1234. */
export const NUM = String.raw`\d{1,3}(?:[,.\u00a0 ]\d{3})+(?:[.,]\d{1,3})?|\d+(?:[.,]\d{1,3})?`;

/** Any currency token, for optional prefixes in balance / counterparty patterns. */
export const ANY_CUR = String.raw`(?:[A-Z]{3}|[A-Za-z]{1,4}\$|[^\d\s:,.()]{1,5})`;

function aliasSource(token: string): string {
  // Letter aliases need word edges ("Rs" not inside "Rsvp"); symbols don't.
  return isAsciiWord(token) ? `\\b${escape(token)}(?![A-Za-z])` : escape(token);
}

/** Regex source matching any way of writing `code`. */
export function currencyTokenSource(code: string): string {
  const parts = [`\\b${code}\\b`];
  for (const [alias, c] of ALIASES) if (c === code) parts.push(aliasSource(alias));
  return `(?:${parts.join('|')})`;
}

const ALIAS_RE = new RegExp(ALIASES.map(([a]) => aliasSource(a)).join('|'), 'gi');
const ISO_RE = /\b[A-Z]{3}\b/g;
const NUM_NEAR = new RegExp(`^\\s?(?:${NUM})|(?:${NUM})\\s?$`);

/**
 * The currency of the first money figure in the text (a code or symbol right next to a number).
 * Falls back to the first currency mentioned at all.
 */
export function detectCurrency(text: string): string | null {
  const raw = text || '';
  type Hit = { index: number; code: string; nearNumber: boolean };
  const hits: Hit[] = [];
  const near = (start: number, end: number) =>
    NUM_NEAR.test(raw.slice(end, end + 14)) || NUM_NEAR.test(raw.slice(Math.max(0, start - 14), start));
  for (const m of raw.matchAll(ISO_RE)) {
    const code = m[0];
    if (!ISO_CODES.has(code)) continue;
    const start = m.index ?? 0;
    const end = start + code.length;
    const nearNumber = near(start, end);
    if (ISO_WORDS.has(code) && !nearNumber) continue;
    hits.push({ index: start, code, nearNumber });
  }
  for (const m of raw.matchAll(ALIAS_RE)) {
    const token = m[0];
    const def = ALIASES.find(([a]) => a.toLowerCase() === token.toLowerCase());
    if (!def) continue;
    const start = m.index ?? 0;
    hits.push({ index: start, code: def[1], nearNumber: near(start, start + token.length) });
  }
  if (!hits.length) return null;
  hits.sort((a, b) => Number(b.nearNumber) - Number(a.nearNumber) || a.index - b.index);
  return hits[0].code;
}

/** "1.234,56" / "1,234.56" / "1 234" → "1234.56". Null for zero or junk. */
export function normalizeAmount(raw: string): string | null {
  let s = (raw || '').replace(/[\u00a0 ]/g, '').trim();
  if (!s) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // Whichever comes last is the decimal mark.
    const dec = lastDot > lastComma ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    s = s.split(thou).join('').replace(dec, '.');
  } else if (lastComma >= 0) {
    const tail = s.length - lastComma - 1;
    const groups = s.split(',').length - 1;
    s = groups === 1 && tail <= 2 ? s.replace(',', '.') : s.split(',').join('');
  } else if (lastDot >= 0) {
    const tail = s.length - lastDot - 1;
    const groups = s.split('.').length - 1;
    if (groups > 1 || tail === 3) s = s.split('.').join('');
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(2);
}
