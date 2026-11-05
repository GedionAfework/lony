import { Crown } from 'lucide-react';

export type PlanInfo = { plan_tier?: string; plan_source?: string; plan_expires_at?: string | null };

export const TIER_LABEL: Record<string, string> = { free: 'Free', plus: 'Plus', pro: 'Pro' };

export function tierOf(p: PlanInfo) {
  const t = (p.plan_tier || 'free').toLowerCase();
  return t === 'premium' ? 'pro' : t;
}

function daysLeft(iso: string) {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

/** Where the plan comes from, in a few words: "paid", "trial · 5d left", "comp · until Mar 3". */
export function planNote(p: PlanInfo): string {
  const src = p.plan_source || 'free';
  if (src === 'polar') return 'paid';
  if (src === 'trial') return p.plan_expires_at ? `trial · ${daysLeft(p.plan_expires_at)}d left` : 'trial';
  if (src === 'admin') {
    return p.plan_expires_at
      ? `comp · until ${new Date(p.plan_expires_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
      : 'comp';
  }
  return '';
}

export function PlanBadge({ plan, withNote = true }: { plan: PlanInfo; withNote?: boolean }) {
  const tier = tierOf(plan);
  const note = withNote && tier !== 'free' ? planNote(plan) : '';
  return (
    <span className="plan-badge">
      <span className={`badge ${tier === 'pro' ? 'badge-primary' : tier === 'plus' ? 'badge-success' : ''}`}>
        {tier !== 'free' ? <Crown size={12} strokeWidth={2} /> : null}
        {TIER_LABEL[tier] ?? tier}
      </span>
      {note ? <small className="muted">{note}</small> : null}
    </span>
  );
}
