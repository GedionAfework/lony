import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import {
  Activity,
  AlertTriangle,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Globe,
  History,
  Inbox,
  LayoutList,
  Monitor,
  Radio,
  RefreshCw,
  ScrollText,
  Search,
  Target,
  User,
  Users,
  X,
} from 'lucide-react';
import { api, type AuditEntry, type AuditParams, type AuditStats } from '../api';
import { useAuth } from '../auth';
import { Button } from '../components/Button';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { Drawer, DetailList } from '../components/Drawer';
import {
  ACTION_LABELS,
  AUDIT_CATEGORIES,
  actionIcon,
  actionLabel,
  actionTone,
  actorName,
  categoryOf,
  changes,
  dayLabel,
  describe,
  describeUserAgent,
  relativeTime,
  targetName,
} from '../lib/audit';

const PAGE = 30;
const LIVE_MS = 15000;

type Range = '24h' | '7d' | '30d' | '90d' | 'all' | 'custom';
const RANGES: { id: Range; label: string }[] = [
  { id: '24h', label: '24h' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom' },
];

type Person = { id: string; label: string };

function rangeBounds(range: Range, from: string, to: string): { from?: string; to?: string } {
  const now = Date.now();
  const hours: Partial<Record<Range, number>> = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30, '90d': 24 * 90 };
  if (hours[range]) return { from: new Date(now - hours[range]! * 3600_000).toISOString() };
  if (range === 'custom') {
    const out: { from?: string; to?: string } = {};
    if (from) out.from = new Date(`${from}T00:00:00`).toISOString();
    if (to) out.to = new Date(new Date(`${to}T00:00:00`).getTime() + 86400_000).toISOString();
    return out;
  }
  return {};
}

function personFromUrl(key: 'actor' | 'target'): Person | null {
  const p = new URLSearchParams(window.location.search);
  const id = p.get(key);
  return id ? { id, label: p.get(`${key}_label`) || `${id.slice(0, 8)}…` } : null;
}

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

function copy(text: string) {
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}

