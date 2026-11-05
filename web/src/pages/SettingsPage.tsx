import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Bell,
  Camera,
  ChevronRight,
  Download,
  FileText,
  Flag,
  Globe,
  KeyRound,
  Landmark,
  LogOut,
  Moon,
  Palette,
  Shield,
  Sparkles,
  Sun,
  Table,
  Trash2,
  Users,
  Wand2,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { api, type AppCalendar, type AppLocale } from '../lib/api';
import { COUNTRIES, TIMEZONES } from '../lib/catalogs';
import { TIER_LABEL, tierOf } from '../lib/plans';
import { useTheme } from '../lib/theme';
import { applyDocumentDirection, parseLocaleMessages, setActivePack, t } from '../i18n';
import { Avatar, prepareAvatar, primeAvatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Field, SelectField } from '../components/Field';
import { PhoneField } from '../components/PhoneField';
import { Segmented } from '../components/Segmented';
import { BillingPanel } from '../components/BillingPanel';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';

type Section = 'profile' | 'plan' | 'region' | 'appearance' | 'notifications' | 'security' | 'privacy' | 'legal';
const SECTIONS: Section[] = ['profile', 'plan', 'region', 'appearance', 'notifications', 'security', 'privacy', 'legal'];

type Tint = 'teal' | 'blue' | 'orange' | 'violet' | 'pink' | 'green' | 'slate' | 'red' | 'gold';

/** Rounded block of rows with a small heading, like phone settings. */
function Group({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <div className="set-group">
      {title ? <div className="set-group-title">{title}</div> : null}
      <div className="set-group-body">{children}</div>
      {footer ? <div className="set-group-foot">{footer}</div> : null}
    </div>
  );
}

function RowIcon({ icon: Icon, tint }: { icon: LucideIcon; tint: Tint }) {
  return (
    <span className={`set-icon tint-${tint}`}>
      <Icon size={16} strokeWidth={2.2} />
    </span>
  );
}

function NavRow({
  icon,
  tint = 'teal',
  title,
  value,
  onClick,
  active,
  danger,
}: {
  icon: LucideIcon;
  tint?: Tint;
  title: string;
  value?: ReactNode;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button type="button" className={`set-row ${active ? 'active' : ''} ${danger ? 'danger' : ''}`} onClick={onClick}>
      <RowIcon icon={icon} tint={danger ? 'red' : tint} />
      <span className="set-row-title">{title}</span>
      {value ? <span className="set-row-value">{value}</span> : null}
      {danger ? null : <ChevronRight size={17} className="set-row-chevron" />}
    </button>
  );
}

