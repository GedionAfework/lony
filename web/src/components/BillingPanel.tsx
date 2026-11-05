import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, CreditCard, ExternalLink, Sparkles, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { api, type BillingCatalog, type MyBilling, type PlanTier } from '../lib/api';
import { TIER_BLURB, TIER_LABEL, featureLines, formatPrice, planStatusLine } from '../lib/plans';
import { Button } from './Button';
import { Segmented } from './Segmented';
import { useToast } from './Toast';

const LIVE = new Set(['active', 'trialing', 'past_due']);

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  if (limit === 0) return null;
  const unlimited = limit < 0;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <span className="mono">{unlimited ? `${used} · unlimited` : `${used} / ${limit}`}</span>
      </div>
      {unlimited ? null : (
        <div className="meter-track">
          <div className={`meter-fill ${pct >= 90 ? 'hot' : ''}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

export function BillingPanel() {
  const { token, refreshMe } = useAuth();
  const { show, showError } = useToast();
  const [params, setParams] = useSearchParams();
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
  const [mine, setMine] = useState<MyBilling | null>(null);
  const [interval, setBillingInterval] = useState<'month' | 'year'>('month');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return null;
    try {
      const [c, m] = await Promise.all([api.billingCatalog(), api.myBilling(token)]);
      setCatalog(c);
      setMine(m);
      setLoadError(null);
      return m;
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load your plan');
      return null;
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // Back from Polar checkout: the webhook may land a moment later, so poll briefly.
  useEffect(() => {
    if (params.get('checkout') !== 'success') return;
    show('Payment received. Updating your plan…');
    const next = new URLSearchParams(params);
    next.delete('checkout');
    next.delete('checkout_id');
    setParams(next, { replace: true });
    let tries = 0;
    const timer = window.setInterval(async () => {
      tries += 1;
      const m = await load();
      if ((m && m.source === 'polar') || tries >= 8) {
        window.clearInterval(timer);
        await refreshMe();
        if (m?.source === 'polar') show(`You're on ${TIER_LABEL[m.tier]} now`);
      }
    }, 2500);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const intervals = useMemo(() => {
    const set = new Set((catalog?.plans ?? []).map((p) => p.interval).filter(Boolean));
    return (['month', 'year'] as const).filter((i) => set.has(i));
  }, [catalog]);

  useEffect(() => {
    if (intervals.length && !intervals.includes(interval)) setBillingInterval(intervals[0]);
  }, [intervals, interval]);

  const subscribed = Boolean(mine?.source === 'polar' && mine.subscription && LIVE.has(mine.subscription.status));

  async function onUpgrade(planKey: string) {
    if (!token) return;
    setBusyKey(planKey);
    try {
      const { url } = await api.startCheckout(token, planKey);
      window.location.href = url;
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not start checkout');
      setBusyKey(null);
    }
  }

  async function onManage() {
    if (!token) return;
    setBusyKey('portal');
    try {
      const { url } = await api.billingPortal(token);
      window.location.href = url;
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not open billing');
      setBusyKey(null);
    }
  }

  if (loadError && !mine) {
    return (
      <div className="set-group">
        <div className="set-inset">
          <p className="muted">{loadError}</p>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  if (!catalog || !mine) {
    return (
      <div className="set-group">
        <div className="set-inset muted">Loading your plan…</div>
      </div>
    );
  }

  const yearSaving = (() => {
    const m = catalog.plans.find((p) => p.tier === 'pro' && p.interval === 'month');
    const y = catalog.plans.find((p) => p.tier === 'pro' && p.interval === 'year');
    if (!m?.amount_cents || !y?.amount_cents || m.currency !== y.currency) return 0;
    return Math.round((1 - y.amount_cents / (m.amount_cents * 12)) * 100);
  })();

  return (
    <div className="billing">
      <div className={`plan-now tier-${mine.tier}`}>
        <div className="plan-now-main">
          <div className="plan-now-label">Your plan</div>
          <div className="plan-now-tier">
            {mine.tier !== 'free' ? <Sparkles size={18} /> : null}
            {TIER_LABEL[mine.tier]}
            {mine.source === 'trial' ? <span className="plan-pill">Trial</span> : null}
          </div>
          <div className="plan-now-status">{planStatusLine(mine)}</div>
        </div>
        {mine.can_manage ? (
          <Button variant="secondary" size="sm" onClick={onManage} busy={busyKey === 'portal'}>
            <CreditCard size={15} /> Manage billing
          </Button>
        ) : null}
      </div>

      <div className="set-group">
        <div className="set-group-title">This month</div>
        <div className="set-group-body">
          <div className="set-inset meters">
            <Meter label="AI requests" used={mine.usage.ai_this_month} limit={mine.limits.ai_monthly} />
            <Meter label="Receipt & voice captures" used={mine.usage.captures_this_month} limit={mine.limits.captures_monthly} />
            <Meter label="Connected banks" used={mine.usage.bank_links} limit={mine.limits.bank_links} />
          </div>
        </div>
      </div>

      <div className="plans-head">
        <div className="set-group-title" style={{ padding: 0 }}>Plans</div>
        {intervals.length > 1 ? (
          <Segmented
            value={interval}
            onChange={(v) => setBillingInterval(v as 'month' | 'year')}
            options={[
              { id: 'month', label: 'Monthly' },
              { id: 'year', label: yearSaving > 0 ? `Yearly · save ${yearSaving}%` : 'Yearly' },
            ]}
          />
        ) : null}
      </div>

      {!catalog.checkout_ready ? (
        <div className="notice">Online payments are being set up. Paid plans will be available here soon.</div>
      ) : null}

      <div className="plan-grid">
        {catalog.tiers.map(({ tier, limits }) => {
          const option =
            catalog.plans.find((p) => p.tier === tier && p.interval === interval) ?? catalog.plans.find((p) => p.tier === tier);
          const price = tier === 'free' ? 'Free' : formatPrice(option);
          const per = option?.interval === 'year' ? '/year' : option?.interval === 'month' ? '/month' : '';
          const current = mine.tier === tier;
          return (
            <div key={tier} className={`plan-card ${current ? 'current' : ''} ${tier === 'pro' ? 'featured' : ''}`}>
              <div className="plan-card-head">
                <div className="plan-card-name">
                  {TIER_LABEL[tier]}
                  {tier === 'pro' && !current ? <span className="plan-pill">Best value</span> : null}
                  {current ? <span className="plan-pill current">Current</span> : null}
                </div>
                <div className="plan-card-blurb">{TIER_BLURB[tier as PlanTier]}</div>
              </div>
              <div className="plan-card-price">
                {price ?? '—'}
                {price && tier !== 'free' ? <small>{per}</small> : null}
              </div>
              <ul className="plan-features">
                {featureLines(limits).map((f) => (
                  <li key={f.text} className={f.on ? '' : 'off'}>
                    {f.on ? <Check size={14} /> : <X size={14} />}
                    {f.text}
                  </li>
                ))}
              </ul>
              <div className="plan-card-action">
                {tier === 'free' ? (
                  current ? <Button variant="secondary" block disabled>Current plan</Button> : null
                ) : subscribed ? (
                  current ? (
                    <Button variant="secondary" block disabled>Current plan</Button>
                  ) : (
                    <Button variant="secondary" block onClick={onManage} busy={busyKey === 'portal'}>
                      Switch in billing <ExternalLink size={14} />
                    </Button>
                  )
                ) : (
                  <Button
                    block
                    variant={tier === 'pro' ? 'primary' : 'secondary'}
                    disabled={!catalog.checkout_ready || !option || busyKey !== null}
                    busy={busyKey === option?.key}
                    onClick={() => option && onUpgrade(option.key)}
                  >
                    {current && mine.source === 'trial'
                      ? `Keep ${TIER_LABEL[tier]}`
                      : current
                        ? 'Subscribe'
                        : `Upgrade to ${TIER_LABEL[tier]}`}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="muted billing-fine">
        Payments are handled securely by Polar. Cancel any time from Manage billing; you keep your plan until the end of the paid period.
      </p>
    </div>
  );
}
