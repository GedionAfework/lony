import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, CreditCard, ExternalLink, Sparkles, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { api, type BillingCatalog, type MyBilling, type PlanLimits, type PlanOption, type PlanTier } from '../lib/api';
import { useCountdown } from './Countdown';
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

      <div className="plans-head">
        <div className="set-group-title" style={{ padding: 0 }}>Plans</div>
        <span className="muted" style={{ fontSize: 12.5 }}>Pay monthly, or yearly and save</span>
      </div>

      {!catalog.checkout_ready ? (
        <div className="notice">Online payments are being set up. Paid plans will be available here soon.</div>
      ) : null}

      <div className="plan-grid">
        {catalog.tiers.map(({ tier, limits }) => (
          <PlanCard
            key={tier}
            tier={tier}
            limits={limits}
            options={catalog.plans.filter((p) => p.tier === tier)}
            current={mine.tier === tier}
            trial={mine.source === 'trial'}
            subscribed={subscribed}
            busyKey={busyKey}
            onBuy={onUpgrade}
            onManage={onManage}
            onExpired={() => void load()}
          />
        ))}
      </div>
      <p className="muted billing-fine">
        Payments are handled securely by Polar. Cancel any time from Manage billing; you keep your plan until the end of the paid period.
      </p>
    </div>
  );
}

function DiscountLine({ option, onExpired }: { option: PlanOption; onExpired: () => void }) {
  const left = useCountdown(option.discount?.ends_at, onExpired);
  const d = option.discount;
  if (!d) return null;
  const off = d.kind === 'percent' ? `${Math.round(d.value)}% off` : `${formatPrice({ amount_cents: d.off_cents, currency: option.currency })} off`;
  return (
    <div className="plan-deal">
      <span className="plan-deal-badge">{off}</span>
      {d.label ? <span className="plan-deal-label">{d.label}</span> : null}
      {left ? (
        <span className="plan-deal-timer" title={d.ends_at ? new Date(d.ends_at).toLocaleString() : undefined}>
          Ends in <b className="mono">{left}</b>
        </span>
      ) : null}
    </div>
  );
}

/** One tier: a monthly/yearly switch, the price (with any discount and its countdown) and features. */
function PlanCard({
  tier,
  limits,
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
  const [period, setPeriod] = useState<'month' | 'year'>(monthly ? 'month' : 'year');
  const chosen = period === 'year' ? yearly ?? monthly : monthly ?? yearly;
  const price = formatPrice(chosen);
  const list = chosen?.discount && chosen.list_cents ? formatPrice({ amount_cents: chosen.list_cents, currency: chosen.currency }) : null;
  const yearSave =
    monthly?.amount_cents && yearly?.amount_cents && monthly.currency === yearly.currency
      ? Math.round((1 - yearly.amount_cents / (monthly.amount_cents * 12)) * 100)
      : 0;
  const offered = tier === 'free' || options.length > 0;

  return (
    <div className={`plan-card ${current ? 'current' : ''} ${tier === 'pro' ? 'featured' : ''}`}>
      <div className="plan-card-head">
        <div className="plan-card-name">
          {TIER_LABEL[tier]}
          {tier === 'pro' && !current ? <span className="plan-pill">Best value</span> : null}
          {current ? <span className="plan-pill current">Current</span> : null}
        </div>
        <div className="plan-card-blurb">{TIER_BLURB[tier]}</div>
      </div>

      {monthly && yearly ? (
        <div className="bill-switch">
          <span className={period === 'month' ? 'on' : ''}>Monthly</span>
          <button
            type="button"
            role="switch"
            aria-checked={period === 'year'}
            aria-label="Bill yearly"
            className={`switch-btn${period === 'year' ? ' on' : ''}`}
            onClick={() => setPeriod(period === 'year' ? 'month' : 'year')}
          >
            <span />
          </button>
          <span className={period === 'year' ? 'on' : ''}>
            Yearly{yearSave > 0 ? <em className="plan-save">save {yearSave}%</em> : null}
          </span>
        </div>
      ) : null}

      <div className="plan-prices">
        {tier === 'free' ? (
          <div className="plan-card-price">
            $0<small>/forever</small>
          </div>
        ) : offered ? (
          <>
            <div className="plan-card-price">
              {list ? <s className="plan-was">{list}</s> : null}
              {price ?? '—'}
              {price ? <small>/{chosen?.interval === 'year' ? 'year' : 'month'}</small> : null}
            </div>
            {chosen?.interval === 'year' && chosen.amount_cents ? (
              <div className="plan-price-alt">
                {formatPrice({ amount_cents: Math.round(chosen.amount_cents / 12), currency: chosen.currency })} a month, billed yearly
              </div>
            ) : null}
            {chosen ? <DiscountLine key={chosen.key} option={chosen} onExpired={onExpired} /> : null}
          </>
        ) : (
          <div className="plan-price-alt">Not offered right now</div>
        )}
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
          current ? (
            <Button variant="secondary" block disabled>
              Current plan
            </Button>
          ) : null
        ) : subscribed ? (
          current ? (
            <Button variant="secondary" block disabled>
              Current plan
            </Button>
          ) : (
            <Button variant="secondary" block onClick={onManage} busy={busyKey === 'portal'}>
              Switch in billing <ExternalLink size={14} />
            </Button>
          )
        ) : chosen ? (
          <Button
            block
            variant={tier === 'pro' ? 'primary' : 'secondary'}
            disabled={!chosen.available || busyKey !== null}
            busy={busyKey === chosen.key}
            onClick={() => onBuy(chosen.key)}
          >
            {current && trial ? `Keep ${TIER_LABEL[tier]}` : `Get ${TIER_LABEL[tier]}`} · {price}/{chosen.interval === 'year' ? 'yr' : 'mo'}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
