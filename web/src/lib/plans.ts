import type { MyBilling, PlanLimits, PlanOption, PlanTier, User } from './api';

export const TIER_LABEL: Record<PlanTier, string> = { free: 'Free', plus: 'Plus', pro: 'Pro' };

export const TIER_BLURB: Record<PlanTier, string> = {
  free: 'Track money, loans and goals.',
  plus: 'Unlimited AI help and reports.',
  pro: 'Everything, plus bank sync.',
};

/** The user's tier as the app should show it ('premium' is the old name for Pro). */
export function tierOf(user?: Pick<User, 'plan_tier'> | null): PlanTier {
  const t = user?.plan_tier;
  if (t === 'plus') return 'plus';
  if (t === 'pro' || t === 'premium') return 'pro';
  return 'free';
}

function count(n: number, unit: string, per = ''): string | null {
  if (n === 0) return null;
  if (n < 0) return `Unlimited ${unit}`;
  return `${n.toLocaleString()} ${unit}${per}`;
}

/** Human feature lines for a tier, best first. */
export function featureLines(l: PlanLimits): { text: string; on: boolean }[] {
  const ai = l.ai_monthly < 0 ? `Unlimited AI coach & insights (${l.ai_daily}/day)` : count(l.ai_monthly, 'AI requests', ' a month');
  const lines: { text: string; on: boolean }[] = [
    { text: 'Accounts, budgets, loans & goals', on: true },
    { text: ai ?? 'AI coach & insights', on: Boolean(ai) },
    { text: count(l.captures_monthly, 'receipt & voice captures', ' a month') ?? 'Receipt & voice capture', on: l.captures_monthly !== 0 },
    {
      text: l.insights_every_days <= 0 ? 'Fresh insights any time' : l.insights_every_days === 1 ? 'Daily insight refresh' : `Insights every ${l.insights_every_days} days`,
      on: true,
    },
    { text: 'Analytics reports', on: l.reports },
    { text: 'Trip budgets', on: l.trips },
    { text: l.bank_links > 0 ? `${l.bank_links} connected bank${l.bank_links > 1 ? 's' : ''}` : 'Connected banks', on: l.bank_links !== 0 },
  ];
  return lines;
}

export function formatPrice(p?: Pick<PlanOption, 'amount_cents' | 'currency'>): string | null {
  if (!p?.amount_cents || !p.currency) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: p.currency.toUpperCase(),
      minimumFractionDigits: p.amount_cents % 100 === 0 ? 0 : 2,
    }).format(p.amount_cents / 100);
  } catch {
    return `${(p.amount_cents / 100).toFixed(2)} ${p.currency.toUpperCase()}`;
  }
}

function fmtDate(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function daysLeft(iso?: string): number {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

/** One line describing where the plan comes from and when it changes. */
export function planStatusLine(b: MyBilling): string {
  const sub = b.subscription;
  if (b.source === 'polar' && sub) {
    if (sub.status === 'past_due') return 'Payment failed: update your card to keep your plan.';
    if (sub.cancel_at_period_end) return `Cancelled, active until ${fmtDate(sub.current_period_end)}.`;
    if (sub.current_period_end) return `Renews on ${fmtDate(sub.current_period_end)}.`;
    return 'Active subscription.';
  }
  if (b.source === 'trial') {
    const d = daysLeft(b.expires_at);
    return d > 0 ? `Free trial: ${d} day${d === 1 ? '' : 's'} left (ends ${fmtDate(b.expires_at)}).` : 'Your free trial has ended.';
  }
  if (b.source === 'admin') return b.expires_at ? `Granted by Lony until ${fmtDate(b.expires_at)}.` : 'Granted by Lony.';
  return 'Upgrade any time. Cancel whenever you like.';
}
