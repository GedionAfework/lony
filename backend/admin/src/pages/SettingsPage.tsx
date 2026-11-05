import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Bot,
  Check,
  CircleCheck,
  CircleX,
  Clock,
  Crown,
  Info,
  KeyRound,
  LogOut,
  Monitor,
  Moon,
  NotebookPen,
  Paintbrush,
  Power,
  ScrollText,
  Server,
  Settings as SettingsIcon,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  UserRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { api, type AuditEntry, type Overview } from '../api';
import { useAuth } from '../auth';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { DetailList } from '../components/Drawer';
import { useThemeMode, type ThemeMode } from '../theme';
import { useDensity, useMotion } from '../lib/prefs';
import { actorName, describe, relativeTime } from '../lib/audit';

const NOTES_KEY = 'lony_admin_ops_notes';
const NOTES_AT_KEY = 'lony_admin_ops_notes_at';

type SectionId = 'platform' | 'account' | 'appearance' | 'notes' | 'billing' | 'about';

const SECTIONS: { id: SectionId; label: string; icon: LucideIcon; hint: string; perm?: string }[] = [
  { id: 'platform', label: 'Platform', icon: SlidersHorizontal, hint: 'Kill switches & health', perm: 'settings.ai' },
  { id: 'account', label: 'Your account', icon: UserRound, hint: 'Profile & permissions' },
  { id: 'appearance', label: 'Appearance', icon: Paintbrush, hint: 'Theme & density' },
  { id: 'notes', label: 'Ops notes', icon: NotebookPen, hint: 'On-call scratchpad' },
  { id: 'billing', label: 'Plans & billing', icon: Wallet, hint: 'Free vs Premium' },
  { id: 'about', label: 'About', icon: Info, hint: 'Build & environment' },
];

const PERMISSION_GROUPS: { label: string; perms: [string, string][] }[] = [
  { label: 'Insights', perms: [['overview.read', 'View overview dashboard']] },
  {
    label: 'People',
    perms: [
      ['users.read', 'View users'],
      ['users.write', 'Suspend users & change plans'],
      ['roles.manage', 'Manage admin roles'],
      ['audit.read', 'Read the audit log'],
    ],
  },
  {
    label: 'Content',
    perms: [
      ['categories.read', 'View catalogs & categories'],
      ['categories.write', 'Edit catalogs & categories'],
      ['themes.read', 'View themes'],
      ['themes.write', 'Edit themes'],
      ['localization.manage', 'Manage languages & calendars'],
    ],
  },
  { label: 'System', perms: [['settings.ai', 'Platform settings & AI switch']] },
];

function readHash(): SectionId | null {
  const h = window.location.hash.replace('#', '') as SectionId;
  return SECTIONS.some((s) => s.id === h) ? h : null;
}

export function SettingsPage() {
  const { hasPerm } = useAuth();
  const visible = SECTIONS.filter((s) => !s.perm || hasPerm(s.perm));
  const [section, setSection] = useState<SectionId>(() => readHash() ?? visible[0]?.id ?? 'account');

  useEffect(() => {
    history.replaceState(null, '', `#${section}`);
  }, [section]);

  const current = visible.find((s) => s.id === section) ?? visible[0];

  return (
    <div className="page">
      <PageHeader icon={SettingsIcon} title="Settings" />

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {visible.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`settings-nav-item${current?.id === s.id ? ' active' : ''}`}
              onClick={() => setSection(s.id)}
              aria-current={current?.id === s.id ? 'page' : undefined}
            >
              <span className="settings-nav-icon">
                <s.icon size={17} strokeWidth={2} />
              </span>
              <span className="settings-nav-text">
                <strong>{s.label}</strong>
                <small>{s.hint}</small>
              </span>
            </button>
          ))}
        </nav>

        <div className="settings-content" key={current?.id}>
          {current?.id === 'platform' ? <PlatformSection /> : null}
          {current?.id === 'account' ? <AccountSection /> : null}
          {current?.id === 'appearance' ? <AppearanceSection /> : null}
          {current?.id === 'notes' ? <NotesSection /> : null}
          {current?.id === 'billing' ? <BillingSection /> : null}
          {current?.id === 'about' ? <AboutSection /> : null}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- shared */

