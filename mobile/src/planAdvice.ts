import { api } from './api';

// How a goal fits the user's money. Uses the average surplus of the last three *full*
// months (the current month is partly over, so it would understate income), and when a
// date is set, what has to be put aside each month to make it.

function money(amount: number, currency: string, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale || undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString()}`;
  }
}

function monthsUntil(dateIso: string, now = new Date()): number {
  const [y, m, d] = dateIso.slice(0, 10).split('-').map(Number);
  if (!y || !m) return 0;
  let months = (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth());
  if ((d || 1) > now.getDate()) months += 1;
  return Math.max(0, months);
}

export async function savingAdvice(
  token: string,
  price: number,
  currency: string,
  targetDate?: string,
  locale?: string,
): Promise<string> {
  if (!Number.isFinite(price) || price <= 0) return '';
  let avgNet: number | null = null;
  try {
    const res = await api.insightsCashflowSeries(token, currency, 4);
    const thisMonth = new Date().toISOString().slice(0, 7);
    const full = (res.series ?? []).filter((p) => p.month < thisMonth).slice(-3);
    const withMoney = full.filter((p) => Number(p.income) > 0 || Number(p.expense) > 0);
    if (withMoney.length) avgNet = withMoney.reduce((sum, p) => sum + Number(p.net || 0), 0) / withMoney.length;
  } catch {
    /* advice is optional */
  }

  const lines: string[] = [];
  const months = targetDate ? monthsUntil(targetDate) : 0;
  if (targetDate && months > 0) {
    const perMonth = price / months;
    lines.push(`To reach ${money(price, currency, locale)} by ${targetDate.slice(0, 10)}, put aside about ${money(perMonth, currency, locale)} a month for ${months} month(s).`);
    if (avgNet !== null) {
      lines.push(
        avgNet >= perMonth
          ? `That fits: you've kept about ${money(avgNet, currency, locale)} a month on average over the last months.`
          : avgNet > 0
            ? `That's more than the ~${money(avgNet, currency, locale)} a month you've kept on average lately — a later date or a cheaper option would fit better.`
            : 'Lately more has gone out than come in, so this will need spending cuts or extra income.',
      );
    }
  } else if (avgNet !== null) {
    if (avgNet > 0) {
      const need = Math.ceil(price / avgNet);
      lines.push(`If you saved everything you've kept on average lately (~${money(avgNet, currency, locale)} a month), it would take about ${need} month(s).`);
    } else {
      lines.push('Lately more has gone out than come in. Set a target date and I can work out a monthly amount.');
    }
  } else {
    lines.push('Log a few months of income and expenses in Lony and I can tell you how long this takes.');
  }
  return lines.join(' ');
}
