import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Copy, RefreshCw, RotateCcw } from 'lucide-react';
import { api, type SystemInfo } from '../api';
import { useAuth } from '../auth';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { relativeTime } from '../lib/audit';

const nf = new Intl.NumberFormat();
const AUTO_MS = 15_000;

function bytes(n: number) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function duration(sec: number) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${sec % 60}s`;
}

const JOB_KIND: Record<string, string> = {
  due_soon_7d: 'Due in 7 days',
  due_soon_3d: 'Due in 3 days',
  due_soon_1d: 'Due tomorrow',
  due_today: 'Due today',
  overdue: 'Overdue',
};

export function SystemPage() {
  const { token, hasPerm } = useAuth();
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [auto, setAuto] = useState(true);
  const [retryOpen, setRetryOpen] = useState(false);
  const [retryBusy, setRetryBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    async (quiet = false) => {
      if (!token) return;
      if (!quiet) setLoading(true);
      try {
        const res = await api.system(token);
        setInfo(res.system);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load system status');
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!auto) return;
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, AUTO_MS);
    return () => window.clearInterval(t);
  }, [auto, load]);

  async function retry() {
    if (!token) return;
    setRetryBusy(true);
    try {
      const res = await api.retryFailedJobs(token);
      setNotice(res.retried ? `${res.retried} job${res.retried > 1 ? 's' : ''} queued again.` : 'There were no failed jobs to retry.');
      setRetryOpen(false);
      await load(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Retry failed');
    } finally {
      setRetryBusy(false);
    }
  }

  const header = (
    <div className="page-header">
      <div className="page-header-title">
        <h1>System</h1>
      </div>
      <div className="page-header-actions">
        {info ? <span className="muted ov-updated">Checked {relativeTime(info.generated_at)}</span> : null}
        <button
          type="button"
          className={`live-toggle${auto ? ' on' : ''}`}
          aria-pressed={auto}
          onClick={() => setAuto((v) => !v)}
          title="Refresh every 15 seconds"
        >
          <span className={`dot dot-${auto ? 'ok' : 'off'}`} />
          {auto ? 'Live' : 'Paused'}
        </button>
        <button type="button" className="shell-icon-btn bordered" onClick={() => void load()} title="Refresh" aria-label="Refresh">
          <RefreshCw size={15} strokeWidth={2} className={loading ? 'spin' : undefined} />
        </button>
      </div>
    </div>
  );

  if (!info) {
    return (
      <div className="page">
        {header}
        {error ? (
          <div className="alert alert-error">
            <AlertTriangle size={16} strokeWidth={2} />
            <span>{error}</span>
          </div>
        ) : (
          <div className="sys-grid">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton" style={{ height: 220 }} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const { runtime: rt, database: db, jobs, sessions, integrations, controls } = info;
  const poolUse = db.pool.max ? Math.round((db.pool.acquired / db.pool.max) * 100) : 0;
  const heapUse = rt.heap_sys_bytes ? Math.round((rt.heap_alloc_bytes / rt.heap_sys_bytes) * 100) : 0;
  const maint = controls.find((c) => c.key === 'maintenance_mode');
  const paused = controls.filter((c) => c.group !== 'platform' && c.kind === 'bool' && c.enabled);
  const largest = Math.max(1, ...db.tables.map((t) => t.bytes));

  const services: { label: string; tone: 'ok' | 'warn' | 'bad' | 'off'; detail: string }[] = [
    { label: 'API', tone: 'ok', detail: `Up ${duration(rt.uptime_sec)}` },
    { label: 'Database', tone: !db.ok ? 'bad' : db.latency_ms > 250 ? 'warn' : 'ok', detail: db.ok ? `${db.latency_ms.toFixed(1)} ms` : 'Unreachable' },
    { label: 'Reminder jobs', tone: jobs.failed ? 'warn' : 'ok', detail: jobs.failed ? `${jobs.failed} failed` : 'Healthy' },
    ...integrations.map((i) => ({
      label: i.label,
      tone: (i.status === 'ok' ? 'ok' : i.status === 'error' ? 'bad' : 'off') as 'ok' | 'bad' | 'off',
      detail: i.detail || (i.configured ? 'Configured' : 'Not configured'),
    })),
  ];

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

      {maint?.enabled || paused.length ? (
        <div className="sys-banner">
          <AlertTriangle size={16} strokeWidth={2} />
          <span>
            {maint?.enabled ? 'Maintenance mode is on — users are locked out.' : null}
            {maint?.enabled && paused.length ? ' ' : null}
            {paused.length ? `Paused: ${paused.map((c) => c.label).join(', ')}.` : null}
          </span>
          <Link to="/controls" className="ov-link">
            Controls <ArrowRight size={14} strokeWidth={2} />
          </Link>
        </div>
      ) : null}

      {/* services */}
      <section className="card sys-services">
        {services.map((s) => (
          <div key={s.label} className="sys-service">
            <span className={`dot dot-${s.tone}`} />
            <span className="cell-stack">
              <span>{s.label}</span>
              <small className="muted">{s.detail}</small>
            </span>
          </div>
        ))}
      </section>

      <div className="sys-grid">
        {/* runtime */}
        <Section title="API server" aside={<span className="badge">{rt.env}</span>}>
          <div className="sys-stats">
            <Stat label="Uptime" value={duration(rt.uptime_sec)} hint={`since ${new Date(rt.started_at).toLocaleString()}`} />
            <Stat label="Goroutines" value={nf.format(rt.goroutines)} />
            <Stat label="Heap in use" value={bytes(rt.heap_alloc_bytes)} hint={`${heapUse}% of ${bytes(rt.heap_sys_bytes)}`} />
            <Stat label="Memory from OS" value={bytes(rt.sys_bytes)} />
          </div>
          <Meter label="Heap" value={heapUse} />
          <Facts
            rows={[
              ['Go', rt.go_version],
              ['Platform', `${rt.os}/${rt.arch} · ${rt.cpus} CPU${rt.cpus > 1 ? 's' : ''}`],
              ['Garbage collections', `${nf.format(rt.num_gc)} · last pause ${(rt.last_gc_pause_ns / 1e6).toFixed(2)} ms`],
              ['Build', rt.revision ? <CopyText text={rt.revision} short={rt.revision.slice(0, 10) + (rt.modified ? ' (modified)' : '')} /> : 'Unknown'],
              ['Built at', rt.build_time ? new Date(rt.build_time).toLocaleString() : '—'],
            ]}
          />
        </Section>

        {/* database */}
        <Section title="Database" aside={<span className={`badge ${db.ok ? 'badge-success' : 'badge-error'}`}>{db.ok ? 'Connected' : 'Down'}</span>}>
          {db.error ? <p className="sys-error">{db.error}</p> : null}
          <div className="sys-stats">
            <Stat label="Latency" value={`${db.latency_ms.toFixed(1)} ms`} />
            <Stat label="Size" value={bytes(db.size_bytes)} />
            <Stat label="Connections" value={`${db.pool.acquired}/${db.pool.max}`} hint={`${db.pool.idle} idle · ${db.pool.total} open`} />
            <Stat label="Migrations" value={nf.format(db.migrations_count)} hint={db.migration ? `latest ${db.migration}` : undefined} />
          </div>
          <Meter label="Pool in use" value={poolUse} />
          <Facts
            rows={[
              ['PostgreSQL', db.version || '—'],
              ['Last migration', db.migration_at ? `${db.migration} · ${new Date(db.migration_at).toLocaleString()}` : db.migration || '—'],
            ]}
          />
        </Section>

        {/* jobs */}
        <Section
          title="Reminder jobs"
          aside={
            hasPerm('system.jobs') ? (
              <Button size="sm" variant="secondary" icon={<RotateCcw size={14} strokeWidth={2} />} disabled={!jobs.failed} onClick={() => setRetryOpen(true)}>
                Retry failed
              </Button>
            ) : null
          }
        >
          <div className="sys-stats">
            <Stat label="Due now" value={nf.format(jobs.due)} hint={jobs.oldest_due_at ? `oldest ${relativeTime(jobs.oldest_due_at)}` : undefined} />
            <Stat label="Scheduled" value={nf.format(jobs.pending)} />
            <Stat label="Sent · 24h" value={nf.format(jobs.completed_24h)} />
            <Stat label="Failed" value={nf.format(jobs.failed)} tone={jobs.failed ? 'warn' : undefined} />
          </div>
          {jobs.recent_failures.length ? (
            <div className="sys-table-wrap">
              <table className="sys-table">
                <thead>
                  <tr>
                    <th>Kind</th>
                    <th>Error</th>
                    <th className="num">Tries</th>
                    <th className="num">When</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.recent_failures.map((f) => (
                    <tr key={f.id}>
                      <td>{JOB_KIND[f.kind] ?? f.kind}</td>
                      <td className="sys-err-cell" title={f.last_error}>
                        {f.last_error || '—'}
                      </td>
                      <td className="num">{f.attempts}</td>
                      <td className="num muted">{relativeTime(f.run_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted sys-note">No failed jobs.</p>
          )}
        </Section>

        {/* sessions */}
        <Section title="Sessions">
          <div className="sys-stats">
            <Stat label="Signed-in sessions" value={nf.format(sessions.active)} />
            <Stat label="People · last hour" value={nf.format(sessions.used_1h)} />
            <Stat label="People · 24h" value={nf.format(sessions.used_24h)} />
            <Stat label="Admins · last hour" value={nf.format(sessions.admins_live)} />
          </div>
          <h4 className="sys-subhead">Integrations</h4>
          <ul className="sys-integrations">
            {integrations.map((i) => (
              <li key={i.key}>
                <span className={`dot dot-${i.status === 'ok' ? 'ok' : i.status === 'error' ? 'bad' : 'off'}`} />
                <span className="cell-stack">
                  <span>{i.label}</span>
                  <small className="muted">{i.detail || '—'}</small>
                </span>
                <span className={`badge ${i.status === 'ok' ? 'badge-success' : i.status === 'error' ? 'badge-error' : 'badge-muted'}`}>
                  {i.status === 'ok' ? 'OK' : i.status === 'error' ? 'Error' : 'Off'}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      {/* tables */}
      <Section title="Largest tables">
        <div className="sys-table-wrap">
          <table className="sys-table">
            <thead>
              <tr>
                <th>Table</th>
                <th className="num">Rows (est.)</th>
                <th className="num">Size</th>
                <th style={{ width: '32%' }} />
              </tr>
            </thead>
            <tbody>
              {db.tables.map((t) => (
                <tr key={t.name}>
                  <td className="mono">{t.name}</td>
                  <td className="num">{nf.format(t.rows)}</td>
                  <td className="num">{bytes(t.bytes)}</td>
                  <td>
                    <div className="ov-bar-track">
                      <span style={{ width: `${(t.bytes / largest) * 100}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Modal
        open={retryOpen}
        title={`Retry ${jobs.failed} failed job${jobs.failed === 1 ? '' : 's'}?`}
        onClose={() => setRetryOpen(false)}
        footer={
          <>
            <Button size="sm" variant="secondary" onClick={() => setRetryOpen(false)} disabled={retryBusy}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" busy={retryBusy} onClick={() => void retry()}>
              Retry now
            </Button>
          </>
        }
      >
        <p style={{ margin: 0 }}>They go back into the queue and run on the next worker tick. Users may receive reminders that were missed.</p>
      </Modal>
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="card sys-section">
      <header className="ov-card-head">
        <h3>{title}</h3>
        {aside}
      </header>
      <div className="stack">{children}</div>
    </section>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'warn' }) {
  return (
    <div className="sys-stat">
      <small>{label}</small>
      <strong className={tone === 'warn' ? 'tone-warn' : undefined}>{value}</strong>
      {hint ? <span className="muted">{hint}</span> : null}
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="ov-bar">
      <div className="ov-bar-top">
        <span>{label}</span>
        <b>{value}%</b>
      </div>
      <div className="ov-bar-track">
        <span className={value >= 85 ? 'warn' : undefined} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
    </div>
  );
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="sys-facts">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function CopyText({ text, short }: { text: string; short: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="link-btn mono"
      title="Copy full revision"
      onClick={() => {
        void navigator.clipboard?.writeText(text).catch(() => undefined);
        setDone(true);
        window.setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? 'Copied' : short} <Copy size={12} strokeWidth={2} />
    </button>
  );
}