function initialsOf(label: string) {
  const parts = label.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

export function AuditPage() {
  const { token } = useAuth();

  // filters
  const [qInput, setQInput] = useState('');
  const q = useDebounced(qInput);
  const [category, setCategory] = useState('');
  const [action, setAction] = useState('');
  const [range, setRange] = useState<Range>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [actor, setActor] = useState<Person | null>(() => personFromUrl('actor'));
  const [target, setTarget] = useState<Person | null>(() => personFromUrl('target'));

  // data
  const [view, setView] = useState<'timeline' | 'table'>('timeline');
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [live, setLive] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [now, setNow] = useState(Date.now());

  const params = useMemo<AuditParams>(() => {
    const bounds = rangeBounds(range, customFrom, customTo);
    return {
      q: q.trim() || undefined,
      action: action || category || undefined,
      actor_id: actor?.id,
      target_id: target?.id,
      ...bounds,
    };
    // `now` refreshes rolling ranges on each live tick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, action, category, range, customFrom, customTo, actor, target]);

  const reqId = useRef(0);
  const load = useCallback(
    async (nextOffset: number, append: boolean) => {
      if (!token) return;
      const id = ++reqId.current;
      setLoading(true);
      setError(null);
      try {
        const res = await api.audit(token, { ...params, ...rangeBounds(range, customFrom, customTo), limit: PAGE, offset: nextOffset });
        if (id !== reqId.current) return;
        const rows = res.audit ?? [];
        setEntries((cur) => (append ? [...cur, ...rows] : rows));
        setTotal(res.total ?? rows.length);
        setOffset(nextOffset);
        setNow(Date.now());
      } catch (e) {
        if (id === reqId.current) setError(e instanceof Error ? e.message : 'Failed to load audit log');
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [token, params, range, customFrom, customTo],
  );

  const loadStats = useCallback(async () => {
    if (!token) return;
    try {
      const res = await api.auditStats(token, 30);
      setStats(res.stats);
    } catch {
      /* stats are a nice-to-have; the list still works */
    }
  }, [token]);

  useEffect(() => {
    void load(0, false);
  }, [load]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void load(0, false);
      void loadStats();
    }, LIVE_MS);
    return () => window.clearInterval(t);
  }, [live, load, loadStats]);

  async function onExport() {
    if (!token) return;
    setExporting(true);
    try {
      await api.exportAudit(token, params);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  function clearAll() {
    setQInput('');
    setCategory('');
    setAction('');
    setRange('30d');
    setCustomFrom('');
    setCustomTo('');
    setActor(null);
    setTarget(null);
  }

  const activeFilters = [
    qInput ? { key: 'q', label: `“${qInput}”`, clear: () => setQInput('') } : null,
    category ? { key: 'cat', label: AUDIT_CATEGORIES.find((c) => c.prefix === category)?.label ?? category, clear: () => setCategory('') } : null,
    action ? { key: 'action', label: actionLabel(action), clear: () => setAction('') } : null,
    actor ? { key: 'actor', label: `By ${actor.label}`, clear: () => setActor(null) } : null,
    target ? { key: 'target', label: `On ${target.label}`, clear: () => setTarget(null) } : null,
    range !== '30d' ? { key: 'range', label: RANGES.find((r) => r.id === range)?.label ?? range, clear: () => setRange('30d') } : null,
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[];

  const grouped = useMemo(() => {
    const groups: { label: string; items: AuditEntry[] }[] = [];
    for (const e of entries) {
      const label = dayLabel(e.created_at);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(e);
      else groups.push({ label, items: [e] });
    }
    return groups;
  }, [entries]);

  const chartData = (stats?.by_day ?? []).map((d) => ({ label: d.day.slice(5), full: d.day, count: d.count }));
  const topAction = stats?.by_action?.[0];
  const maxActionCount = Math.max(1, ...(stats?.by_action ?? []).map((a) => a.count));

  const pageNo = Math.floor(offset / PAGE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE));

  function openActor(e: AuditEntry) {
    setActor({ id: e.actor_id, label: actorName(e) });
    setSelected(null);
  }
  function openTarget(e: AuditEntry) {
    if (!e.target_user_id) return;
    setTarget({ id: e.target_user_id, label: targetName(e) ?? e.target_user_id });
    setSelected(null);
  }

  return (
    <div className="page">
      <PageHeader
        icon={ScrollText}
        title="Audit log"
        actions={
          <>
            <button
              type="button"
              className={`live-toggle${live ? ' on' : ''}`}
              onClick={() => setLive((v) => !v)}
              aria-pressed={live}
              title="Refresh automatically every 15 seconds"
            >
              <Radio size={15} strokeWidth={2} />
              {live ? 'Live' : 'Go live'}
            </button>
            <Button
              variant="secondary"
              icon={<RefreshCw size={15} strokeWidth={2} className={loading ? 'spin' : undefined} />}
              onClick={() => {
                void load(0, false);
                void loadStats();
              }}
            >
              Refresh
            </Button>
            <Button variant="primary" busy={exporting} icon={<Download size={15} strokeWidth={2} />} onClick={() => void onExport()}>
              Export CSV
            </Button>
          </>
        }
      />

      {error ? (
        <div className="alert alert-error">
          <AlertTriangle size={16} strokeWidth={2} />
          <span>{error}</span>
        </div>
      ) : null}

      {/* ------------------------------------------------ insight strip */}
      <div className="audit-insights">
        <div className="audit-kpis">
          <StatCard icon={Activity} label="Events today" value={stats?.today ?? '—'} />
          <StatCard icon={History} label="Last 7 days" value={stats?.last_7d ?? '—'} />
          <StatCard icon={Users} label="Active admins · 7d" value={stats?.actors_7d ?? '—'} />
          <StatCard
            icon={ScrollText}
            label="All-time events"
            value={stats ? stats.total.toLocaleString() : '—'}
            hint={topAction ? `Most common: ${actionLabel(topAction.action)}` : undefined}
          />
        </div>

        <div className="card audit-chart-card">
          <div className="card-title-row">
            <strong>Activity · 30 days</strong>
            <span className="muted" style={{ fontSize: 12.5 }}>
              {stats ? `${stats.by_day.reduce((n, d) => n + d.count, 0)} events` : ''}
            </span>
          </div>
          <div style={{ height: 150 }}>
            {chartData.some((d) => d.count > 0) ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="auditBar" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#14b8a6" />
                      <stop offset="100%" stopColor="#0891b2" stopOpacity={0.55} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} interval={4} />
                  <Tooltip
                    cursor={{ fill: 'var(--surface-muted)' }}
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, fontSize: 12 }}
                    labelFormatter={(_, p) => String(p?.[0]?.payload?.full ?? '')}
                    formatter={(v) => [v as number, 'Events']}
                  />
                  <Bar dataKey="count" fill="url(#auditBar)" radius={[5, 5, 2, 2]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="chart-state">
                <p>No admin activity in the last 30 days</p>
              </div>
            )}
          </div>
        </div>

        <div className="card audit-side-card">
          <div className="card-title-row">
            <strong>Top actions</strong>
          </div>
          <div className="audit-bars">
            {(stats?.by_action ?? []).slice(0, 5).map((a) => {
              const cat = categoryOf(a.action);
              return (
                <button
                  type="button"
                  key={a.action}
                  className={`audit-bar-row${action === a.action ? ' active' : ''}`}
                  onClick={() => setAction(action === a.action ? '' : a.action)}
                  title="Filter by this action"
                >
                  <span className="audit-bar-label">{actionLabel(a.action)}</span>
                  <span className="audit-bar-track">
                    <span style={{ width: `${(a.count / maxActionCount) * 100}%`, background: cat.color }} />
                  </span>
                  <b>{a.count}</b>
                </button>
              );
            })}
            {stats && stats.by_action.length === 0 ? <p className="muted" style={{ margin: 0, fontSize: 13 }}>Nothing yet.</p> : null}
          </div>
          {stats && stats.top_actors.length > 0 ? (
            <>
              <div className="card-title-row" style={{ marginTop: 16 }}>
                <strong>Most active admins</strong>
              </div>
              <div className="audit-actors">
                {stats.top_actors.slice(0, 4).map((a) => {
                  const label = a.name?.trim() || a.email || a.actor_id.slice(0, 8);
                  return (
                    <button type="button" key={a.actor_id} className="audit-actor" onClick={() => setActor({ id: a.actor_id, label })}>
                      <span className="audit-avatar">{initialsOf(label)}</span>
                      <span className="audit-actor-name">{label}</span>
                      <span className="muted">{a.count}</span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* ------------------------------------------------ filters */}
      <div className="audit-filters">
        <div className="audit-filter-row">
          <label className="audit-search">
            <Search size={16} strokeWidth={2} />
            <input
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="Search admin, target email, action, IP or details…"
              aria-label="Search audit log"
            />
          </label>
          <div className="seg" role="tablist" aria-label="Time range">
            {RANGES.map((r) => (
              <button key={r.id} type="button" className={range === r.id ? 'active' : ''} onClick={() => setRange(r.id)}>
                {r.label}
              </button>
            ))}
          </div>
          <select value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action" style={{ width: 'auto', minWidth: 190 }}>
            <option value="">Any action</option>
            {Object.keys(ACTION_LABELS)
              .filter((a) => !category || a.startsWith(category))
              .map((a) => (
                <option key={a} value={a}>
                  {actionLabel(a)}
                </option>
              ))}
          </select>
        </div>

        {range === 'custom' ? (
          <div className="audit-filter-row audit-custom-range">
            <CalendarRange size={16} strokeWidth={2} className="muted" />
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} aria-label="From date" />
            <span className="muted">to</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} aria-label="To date" />
          </div>
        ) : null}

        <div className="audit-chips" role="tablist" aria-label="Category">
          <button type="button" className={`audit-chip${category === '' ? ' active' : ''}`} onClick={() => setCategory('')}>
            All
          </button>
          {AUDIT_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`audit-chip${category === c.prefix ? ' active' : ''}`}
              style={{ ['--chip' as string]: c.color }}
              onClick={() => {
                setCategory(category === c.prefix ? '' : c.prefix);
                setAction('');
              }}
            >
              <i />
              {c.label}
            </button>
          ))}
        </div>

        {activeFilters.length > 0 ? (
          <div className="audit-active">
            <span className="muted">Filters:</span>
            {activeFilters.map((f) => (
              <span key={f.key} className="filter-pill">
                {f.label}
                <button type="button" onClick={f.clear} aria-label={`Remove ${f.label}`}>
                  <X size={12} strokeWidth={2.5} />
                </button>
              </span>
            ))}
            <button type="button" className="link-btn" onClick={clearAll}>
              Clear all
            </button>
          </div>
        ) : null}
      </div>

      {/* ------------------------------------------------ results */}
      <div className="lt-table-card audit-results">
        <div className="lt-table-head">
          <div className="lt-table-head-text">
            <h3 className="lt-table-title">Events</h3>
            <p className="lt-table-subtitle">{total.toLocaleString()}</p>
            {loading ? <RefreshCw size={14} className="spin muted" /> : null}
          </div>
          <div className="seg" role="tablist" aria-label="View">
            <button type="button" className={view === 'timeline' ? 'active' : ''} onClick={() => setView('timeline')}>
              <History size={14} strokeWidth={2} /> Timeline
            </button>
            <button
              type="button"
              className={view === 'table' ? 'active' : ''}
              onClick={() => {
                setView('table');
                if (entries.length > PAGE) void load(0, false);
              }}
            >
              <LayoutList size={14} strokeWidth={2} /> Table
            </button>
          </div>
        </div>

        {loading && entries.length === 0 ? (
          <div className="audit-timeline">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="audit-item audit-item-skel">
                <span className="lt-skel" style={{ width: 36, height: 36, borderRadius: 12 }} />
                <span className="lt-skel" style={{ flex: 1, height: 14 }} />
              </div>
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="lt-table-empty">
            <Inbox size={28} strokeWidth={1.4} />
            <p>No events match these filters.</p>
            {activeFilters.length ? (
              <Button variant="secondary" size="sm" onClick={clearAll}>
                Clear filters
              </Button>
            ) : null}
          </div>
        ) : view === 'timeline' ? (
          <div className="audit-timeline">
            {grouped.map((g) => (
              <section key={g.label} className="audit-day">
                <h4 className="audit-day-label">
                  {g.label}
                  <span>{g.items.length}</span>
                </h4>
                {g.items.map((e) => {
                  const Icon = actionIcon(e.action);
                  const cat = categoryOf(e.action);
                  const diff = changes(e);
                  return (
                    <button
                      type="button"
                      key={e.id}
                      className={`audit-item tone-${actionTone(e.action)}${selected?.id === e.id ? ' active' : ''}`}
                      onClick={() => setSelected(e)}
                    >
                      <span className="audit-item-icon" style={{ ['--cat' as string]: cat.color }}>
                        <Icon size={16} strokeWidth={2} />
                      </span>
                      <span className="audit-item-main">
                        <span className="audit-item-text">
                          <b>{actorName(e)}</b> {describe(e)}
                        </span>
                        <span className="audit-item-meta">
                          <span className="audit-cat" style={{ ['--cat' as string]: cat.color }}>
                            {cat.label}
                          </span>
                          {diff.map((d) => (
                            <span key={d.field} className="audit-diff">
                              {d.field}: {d.from ? <s>{d.from}</s> : null}
                              {d.from ? ' → ' : ''}
                              <b>{d.to}</b>
                            </span>
                          ))}
                          {e.ip ? (
                            <span className="audit-ip">
                              <Globe size={11} strokeWidth={2} /> {e.ip}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <time className="audit-item-time" dateTime={e.created_at} title={new Date(e.created_at).toLocaleString()}>
                        {relativeTime(e.created_at, now)}
                        <small>{new Date(e.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</small>
                      </time>
                    </button>
                  );
                })}
              </section>
            ))}
            {entries.length < total ? (
              <div className="audit-more">
                <Button variant="secondary" busy={loading} onClick={() => void load(entries.length, true)}>
                  Load {Math.min(PAGE, total - entries.length)} more
                </Button>
                <span className="muted">
                  Showing {entries.length} of {total.toLocaleString()}
                </span>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <div className="lt-table-scroll">
              <table className="lt-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Admin</th>
                    <th>Action</th>
                    <th>Target</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => {
                    const cat = categoryOf(e.action);
                    return (
                      <tr key={e.id} className={`lt-clickable${selected?.id === e.id ? ' lt-row-active' : ''}`} onClick={() => setSelected(e)}>
                        <td>
                          <div className="cell-stack">
                            <span style={{ fontWeight: 600 }}>{relativeTime(e.created_at, now)}</span>
                            <span className="muted" style={{ fontSize: 12 }}>
                              {new Date(e.created_at).toLocaleString()}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="user-cell">
                            <span className="audit-avatar">{initialsOf(actorName(e))}</span>
                            <div className="cell-stack">
                              <span>{actorName(e)}</span>
                              {e.actor_name && e.actor_email ? (
                                <span className="muted" style={{ fontSize: 12 }}>
                                  {e.actor_email}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="audit-cat" style={{ ['--cat' as string]: cat.color }}>
                            {actionLabel(e.action)}
                          </span>
                        </td>
                        <td>{targetName(e) ?? <span className="muted">—</span>}</td>
                        <td className="muted" style={{ fontSize: 12.5 }}>
                          {e.ip || '—'}
                          {e.user_agent ? <div>{describeUserAgent(e.user_agent)}</div> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="lt-table-footer">
              <div className="pagination">
                <span className="muted">
                  Page {pageNo} of {pageCount} · {total.toLocaleString()} events
                </span>
                <div className="btn-group">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={offset === 0 || loading}
                    icon={<ChevronLeft size={14} strokeWidth={2} />}
                    onClick={() => void load(Math.max(0, offset - PAGE), false)}
                  >
                    Prev
                  </Button>
                  <Button variant="secondary" size="sm" disabled={offset + PAGE >= total || loading} onClick={() => void load(offset + PAGE, false)}>
                    Next <ChevronRight size={14} strokeWidth={2} />
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <AuditDrawer entry={selected} onClose={() => setSelected(null)} onActor={openActor} onTarget={openTarget} />
    </div>
  );
}

function AuditDrawer({
  entry,
  onClose,
  onActor,
  onTarget,
}: {
  entry: AuditEntry | null;
  onClose: () => void;
  onActor: (e: AuditEntry) => void;
  onTarget: (e: AuditEntry) => void;
}) {
  const [copied, setCopied] = useState(false);
  if (!entry) return null;
  const Icon = actionIcon(entry.action);
  const cat = categoryOf(entry.action);
  const diff = changes(entry);
  const when = new Date(entry.created_at);
  const meta = entry.meta ?? {};
  const metaKeys = Object.keys(meta);

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow={<span style={{ color: cat.color }}>{cat.label}</span>}
      title={actionLabel(entry.action)}
      icon={
        <span className="audit-item-icon lg" style={{ ['--cat' as string]: cat.color }}>
          <Icon size={20} strokeWidth={2} />
        </span>
      }
    >
      <p className="drawer-lead">
        <b>{actorName(entry)}</b> {describe(entry)}.
      </p>

      {diff.length ? (
        <div className="drawer-section">
          <h4>Change</h4>
          <div className="diff-list">
            {diff.map((d) => (
              <div key={d.field} className="diff-row">
                <span className="muted">{d.field}</span>
                {d.from ? <span className="diff-from">{d.from}</span> : null}
                {d.from ? <ChevronRight size={14} className="muted" /> : null}
                <span className="diff-to">{d.to}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="drawer-section">
        <h4>Who</h4>
        <div className="person-card">
          <span className="audit-avatar lg">{initialsOf(actorName(entry))}</span>
          <div className="cell-stack">
            <strong>{actorName(entry)}</strong>
            <span className="muted" style={{ fontSize: 12.5 }}>
              {entry.actor_email || entry.actor_id}
            </span>
          </div>
          <Button size="sm" variant="secondary" icon={<User size={13} strokeWidth={2} />} onClick={() => onActor(entry)}>
            Their activity
          </Button>
        </div>
      </div>

      {entry.target_user_id ? (
        <div className="drawer-section">
          <h4>Affected user</h4>
          <div className="person-card">
            <span className="audit-avatar lg alt">{initialsOf(targetName(entry) ?? '?')}</span>
            <div className="cell-stack">
              <strong>{targetName(entry)}</strong>
              <span className="muted" style={{ fontSize: 12.5 }}>
                {entry.target_email || entry.target_user_id}
              </span>
            </div>
            <Button size="sm" variant="secondary" icon={<Target size={13} strokeWidth={2} />} onClick={() => onTarget(entry)}>
              History
            </Button>
          </div>
        </div>
      ) : null}

      <div className="drawer-section">
        <h4>When & where</h4>
        <DetailList
          rows={[
            ['Local time', when.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'medium' })],
            ['UTC', <span className="mono">{when.toISOString().replace('T', ' ').slice(0, 19)}</span>],
            [
              'IP address',
              entry.ip ? (
                <span className="mono">{entry.ip}</span>
              ) : (
                <span className="muted">Not recorded</span>
              ),
            ],
            [
              'Device',
              entry.user_agent ? (
                <span title={entry.user_agent}>
                  <Monitor size={13} strokeWidth={2} style={{ verticalAlign: -2, marginRight: 6 }} />
                  {describeUserAgent(entry.user_agent)}
                </span>
              ) : (
                <span className="muted">Not recorded</span>
              ),
            ],
          ]}
        />
      </div>

      <div className="drawer-section">
        <h4>Identifiers</h4>
        <DetailList
          rows={[
            ['Event ID', <CopyText text={entry.id} />],
            ['Action code', <CopyText text={entry.action} />],
            ['Admin ID', <CopyText text={entry.actor_id} />],
            ...(entry.target_user_id ? ([['User ID', <CopyText text={entry.target_user_id} />]] as [string, ReactNode][]) : []),
          ]}
        />
      </div>

      <div className="drawer-section">
        <h4 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Details
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              copy(JSON.stringify(meta, null, 2));
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }}
          >
            <Copy size={12} strokeWidth={2} /> {copied ? 'Copied' : 'Copy JSON'}
          </button>
        </h4>
        {metaKeys.length ? <pre className="audit-meta code-block">{JSON.stringify(meta, null, 2)}</pre> : <p className="muted">No extra details.</p>}
      </div>
    </Drawer>
  );
}

function CopyText({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="copy-text"
      title="Copy"
      onClick={() => {
        copy(text);
        setDone(true);
        window.setTimeout(() => setDone(false), 1200);
      }}
    >
      <span className="mono">{text}</span>
      <Copy size={12} strokeWidth={2} />
      {done ? <em>copied</em> : null}
    </button>
  );
}
