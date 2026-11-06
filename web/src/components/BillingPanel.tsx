import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight, Check, CreditCard, Crown, ExternalLink, Flame, Leaf, Sparkles, X, Zap } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { api, type BillingCatalog, type MyBilling, type PlanLimits, type PlanOption, type PlanTier } from '../lib/api';
import { useCountdownParts } from './Countdown';
import { TIER_BLURB, TIER_LABEL, featureLines, formatPrice, planStatusLine } from '../lib/plans';
import { Button } from './Button';
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

      <PlansSection
        catalog={catalog}
        mine={mine}
        subscribed={subscribed}
        busyKey={busyKey}
        onBuy={onUpgrade}
        onManage={onManage}
        onExpired={() => void load()}
      />
      <p className="muted billing-fine">
        Payments are handled securely by Polar. Cancel any time from Manage billing; you keep your plan until the end of the paid period.
      </p>
    </div>
  );
}

const TIER_ICON: Record<PlanTier, typeof Leaf> = { free: Leaf, plus: Zap, pro: Crown };

type Period = 'month' | 'year';

function yearSaving(options: PlanOption[]): number {
  const m = options.find((o) => o.interval === 'month');
  const y = options.find((o) => o.interval === 'year');
  if (!m?.amount_cents || !y?.amount_cents || m.currency !== y.currency) return 0;
  return Math.round((1 - y.amount_cents / (m.amount_cents * 12)) * 100);
}

