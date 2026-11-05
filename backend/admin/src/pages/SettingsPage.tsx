import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check,
  Info,
  KeyRound,
  LogOut,
  Monitor,
  Moon,
  NotebookPen,
  Paintbrush,
  Settings as SettingsIcon,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../auth';
import { Button } from '../components/Button';
import { PageHeader } from '../components/PageHeader';
import { DetailList } from '../components/Drawer';
import { useThemeMode, type ThemeMode } from '../theme';
import { useDensity, useMotion } from '../lib/prefs';
import { relativeTime } from '../lib/audit';

const NOTES_KEY = 'lony_admin_ops_notes';
const NOTES_AT_KEY = 'lony_admin_ops_notes_at';

type SectionId = 'account' | 'appearance' | 'notes' | 'about';

const SECTIONS: { id: SectionId; label: string; icon: LucideIcon; hint: string; perm?: string }[] = [
  { id: 'account', label: 'Your account', icon: UserRound, hint: 'Profile & permissions' },
  { id: 'appearance', label: 'Appearance', icon: Paintbrush, hint: 'Theme & density' },
  { id: 'notes', label: 'Ops notes', icon: NotebookPen, hint: 'On-call scratchpad' },
  { id: 'about', label: 'About', icon: Info, hint: 'Build & environment' },
];

const PERMISSION_GROUPS: { label: string; perms: [string, string][] }[] = [
  {
    label: 'Monitor',
    perms: [
      ['overview.read', 'View the overview'],
      ['system.read', 'View system health'],
      ['audit.read', 'View the audit log'],
      ['audit.export', 'Export the audit log'],
    ],
  },
  {
    label: 'Users',
    perms: [
      ['users.read', 'View users'],
      ['users.suspend', 'Suspend users'],
      ['users.plan', 'Change plans'],
      ['users.sessions', 'Sign users out'],
    ],
  },
  {
    label: 'Admin access',
    perms: [
      ['roles.read', 'View roles & team'],
      ['roles.assign', 'Manage the admin team'],
      ['roles.manage', 'Edit roles'],
    ],
  },
  {
    label: 'Controls',
    perms: [
      ['settings.platform', 'Maintenance, sign-ups & features'],
      ['settings.ai', 'AI switch'],
      ['system.jobs', 'Retry background jobs'],
    ],
  },
  {
    label: 'Billing',
    perms: [
      ['billing.read', 'View billing'],
      ['billing.manage', 'Edit plan limits & trial'],
    ],
  },
  {
    label: 'Content',
    perms: [
      ['categories.read', 'View catalogs'],
      ['categories.write', 'Edit catalogs'],
      ['themes.read', 'View themes'],
      ['themes.write', 'Edit themes'],
      ['localization.read', 'View languages'],
      ['localization.manage', 'Edit languages'],
    ],
  },
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
          {current?.id === 'account' ? <AccountSection /> : null}
          {current?.id === 'appearance' ? <AppearanceSection /> : null}
          {current?.id === 'notes' ? <NotesSection /> : null}
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
          hasPerm('roles.read') ? (
            <Button size="sm" variant="secondary" onClick={() => navigate('/team?tab=roles')}>
              Admins & roles
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
  { id: 'system', label: 'Match device', icon: Monitor },
];

function AppearanceSection() {
  const [mode, setMode, dark] = useThemeMode();
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
                {t.id === 'system' ? <span className="muted theme-option-now">now {dark ? 'dark' : 'light'}</span> : null}
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
