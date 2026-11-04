// Mirrors loans.ComputeCharged on the server (backend/api/internal/loans/money.go) so
// the form can preview the total. The server's number is the one both people accept.

export type InterestCharge = 'once' | 'per_month' | 'per_year';

export const INTEREST_CHARGES: { id: InterestCharge; label: string }[] = [
  { id: 'once', label: 'Once' },
  { id: 'per_month', label: 'Per month' },
  { id: 'per_year', label: 'Per year' },
];

function day(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

/** Calendar months from start to due; a started month counts, minimum one. */
export function monthsCharged(startIso: string, dueIso: string): number {
  const s = day(startIso);
  const d = day(dueIso);
  let months = (d.getUTCFullYear() - s.getUTCFullYear()) * 12 + (d.getUTCMonth() - s.getUTCMonth());
  if (d.getUTCDate() > s.getUTCDate()) months += 1;
  return Math.max(1, months);
}

export function computeCharged(principal: number, ratePercent: number, charge: InterestCharge, startIso: string, dueIso: string) {
  const base = (principal * ratePercent) / 100;
  let interest = base;
  let label = `${ratePercent}% once`;
  if (charge === 'per_month' && dueIso) {
    const months = monthsCharged(startIso, dueIso);
    interest = base * months;
    label = `${ratePercent}% × ${months} month${months === 1 ? '' : 's'}`;
  } else if (charge === 'per_year' && dueIso) {
    const days = Math.max(1, Math.round((day(dueIso).getTime() - day(startIso).getTime()) / 86_400_000));
    interest = (base * days) / 365;
    label = `${ratePercent}% a year × ${days} days`;
  }
  interest = Math.round(interest * 10_000) / 10_000;
  return { interest, total: principal + interest, label };
}

export function chargeLabel(charge?: string | null): string {
  if (charge === 'per_month') return 'per month';
  if (charge === 'per_year') return 'per year';
  return 'once';
}