function ToggleRow({ icon, tint = 'teal', title, value, onChange }: { icon: LucideIcon; tint?: Tint; title: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="set-row">
      <RowIcon icon={icon} tint={tint} />
      <span className="set-row-title">{title}</span>
      <input type="checkbox" className="switch" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

const HOUR_CYCLES = [
  { value: '24h', labelKey: 'settings.hourCycle.24h' },
  { value: '12h', labelKey: 'settings.hourCycle.12h' },
] as const;

const NOTIFY_KEY = 'lony_notify_prefs_v1';
type NotifyPrefs = { loans: boolean; splits: boolean; goals: boolean; inbox: boolean };
const DEFAULT_NOTIFY: NotifyPrefs = { loans: true, splits: true, goals: true, inbox: true };

function readNotify(): NotifyPrefs {
  try {
    const raw = localStorage.getItem(NOTIFY_KEY);
    return raw ? { ...DEFAULT_NOTIFY, ...JSON.parse(raw) } : DEFAULT_NOTIFY;
  } catch {
    return DEFAULT_NOTIFY;
  }
}

function download(name: string, type: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function SettingsPage() {
  const { user, token, setUser, logout, busy: authBusy } = useAuth();
  const { mode, setMode } = useTheme();
  const navigate = useNavigate();
  const params = useParams();
  const { showError, show } = useToast();
  const confirm = useConfirm();
  const section = SECTIONS.includes(params.section as Section) ? (params.section as Section) : null;
  const [busy, setBusy] = useState(false);

  const [username, setUsername] = useState(user?.username || '');
  const [firstName, setFirstName] = useState(user?.first_name || '');
  const [middleName, setMiddleName] = useState(user?.middle_name || '');
  const [lastName, setLastName] = useState(user?.last_name || '');
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [country, setCountry] = useState(user?.country_code || '');
  const [phone, setPhone] = useState(user?.phone_e164 || '');
  const [locale, setLocale] = useState(user?.locale || 'en');
  const [timezone, setTimezone] = useState(user?.timezone || 'UTC');
  const [calendarId, setCalendarId] = useState(user?.calendar_id || 'gregorian');
  const [hourCycle, setHourCycle] = useState(user?.hour_cycle || '24h');
  const [authPref, setAuthPref] = useState((user?.preferred_auth_provider as 'email' | 'google' | 'telegram') || 'email');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [notify, setNotify] = useState<NotifyPrefs>(readNotify);
  function setPref(key: keyof NotifyPrefs) {
    return (v: boolean) =>
      setNotify((prev) => {
        const next = { ...prev, [key]: v };
        try {
          localStorage.setItem(NOTIFY_KEY, JSON.stringify(next));
        } catch {
          /* storage blocked */
        }
        return next;
      });
  }

  const [locales, setLocales] = useState<AppLocale[]>([]);
  const [calendars, setCalendars] = useState<AppCalendar[]>([]);

  const isAdmin = user?.role === 'admin';
  const tier = tierOf(user);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [locRes, calRes] = await Promise.all([api.listLocales(), api.listCalendars()]);
        if (cancelled) return;
        if ('locales' in locRes) {
          setLocales(locRes.locales ?? []);
          for (const loc of locRes.locales ?? []) {
            setActivePack({ locale: loc.code, name: loc.name, dir: loc.dir, messages: parseLocaleMessages(loc.messages) });
          }
        }
        setCalendars(calRes.calendars ?? []);
      } catch {
        // keep bundled English
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!user?.locale) return;
    setLocale(user.locale);
    setTimezone(user.timezone || 'UTC');
    setCalendarId(user.calendar_id || 'gregorian');
    setHourCycle(user.hour_cycle || '24h');
    applyDocumentDirection(user.locale);
  }, [user?.locale, user?.timezone, user?.calendar_id, user?.hour_cycle]);

  async function onSaveProfile() {
    if (!token) return;
    setBusy(true);
    try {
      const res = await api.patchMe(token, {
        display_name: displayName.trim(),
        username: username.trim(),
        first_name: firstName.trim(),
        middle_name: middleName.trim() || undefined,
        last_name: lastName.trim(),
        phone_e164: phone.trim() || undefined,
        country_code: country.trim().toUpperCase() || undefined,
        default_currency_code: (user?.default_currency_code || '').trim().toUpperCase() || undefined,
        preferred_auth_provider: authPref,
      });
      setUser(res.user);
      show('Profile saved');
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  async function onSaveRegion() {
    if (!token) return;
    setBusy(true);
    try {
      const res = await api.patchMe(token, {
        locale: locale.trim() || 'en',
        timezone: timezone.trim() || 'UTC',
        calendar_id: calendarId.trim() || 'gregorian',
        hour_cycle: hourCycle.trim() === 'ethiopian_6' ? '24h' : hourCycle.trim() || '24h',
      });
      setUser(res.user);
      const pack = locales.find((l) => l.code === (res.user.locale || locale));
      if (pack) {
        setActivePack({ locale: pack.code, name: pack.name, dir: pack.dir, messages: parseLocaleMessages(pack.messages) });
      } else {
        setActivePack({ locale: res.user.locale || 'en' });
      }
      applyDocumentDirection(res.user.locale);
      show('Preferences saved');
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  async function onPickAvatar(file: File) {
    if (!token) return;
    if (!file.type.startsWith('image/')) {
      showError('Choose a photo (JPG or PNG)');
      return;
    }
    setBusy(true);
    try {
      const pic = await prepareAvatar(file);
      const res = await api.uploadAvatar(token, { filename: pic.filename, mime: pic.mime, attachment_base64: pic.base64 });
      primeAvatar(res.user.avatar_url, pic.blob);
      setUser(res.user);
      show('Photo updated');
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not upload photo');
    } finally {
      setBusy(false);
    }
  }

  async function onChangePassword() {
    if (!token || !currentPassword || !newPassword) return;
    setBusy(true);
    try {
      await api.changePassword(token, currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      show('Password updated');
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not update password');
    } finally {
      setBusy(false);
    }
  }

  async function onExportData() {
    if (!token) return;
    setBusy(true);
    try {
      const res = await api.exportMyData(token);
      download('lony-export.json', 'application/json', JSON.stringify(res.export, null, 2));
      show('Export downloaded');
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  }

  async function onExportLedger() {
    if (!token) return;
    setBusy(true);
    try {
      const res = await api.exportLedgerCSV(token);
      download(
        'lony-ledger.csv',
        'text/csv',
        `# cashflow\n${res.cashflow_csv}\n\n# transfers\n${res.transfers_csv}\n\n# accounts\n${res.accounts_csv}`,
      );
      show('Ledger CSV downloaded');
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  }

  async function onClearAI() {
    if (!token) return;
    const ok = await confirm({ title: 'Clear AI insights?', body: 'Your saved insights and coach chat are removed.', confirmLabel: 'Clear', tone: 'danger' });
    if (!ok) return;
    setBusy(true);
    try {
      await api.clearAIInsights(token);
      show('AI insights cleared');
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not clear');
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteAccount() {
    if (!token) return;
    const ok = await confirm({
      title: 'Delete your account?',
      body: 'Your profile, accounts, records and chats are deleted for good. This can’t be undone.',
      confirmLabel: 'Delete forever',
      tone: 'danger',
      typeToConfirm: 'DELETE',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.deleteAccount(token);
      await logout();
      navigate('/login');
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not delete');
      setBusy(false);
    }
  }

  async function onLogout() {
    const ok = await confirm({ title: 'Sign out?', body: 'You can sign back in any time.', confirmLabel: 'Sign out' });
    if (!ok) return;
    await logout();
    navigate('/login');
  }

  const go = (s: Section | null) => navigate(s ? `/settings/${s}` : '/settings');
  const name = user?.display_name || [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username || 'You';
  const languageName = locales.find((l) => l.code === (user?.locale || 'en'))?.name ?? (user?.locale || 'en').toUpperCase();

  const localeOpts =
    locales.length > 0 ? locales.map((l) => ({ id: l.code, label: `${l.name} (${l.code})` })) : [{ id: locale || 'en', label: locale || 'en' }];
  const calendarOpts =
    calendars.length > 0
      ? calendars.map((c) => ({ id: c.id, label: c.name }))
      : [
          { id: 'gregorian', label: 'Gregorian' },
          { id: 'ethiopic', label: 'Ethiopic' },
          { id: 'hijri', label: 'Hijri' },
        ];
  const hourOpts = HOUR_CYCLES.map((h) => ({ id: h.value, label: t(locale, h.labelKey) }));

  const TITLES: Record<Section, string> = {
    profile: t(locale, 'settings.profile'),
    plan: 'Plan & billing',
    region: 'Language & region',
    appearance: 'Appearance',
    notifications: t(locale, 'settings.notifications'),
    security: t(locale, 'settings.security'),
    privacy: t(locale, 'settings.privacy'),
    legal: 'About & legal',
  };

  function detail(s: Section): ReactNode {
    switch (s) {
      case 'profile':
        return (
          <>
            <div className="set-hero">
              <label className="avatar-picker" title={user?.avatar_url ? 'Change photo' : 'Add photo'}>
                <Avatar src={user?.avatar_url} token={token} letter={displayName || firstName || '?'} size={88} />
                <span className="avatar-picker-badge">{busy ? <span className="spinner" /> : <Camera size={15} />}</span>
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void onPickAvatar(f);
                  }}
                />
              </label>
              <div className="muted">{user?.email}</div>
            </div>
            {!user?.profile_complete ? <div className="notice warn">Finish your account details to use Lony fully.</div> : null}
            <Group title="Name">
              <div className="set-inset">
                <div className="form-row">
                  <Field label="First name" value={firstName} onChange={setFirstName} />
                  <Field label="Last name" value={lastName} onChange={setLastName} />
                </div>
                <div className="form-row">
                  <Field label="Middle name" value={middleName} onChange={setMiddleName} />
                  <Field label="Display name" value={displayName} onChange={setDisplayName} />
                </div>
              </div>
            </Group>
            <Group title="Account">
              <div className="set-inset">
                <div className="form-row">
                  <Field label="Username" value={username} onChange={setUsername} />
                  <SelectField label="Country" value={country} onChange={setCountry} options={COUNTRIES} placeholder="Select" />
                </div>
                <PhoneField value={phone} onChange={setPhone} defaultCountry={country} />
              </div>
            </Group>
            <Group title="Sign-in preference">
              <div className="set-inset">
                <Segmented
                  value={authPref}
                  onChange={(v) => setAuthPref(v as 'email' | 'google' | 'telegram')}
                  options={[
                    { id: 'email', label: 'Email' },
                    { id: 'google', label: 'Google' },
                    { id: 'telegram', label: 'Telegram' },
                  ]}
                />
              </div>
            </Group>
            <div className="set-actions">
              <Button onClick={onSaveProfile} busy={busy} disabled={!username.trim() || !firstName.trim() || !lastName.trim()}>
                {busy ? 'Saving…' : t(locale, 'common.save')}
              </Button>
            </div>
          </>
        );
      case 'plan':
        return <BillingPanel />;
      case 'region':
        return (
          <>
            <Group title="Language">
              <div className="set-inset">
                <SelectField
                  label={t(locale, 'settings.language')}
                  value={locale}
                  onChange={(code) => {
                    setLocale(code);
                    const pack = locales.find((l) => l.code === code);
                    if (pack) {
                      setActivePack({ locale: pack.code, name: pack.name, dir: pack.dir, messages: parseLocaleMessages(pack.messages) });
                      applyDocumentDirection(pack.code);
                    }
                  }}
                  options={localeOpts}
                />
              </div>
            </Group>
            <Group title="Dates & time">
              <div className="set-inset">
                <div className="form-row">
                  <SelectField label={t(locale, 'settings.calendar')} value={calendarId} onChange={setCalendarId} options={calendarOpts} />
                  <SelectField
                    label={t(locale, 'settings.hourCycle')}
                    value={hourCycle === 'ethiopian_6' ? '24h' : hourCycle}
                    onChange={setHourCycle}
                    options={hourOpts}
                  />
                </div>
                <SelectField label={t(locale, 'settings.timezone')} value={timezone} onChange={setTimezone} options={TIMEZONES} />
              </div>
            </Group>
            <div className="set-actions">
              <Button onClick={onSaveRegion} busy={busy}>
                {busy ? 'Saving…' : t(locale, 'common.save')}
              </Button>
            </div>
          </>
        );
      case 'appearance':
        return (
          <Group title="Theme">
            <div className="set-inset">
              <div className="theme-pick">
                <button type="button" className={mode === 'light' ? 'active' : ''} onClick={() => setMode('light')}>
                  <span className="theme-swatch light">
                    <Sun size={18} />
                  </span>
                  Light
                </button>
                <button type="button" className={mode === 'dark' ? 'active' : ''} onClick={() => setMode('dark')}>
                  <span className="theme-swatch dark">
                    <Moon size={18} />
                  </span>
                  Dark
                </button>
              </div>
            </div>
          </Group>
        );
      case 'notifications':
        return (
          <Group title="Tell me about" footer="Applies to alerts on this device.">
            <ToggleRow icon={Landmark} tint="orange" title="Loan & repayment alerts" value={notify.loans} onChange={setPref('loans')} />
            <ToggleRow icon={Users} tint="violet" title="Expense splits" value={notify.splits} onChange={setPref('splits')} />
            <ToggleRow icon={Flag} tint="green" title="Goal reminders" value={notify.goals} onChange={setPref('goals')} />
            <ToggleRow icon={Bell} tint="blue" title="In-app inbox" value={notify.inbox} onChange={setPref('inbox')} />
          </Group>
        );
      case 'security':
        return (
          <Group title="Password" footer={`Changes the password for ${user?.email ?? 'your account'}.`}>
            <div className="set-inset">
              <Field label="Current password" type="password" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
              <Field label="New password" type="password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
              <div>
                <Button onClick={onChangePassword} busy={busy} disabled={!currentPassword || !newPassword}>
                  {busy ? 'Working…' : 'Update password'}
                </Button>
              </div>
            </div>
          </Group>
        );
      case 'privacy':
        return (
          <>
            <Group title="Your data">
              <NavRow icon={Download} tint="blue" title="Export my data (JSON)" onClick={onExportData} />
              <NavRow icon={Table} tint="green" title="Export ledger (CSV)" onClick={onExportLedger} />
            </Group>
            <Group title="AI">
              <NavRow icon={Wand2} tint="violet" title="Clear AI insights & coach chat" onClick={onClearAI} />
            </Group>
            <Group footer="Deletes your profile, accounts, records and chats for good.">
              <NavRow icon={Trash2} title="Delete account" danger onClick={onDeleteAccount} />
            </Group>
          </>
        );
      case 'legal':
        return (
          <Group
            footer={
              user?.tos_accepted_at ? (
                `Accepted ${new Date(user.tos_accepted_at).toLocaleDateString()} · ${user.tos_version ?? ''}`
              ) : (
                <span style={{ color: 'var(--error)' }}>Terms not accepted yet</span>
              )
            }
          >
            <NavRow icon={FileText} tint="slate" title="Terms of Service" onClick={() => navigate('/tos')} />
          </Group>
        );
    }
  }

  // Wide screens show the profile when nothing is picked; phones show the list.
  const shown: Section = section ?? 'profile';

  return (
    <div className={`settings-split ${section ? 'has-section' : ''}`}>
      <aside className="settings-list">
        <div className="settings-list-head">
          <h1>{t(locale, 'settings.title')}</h1>
        </div>
        <div className="settings-list-body">
          <button type="button" className={`set-profile ${shown === 'profile' ? 'active' : ''}`} onClick={() => go('profile')}>
            <Avatar src={user?.avatar_url} token={token} letter={name} size={52} />
            <span className="set-profile-text">
              <strong>{name}</strong>
              <small>{user?.username ? `@${user.username}` : user?.email}</small>
            </span>
            <span className={`tier-chip tier-${tier}`}>{TIER_LABEL[tier]}</span>
          </button>

          {!user?.profile_complete ? (
            <button type="button" className="notice warn as-button" onClick={() => go('profile')}>
              Finish your profile to use Lony fully.
            </button>
          ) : null}

          <Group>
            <NavRow
              icon={Sparkles}
              tint="gold"
              title="Plan & billing"
              value={tier === 'free' ? 'Upgrade' : TIER_LABEL[tier]}
              active={section === 'plan'}
              onClick={() => go('plan')}
            />
          </Group>

          <Group title="General">
            <NavRow icon={Globe} tint="blue" title="Language & region" value={`${languageName} · ${user?.default_currency_code || '—'}`} active={section === 'region'} onClick={() => go('region')} />
            <NavRow icon={Palette} tint="pink" title="Appearance" value={mode === 'dark' ? 'Dark' : 'Light'} active={section === 'appearance'} onClick={() => go('appearance')} />
            <NavRow icon={Bell} tint="red" title={t(locale, 'settings.notifications')} active={section === 'notifications'} onClick={() => go('notifications')} />
          </Group>

          <Group title="Money">
            <NavRow icon={Landmark} tint="teal" title="Payment methods" onClick={() => navigate('/banks')} />
          </Group>

          <Group title="Privacy">
            <NavRow icon={KeyRound} tint="slate" title={t(locale, 'settings.security')} active={section === 'security'} onClick={() => go('security')} />
            <NavRow icon={Shield} tint="violet" title={t(locale, 'settings.privacy')} active={section === 'privacy'} onClick={() => go('privacy')} />
          </Group>

          <Group>
            <NavRow icon={FileText} tint="slate" title="About & legal" active={section === 'legal'} onClick={() => go('legal')} />
            {isAdmin ? <NavRow icon={Wrench} tint="orange" title={t(locale, 'settings.admin')} onClick={() => navigate('/admin')} /> : null}
          </Group>

          <Group>
            <NavRow icon={LogOut} title={authBusy ? 'Signing out…' : t(locale, 'common.signOut')} danger onClick={onLogout} />
          </Group>
        </div>
      </aside>

      <section className="settings-detail">
        <div className="settings-detail-head">
          <button type="button" className="icon-btn ghost settings-back" aria-label="Back" onClick={() => go(null)}>
            <ArrowLeft size={18} />
          </button>
          <h2>{TITLES[shown]}</h2>
        </div>
        <div className={`settings-detail-body ${shown === 'plan' ? 'wide' : ''}`}>{detail(shown)}</div>
      </section>
    </div>
  );
}
