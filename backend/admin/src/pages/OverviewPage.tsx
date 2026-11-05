import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  Coins,
  HandCoins,
  Languages,
  Layers,
  Palette,
  Power,
  RefreshCw,
  ScrollText,
  ServerCrash,
  Sparkles,
  UserPlus,
  Users,
  Wifi,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { api, type AuditEntry, type DayCount, type Overview } from '../api';
import { useAuth } from '../auth';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { actionIcon, actorName, categoryOf, describe, relativeTime } from '../lib/audit';

const TEAL = '#14B8A6';
const CYAN = '#06B6D4';
const VIOLET = '#7C6CF6';
const AMBER = '#F59E0B';
const ROSE = '#F43F5E';
const SLATE = '#94A3B8';

const TOOLTIP = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 12,
  fontSize: 12,
  boxShadow: 'var(--shadow)',
  color: 'var(--text)',
};

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

const nf = new Intl.NumberFormat();
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

export function OverviewPage() {
  const { token, hasPerm, me } = useAuth();
  const navigate = useNavigate();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [signups, setSignups] = useState<DayCount[]>([]);
  const [range, setRange] = useState<Range>(30);
  const [aiDisabled, setAIDisabled] = useState(false);
  const [recent, setRecent] = useState<AuditEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiBusy, setAIBusy] = useState(false);
  const [aiConfirm, setAIConfirm] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [ov, settings, audit] = await Promise.all([
        api.overview(token, range),
        hasPerm('settings.ai') ? api.getSettings(token).catch(() => null) : Promise.resolve(null),
        hasPerm('audit.read') ? api.audit(token, { limit: 6 }).catch(() => null) : Promise.resolve(null),
      ]);
      setOverview(ov.overview);
      setSignups(ov.signups_by_day ?? []);
      if (settings) setAIDisabled(Boolean(settings.settings?.ai_disabled));
      setRecent(audit ? audit.audit ?? [] : null);
      setUpdatedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load overview');
    } finally {
      setLoading(false);
    }
  }, [token, hasPerm, range]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleAI() {
    if (!token) return;
    setAIBusy(true);
    try {
      const res = await api.setAIDisabled(token, !aiDisabled);
      setAIDisabled(Boolean(res.settings?.ai_disabled));
      setAIConfirm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update AI setting');
    } finally {
      setAIBusy(false);
    }
  }

  const series = useMemo(() => {
    let running = 0;
    return signups.map((d) => {
      running += d.count;
      return {
        label: new Date(`${d.day}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        full: d.day,
        count: d.count,
        total: running,
      };
    });
  }, [signups]);

  if (loading && !overview) {
    return (
      <div className="page">
        <div className="skeleton" style={{ height: 190 }} />
        <div className="dash-kpis">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton skeleton-card" />
          ))}
        </div>
        <div className="skeleton" style={{ height: 340 }} />
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="page">
        <div className="state-panel state-panel-error">
          <AlertTriangle size={30} strokeWidth={1.5} />
          <p>{error}</p>
          <Button onClick={() => void load()}>Retry</Button>
        </div>
      </div>
    );
  }
  if (!overview) return null;

  const o = overview;
  const firstName = (me?.display_name || '').trim().split(/\s+/)[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const rangeSignups = signups.reduce((n, d) => n + d.count, 0);
  const prevHalf = signups.slice(0, Math.floor(signups.length / 2)).reduce((n, d) => n + d.count, 0);
  const lastHalf = signups.slice(Math.floor(signups.length / 2)).reduce((n, d) => n + d.count, 0);
  const trend = prevHalf ? Math.round(((lastHalf - prevHalf) / prevHalf) * 100) : null;
  const stickiness = o.wau ? Math.round((o.dau / o.wau) * 100) : 0;
  const activeShare = o.total_users ? Math.round((o.active_users / o.total_users) * 100) : 0;
  const overdueShare = o.open_loans ? Math.round((o.overdue_loans / o.open_loans) * 100) : 0;
  const jobsFailed = o.jobs_failed ?? 0;
  const jobsPending = o.jobs_pending ?? 0;

  const attention: { tone: 'error' | 'warning'; title: string; detail: string; to?: string }[] = [];
  if (aiDisabled) attention.push({ tone: 'warning', title: 'AI is switched off', detail: 'Premium members have no AI right now.', to: '/settings#platform' });
  if (o.fx_ok === false) attention.push({ tone: 'error', title: 'Exchange rates are down', detail: o.fx_error || 'The FX provider is unreachable.' });
  if (jobsFailed > 0) attention.push({ tone: 'error', title: `${jobsFailed} background job${jobsFailed === 1 ? '' : 's'} failed`, detail: `${jobsPending} still pending.` });
  if (o.overdue_loans > 0) attention.push({ tone: 'warning', title: `${o.overdue_loans} overdue loan${o.overdue_loans === 1 ? '' : 's'}`, detail: `${overdueShare}% of ${o.open_loans} open loans.` });
  if (o.suspended_users > 0)
    attention.push({ tone: 'warning', title: `${o.suspended_users} suspended account${o.suspended_users === 1 ? '' : 's'}`, detail: 'Review whether they should be reactivated.', to: '/users' });

  const quick: { to: string; label: string; icon: LucideIcon; perm: string }[] = [
    { to: '/users', label: 'Users', icon: Users, perm: 'users.read' },
    { to: '/audit', label: 'Audit log', icon: ScrollText, perm: 'audit.read' },
    { to: '/categories', label: 'Catalogs', icon: Layers, perm: 'categories.read' },
    { to: '/themes', label: 'Themes', icon: Palette, perm: 'themes.read' },
    { to: '/localization', label: 'Languages', icon: Languages, perm: 'localization.manage' },
  ];

  const accountMix = [
    { name: 'Active', value: o.active_users, color: TEAL },
    { name: 'Suspended', value: Math.max(o.suspended_users, 0), color: AMBER },
    { name: 'Other', value: Math.max(o.total_users - o.active_users - o.suspended_users, 0), color: SLATE },
  ].filter((d) => d.value > 0);

  const aiBars = [
    { name: 'Requests today', value: o.ai_requests_today ?? 0, fill: CYAN },
    { name: 'Runs · 7d', value: o.ai_runs_7d ?? 0, fill: TEAL },
    { name: 'Insights · 7d', value: o.ai_insights_7d, fill: VIOLET },
    { name: 'AI users · 7d', value: o.ai_users_7d ?? 0, fill: AMBER },
  ];

  return (
    <div className="page dash">
      {/* ---------------------------------------------------------- hero */}
      <section className="dash-hero">
        <div className="dash-hero-glow" aria-hidden />
        <div className="dash-hero-main">
          <span className="dash-hero-date">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
          <h1>
            {greeting}
            {firstName ? `, ${firstName}` : ''}.
          </h1>
          <p>
            <b>{nf.format(o.total_users)}</b> people use Lony. <b>{nf.format(o.signups_7d)}</b> joined this week and <b>{nf.format(o.dau)}</b> were active
            today.
          </p>
          <div className="dash-hero-status">
            <StatusChip ok={!aiDisabled} icon={Bot} label={aiDisabled ? 'AI off' : 'AI on'} />
            <StatusChip ok={o.fx_ok !== false} icon={o.fx_ok === false ? WifiOff : Wifi} label={o.fx_ok === false ? 'FX down' : `FX ${o.fx_base || 'OK'}`} />
            <StatusChip ok={jobsFailed === 0} icon={jobsFailed ? ServerCrash : CheckCircle2} label={jobsFailed ? `${jobsFailed} jobs failed` : 'Jobs healthy'} />
          </div>
        </div>
        <div className="dash-hero-side">
          <div className="dash-hero-actions">
            <button type="button" className="hero-btn" onClick={() => void load()} title="Refresh">
              <RefreshCw size={16} className={loading ? 'spin' : undefined} />
              {updatedAt ? `Updated ${relativeTime(new Date(updatedAt).toISOString())}` : 'Refresh'}
            </button>
            {hasPerm('settings.ai') ? (
              <button type="button" className={`hero-btn${aiDisabled ? ' hero-btn-warn' : ''}`} onClick={() => setAIConfirm(true)}>
                <Power size={16} /> {aiDisabled ? 'Turn AI on' : 'Turn AI off'}
              </button>
            ) : null}
          </div>
          <div className="dash-hero-quick">
            {quick
              .filter((q) => hasPerm(q.perm))
              .map((q) => (
                <button key={q.to} type="button" onClick={() => navigate(q.to)}>
                  <q.icon size={17} strokeWidth={2} />
                  <span>{q.label}</span>
                </button>
              ))}
          </div>
        </div>
      </section>

      {error ? (
        <div className="alert alert-error">
          <AlertTriangle size={16} strokeWidth={2} />
          <span>{error}</span>
        </div>
      ) : null}

      {/* ---------------------------------------------------------- KPIs */}
      <div className="dash-kpis">
        <Kpi
          icon={Users}
          color={TEAL}
          label="Total users"
          value={nf.format(o.total_users)}
          foot={
            <>
              <b>{activeShare}%</b> active · {nf.format(o.suspended_users)} suspended
            </>
          }
          spark={series.map((d) => d.total)}
        />
        <Kpi
          icon={Activity}
          color={VIOLET}
          label="Daily active"
          value={nf.format(o.dau)}
          foot={
            <>
              <b>{stickiness}%</b> of {nf.format(o.wau)} weekly actives
            </>
          }
          meter={stickiness}
        />
        <Kpi
          icon={Sparkles}
          color={CYAN}
          label="AI runs · 7d"
          value={nf.format(o.ai_runs_7d ?? 0)}
          foot={
            <>
              <b>{compact.format(o.ai_tokens_7d ?? 0)}</b> tokens · {nf.format(o.ai_users_7d ?? 0)} users
            </>
          }
          badge={aiDisabled ? { text: 'off', tone: 'warning' } : undefined}
        />
        <Kpi
          icon={HandCoins}
          color={o.overdue_loans ? AMBER : TEAL}
          label="Open loans"
          value={nf.format(o.open_loans)}
          foot={
            <>
              <b>{nf.format(o.overdue_loans)}</b> overdue{o.open_loans ? ` (${overdueShare}%)` : ''}
            </>
          }
          meter={100 - overdueShare}
          badge={o.overdue_loans ? { text: 'watch', tone: 'warning' } : undefined}
        />
      </div>

      {/* ---------------------------------------------------- main grid */}
      <div className="dash-main">
        <section className="card dash-growth">
          <header className="dash-card-head">
            <div>
              <span className="dash-eyebrow">Growth</span>
              <h3>
                {nf.format(rangeSignups)} new signups
                {trend !== null ? (
                  <span className={`trend ${trend >= 0 ? 'up' : 'down'}`}>
                    <ArrowUpRight size={14} style={{ transform: trend < 0 ? 'rotate(90deg)' : undefined }} />
                    {Math.abs(trend)}%
                  </span>
                ) : null}
              </h3>
              <p className="muted">Last {range} days{trend !== null ? ', second half vs first half' : ''}</p>
            </div>
            <div className="seg" role="tablist" aria-label="Range">
              {RANGES.map((r) => (
                <button key={r} type="button" className={range === r ? 'active' : ''} onClick={() => setRange(r)}>
                  {r}d
                </button>
              ))}
            </div>
          </header>
          <div className="dash-growth-chart">
            {rangeSignups === 0 ? (
              <div className="chart-state">
                <UserPlus size={26} strokeWidth={1.5} />
                <p>No signups in the last {range} days</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top: 10, right: 6, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="growthFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={TEAL} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={TEAL} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--line)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip
                    contentStyle={TOOLTIP}
                    cursor={{ stroke: TEAL, strokeDasharray: '4 4' }}
                    labelFormatter={(_, p) => String(p?.[0]?.payload?.full ?? '')}
                    formatter={(v, name) => [v as number, name === 'count' ? 'Signups' : 'Running total']}
                  />
                  <Area type="monotone" dataKey="count" stroke={TEAL} strokeWidth={2.5} fill="url(#growthFill)" activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
          <footer className="dash-growth-foot">
            <div>
              <small>Last 7 days</small>
              <b>{nf.format(o.signups_7d)}</b>
            </div>
            <div>
              <small>Last 30 days</small>
              <b>{nf.format(o.signups_30d)}</b>
            </div>
            <div>
              <small>Weekly actives</small>
              <b>{nf.format(o.wau)}</b>
            </div>
            <div>
              <small>Cashflow entries · 7d</small>
              <b>{nf.format(o.cashflow_entries_7d)}</b>
            </div>
          </footer>
        </section>

        <section className="card dash-attention">
          <header className="dash-card-head">
            <div>
              <span className="dash-eyebrow">Health</span>
              <h3>Needs attention</h3>
            </div>
            <span className={`badge ${attention.length ? 'badge-warning' : 'badge-success'}`}>{attention.length ? attention.length : 'All clear'}</span>
          </header>
          {attention.length === 0 ? (
            <div className="all-clear">
              <CheckCircle2 size={30} strokeWidth={1.6} />
              <div>
                <strong>Everything looks healthy</strong>
                <p className="muted">No failed jobs, FX is up, AI is on and nothing is overdue.</p>
              </div>
            </div>
          ) : (
            <ul className="attention-list">
              {attention.map((a) => (
                <li key={a.title} className={`attention-${a.tone}`}>
                  <span className="attention-dot" />
                  <span className="cell-stack">
                    <span>{a.title}</span>
                    <span className="muted" style={{ fontSize: 12.5 }}>
                      {a.detail}
                    </span>
                  </span>
                  {a.to ? (
                    <button type="button" className="icon-btn icon-btn-sm" onClick={() => navigate(a.to!)} aria-label={`Open ${a.title}`}>
                      <ArrowRight size={15} strokeWidth={2} />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <div className="dash-systems">
            <SystemRow
              ok={o.fx_ok !== false}
              label="Exchange rates"
              detail={o.fx_ok === false ? o.fx_error || 'Unreachable' : `${o.fx_base || 'USD'} base${o.fx_as_of ? ` · ${o.fx_as_of}` : ''}`}
            />
            <SystemRow ok={jobsFailed === 0} label="Job queue" detail={`${jobsFailed} failed · ${jobsPending} pending`} />
            <SystemRow ok={!aiDisabled} label="AI services" detail={aiDisabled ? 'Disabled by an admin' : `${nf.format(o.ai_requests_today ?? 0)} requests today`} />
          </div>
        </section>
      </div>

      {/* ---------------------------------------------------- breakdowns */}
      <div className="dash-row">
        <section className="card dash-mini">
          <header className="dash-card-head">
            <div>
              <span className="dash-eyebrow">Accounts</span>
              <h3>Account status</h3>
            </div>
          </header>
          <div className="dash-donut">
            <div style={{ width: 150, height: 150, position: 'relative' }}>
              {accountMix.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={accountMix} dataKey="value" nameKey="name" innerRadius={50} outerRadius={70} paddingAngle={3} cornerRadius={5} stroke="none">
                      {accountMix.map((d) => (
                        <Cell key={d.name} fill={d.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP} />
                  </PieChart>
                </ResponsiveContainer>
              ) : null}
              <div className="chart-center-label">
                <div>
                  <strong>{activeShare}%</strong>
                  <small>active</small>
                </div>
              </div>
            </div>
            <ul className="legend-list">
              {accountMix.map((d) => (
                <li key={d.name}>
                  <i style={{ background: d.color }} />
                  <span>{d.name}</span>
                  <b>{nf.format(d.value)}</b>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="card dash-mini">
          <header className="dash-card-head">
            <div>
              <span className="dash-eyebrow">AI</span>
              <h3>AI activity</h3>
            </div>
            <span className={`badge ${aiDisabled ? 'badge-warning' : 'badge-success'}`}>{aiDisabled ? 'off' : 'on'}</span>
          </header>
          <div style={{ height: 170 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={aiBars} layout="vertical" margin={{ top: 0, right: 30, left: 0, bottom: 0 }} barSize={14}>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 12, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={TOOLTIP} cursor={{ fill: 'var(--surface-muted)' }} formatter={(v) => [nf.format(v as number), '']} />
                <Bar dataKey="value" radius={[0, 8, 8, 0]} label={{ position: 'right', fontSize: 11, fill: 'var(--muted)' }}>
                  {aiBars.map((d) => (
                    <Cell key={d.name} fill={d.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="card dash-mini">
          <header className="dash-card-head">
            <div>
              <span className="dash-eyebrow">Money</span>
              <h3>Lending & cashflow</h3>
            </div>
          </header>
          <div className="dash-stack-bars">
            <StackBar label="Loans on time" value={o.open_loans - o.overdue_loans} total={o.open_loans} color={TEAL} />
            <StackBar label="Loans overdue" value={o.overdue_loans} total={o.open_loans} color={ROSE} />
            <StackBar label="Jobs pending" value={jobsPending} total={jobsPending + jobsFailed} color={SLATE} />
            <StackBar label="Jobs failed" value={jobsFailed} total={jobsPending + jobsFailed} color={ROSE} />
          </div>
          <div className="dash-inline-stat">
            <ArrowLeftRight size={16} />
            <span>
              <b>{nf.format(o.cashflow_entries_7d)}</b> cashflow entries logged this week
            </span>
          </div>
          <div className="dash-inline-stat">
            <Coins size={16} />
            <span>
              <b>{nf.format(o.ai_insights_7d)}</b> AI insights generated this week
            </span>
          </div>
        </section>
      </div>

      {recent !== null ? (
        <section className="card">
          <header className="dash-card-head">
            <div>
              <span className="dash-eyebrow">Audit</span>
              <h3>Recent admin activity</h3>
            </div>
            <Button size="sm" variant="secondary" onClick={() => navigate('/audit')}>
              Open audit log <ArrowRight size={14} />
            </Button>
          </header>
          {recent.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No admin actions recorded yet.
            </p>
          ) : (
            <ul className="feed feed-grid">
              {recent.map((e) => {
                const Icon = actionIcon(e.action);
                const cat = categoryOf(e.action);
                return (
                  <li key={e.id}>
                    <span className="audit-item-icon sm" style={{ ['--cat' as string]: cat.color }}>
                      <Icon size={14} strokeWidth={2} />
                    </span>
                    <span className="feed-text">
                      <b>{actorName(e)}</b> {describe(e)}
                    </span>
                    <time className="muted">{relativeTime(e.created_at)}</time>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      <Modal
        open={aiConfirm}
        title={aiDisabled ? 'Turn AI back on?' : 'Turn AI off for everyone?'}
        onClose={() => setAIConfirm(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAIConfirm(false)}>
              Cancel
            </Button>
            <Button variant={aiDisabled ? 'primary' : 'danger'} busy={aiBusy} icon={<Power size={15} />} onClick={() => void toggleAI()}>
              {aiDisabled ? 'Turn AI on' : 'Turn AI off'}
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, lineHeight: 1.6 }}>
          {aiDisabled
            ? 'Premium members get AI features back immediately.'
            : 'All AI features stop immediately for every member, including Premium.'}{' '}
          The change is recorded in the audit log.
        </p>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------- pieces */

function StatusChip({ ok, icon: Icon, label }: { ok: boolean; icon: LucideIcon; label: string }) {
  return (
    <span className={`hero-chip${ok ? '' : ' bad'}`}>
      <Icon size={13} strokeWidth={2.2} />
      {label}
    </span>
  );
}

function Kpi({
  icon: Icon,
  color,
  label,
  value,
  foot,
  spark,
  meter,
  badge,
}: {
  icon: LucideIcon;
  color: string;
  label: string;
  value: string;
  foot: ReactNode;
  spark?: number[];
  meter?: number;
  badge?: { text: string; tone: string };
}) {
  const points = spark && spark.length > 1 ? sparkPath(spark) : null;
  return (
    <div className="kpi" style={{ ['--kpi' as string]: color }}>
      <div className="kpi-top">
        <span className="kpi-icon">
          <Icon size={18} strokeWidth={2} />
        </span>
        <span className="kpi-label">{label}</span>
        {badge ? <span className={`badge badge-${badge.tone}`}>{badge.text}</span> : null}
      </div>
      <strong className="kpi-value">{value}</strong>
      {points ? (
        <svg className="kpi-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden>
          <path d={`${points} L100,30 L0,30 Z`} className="kpi-spark-fill" />
          <path d={points} className="kpi-spark-line" />
        </svg>
      ) : meter !== undefined ? (
        <div className="kpi-meter">
          <span style={{ width: `${Math.max(0, Math.min(100, meter))}%` }} />
        </div>
      ) : null}
      <div className="kpi-foot">{foot}</div>
    </div>
  );
}

function sparkPath(values: number[]) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (values.length - 1)) * 100).toFixed(2)},${(28 - ((v - min) / span) * 26).toFixed(2)}`)
    .join(' ');
}

function SystemRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="system-row">
      <span className={`system-dot${ok ? '' : ' bad'}`} />
      <span className="cell-stack" style={{ flex: 1 }}>
        <span>{label}</span>
        <span className="muted" style={{ fontSize: 12 }}>
          {detail}
        </span>
      </span>
      <span className={`badge ${ok ? 'badge-success' : 'badge-error'}`}>{ok ? 'OK' : 'Issue'}</span>
    </div>
  );
}

function StackBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const p = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="stack-bar">
      <div className="stack-bar-top">
        <span>{label}</span>
        <b>
          {nf.format(value)} <span className="muted">· {p}%</span>
        </b>
      </div>
      <div className="stack-bar-track">
        <span style={{ width: `${p}%`, background: color }} />
      </div>
    </div>
  );
}
