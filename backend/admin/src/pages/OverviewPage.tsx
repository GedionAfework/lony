import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, ChevronRight, RefreshCw } from 'lucide-react';
import { api, type AuditEntry, type Control, type DayCount, type Overview, type SystemInfo } from '../api';
import { useAuth } from '../auth';
import { Button } from '../components/Button';
import { actorName, describe, relativeTime } from '../lib/audit';

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

const nf = new Intl.NumberFormat();
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

type Tone = 'ok' | 'warn' | 'bad' | 'off';
type Check = { label: string; tone: Tone; detail: string; to?: string };
type Issue = { label: string; detail: string; tone: 'warn' | 'bad'; to?: string };

export function OverviewPage() {
  const { token, hasPerm } = useAuth();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [signups, setSignups] = useState<DayCount[]>([]);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [controls, setControls] = useState<Control[] | null>(null);
  const [recent, setRecent] = useState<AuditEntry[] | null>(null);
  const [range, setRange] = useState<Range>(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [, tick] = useState(0);

  const canSystem = hasPerm('system.read');
  const canControls = hasPerm('settings.platform') || hasPerm('settings.ai');
  const canAudit = hasPerm('audit.read');

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [ov, sys, ctl, audit] = await Promise.all([
        api.overview(token, range),
        canSystem ? api.system(token).catch(() => null) : Promise.resolve(null),
        !canSystem && canControls ? api.controls(token).catch(() => null) : Promise.resolve(null),
        canAudit ? api.audit(token, { limit: 7 }).catch(() => null) : Promise.resolve(null),
      ]);
      setOverview(ov.overview);
      setSignups(ov.signups_by_day ?? []);
      setSystem(sys?.system ?? null);
      setControls(sys?.system.controls ?? ctl?.controls ?? null);
      setRecent(audit ? audit.audit ?? [] : null);
      setUpdatedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load overview');
    } finally {
      setLoading(false);
    }
  }, [token, range, canSystem, canControls, canAudit]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep "updated x ago" honest without reloading.
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const series = useMemo(
    () =>
      signups.map((d) => ({
        label: new Date(`${d.day}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        count: d.count,
      })),
    [signups],
  );
  const rangeTotal = signups.reduce((n, d) => n + d.count, 0);

  if (loading && !overview) {
    return (
      <div className="page">
        <div className="page-header">
          <div className="page-header-title">
            <h1>Overview</h1>
          </div>
        </div>
        <div className="skeleton" style={{ height: 52 }} />
        <div className="skeleton" style={{ height: 112 }} />
        <div className="ov-grid">
          <div className="skeleton" style={{ height: 320 }} />
          <div className="skeleton" style={{ height: 320 }} />
        </div>
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="page">
        <div className="alert alert-error">
          <AlertTriangle size={16} strokeWidth={2} />
          <span>{error ?? 'Overview unavailable'}</span>
        </div>
        <div>
          <Button variant="secondary" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const o = overview;
  const checks = buildChecks(o, system, controls);
  const issues = buildIssues(o, system, controls);
  const down = checks.filter((c) => c.tone === 'bad').length;
  const degraded = checks.filter((c) => c.tone === 'warn').length;
  const headline =
    down > 0 ? `${down} system${down > 1 ? 's' : ''} down` : degraded > 0 ? `${degraded} need${degraded > 1 ? '' : 's'} a look` : 'All systems normal';
  const headTone: Tone = down > 0 ? 'bad' : degraded > 0 ? 'warn' : 'ok';

  const signupDelta = o.signups_prev_7d != null ? o.signups_7d - o.signups_prev_7d : null;
  const premium = o.premium_users ?? 0;
  const aiPaused = controls?.find((c) => c.key === 'ai_disabled')?.enabled ?? false;
  const activeBase = o.mau || o.wau || o.total_users;

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-header-title">
          <h1>Overview</h1>
        </div>
        <div className="page-header-actions">
          {updatedAt ? <span className="muted ov-updated">Updated {relativeTime(new Date(updatedAt).toISOString())}</span> : null}
          <div className="seg" role="tablist" aria-label="Range">
            {RANGES.map((r) => (
              <button key={r} type="button" className={range === r ? 'active' : ''} onClick={() => setRange(r)}>
                {r}d
              </button>
            ))}
          </div>
          <button type="button" className="shell-icon-btn bordered" onClick={() => void load()} title="Refresh" aria-label="Refresh">
            <RefreshCw size={15} strokeWidth={2} className={loading ? 'spin' : undefined} />
          </button>
        </div>
      </div>

      {error ? (
        <div className="alert alert-error">
          <AlertTriangle size={16} strokeWidth={2} />
          <span>{error}</span>
        </div>
      ) : null}

      {/* ---- status strip */}
      <section className="ov-status card">
        <div className="ov-status-head">
          <span className={`dot dot-${headTone}`} />
          <strong>{headline}</strong>
        </div>
        <div className="ov-status-checks">
          {checks.map((c) => {
            const inner = (
              <>
                <span className={`dot dot-${c.tone}`} />
                <span>{c.label}</span>
                <small>{c.detail}</small>
              </>
            );
            return c.to ? (
              <Link key={c.label} to={c.to} className="ov-check" title={c.detail}>
                {inner}
              </Link>
            ) : (
              <span key={c.label} className="ov-check" title={c.detail}>
                {inner}
              </span>
            );
          })}
        </div>
      </section>

      {/* ---- headline metrics */}
      <section className="ov-metrics card">
        <Metric
          label="Total users"
          value={nf.format(o.total_users)}
          foot={
            <>
              <b>+{nf.format(o.signups_7d)}</b> this week
              {signupDelta != null ? <Delta value={signupDelta} /> : null}
            </>
          }
        />
        <Metric
          label="Active today"
          value={nf.format(o.dau)}
          foot={
            <>
              <b>{pct(o.dau, o.total_users)}%</b> of all users
            </>
          }
        />
        <Metric
          label="Active this week"
          value={nf.format(o.wau)}
          foot={
            <>
              <b>{pct(o.dau, o.wau)}%</b> come back daily
            </>
          }
        />
        <Metric
          label="Premium"
          value={nf.format(premium)}
          foot={
            <>
              <b>{pct(premium, o.total_users)}%</b> of users
            </>
          }
        />
      </section>

      {/* ---- growth + attention */}
      <div className="ov-grid">
        <section className="card ov-chart-card">
          <header className="ov-card-head">
            <div>
              <h3>Sign-ups</h3>
              <p className="ov-big">
                {nf.format(rangeTotal)} <span className="muted">in the last {range} days</span>
              </p>
            </div>
          </header>
          <div className="ov-chart">
            {series.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="ovFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.14} />
                      <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--line)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--faint)', fontSize: 11 }} minTickGap={24} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: 'var(--faint)', fontSize: 11 }} width={40} />
                  <Tooltip
                    cursor={{ stroke: 'var(--line-strong)' }}
                    contentStyle={{
                      background: 'var(--surface)',
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                      fontSize: 12.5,
                      boxShadow: 'var(--shadow)',
                    }}
                    labelStyle={{ color: 'var(--muted)', marginBottom: 2 }}
                    itemStyle={{ color: 'var(--text)' }}
                    formatter={(v) => [nf.format(Number(v)), 'Sign-ups']}
                  />
                  <Area type="monotone" dataKey="count" stroke="var(--primary)" strokeWidth={1.75} fill="url(#ovFill)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="chart-state muted">No sign-ups in this range.</div>
            )}
          </div>
        </section>

        <section className="card ov-attention">
          <header className="ov-card-head">
            <h3>Needs attention</h3>
            {issues.length ? <span className="badge">{issues.length}</span> : null}
          </header>
          {issues.length ? (
            <ul className="ov-list">
              {issues.map((i) => (
                <li key={i.label}>
                  {i.to ? (
                    <Link to={i.to} className="ov-list-row">
                      <span className={`dot dot-${i.tone}`} />
                      <span className="cell-stack">
                        <span>{i.label}</span>
                        <small className="muted">{i.detail}</small>
                      </span>
                      <ChevronRight size={15} strokeWidth={2} className="ov-chev" />
                    </Link>
                  ) : (
                    <div className="ov-list-row static">
                      <span className={`dot dot-${i.tone}`} />
                      <span className="cell-stack">
                        <span>{i.label}</span>
                        <small className="muted">{i.detail}</small>
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="ov-empty">
              <span className="dot dot-ok" />
              <p>Nothing needs attention right now.</p>
            </div>
          )}
        </section>
      </div>

      {/* ---- detail panels */}
      <div className="ov-three">
        <Panel title="Engagement" to="/users" toLabel="Users">
          <BarRow label="Daily active" value={o.dau} max={activeBase} />
          <BarRow label="Weekly active" value={o.wau} max={activeBase} />
          {o.mau != null ? <BarRow label="Monthly active" value={o.mau} max={activeBase} /> : null}
          <dl className="ov-facts">
            <div>
              <dt>Suspended</dt>
              <dd>{nf.format(o.suspended_users)}</dd>
            </div>
            <div>
              <dt>Sign-ups · 30d</dt>
              <dd>{nf.format(o.signups_30d)}</dd>
            </div>
          </dl>
        </Panel>

        <Panel title="Lending">
          <div className="ov-pair">
            <div>
              <small>Open loans</small>
              <strong>{nf.format(o.open_loans)}</strong>
            </div>
            <div>
              <small>Overdue</small>
              <strong className={o.overdue_loans > 0 ? 'tone-warn' : undefined}>{nf.format(o.overdue_loans)}</strong>
            </div>
          </div>
          <BarRow label="Overdue rate" value={o.overdue_loans} max={o.open_loans} asPercent warn />
          <dl className="ov-facts">
            <div>
              <dt>New loans · 7d</dt>
              <dd>{o.loans_created_7d != null ? nf.format(o.loans_created_7d) : '—'}</dd>
            </div>
            <div>
              <dt>Cash-flow entries · 7d</dt>
              <dd>{nf.format(o.cashflow_entries_7d)}</dd>
            </div>
          </dl>
        </Panel>

        <Panel title="AI" to={canControls ? '/controls' : undefined} toLabel="Controls">
          <div className="ov-pair">
            <div>
              <small>Runs · 7d</small>
              <strong>{compact.format(o.ai_runs_7d ?? 0)}</strong>
            </div>
            <div>
              <small>Requests today</small>
              <strong>{compact.format(o.ai_requests_today ?? 0)}</strong>
            </div>
          </div>
          <dl className="ov-facts">
            <div>
              <dt>Users · 7d</dt>
              <dd>{nf.format(o.ai_users_7d ?? 0)}</dd>
            </div>
            <div>
              <dt>Tokens · 7d</dt>
              <dd>{compact.format(o.ai_tokens_7d ?? 0)}</dd>
            </div>
            <div>
              <dt>Insights · 7d</dt>
              <dd>{nf.format(o.ai_insights_7d)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                {controls ? (
                  <span className={`badge ${aiPaused ? 'badge-warning' : 'badge-success'}`}>{aiPaused ? 'Paused' : 'On'}</span>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          </dl>
        </Panel>
      </div>

      {/* ---- activity + shortcuts */}
      <div className="ov-grid">
        <section className="card">
          <header className="ov-card-head">
            <h3>Recent admin activity</h3>
            {canAudit ? (
              <Link to="/audit" className="ov-link">
                Audit log <ArrowRight size={14} strokeWidth={2} />
              </Link>
            ) : null}
          </header>
          {recent === null ? (
            <p className="muted ov-note">You don’t have access to the audit log.</p>
          ) : recent.length === 0 ? (
            <p className="muted ov-note">No admin activity yet.</p>
          ) : (
            <ul className="ov-feed">
              {recent.map((e) => (
                <li key={e.id}>
                  <span className="ov-avatar">{initials(actorName(e))}</span>
                  <span className="ov-feed-text">
                    <b>{actorName(e)}</b> {describe(e)}
                  </span>
                  <time className="muted" title={new Date(e.created_at).toLocaleString()}>
                    {relativeTime(e.created_at)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Shortcuts />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ pieces */

function Metric({ label, value, foot }: { label: string; value: ReactNode; foot: ReactNode }) {
  return (
    <div className="ov-metric">
      <span className="ov-metric-label">{label}</span>
      <strong className="ov-metric-value">{value}</strong>
      <span className="ov-metric-foot">{foot}</span>
    </div>
  );
}

function Delta({ value }: { value: number }) {
  if (value === 0) return <span className="ov-delta">· same as last week</span>;
  const up = value > 0;
  return (
    <span className={`ov-delta ${up ? 'up' : 'down'}`} title="Compared with the week before">
      {up ? <ArrowUpRight size={13} strokeWidth={2} /> : <ArrowDownRight size={13} strokeWidth={2} />}
      {Math.abs(value)} vs last week
    </span>
  );
}

function Panel({ title, to, toLabel, children }: { title: string; to?: string; toLabel?: string; children: ReactNode }) {
  return (
    <section className="card ov-panel">
      <header className="ov-card-head">
        <h3>{title}</h3>
        {to ? (
          <Link to={to} className="ov-link">
            {toLabel} <ArrowRight size={14} strokeWidth={2} />
          </Link>
        ) : null}
      </header>
      <div className="stack">{children}</div>
    </section>
  );
}

function BarRow({ label, value, max, asPercent, warn }: { label: string; value: number; max: number; asPercent?: boolean; warn?: boolean }) {
  const share = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const shown = asPercent ? `${Math.round(share)}%` : nf.format(value);
  return (
    <div className="ov-bar">
      <div className="ov-bar-top">
        <span>{label}</span>
        <b>{shown}</b>
      </div>
      <div className="ov-bar-track">
        <span className={warn && share >= 10 ? 'warn' : undefined} style={{ width: `${share}%` }} />
      </div>
    </div>
  );
}

function Shortcuts() {
  const { hasPerm } = useAuth();
  const navigate = useNavigate();
  const items = [
    { label: 'Find a user', hint: 'Search accounts', to: '/users', ok: hasPerm('users.read') },
    { label: 'Manage admin access', hint: 'Team, roles and permissions', to: '/team', ok: hasPerm('roles.read') },
    { label: 'Platform controls', hint: 'Maintenance, sign-ups, features', to: '/controls', ok: hasPerm('settings.platform') || hasPerm('settings.ai') },
    { label: 'System health', hint: 'Database, jobs, integrations', to: '/system', ok: hasPerm('system.read') },
  ].filter((i) => i.ok);
  if (!items.length) return null;
  return (
    <section className="card">
      <header className="ov-card-head">
        <h3>Shortcuts</h3>
      </header>
      <ul className="ov-list">
        {items.map((i) => (
          <li key={i.to}>
            <button type="button" className="ov-list-row" onClick={() => navigate(i.to)}>
              <span className="cell-stack">
                <span>{i.label}</span>
                <small className="muted">{i.hint}</small>
              </span>
              <ChevronRight size={15} strokeWidth={2} className="ov-chev" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/* ------------------------------------------------------------ status */

function shortName(label: string) {
  return label.replace(/\s*\(.*\)$/, '');
}

function buildChecks(o: Overview, sys: SystemInfo | null, controls: Control[] | null): Check[] {
  const out: Check[] = [];
  if (sys) {
    const db = sys.database;
    out.push({
      label: 'Database',
      tone: !db.ok ? 'bad' : db.latency_ms > 250 ? 'warn' : 'ok',
      detail: db.ok ? `${db.latency_ms.toFixed(1)} ms` : 'unreachable',
      to: '/system',
    });
    const j = sys.jobs;
    out.push({ label: 'Jobs', tone: j.failed > 0 ? 'warn' : 'ok', detail: j.failed > 0 ? `${j.failed} failed` : `${j.due} due`, to: '/system' });
    for (const i of sys.integrations) {
      if (!i.configured) continue;
      out.push({
        label: shortName(i.label),
        tone: i.status === 'ok' ? 'ok' : i.status === 'error' ? 'bad' : 'off',
        detail: i.status === 'ok' ? 'ok' : i.status,
        to: '/system',
      });
    }
  } else {
    out.push({ label: 'Exchange rates', tone: o.fx_ok === false ? 'bad' : 'ok', detail: o.fx_ok === false ? 'failing' : 'ok' });
    out.push({ label: 'Jobs', tone: (o.jobs_failed ?? 0) > 0 ? 'warn' : 'ok', detail: (o.jobs_failed ?? 0) > 0 ? `${o.jobs_failed} failed` : 'ok' });
  }
  if (controls) {
    const maint = controls.find((c) => c.key === 'maintenance_mode')?.enabled;
    const paused = controls.filter((c) => c.group !== 'platform' && c.kind === 'bool' && c.enabled).length;
    out.push({ label: 'App', tone: maint ? 'bad' : paused ? 'warn' : 'ok', detail: maint ? 'maintenance' : paused ? `${paused} paused` : 'open', to: '/controls' });
  }
  return out;
}

function buildIssues(o: Overview, sys: SystemInfo | null, controls: Control[] | null): Issue[] {
  const out: Issue[] = [];
  if (controls?.find((c) => c.key === 'maintenance_mode')?.enabled)
    out.push({ label: 'Maintenance mode is on', detail: 'Users can’t use the app', tone: 'bad', to: '/controls' });
  const paused = controls?.filter((c) => c.group !== 'platform' && c.kind === 'bool' && c.enabled) ?? [];
  if (paused.length)
    out.push({ label: `${paused.length} feature${paused.length > 1 ? 's' : ''} paused`, detail: paused.map((c) => c.label).join(', '), tone: 'warn', to: '/controls' });
  if (sys && !sys.database.ok) out.push({ label: 'Database unreachable', detail: sys.database.error || 'Ping failed', tone: 'bad', to: '/system' });
  const failed = sys ? sys.jobs.failed : o.jobs_failed ?? 0;
  if (failed > 0) out.push({ label: `${nf.format(failed)} failed reminder job${failed > 1 ? 's' : ''}`, detail: 'Retry them from System', tone: 'warn', to: '/system' });
  for (const i of sys?.integrations ?? []) {
    if (i.status === 'error') out.push({ label: `${shortName(i.label)} is failing`, detail: i.detail || 'Check System', tone: 'bad', to: '/system' });
  }
  if (o.overdue_loans > 0)
    out.push({ label: `${nf.format(o.overdue_loans)} overdue loan${o.overdue_loans > 1 ? 's' : ''}`, detail: `${pct(o.overdue_loans, o.open_loans)}% of open loans`, tone: 'warn' });
  const pending = o.deletion_pending ?? 0;
  if (pending > 0) out.push({ label: `${nf.format(pending)} account deletion${pending > 1 ? 's' : ''} pending`, detail: 'Accounts waiting to be removed', tone: 'warn', to: '/users' });
  if (o.suspended_users > 0)
    out.push({ label: `${nf.format(o.suspended_users)} suspended account${o.suspended_users > 1 ? 's' : ''}`, detail: 'Review and reinstate if needed', tone: 'warn', to: '/users' });
  return out;
}
