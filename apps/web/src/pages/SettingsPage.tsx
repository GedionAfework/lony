import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { api, type AppCalendar, type AppLocale } from '../lib/api';
import { COUNTRIES, CURRENCIES, TIMEZONES } from '../lib/catalogs';
import { applyDocumentDirection, parseLocaleMessages, setActivePack, t } from '../i18n';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Field, SelectField } from '../components/Field';
import { Segmented } from '../components/Segmented';
import { useToast } from '../components/Toast';

type Page = 'hub' | 'profile' | 'region' | 'payments' | 'notifications' | 'privacy' | 'security' | 'legal';

function HubRow({ title, subtitle, onClick }: { title: string; subtitle: string; onClick: () => void }) {
  return (
    <div className="list-row clickable-row" onClick={onClick}>
      <div className="main">
        <div className="title">{title}</div>
        <div className="sub">{subtitle}</div>
      </div>
    </div>
  );
}

const HOUR_CYCLES = [
  { value: '24h', labelKey: 'settings.hourCycle.24h' },
  { value: '12h', labelKey: 'settings.hourCycle.12h' },
] as const;

export function SettingsPage() {
  const { user, token, setUser, logout, busy: authBusy } = useAuth();
  const navigate = useNavigate();
  const { showError, show } = useToast();
  const [page, setPage] = useState<Page>('hub');
  const [busy, setBusy] = useState(false);

  const [username, setUsername] = useState(user?.username || '');
  const [firstName, setFirstName] = useState(user?.first_name || '');
  const [middleName, setMiddleName] = useState(user?.middle_name || '');
  const [lastName, setLastName] = useState(user?.last_name || '');
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [country, setCountry] = useState(user?.country_code || '');
  const [currency, setCurrency] = useState(user?.default_currency_code || '');
  const [locale, setLocale] = useState(user?.locale || 'en');
  const [timezone, setTimezone] = useState(user?.timezone || 'UTC');
  const [calendarId, setCalendarId] = useState(user?.calendar_id || 'gregorian');
  const [hourCycle, setHourCycle] = useState(user?.hour_cycle || '24h');
  const [authPref, setAuthPref] = useState((user?.preferred_auth_provider as 'email' | 'google' | 'telegram') || 'email');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [pushLoans, setPushLoans] = useState(true);
  const [pushSplits, setPushSplits] = useState(true);
  const [pushGoals, setPushGoals] = useState(true);
  const [inAppAll, setInAppAll] = useState(true);

  const [locales, setLocales] = useState<AppLocale[]>([]);
  const [calendars, setCalendars] = useState<AppCalendar[]>([]);

  const isAdmin = user?.role === 'admin';
  const isPremium = isAdmin || (user?.plan_tier || 'free').toLowerCase() === 'premium';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [locRes, calRes] = await Promise.all([api.listLocales(), api.listCalendars()]);
        if (cancelled) return;
        if ('locales' in locRes) {
          setLocales(locRes.locales ?? []);
          for (const loc of locRes.locales ?? []) {
            setActivePack({
              locale: loc.code,
              name: loc.name,
              dir: loc.dir,
              messages: parseLocaleMessages(loc.messages),
            });
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
        country_code: country.trim().toUpperCase() || undefined,
        default_currency_code: currency.trim().toUpperCase() || undefined,
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
        setActivePack({
          locale: pack.code,
          name: pack.name,
          dir: pack.dir,
          messages: parseLocaleMessages(pack.messages),
        });
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

  function onPickAvatar(file: File) {
    const reader = new FileReader();
    reader.onload = async () => {
      if (!token) return;
      const result = String(reader.result || '');
      const idx = result.indexOf(',');
      const b64 = idx >= 0 ? result.slice(idx + 1) : result;
      setBusy(true);
      try {
        const res = await api.uploadAvatar(token, { filename: file.name, mime: file.type || 'image/jpeg', attachment_base64: b64 });
        setUser(res.user);
      } catch (e) {
        showError(e instanceof Error ? e.message : 'Could not upload photo');
      } finally {
        setBusy(false);
      }
    };
    reader.readAsDataURL(file);
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
      const blob = new Blob([JSON.stringify(res.export, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'lony-export.json';
      a.click();
      URL.revokeObjectURL(url);
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
      const blob = new Blob(
        [`# cashflow\n${res.cashflow_csv}\n\n# transfers\n${res.transfers_csv}\n\n# accounts\n${res.accounts_csv}`],
        { type: 'text/csv' },
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'lony-ledger.csv';
      a.click();
      URL.revokeObjectURL(url);
      show('Ledger CSV downloaded');
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  }

  async function onClearAI() {
    if (!token) return;
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
    if (!confirm('Delete account forever?')) return;
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
    await logout();
    navigate('/login');
  }

  function Back({ title }: { title: string }) {
    return <PageHeader title={title} back onBack={() => setPage('hub')} />;
  }

  if (page === 'profile') {
    return (
      <div className="page page-narrow">
        <Back title={t(locale, 'settings.profile')} />
        {!user?.profile_complete ? <p style={{ color: 'var(--error)' }}>Finish your account details to use Lony fully.</p> : null}
        <Card>
          <div className="flex-col" style={{ alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <div className="avatar" style={{ width: 96, height: 96, fontSize: 32 }}>
              {user?.avatar_url ? <img src={user.avatar_url} alt={displayName} /> : (displayName || firstName || '?').slice(0, 1).toUpperCase()}
            </div>
            <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
              <Camera size={15} /> {busy ? 'Uploading…' : user?.avatar_url ? 'Change photo' : 'Add photo'}
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && onPickAvatar(e.target.files[0])} />
            </label>
          </div>
          <div className="muted">{user?.email}</div>
          <Field label="Username" value={username} onChange={setUsername} />
          <div className="form-row">
            <Field label="First name" value={firstName} onChange={setFirstName} />
            <Field label="Last name" value={lastName} onChange={setLastName} />
          </div>
          <Field label="Middle name" value={middleName} onChange={setMiddleName} />
          <Field label="Display name" value={displayName} onChange={setDisplayName} />
          <div className="form-row">
            <SelectField label="Country" value={country} onChange={setCountry} options={COUNTRIES} placeholder="Select" />
          </div>
          <div className="section-label">Sign-in preference</div>
          <Segmented value={authPref} onChange={(v) => setAuthPref(v as 'email' | 'google' | 'telegram')} options={[{ id: 'email', label: 'Email' }, { id: 'google', label: 'Google' }, { id: 'telegram', label: 'Telegram' }]} />
          <Button onClick={onSaveProfile} busy={busy} disabled={!username.trim() || !firstName.trim() || !lastName.trim()} block>
            {busy ? 'Saving…' : t(locale, 'common.save')}
          </Button>
        </Card>
      </div>
    );
  }

  if (page === 'region') {
    const localeOpts =
      locales.length > 0
        ? locales.map((l) => ({ id: l.code, label: `${l.name} (${l.code})` }))
        : [{ id: locale || 'en', label: locale || 'en' }];
    const calendarOpts =
      calendars.length > 0
        ? calendars.map((c) => ({ id: c.id, label: c.name }))
        : [
            { id: 'gregorian', label: 'Gregorian' },
            { id: 'ethiopic', label: 'Ethiopic' },
            { id: 'hijri', label: 'Hijri' },
          ];
    const hourOpts = HOUR_CYCLES.map((h) => ({ id: h.value, label: t(locale, h.labelKey) }));
    return (
      <div className="page page-narrow">
        <Back title="Preferences" />
        <Card>
          <SelectField
            label={t(locale, 'settings.language')}
            value={locale}
            onChange={(code) => {
              setLocale(code);
              const pack = locales.find((l) => l.code === code);
              if (pack) {
                setActivePack({
                  locale: pack.code,
                  name: pack.name,
                  dir: pack.dir,
                  messages: parseLocaleMessages(pack.messages),
                });
                applyDocumentDirection(pack.code);
              }
            }}
            options={localeOpts}
          />
          <SelectField label={t(locale, 'settings.calendar')} value={calendarId} onChange={setCalendarId} options={calendarOpts} />
          <SelectField
            label={t(locale, 'settings.hourCycle')}
            value={hourCycle === 'ethiopian_6' ? '24h' : hourCycle}
            onChange={setHourCycle}
            options={hourOpts}
          />
          <SelectField label={t(locale, 'settings.timezone')} value={timezone} onChange={setTimezone} options={TIMEZONES} />
          <Button onClick={onSaveRegion} busy={busy} block>
            {busy ? 'Saving…' : t(locale, 'common.save')}
          </Button>
        </Card>
      </div>
    );
  }

  if (page === 'payments') {
    return (
      <div className="page page-narrow">
        <Back title={t(locale, 'settings.payments')} />
        <Card>
          <p className="muted">Banks and wallets used when sharing how to get paid on loans.</p>
          <Button onClick={() => navigate('/banks')} block>
            Manage banks &amp; wallets
          </Button>
        </Card>
      </div>
    );
  }

  if (page === 'notifications') {
    const rows: [string, boolean, (v: boolean) => void][] = [
      ['Loan & repayment alerts', pushLoans, setPushLoans],
      ['Expense splits', pushSplits, setPushSplits],
      ['Goal reminders', pushGoals, setPushGoals],
      ['In-app inbox', inAppAll, setInAppAll],
    ];
    return (
      <div className="page page-narrow">
        <Back title={t(locale, 'settings.notifications')} />
        <Card>
          <p className="muted" style={{ fontSize: 13 }}>Choose what you want to hear about.</p>
          {rows.map(([label, value, setter]) => (
            <label key={label} className="checkbox-row" style={{ justifyContent: 'space-between' }}>
              {label}
              <input type="checkbox" checked={value} onChange={() => setter(!value)} />
            </label>
          ))}
        </Card>
      </div>
    );
  }

  if (page === 'privacy') {
    return (
      <div className="page page-narrow">
        <Back title={t(locale, 'settings.privacy')} />
        <Card>
          <p className="muted" style={{ fontSize: 13 }}>Download a copy of your Lony data, clear AI insight history, or delete your account.</p>
          <Button variant="secondary" onClick={onExportData} disabled={busy} block>
            {busy ? 'Working…' : 'Export my data'}
          </Button>
          <Button variant="secondary" onClick={onExportLedger} disabled={busy} block>
            {busy ? 'Working…' : 'Export ledger CSV'}
          </Button>
          <Button variant="secondary" onClick={onClearAI} disabled={busy} block>
            {busy ? 'Working…' : 'Clear AI insights'}
          </Button>
          <Button variant="danger" onClick={onDeleteAccount} disabled={busy} block>
            Delete account
          </Button>
        </Card>
      </div>
    );
  }

  if (page === 'security') {
    return (
      <div className="page page-narrow">
        <Back title={t(locale, 'settings.security')} />
        <Card>
          <p className="muted" style={{ fontSize: 13 }}>Change the password for {user?.email}.</p>
          <Field label="Current password" type="password" value={currentPassword} onChange={setCurrentPassword} />
          <Field label="New password" type="password" value={newPassword} onChange={setNewPassword} />
          <Button onClick={onChangePassword} busy={busy} disabled={!currentPassword || !newPassword} block>
            {busy ? 'Working…' : 'Update password'}
          </Button>
        </Card>
      </div>
    );
  }

  if (page === 'legal') {
    return (
      <div className="page page-narrow">
        <Back title={t(locale, 'settings.legal')} />
        <Card>
          <Button variant="secondary" onClick={() => navigate('/tos')} block>
            Terms of Service
          </Button>
          {user?.tos_accepted_at ? (
            <p className="muted" style={{ fontSize: 13 }}>Accepted · {user.tos_version}</p>
          ) : (
            <p style={{ color: 'var(--error)', fontSize: 13 }}>Terms not accepted yet</p>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="page page-narrow">
      <PageHeader title={t(locale, 'settings.title')} />
      {!user?.profile_complete ? <p style={{ color: 'var(--error)' }}>Finish your profile to use Lony fully.</p> : null}
      {!isPremium ? (
        <Card>
          <div style={{ fontWeight: 700 }}>Free plan</div>
          <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>Insights AI (Analysis, Reports, Coach) requires Premium. Ask an admin to upgrade your account.</p>
        </Card>
      ) : (
        <Card>
          <div style={{ fontWeight: 700 }}>Premium</div>
          <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>AI personas are unlocked for this account.</p>
        </Card>
      )}
      <Card tight>
        <HubRow title={t(locale, 'settings.profile')} subtitle={t(locale, 'settings.profileSubtitle')} onClick={() => setPage('profile')} />
        <HubRow title="Preferences" subtitle={t(locale, 'settings.regionSubtitle')} onClick={() => setPage('region')} />
        <HubRow title={t(locale, 'settings.themes')} subtitle={t(locale, 'settings.themesSubtitle')} onClick={() => navigate('/themes')} />
        <HubRow title={t(locale, 'settings.payments')} subtitle={t(locale, 'settings.paymentsSubtitle')} onClick={() => setPage('payments')} />
        <HubRow title={t(locale, 'settings.notifications')} subtitle={t(locale, 'settings.notificationsSubtitle')} onClick={() => setPage('notifications')} />
        <HubRow title={t(locale, 'settings.privacy')} subtitle={t(locale, 'settings.privacySubtitle')} onClick={() => setPage('privacy')} />
        <HubRow title={t(locale, 'settings.security')} subtitle={t(locale, 'settings.securitySubtitle')} onClick={() => setPage('security')} />
        <HubRow title={t(locale, 'settings.legal')} subtitle={t(locale, 'settings.legalSubtitle')} onClick={() => setPage('legal')} />
        {isAdmin ? <HubRow title={t(locale, 'settings.admin')} subtitle={t(locale, 'settings.adminSubtitle')} onClick={() => navigate('/admin')} /> : null}
      </Card>
      <Button variant="secondary" onClick={onLogout} busy={authBusy} block>
        {t(locale, 'common.signOut')}
      </Button>
    </div>
  );
}