/** The plan grid with one Monthly / Yearly switch for every card. */
function PlansSection({
  catalog,
  mine,
  subscribed,
  busyKey,
  onBuy,
  onManage,
  onExpired,
}: {
  catalog: BillingCatalog;
  mine: MyBilling;
  subscribed: boolean;
  busyKey: string | null;
  onBuy: (key: string) => void;
  onManage: () => void;
  onExpired: () => void;
}) {
  const hasYear = catalog.plans.some((p) => p.interval === 'year');
  const hasMonth = catalog.plans.some((p) => p.interval === 'month');
  const [period, setPeriod] = useState<Period>(hasMonth ? 'month' : 'year');
  const bestSave = Math.max(0, ...(['plus', 'pro'] as PlanTier[]).map((t) => yearSaving(catalog.plans.filter((p) => p.tier === t))));
  const anyDeal = catalog.plans.some((p) => p.discount);

  return (
    <section className="plans">
      <div className="plans-head">
        <div>
          <h3 className="plans-title">{mine.tier === 'free' ? 'Upgrade your plan' : 'Plans'}</h3>
          <p className="plans-sub">{anyDeal ? 'Limited-time offers are on now.' : 'Cancel any time. Keep your plan until the end of the paid period.'}</p>
        </div>
        {hasYear && hasMonth ? (
          <div className="period-toggle" role="radiogroup" aria-label="Billing period">
            {(['month', 'year'] as Period[]).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={period === p} className={period === p ? 'on' : ''} onClick={() => setPeriod(p)}>
                {p === 'month' ? 'Monthly' : 'Yearly'}
                {p === 'year' && bestSave > 0 ? <span className="period-save">−{bestSave}%</span> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {!catalog.checkout_ready ? <div className="notice">Online payments are being set up. Paid plans will be available here soon.</div> : null}

      <div className="plan-grid">
        {catalog.tiers.map(({ tier, limits }) => (
          <PlanCard
            key={tier}
            tier={tier}
            limits={limits}
            period={period}
            onPeriod={setPeriod}
            options={catalog.plans.filter((p) => p.tier === tier)}
            current={mine.tier === tier}
            trial={mine.source === 'trial'}
            subscribed={subscribed}
            busyKey={busyKey}
            onBuy={onBuy}
            onManage={onManage}
            onExpired={onExpired}
          />
        ))}
      </div>
    </section>
  );
}

function TimerTiles({ to, onDone }: { to?: string; onDone: () => void }) {
  const p = useCountdownParts(to, onDone);
  if (!p) return null;
  const cells: [number, string][] = p.d > 0 ? [[p.d, 'd'], [p.h, 'h'], [p.m, 'm'], [p.s, 's']] : [[p.h, 'h'], [p.m, 'm'], [p.s, 's']];
  return (
    <span className="deal-timer" title={to ? `Ends ${new Date(to).toLocaleString()}` : undefined} aria-label="Time left on this offer">
      {cells.map(([n, u]) => (
        <span key={u} className="deal-cell">
          <b>{String(n).padStart(2, '0')}</b>
          <i>{u}</i>
        </span>
      ))}
    </span>
  );
}

/** One tier: price for the chosen period (with any running offer and its countdown), the button, then features. */
function PlanCard({
  tier,
  limits,
  period,
  onPeriod,
  options,
  current,
  trial,
  subscribed,
  busyKey,
  onBuy,
  onManage,
  onExpired,
}: {
  tier: PlanTier;
  limits: PlanLimits;
  period: Period;
  onPeriod: (p: Period) => void;
  options: PlanOption[];
  current: boolean;
  trial: boolean;
  subscribed: boolean;
  busyKey: string | null;
  onBuy: (key: string) => void;
  onManage: () => void;
  onExpired: () => void;
}) {
  const monthly = options.find((o) => o.interval === 'month');
  const yearly = options.find((o) => o.interval === 'year');
  const chosen = period === 'year' ? yearly ?? monthly : monthly ?? yearly;
  const fallback = chosen && chosen.interval !== period;
  const price = formatPrice(chosen);
  const deal = chosen?.discount ?? null;
  const list = deal && chosen?.list_cents ? formatPrice({ amount_cents: chosen.list_cents, currency: chosen.currency }) : null;
  const save = yearSaving(options);
  const featured = tier === 'pro';
  const Icon = TIER_ICON[tier];
  const offered = tier === 'free' || options.length > 0;
  const per = chosen?.interval === 'year' ? 'year' : 'month';
  const off = deal ? (deal.kind === 'percent' ? `${Math.round(deal.value)}% off` : `${formatPrice({ amount_cents: deal.off_cents, currency: chosen?.currency })} off`) : '';

  return (
    <div className={['plan-card', `tier-${tier}`, current ? 'current' : '', featured ? 'featured' : '', deal ? 'has-deal' : ''].filter(Boolean).join(' ')}>
      {current ? <div className="plan-ribbon current">Your plan</div> : featured ? <div className="plan-ribbon">Most popular</div> : null}

      <div className="plan-card-head">
        <span className="plan-icon">
          <Icon size={18} />
        </span>
        <div>
          <div className="plan-card-name">{TIER_LABEL[tier]}</div>
          <div className="plan-card-blurb">{TIER_BLURB[tier]}</div>
        </div>
      </div>

      {deal && chosen ? (
        <div className="deal-strip">
          <span className="deal-badge">
            <Flame size={13} /> {off}
          </span>
          {deal.label ? <span className="deal-label">{deal.label}</span> : null}
          {deal.ends_at ? (
            <span className="deal-ends">
              <span className="deal-ends-text">Ends in</span>
              <TimerTiles key={chosen.key} to={deal.ends_at} onDone={onExpired} />
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="plan-prices">
        {tier === 'free' ? (
          <>
            <div className="plan-card-price">
              $0
              <small>/forever</small>
            </div>
            <div className="plan-price-alt">No card needed</div>
          </>
        ) : offered && chosen ? (
          <>
            <div className="plan-card-price">
              {list ? <s className="plan-was">{list}</s> : null}
              {price ?? '—'}
              {price ? <small>/{per}</small> : null}
            </div>
            <div className="plan-price-alt">
              {chosen.interval === 'year' && chosen.amount_cents ? (
                <>
                  <strong>{formatPrice({ amount_cents: Math.round(chosen.amount_cents / 12), currency: chosen.currency })}</strong> a month, billed yearly
                  {save > 0 ? <span className="plan-save">Save {save}%</span> : null}
                </>
              ) : yearly && save > 0 ? (
                <button type="button" className="plan-switch-link" onClick={() => onPeriod('year')}>
                  Pay yearly and save {save}%
                </button>
              ) : (
                <>Billed monthly</>
              )}
            </div>
            {fallback ? <div className="plan-price-note">Only {chosen.interval === 'year' ? 'yearly' : 'monthly'} billing for {TIER_LABEL[tier]}</div> : null}
          </>
        ) : (
          <div className="plan-price-alt">Not offered right now</div>
        )}
      </div>

      <div className="plan-card-action">
        {tier === 'free' ? (
          <Button variant="secondary" block disabled>
            {current ? 'Current plan' : 'Included'}
          </Button>
        ) : subscribed ? (
          current ? (
            <Button variant="secondary" block disabled>
              <Check size={15} /> Current plan
            </Button>
          ) : (
            <Button variant="secondary" block onClick={onManage} busy={busyKey === 'portal'}>
              Switch in billing <ExternalLink size={14} />
            </Button>
          )
        ) : chosen ? (
          <Button
            block
            variant={featured || deal ? 'primary' : 'secondary'}
            disabled={!chosen.available || busyKey !== null}
            busy={busyKey === chosen.key}
            onClick={() => onBuy(chosen.key)}
          >
            {current && trial ? `Keep ${TIER_LABEL[tier]}` : `Upgrade to ${TIER_LABEL[tier]}`} <ArrowRight size={15} />
          </Button>
        ) : null}
        {chosen && !chosen.available && tier !== 'free' && !subscribed ? <div className="plan-action-note">Coming soon</div> : null}
      </div>

      <div className="plan-features-wrap">
        <div className="plan-features-title">What's included</div>
        <ul className="plan-features">
          {featureLines(limits).map((f) => (
            <li key={f.text} className={f.on ? '' : 'off'}>
              <span className="plan-feature-mark">{f.on ? <Check size={12} strokeWidth={3} /> : <X size={12} strokeWidth={2.5} />}</span>
              {f.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
