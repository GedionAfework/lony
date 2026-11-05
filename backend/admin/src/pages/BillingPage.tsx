import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Check, Copy, RefreshCw, X } from 'lucide-react';
import { api, type BillingOverview, type BillingSubscription, type PlanLimits, type PlanTier } from '../api';
import { useAuth } from '../auth';
import { Button } from '../components/Button';
import { TIER_LABEL } from '../components/PlanBadge';
import { relativeTime } from '../lib/audit';

const TIERS: PlanTier[] = ['free', 'plus', 'pro'];
const nf = new Intl.NumberFormat();

function money(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

type NumKey = 'ai_monthly' | 'ai_daily' | 'captures_monthly' | 'insights_every_days' | 'bank_links';
type BoolKey = 'reports' | 'trips';

const LIMIT_ROWS: ({ key: NumKey; kind: 'num'; label: string; hint: string; unlimited?: boolean } | { key: BoolKey; kind: 'bool'; label: string; hint: string })[] = [
  { key: 'ai_monthly', kind: 'num', label: 'AI requests / month', hint: 'Coach, plan chat, insight and report write-ups', unlimited: true },
  { key: 'ai_daily', kind: 'num', label: 'AI requests / day', hint: 'Hard daily ceiling against abuse', unlimited: true },
  { key: 'captures_monthly', kind: 'num', label: 'Captures / month', hint: 'Receipt scans and voice entries', unlimited: true },
  { key: 'insights_every_days', kind: 'num', label: 'Insights refresh every', hint: 'Days between refreshes (0 = any time)' },
  { key: 'bank_links', kind: 'num', label: 'Connected banks', hint: 'Plaid connections at once', unlimited: true },
  { key: 'reports', kind: 'bool', label: 'Analytics reports', hint: 'Monthly AI reports' },
  { key: 'trips', kind: 'bool', label: 'Trip budgets', hint: 'Creating trips' },
];

const STATUS_TONE: Record<string, string> = {
  active: 'badge-success',
  trialing: 'badge-primary',
  past_due: 'badge-warning',
  unpaid: 'badge-error',
  canceled: 'badge-muted',
  incomplete: 'badge-muted',
  incomplete_expired: 'badge-muted',
};

export function BillingPage() {
  const { token, hasPerm } = useAuth();
  const canManage = hasPerm('billing.manage');
  const [data, setData] = useState<BillingOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [subFilter, setSubFilter] = useState('');
  const [subs, setSubs] = useState<BillingSubscription[] | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      setData(await api.billing(token));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load billing');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!token || !subFilter) {
      setSubs(null);
      return;
    }
    api
      .billingSubscriptions(token, subFilter)
      .then((r) => setSubs(r.subscriptions))
      .catch(() => setSubs([]));
  }, [token, subFilter]);

  const header = (
    <div className="page-header">
      <div className="page-header-title">
        <h1>Billing</h1>
      </div>
      <div className="page-header-actions">
        <button type="button" className="shell-icon-btn bordered" onClick={() => void load()} title="Refresh" aria-label="Refresh">
          <RefreshCw size={15} strokeWidth={2} className={loading ? 'spin' : undefined} />
        </button>
      </div>
    </div>
  );

  if (!data) {
    return (
      <div className="page">
        {header}
        {error ? (
          <div className="alert alert-error">
            <AlertTriangle size={16} strokeWidth={2} />
            <span>{error}</span>
          </div>
        ) : (
          <>
            <div className="skeleton" style={{ height: 110 }} />
            <div className="skeleton" style={{ height: 320 }} />
          </>
        )}
      </div>
    );
  }

  const st = data.stats;
  const mrrMain = st.mrr[0];
  const paidUsers = st.tiers.filter((t) => t.source === 'polar').reduce((n, t) => n + t.users, 0);
  const conversion = st.total_users ? ((paidUsers / st.total_users) * 100).toFixed(1) : '0';
  const setupIssues = [
    !data.setup.configured ? 'POLAR_ACCESS_TOKEN is not set' : null,
    !data.setup.webhook_secret_set ? 'POLAR_WEBHOOK_SECRET is not set' : null,
    Object.keys(data.setup.products).length === 0 ? 'POLAR_PRODUCTS has no plans' : null,
  ].filter(Boolean) as string[];
  const shownSubs = subs ?? data.subscriptions;

  return (
    <div className="page">
      {header}

      {error ? (
        <div className="alert alert-error">
          <AlertTriangle size={16} strokeWidth={2} />
          <span>{error}</span>
        </div>
      ) : null}
      {notice ? (
        <div className="alert banner-success" onClick={() => setNotice(null)}>
          <span>{notice}</span>
        </div>
      ) : null}
      {setupIssues.length ? (
        <div className="sys-banner">
          <AlertTriangle size={16} strokeWidth={2} />
          <span>Payments aren’t fully set up: {setupIssues.join(' · ')}. People can’t buy plans until this is done.</span>
        </div>
      ) : null}

      <section className="ov-metrics card">
        <div className="ov-metric">
          <span className="ov-metric-label">Monthly recurring revenue</span>
          <strong className="ov-metric-value">{mrrMain ? money(mrrMain.cents, mrrMain.currency) : money(0, 'usd')}</strong>
          <span className="ov-metric-foot">
            {st.mrr.length > 1 ? st.mrr.slice(1).map((m) => money(m.cents, m.currency)).join(' + ') : 'yearly plans counted monthly'}
          </span>
        </div>
        <div className="ov-metric">
          <span className="ov-metric-label">Paying subscribers</span>
          <strong className="ov-metric-value">{nf.format(st.active_subscriptions)}</strong>
          <span className="ov-metric-foot">
            <b>{conversion}%</b> of users · <b>+{st.new_30d}</b> in 30d
          </span>
        </div>
        <div className="ov-metric">
          <span className="ov-metric-label">On a free trial</span>
          <strong className="ov-metric-value">{nf.format(st.trials_active)}</strong>
          <span className="ov-metric-foot">
            <b>{st.trials_ending_7d}</b> ending this week
          </span>
        </div>
        <div className="ov-metric">
          <span className="ov-metric-label">Churned · 30d</span>
          <strong className={`ov-metric-value${st.churned_30d ? ' tone-warn' : ''}`}>{nf.format(st.churned_30d)}</strong>
          <span className="ov-metric-foot">
            <b>{st.canceling}</b> canceling · <b className={st.past_due ? 'tone-warn' : undefined}>{st.past_due}</b> past due
          </span>
        </div>
      </section>

      <div className="ov-grid">
        <PlanMix data={data} />
        <SetupCard data={data} />
      </div>

      <LimitsEditor
        data={data}
        canManage={canManage}
        onSaved={(next) => {
          setData(next);
          setNotice('Plan limits saved. They apply within 30 seconds.');
        }}
        onError={setError}
      />

      <section className="card team-card">
        <div className="team-toolbar">
          <h3 className="bill-h3">Subscriptions</h3>
          <div className="seg" role="tablist" style={{ marginLeft: 'auto' }}>
            {[
              ['', 'Recent'],
              ['active', 'Active'],
              ['trialing', 'Trialing'],
              ['past_due', 'Past due'],
              ['canceled', 'Canceled'],
            ].map(([id, label]) => (
              <button key={id} type="button" className={subFilter === id ? 'active' : ''} onClick={() => setSubFilter(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="lt-table-scroll">
          <table className="lt-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Plan</th>
                <th>Status</th>
                <th className="num">Price</th>
                <th>Renews / ends</th>
                <th className="num">Updated</th>
              </tr>
            </thead>
            <tbody>
              {shownSubs.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.user_id ? (
                      <Link to={`/users?q=${encodeURIComponent(s.user_email || '')}`} className="cell-stack bill-user">
                        <span>{s.user_name || s.user_email}</span>
                        <small className="muted">{s.user_email}</small>
                      </Link>
                    ) : (
                      <span className="muted mono" title="No Lony account matched">
                        {s.customer_id || '—'}
                      </span>
                    )}
                  </td>
                  <td>
                    {s.tier ? TIER_LABEL[s.tier] ?? s.tier : '—'}
                    {s.interval ? <span className="muted"> · {s.interval === 'year' ? 'yearly' : 'monthly'}</span> : null}
                  </td>
                  <td>
                    <span className={`badge ${STATUS_TONE[s.status] ?? ''}`}>{s.status.replace('_', ' ')}</span>
                    {s.cancel_at_period_end && s.status !== 'canceled' ? <span className="badge badge-warning" style={{ marginLeft: 4 }}>canceling</span> : null}
                  </td>
                  <td className="num">{money(s.amount_cents, s.currency)}</td>
                  <td>
                    {s.status === 'canceled'
                      ? s.ended_at
                        ? `Ended ${new Date(s.ended_at).toLocaleDateString()}`
                        : 'Ended'
                      : s.current_period_end
                        ? `${s.cancel_at_period_end ? 'Ends' : 'Renews'} ${new Date(s.current_period_end).toLocaleDateString()}`
                        : '—'}
                  </td>
                  <td className="num muted">{relativeTime(s.updated_at)}</td>
                </tr>
              ))}
              {!shownSubs.length ? (
                <tr>
                  <td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 28 }}>
                    No subscriptions yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <header className="ov-card-head">
          <h3>Payment events</h3>
          <span className="muted" style={{ fontSize: 12.5 }}>
            Last {data.events.length} webhooks from Polar
          </span>
        </header>
        {data.events.length ? (
          <ul className="bill-events">
            {data.events.map((e) => (
              <li key={e.id}>
                <span className={`dot dot-${e.error ? 'bad' : e.processed_at ? 'ok' : 'warn'}`} />
                <code>{e.type}</code>
                <span className="muted bill-event-user">{e.user_email || '—'}</span>
                {e.error ? (
                  <span className="bill-event-err" title={e.error}>
                    {e.error}
                  </span>
                ) : null}
                <time className="muted" title={new Date(e.received_at).toLocaleString()}>
                  {relativeTime(e.received_at)}
                </time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted ov-note">No webhooks received yet. Once Polar is connected, every payment event shows up here.</p>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------ plan mix */

function PlanMix({ data }: { data: BillingOverview }) {
  const rows = TIERS.map((tier) => {
    const of = (src: string) => data.stats.tiers.filter((t) => t.tier === tier && t.source === src).reduce((n, t) => n + t.users, 0);
    const total = data.stats.tiers.filter((t) => t.tier === tier).reduce((n, t) => n + t.users, 0);
    return { tier, total, paid: of('polar'), trial: of('trial'), comp: of('admin') };
  });
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <section className="card">
      <header className="ov-card-head">
        <h3>Plan mix</h3>
        <span className="muted" style={{ fontSize: 12.5 }}>
          {nf.format(data.stats.total_users)} users
        </span>
      </header>
      <div className="stack">
        {rows.map((r) => (
          <div key={r.tier} className="ov-bar">
            <div className="ov-bar-top">
              <span>{TIER_LABEL[r.tier]}</span>
              <b>{nf.format(r.total)}</b>
            </div>
            <div className="ov-bar-track">
              <span style={{ width: `${(r.total / max) * 100}%` }} />
            </div>
            {r.tier !== 'free' ? (
              <small className="muted bill-mix-note">
                {r.paid} paying · {r.trial} on trial · {r.comp} comped
              </small>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ setup */

function SetupCard({ data }: { data: BillingOverview }) {
  const s = data.setup;
  const apiBase = ((import.meta.env.VITE_API_BASE as string | undefined) || window.location.origin).replace(/\/$/, '');
  const hook = `${apiBase}${s.webhook_path}`;
  const [copied, setCopied] = useState(false);
  const products = Object.entries(s.products).sort(([a], [b]) => a.localeCompare(b));
  const Row = ({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) => (
    <li>
      {ok ? <Check size={14} strokeWidth={2.5} className="bill-ok" /> : <X size={14} strokeWidth={2.5} className="bill-bad" />}
      <span>{label}</span>
      {detail ? <small className="muted">{detail}</small> : null}
    </li>
  );
  return (
    <section className="card">
      <header className="ov-card-head">
        <h3>Polar setup</h3>
        <span className={`badge ${s.server === 'production' ? 'badge-success' : 'badge-warning'}`}>{s.server || 'sandbox'}</span>
      </header>
      <ul className="bill-setup">
        <Row ok={s.configured} label="Access token" detail="POLAR_ACCESS_TOKEN" />
        <Row ok={s.webhook_secret_set} label="Webhook secret" detail="POLAR_WEBHOOK_SECRET" />
        <Row ok={products.length > 0} label={`${products.length} plans mapped`} detail="POLAR_PRODUCTS" />
        <Row ok={Boolean(s.success_url)} label="Return URL after checkout" detail={s.success_url || 'POLAR_SUCCESS_URL'} />
      </ul>
      {products.length ? (
        <dl className="sys-facts" style={{ marginTop: 12 }}>
          {products.map(([k, v]) => (
            <div key={k}>
              <dt className="mono">{k}</dt>
              <dd className="mono">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="bill-hook">
        <span className="field-label">Webhook URL for Polar</span>
        <button
          type="button"
          className="bill-hook-url mono"
          onClick={() => {
            void navigator.clipboard?.writeText(hook).catch(() => undefined);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          }}
          title="Copy"
        >
          <span>{hook}</span>
          {copied ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={2} />}
        </button>
        <small className="muted">Subscribe it to all subscription.* events.</small>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ limits */

function LimitsEditor({
  data,
  canManage,
  onSaved,
  onError,
}: {
  data: BillingOverview;
  canManage: boolean;
  onSaved: (d: BillingOverview) => void;
  onError: (msg: string) => void;
}) {
  const { token } = useAuth();
  const [limits, setLimits] = useState<Record<PlanTier, PlanLimits>>(data.limits);
  const [trialDays, setTrialDays] = useState(data.trial_days);
  const [trialTier, setTrialTier] = useState(data.trial_tier);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLimits(data.limits);
    setTrialDays(data.trial_days);
    setTrialTier(data.trial_tier);
  }, [data]);

  const dirty = useMemo(
    () => JSON.stringify(limits) !== JSON.stringify(data.limits) || trialDays !== data.trial_days || trialTier !== data.trial_tier,
    [limits, trialDays, trialTier, data],
  );

  function setNum(tier: PlanTier, key: NumKey, v: number) {
    setLimits((cur) => ({ ...cur, [tier]: { ...cur[tier], [key]: v } }));
  }
  function setBool(tier: PlanTier, key: BoolKey, v: boolean) {
    setLimits((cur) => ({ ...cur, [tier]: { ...cur[tier], [key]: v } }));
  }

  async function save() {
    if (!token) return;
    setBusy(true);
    try {
      onSaved(await api.updateBillingSettings(token, { limits, trial_days: trialDays, trial_tier: trialTier }));
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not save limits');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card team-card">
      <div className="team-toolbar">
        <h3 className="bill-h3">Plan limits</h3>
        <span className="muted" style={{ fontSize: 12.5 }}>
          Enforced by the API for every user
        </span>
      </div>
      <div className="lt-table-scroll">
        <table className="lt-table bill-limits">
          <thead>
            <tr>
              <th>Limit</th>
              {TIERS.map((t) => (
                <th key={t} className="num">
                  {TIER_LABEL[t]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LIMIT_ROWS.map((row) => (
              <tr key={row.key}>
                <td>
                  <span className="cell-stack">
                    <span>{row.label}</span>
                    <small className="muted">{row.hint}</small>
                  </span>
                </td>
                {TIERS.map((t) => (
                  <td key={t} className="num">
                    {row.kind === 'bool' ? (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={limits[t][row.key]}
                        aria-label={`${row.label} on ${TIER_LABEL[t]}`}
                        className={`switch${limits[t][row.key] ? ' on' : ''}`}
                        disabled={!canManage}
                        onClick={() => setBool(t, row.key, !limits[t][row.key])}
                      >
                        <span />
                      </button>
                    ) : (
                      <LimitInput
                        value={limits[t][row.key]}
                        unlimited={row.unlimited}
                        disabled={!canManage}
                        suffix={row.key === 'insights_every_days' ? 'd' : undefined}
                        onChange={(v) => setNum(t, row.key, v)}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td>
                <span className="cell-stack">
                  <span>Sign-up trial</span>
                  <small className="muted">New accounts start on a paid tier, no card needed. 0 turns it off.</small>
                </span>
              </td>
              <td colSpan={3} className="num">
                <span className="bill-trial">
                  <input
                    type="number"
                    min={0}
                    max={90}
                    value={trialDays}
                    disabled={!canManage}
                    onChange={(e) => setTrialDays(Math.max(0, Math.min(90, Number(e.target.value) || 0)))}
                  />
                  <span className="muted">days of</span>
                  <select value={trialTier} disabled={!canManage || trialDays === 0} onChange={(e) => setTrialTier(e.target.value as 'plus' | 'pro')}>
                    <option value="plus">Plus</option>
                    <option value="pro">Pro</option>
                  </select>
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {canManage ? (
        <footer className={`role-editor-foot${dirty ? ' dirty' : ''}`}>
          <span className="role-diff">{dirty ? <span className="muted">Unsaved changes</span> : <span className="muted">Saved</span>}</span>
          {dirty ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setLimits(data.limits);
                setTrialDays(data.trial_days);
                setTrialTier(data.trial_tier);
              }}
            >
              Discard
            </Button>
          ) : null}
          <Button size="sm" busy={busy} disabled={!dirty} onClick={() => void save()}>
            Save limits
          </Button>
        </footer>
      ) : null}
    </section>
  );
}

function LimitInput({
  value,
  unlimited,
  disabled,
  suffix,
  onChange,
}: {
  value: number;
  unlimited?: boolean;
  disabled: boolean;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  const isInf = value < 0;
  return (
    <span className="bill-limit">
      {isInf ? (
        <span className="bill-inf">Unlimited</span>
      ) : (
        <input type="number" min={0} value={value} disabled={disabled} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} />
      )}
      {suffix && !isInf ? <span className="muted">{suffix}</span> : null}
      {unlimited ? (
        <button
          type="button"
          className={`bill-inf-toggle${isInf ? ' on' : ''}`}
          disabled={disabled}
          title={isInf ? 'Set a number' : 'Make unlimited'}
          onClick={() => onChange(isInf ? 0 : -1)}
        >
          ∞
        </button>
      ) : null}
    </span>
  );
}
