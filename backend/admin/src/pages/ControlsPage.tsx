import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Lock } from 'lucide-react';
import { api, type AuditEntry, type Control } from '../api';
import { useAuth } from '../auth';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { actorName, describe, relativeTime } from '../lib/audit';

type Pending = { control: Control; next: boolean };

export function ControlsPage() {
  const { token, hasPerm } = useAuth();
  const canPlatform = hasPerm('settings.platform');
  const canAI = hasPerm('settings.ai');
  const [controls, setControls] = useState<Control[] | null>(null);
  const [history, setHistory] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageSaved, setMessageSaved] = useState<'idle' | 'saving' | 'saved'>('idle');

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [res, audit] = await Promise.all([
        api.controls(token),
        hasPerm('audit.read') ? api.audit(token, { action: 'settings.', limit: 8 }).catch(() => null) : Promise.resolve(null),
      ]);
      setControls(res.controls);
      setMessage(res.controls.find((c) => c.key === 'maintenance_message')?.value ?? '');
      setHistory(audit ? audit.audit ?? [] : null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load controls');
    }
  }, [token, hasPerm]);

  useEffect(() => {
    void load();
  }, [load]);

  const canEdit = (c: Control) => (c.group === 'ai' ? canAI : canPlatform);

  async function apply(p: Pending) {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      if (p.control.key === 'ai_disabled') {
        await api.setAIDisabled(token, p.next);
      } else {
        await api.setControls(token, { [p.control.key]: p.next ? 'true' : 'false' });
      }
      setPending(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update');
    } finally {
      setBusy(false);
    }
  }

  async function saveMessage() {
    if (!token) return;
    setMessageSaved('saving');
    try {
      await api.setControls(token, { maintenance_message: message });
      setMessageSaved('saved');
      window.setTimeout(() => setMessageSaved('idle'), 1500);
      await load();
    } catch (e) {
      setMessageSaved('idle');
      setError(e instanceof Error ? e.message : 'Could not save message');
    }
  }

  if (!controls) {
    return (
      <div className="page">
        <PageTitle />
        {error ? (
          <div className="alert alert-error">
            <AlertTriangle size={16} strokeWidth={2} />
            <span>{error}</span>
          </div>
        ) : (
          <>
            <div className="skeleton" style={{ height: 180 }} />
            <div className="skeleton" style={{ height: 300 }} />
          </>
        )}
      </div>
    );
  }

  const byKey = (k: string) => controls.find((c) => c.key === k);
  const maint = byKey('maintenance_mode');
  const signups = byKey('signups_disabled');
  const ai = byKey('ai_disabled');
  const features = controls.filter((c) => c.group === 'features');
  const pausedCount = features.filter((f) => f.enabled).length;
  const savedMessage = byKey('maintenance_message')?.value ?? '';

  return (
    <div className="page">
      <PageTitle />

      {error ? (
        <div className="alert alert-error">
          <AlertTriangle size={16} strokeWidth={2} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="ctl-summary card">
        <SummaryItem label="App access" value={maint?.enabled ? 'Maintenance' : 'Open'} tone={maint?.enabled ? 'bad' : 'ok'} />
        <SummaryItem label="Sign-ups" value={signups?.enabled ? 'Paused' : 'Open'} tone={signups?.enabled ? 'warn' : 'ok'} />
        <SummaryItem label="AI features" value={ai?.enabled ? 'Paused' : 'On'} tone={ai?.enabled ? 'warn' : 'ok'} />
        <SummaryItem label="Features" value={pausedCount ? `${pausedCount} paused` : 'All running'} tone={pausedCount ? 'warn' : 'ok'} />
      </div>

      <div className="ctl-layout">
        <div className="stack-lg">
          <Group title="Access">
            {maint ? (
              <ControlRow control={maint} editable={canEdit(maint)} onToggle={(next) => setPending({ control: maint, next })} onLabel="On" offLabel="Off">
                <div className="ctl-message">
                  <label className="field">
                    <span className="field-label">Message users see</span>
                    <textarea
                      rows={2}
                      value={message}
                      maxLength={500}
                      disabled={!canPlatform}
                      onChange={(e) => setMessage(e.target.value)}
                    />
                  </label>
                  <div className="ctl-message-foot">
                    <span className="muted">{message.length}/500</span>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!canPlatform || message.trim() === savedMessage.trim() || messageSaved === 'saving'}
                      busy={messageSaved === 'saving'}
                      onClick={() => void saveMessage()}
                    >
                      {messageSaved === 'saved' ? 'Saved' : 'Save message'}
                    </Button>
                  </div>
                </div>
              </ControlRow>
            ) : null}
            {signups ? (
              <ControlRow control={signups} editable={canEdit(signups)} onToggle={(next) => setPending({ control: signups, next })} onLabel="Paused" offLabel="Open" />
            ) : null}
          </Group>

          {ai ? (
            <Group title="AI">
              <ControlRow control={ai} editable={canEdit(ai)} onToggle={(next) => setPending({ control: ai, next })} onLabel="Paused" offLabel="On" />
            </Group>
          ) : null}

          <Group title="Features" hint="Pausing blocks new changes in that area. People can still see their existing data.">
            {features.map((f) => (
              <ControlRow key={f.key} control={f} editable={canEdit(f)} onToggle={(next) => setPending({ control: f, next })} onLabel="Paused" offLabel="Running" showPaths />
            ))}
          </Group>
        </div>

        <aside className="stack-lg">
          <section className="card ctl-side">
            <h3>How these work</h3>
            <ul className="ctl-notes">
              <li>Changes apply to every user within a few seconds.</li>
              <li>Admins can always reach this console, even in maintenance mode.</li>
              <li>Blocked requests get a clear “temporarily unavailable” error in the app.</li>
              <li>Every change is written to the audit log with who made it.</li>
            </ul>
          </section>
          {history !== null ? (
            <section className="card ctl-side">
              <header className="ov-card-head">
                <h3>Recent changes</h3>
                <Link to="/audit?action=settings." className="ov-link">
                  All <ArrowRight size={14} strokeWidth={2} />
                </Link>
              </header>
              {history.length ? (
                <ul className="ctl-history">
                  {history.map((e) => (
                    <li key={e.id}>
                      <span>
                        <b>{actorName(e)}</b> {describe(e)}
                      </span>
                      <time className="muted" title={new Date(e.created_at).toLocaleString()}>
                        {relativeTime(e.created_at)}
                      </time>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  No changes yet.
                </p>
              )}
            </section>
          ) : null}
        </aside>
      </div>

      <ConfirmToggle pending={pending} busy={busy} onCancel={() => setPending(null)} onConfirm={() => pending && void apply(pending)} />
    </div>
  );
}

function PageTitle() {
  return (
    <div className="page-header">
      <div className="page-header-title">
        <h1>Controls</h1>
      </div>
    </div>
  );
}

function SummaryItem({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className="ctl-summary-item">
      <small>{label}</small>
      <span>
        <span className={`dot dot-${tone}`} />
        {value}
      </span>
    </div>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="card ctl-group">
      <header className="ctl-group-head">
        <h3>{title}</h3>
        {hint ? <p>{hint}</p> : null}
      </header>
      <div className="ctl-rows">{children}</div>
    </section>
  );
}

function ControlRow({
  control: c,
  editable,
  onToggle,
  onLabel,
  offLabel,
  showPaths,
  children,
}: {
  control: Control;
  editable: boolean;
  onToggle: (next: boolean) => void;
  onLabel: string;
  offLabel: string;
  showPaths?: boolean;
  children?: ReactNode;
}) {
  const on = c.enabled;
  return (
    <div className={`ctl-row${on ? ' on' : ''}`}>
      <div className="ctl-row-main">
        <div className="cell-stack">
          <span className="ctl-row-title">
            {c.label}
            <span className={`badge ${on ? (c.key === 'maintenance_mode' ? 'badge-error' : 'badge-warning') : 'badge-muted'}`}>{on ? onLabel : offLabel}</span>
          </span>
          <span className="muted ctl-row-desc">{c.description}</span>
          {showPaths && c.paths?.length ? (
            <span className="ctl-paths">
              {c.paths.map((p) => (
                <code key={p}>{p}</code>
              ))}
            </span>
          ) : null}
        </div>
        {editable ? (
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={c.label}
            className={`switch${on ? ' on' : ''}${c.danger || c.group === 'features' ? ' switch-warn' : ''}`}
            onClick={() => onToggle(!on)}
          >
            <span />
          </button>
        ) : (
          <span className="ctl-locked" title="You don’t have permission to change this">
            <Lock size={14} strokeWidth={2} />
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function ConfirmToggle({
  pending,
  busy,
  onCancel,
  onConfirm,
}: {
  pending: Pending | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!pending) return null;
  const { control: c, next } = pending;
  const copy = confirmCopy(c, next);
  return (
    <Modal
      open
      title={copy.title}
      onClose={onCancel}
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" variant={copy.danger ? 'danger' : 'primary'} busy={busy} onClick={onConfirm}>
            {copy.action}
          </Button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{copy.body}</p>
    </Modal>
  );
}

function confirmCopy(c: Control, next: boolean): { title: string; body: string; action: string; danger: boolean } {
  switch (c.key) {
    case 'maintenance_mode':
      return next
        ? { title: 'Turn on maintenance mode?', body: 'Everyone except admins is locked out of the app until you turn it off. They see your maintenance message.', action: 'Turn on', danger: true }
        : { title: 'Turn off maintenance mode?', body: 'The app opens again for everyone right away.', action: 'Turn off', danger: false };
    case 'signups_disabled':
      return next
        ? { title: 'Pause sign-ups?', body: 'New people can’t create an account with email and password. Existing users are not affected.', action: 'Pause sign-ups', danger: true }
        : { title: 'Open sign-ups?', body: 'New people can create accounts again.', action: 'Open sign-ups', danger: false };
    case 'ai_disabled':
      return next
        ? { title: 'Pause AI features?', body: 'Insights, the coach, receipt scanning and other AI features stop for every user until you turn them back on.', action: 'Pause AI', danger: true }
        : { title: 'Turn AI features back on?', body: 'AI features become available again for everyone.', action: 'Turn on', danger: false };
    default:
      return next
        ? { title: `Pause ${c.label.toLowerCase()}?`, body: `${c.description} Reading existing data keeps working.`, action: 'Pause', danger: true }
        : { title: `Resume ${c.label.toLowerCase()}?`, body: 'People can use this feature normally again.', action: 'Resume', danger: false };
  }
}