function Panel({
  title,
  description,
  icon: Icon,
  aside,
  children,
  tone,
}: {
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
  aside?: ReactNode;
  children?: ReactNode;
  tone?: 'danger';
}) {
  return (
    <section className={`card settings-panel${tone === 'danger' ? ' settings-panel-danger' : ''}`}>
      <header className="settings-panel-head">
        {Icon ? (
          <span className="settings-panel-icon">
            <Icon size={18} strokeWidth={2} />
          </span>
        ) : null}
        <div className="settings-panel-title">
          <h3>{title}</h3>
          {description ? <p>{description}</p> : null}
        </div>
        {aside ? <div className="settings-panel-aside">{aside}</div> : null}
      </header>
      {children ? <div className="settings-panel-body">{children}</div> : null}
    </section>
  );
}

function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch${checked ? ' on' : ''}`}
      disabled={disabled}
      onClick={onChange}
    >
      <span />
    </button>
  );
}

function HealthRow({ ok, label, detail, icon: Icon }: { ok: boolean | null; label: string; detail: string; icon: LucideIcon }) {
  return (
    <div className="health-row">
      <span className="health-icon">
        <Icon size={16} strokeWidth={2} />
      </span>
      <span className="cell-stack">
        <span>{label}</span>
        <span className="muted" style={{ fontSize: 12.5 }}>
          {detail}
        </span>
      </span>
      {ok === null ? (
        <span className="badge badge-muted">Unknown</span>
      ) : ok ? (
        <span className="badge badge-success">Healthy</span>
      ) : (
        <span className="badge badge-error">Attention</span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- platform */

function PlatformSection() {
  const { token, hasPerm } = useAuth();
  const navigate = useNavigate();
  const [aiDisabled, setAIDisabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [history, setHistory] = useState<AuditEntry[]>([]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [settings, ov, audit] = await Promise.all([
        api.getSettings(token),
        hasPerm('overview.read') ? api.overview(token).catch(() => null) : Promise.resolve(null),
        hasPerm('audit.read') ? api.audit(token, { action: 'settings.', limit: 6 }).catch(() => null) : Promise.resolve(null),
      ]);
      setAIDisabled(Boolean(settings.settings?.ai_disabled));
      setOverview(ov?.overview ?? null);
      setHistory(audit?.audit ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, [token, hasPerm]);

  useEffect(() => {
    void load();
  }, [load]);

  async function applyAI() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.setAIDisabled(token, !aiDisabled);
      setAIDisabled(Boolean(res.settings?.ai_disabled));
      setConfirm(false);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update AI setting');
    } finally {
      setBusy(false);
    }
  }

  const aiOn = !aiDisabled;

  return (
    <div className="stack-lg">
      {error ? (
        <div className="alert alert-error">
          <AlertTriangle size={16} strokeWidth={2} />
          <span>{error}</span>
        </div>
      ) : null}

      <section className={`card ai-switch-card${aiOn ? ' on' : ' off'}`}>
        <div className="ai-switch-glow" aria-hidden />
        <div className="ai-switch-main">
          <span className="ai-switch-icon">
            <Bot size={26} strokeWidth={1.8} />
          </span>
          <div className="ai-switch-text">
            <span className="ai-switch-eyebrow">Global kill switch</span>
            <h3>{loading ? 'Checking AI status…' : aiOn ? 'AI is running' : 'AI is switched off'}</h3>
            <p>
              {aiOn
                ? 'Premium members can use insights, the coach, plan chat and smart capture. Free members stay gated by plan.'
                : (
                    <>
                      Every AI endpoint is answering <code>AI_DISABLED</code>. No member, free or premium, can use AI features
                      until you turn it back on.
                    </>
                  )}
            </p>
          </div>
          <Switch checked={aiOn} disabled={loading || busy} label="AI enabled" onChange={() => setConfirm(true)} />
        </div>
        {overview ? (
          <div className="ai-switch-stats">
            <div>
              <small>Requests today</small>
              <strong>{(overview.ai_requests_today ?? 0).toLocaleString()}</strong>
            </div>
            <div>
              <small>Runs · 7d</small>
              <strong>{(overview.ai_runs_7d ?? 0).toLocaleString()}</strong>
            </div>
            <div>
              <small>AI users · 7d</small>
              <strong>{(overview.ai_users_7d ?? 0).toLocaleString()}</strong>
            </div>
            <div>
              <small>Tokens · 7d</small>
              <strong>
                {new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(overview.ai_tokens_7d ?? 0)}
              </strong>
            </div>
          </div>
        ) : null}
      </section>

      {overview ? (
        <Panel title="System health" description="Live from the API on page load." icon={Server} aside={
          <Button size="sm" variant="ghost" onClick={() => void load()}>
            Recheck
          </Button>
        }>
          <div className="health-list">
            <HealthRow
              icon={overview.fx_ok ? CircleCheck : CircleX}
              ok={overview.fx_ok ?? null}
              label="Exchange-rate provider"
              detail={overview.fx_ok ? `Base ${overview.fx_base || 'USD'} · updated ${overview.fx_as_of || 'recently'}` : overview.fx_error || 'Provider unreachable'}
            />
            <HealthRow
              icon={Clock}
              ok={(overview.jobs_failed ?? 0) === 0}
              label="Background jobs"
              detail={`${overview.jobs_failed ?? 0} failed · ${overview.jobs_pending ?? 0} pending`}
            />
            <HealthRow icon={Bot} ok={aiOn} label="AI services" detail={aiOn ? 'Enabled for premium members' : 'Disabled by an admin'} />
          </div>
        </Panel>
      ) : null}

      {hasPerm('audit.read') ? (
        <Panel
          title="Change history"
          description="Who flipped platform switches, most recent first."
          icon={ScrollText}
          aside={
            <Button size="sm" variant="secondary" onClick={() => navigate('/audit')}>
              Open audit log
            </Button>
          }
        >
          {history.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No platform setting has been changed yet.
            </p>
          ) : (
            <ul className="mini-timeline">
              {history.map((e) => (
                <li key={e.id}>
                  <span className={`mini-dot ${e.action.endsWith('disable') ? 'bad' : 'good'}`} />
                  <span>
                    <b>{actorName(e)}</b> {describe(e)}
                  </span>
                  <time className="muted" title={new Date(e.created_at).toLocaleString()}>
                    {relativeTime(e.created_at)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}

      <Modal
        open={confirm}
        title={aiOn ? 'Turn AI off for everyone?' : 'Turn AI back on?'}
        onClose={() => setConfirm(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button variant={aiOn ? 'danger' : 'primary'} busy={busy} icon={<Power size={15} strokeWidth={2} />} onClick={() => void applyAI()}>
              {aiOn ? 'Turn AI off' : 'Turn AI on'}
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, lineHeight: 1.6 }}>
          {aiOn
            ? 'All AI features stop immediately for every member, including Premium. Use this during provider outages, runaway costs or incidents. The change is recorded in the audit log.'
            : 'Premium members get AI features back immediately. The change is recorded in the audit log.'}
        </p>
      </Modal>
    </div>
  );
}

/* --------------------------------------------------------------- account */

function AccountSection() {
  const { me, hasPerm, logout } = useAuth();
  const navigate = useNavigate();
  const role = me?.admin_role || (me?.role === 'admin' ? 'Admin' : '—');
  const legacy = !me?.admin_permissions;
  const granted = PERMISSION_GROUPS.reduce((n, g) => n + g.perms.filter(([c]) => hasPerm(c)).length, 0);
  const totalPerms = PERMISSION_GROUPS.reduce((n, g) => n + g.perms.length, 0);
  const name = me?.display_name || me?.email || 'Admin';
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="stack-lg">
      <section className="card profile-card">
        <span className="profile-avatar">{initials}</span>
        <div className="profile-text">
          <h3>{name}</h3>
          <p className="muted">{me?.email}</p>
          <div className="profile-badges">
            <span className="badge badge-primary">
              <ShieldCheck size={12} strokeWidth={2} /> {role}
            </span>
            <span className={`badge badge-${me?.status === 'active' ? 'success' : 'warning'}`}>{me?.status}</span>
          </div>
        </div>
        <Button
          variant="secondary"
          icon={<LogOut size={15} strokeWidth={2} />}
          onClick={async () => {
            await logout();
            navigate('/login', { replace: true });
          }}
        >
          Sign out
        </Button>
      </section>

      <Panel
        title="Your permissions"
        description={legacy ? 'Legacy admin account: full access until a role is assigned.' : `${granted} of ${totalPerms} granted by the ${role} role.`}
        icon={KeyRound}
        aside={
          hasPerm('roles.manage') ? (
            <Button size="sm" variant="secondary" onClick={() => navigate('/users?tab=roles')}>
              Manage roles
            </Button>
          ) : null
        }
      >
        <div className="perm-groups">
          {PERMISSION_GROUPS.map((g) => (
            <div key={g.label} className="perm-group">
              <h4>{g.label}</h4>
              {g.perms.map(([code, label]) => {
                const ok = hasPerm(code);
                return (
                  <div key={code} className={`perm-line${ok ? ' ok' : ''}`}>
                    {ok ? <Check size={14} strokeWidth={2.5} /> : <span className="perm-off" />}
                    <span>{label}</span>
                    <code>{code}</code>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Account ID" icon={UserRound}>
        <DetailList rows={[['User ID', <span className="mono">{me?.id}</span>], ['Email', me?.email ?? '—']]} />
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------ appearance */

const THEMES: { id: ThemeMode; label: string; icon: LucideIcon }[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor },
];

function AppearanceSection() {
  const [mode, setMode] = useThemeMode();
  const [density, setDensity] = useDensity();
  const [motion, setMotion] = useMotion();

  return (
    <div className="stack-lg">
      <Panel title="Theme" description="Saved in this browser." icon={Paintbrush}>
        <div className="theme-picker">
          {THEMES.map((t) => (
            <button key={t.id} type="button" className={`theme-option${mode === t.id ? ' active' : ''}`} onClick={() => setMode(t.id)}>
              <span className={`theme-preview theme-preview-${t.id}`} aria-hidden>
                <i />
                <b />
                <b />
              </span>
              <span className="theme-option-label">
                <t.icon size={15} strokeWidth={2} /> {t.label}
                {mode === t.id ? <Check size={15} strokeWidth={2.5} className="theme-option-check" /> : null}
              </span>
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="Comfort" icon={SlidersHorizontal}>
        <div className="pref-rows">
          <div className="pref-row">
            <div className="cell-stack">
              <span>Compact tables</span>
              <span className="muted" style={{ fontSize: 12.5 }}>
                Tighter rows so more records fit on screen.
              </span>
            </div>
            <Switch
              checked={density === 'compact'}
              label="Compact tables"
              onChange={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}
            />
          </div>
          <div className="pref-row">
            <div className="cell-stack">
              <span>Reduce motion</span>
              <span className="muted" style={{ fontSize: 12.5 }}>
                Turns off entrance animations and hover lifts.
              </span>
            </div>
            <Switch checked={motion === 'reduced'} label="Reduce motion" onChange={() => setMotion(motion === 'reduced' ? 'full' : 'reduced')} />
          </div>
        </div>
      </Panel>
    </div>
  );
}

/* ----------------------------------------------------------------- notes */

function NotesSection() {
  const [notes, setNotes] = useState(() => {
    try {
      return localStorage.getItem(NOTES_KEY) || '';
    } catch {
      return '';
    }
  });
  const [savedAt, setSavedAt] = useState<string | null>(() => {
    try {
      return localStorage.getItem(NOTES_AT_KEY);
    } catch {
      return null;
    }
  });
  const [dirty, setDirty] = useState(false);

  // Autosave a moment after typing stops.
  useEffect(() => {
    if (!dirty) return;
    const t = window.setTimeout(() => {
      const at = new Date().toISOString();
      try {
        localStorage.setItem(NOTES_KEY, notes);
        localStorage.setItem(NOTES_AT_KEY, at);
      } catch {
        /* ignore */
      }
      setSavedAt(at);
      setDirty(false);
    }, 800);
    return () => window.clearTimeout(t);
  }, [notes, dirty]);

  return (
    <Panel
      title="Ops notes"
      description="Private scratchpad for the on-call admin. Saved automatically, only in this browser."
      icon={NotebookPen}
      aside={
        <span className={`save-state${dirty ? ' saving' : ''}`}>
          {dirty ? 'Saving…' : savedAt ? (
            <>
              <Check size={13} strokeWidth={2.5} /> Saved {relativeTime(savedAt)}
            </>
          ) : (
            'Not saved yet'
          )}
        </span>
      }
    >
      <textarea
        className="ops-notes"
        rows={14}
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setDirty(true);
        }}
        placeholder={'e.g.\n- FX provider flaky after 22:00 UTC, escalate to #payments\n- Premium promo ends Friday'}
      />
      <div className="muted" style={{ fontSize: 12, textAlign: 'right', marginTop: 6 }}>
        {notes.length.toLocaleString()} characters
      </div>
    </Panel>
  );
}

/* --------------------------------------------------------------- billing */

function BillingSection() {
  const navigate = useNavigate();
  const { hasPerm } = useAuth();
  return (
    <div className="stack-lg">
      <div className="plan-grid">
        <div className="card plan-card">
          <span className="plan-name">Free</span>
          <ul>
            <li>
              <Check size={14} /> Loans, cashflow, accounts & goals
            </li>
            <li>
              <Check size={14} /> Friends, chat & trust score
            </li>
            <li className="off">
              <CircleX size={14} /> No AI features
            </li>
          </ul>
        </div>
        <div className="card plan-card plan-card-premium">
          <span className="plan-name">
            <Crown size={15} /> Premium
          </span>
          <ul>
            <li>
              <Check size={14} /> Everything in Free
            </li>
            <li>
              <Check size={14} /> AI insights, coach & plan chat
            </li>
            <li>
              <Check size={14} /> Smart capture & analytics reports
            </li>
          </ul>
        </div>
      </div>
      <Panel
        title="How plans are assigned"
        description="Checkout isn’t wired up yet, so plans are switched by hand from a user’s profile."
        icon={Wallet}
        aside={
          hasPerm('users.write') ? (
            <Button size="sm" variant="secondary" onClick={() => navigate('/users')}>
              Go to users
            </Button>
          ) : null
        }
      />
    </div>
  );
}

/* ----------------------------------------------------------------- about */

function AboutSection() {
  const apiBase = (import.meta.env.VITE_API_BASE as string | undefined) || window.location.origin;
  return (
    <Panel title="About this console" icon={Info}>
      <DetailList
        rows={[
          ['Console', 'Lony Admin'],
          ['Mode', import.meta.env.MODE],
          ['API', <span className="mono">{apiBase}</span>],
          ['Browser time zone', Intl.DateTimeFormat().resolvedOptions().timeZone],
          ['Language', navigator.language],
          ['Shortcuts', <span><kbd>Ctrl</kbd> <kbd>K</kbd> command palette · <kbd>Esc</kbd> close panels</span>],
        ]}
      />
    </Panel>
  );
}
