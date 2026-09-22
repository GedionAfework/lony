/** Display helpers for money inputs (thousands separators). */

export function stripAmount(raw: string): string {
  return raw.replace(/,/g, '').replace(/[^\d.]/g, '');
}

/** Format a numeric string with commas every 3 digits (keeps decimals). */
export function formatAmountCommas(raw: string): string {
  const cleaned = stripAmount(raw);
  if (!cleaned) return '';
  const neg = cleaned.startsWith('-');
  const body = neg ? cleaned.slice(1) : cleaned;
  const [intPart, ...rest] = body.split('.');
  const dec = rest.length ? rest.join('').replace(/\./g, '') : undefined;
  const withCommas = (intPart || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const out = dec !== undefined ? `${withCommas}.${dec}` : withCommas;
  return neg ? `-${out}` : out;
}

export function parseAmountNumber(raw: string): number {
  const n = Number(stripAmount(raw));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Locale-aware money formatting. Uses CLDR rules so the currency symbol/code
 * appears as a prefix or suffix depending on locale + currency (e.g. $10 vs 10 €).
 */
export function formatMoney(
  amount: string | number | null | undefined,
  currency: string | null | undefined,
  locale = 'en',
): string {
  if (amount === null || amount === undefined || amount === '') {
    return '';
  }
  const n = typeof amount === 'number' ? amount : Number(String(amount).replace(/,/g, ''));
  const code = (currency || '').trim().toUpperCase();
  if (!Number.isFinite(n)) {
    return code ? `${amount} ${code}` : String(amount);
  }
  try {
    if (!code) {
      return new Intl.NumberFormat(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      }).format(n);
    }
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      currencyDisplay: 'symbol',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    const num = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(n);
    return code ? `${num} ${code}` : num;
  }
}

/** Signed money (loan list): sign placement follows the locale via Intl. */
export function formatSignedMoney(
  amount: string | null | undefined,
  currency: string | null | undefined,
  sign: 1 | -1,
  locale = 'en',
): string {
  if (!amount) {
    return '—';
  }
  const n = Number(String(amount).replace(/,/g, ''));
  if (!Number.isFinite(n)) {
    return '—';
  }
  return formatMoney(sign * Math.abs(n), currency, locale);
}

