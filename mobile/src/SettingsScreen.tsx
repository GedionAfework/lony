import { useEffect, useState } from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Alert, I18nManager, Platform, Pressable, Share, Switch, Text, View } from 'react-native';
import { AdminScreen } from './AdminScreen';
import { AuthenticatedAvatar } from './AuthenticatedAvatar';
import { api, type AppCalendar, type AppLocale } from './api';
import { COUNTRIES, CURRENCIES, CALENDARS, TIMEZONES, resolveTimezoneId } from './catalogs';
import { getSmsAutoImportEnabled, setSmsAutoImportEnabled } from './smsAutoIngest';
import {
  cancelDailySmsCheckup,
  getSmsCheckupTime,
  scheduleDailySmsCheckup,
  setSmsCheckupTime,
} from './smsWatcher';
import {
  disableBiometricsLock,
  enableBiometricsLock,
  getBiometricsAvailability,
  getBiometricsLockEnabled,
} from './biometricsLock';
import {
  clearAppLock,
  getAppLockMethod,
  setAppLockMethod,
  setBiometricsAsLockMethod,
  type AppLockMethod,
} from './appLock';
import { applyNativeDirection, parseLocaleMessages, setActivePack, t } from './i18n';
import { IconCamera } from './icons';
import { PatternPad } from './PatternPad';
import { PhoneField } from './PhoneField';
import { SearchSelect } from './SearchSelect';
import { ThemesScreen } from './ThemesScreen';
import { fonts, radii, space, useTheme } from './theme';
import {
  Card,
  Field,
  PrimaryButton,
  ScreenHeader,
  SecondaryButton,
  SectionLabel,
  Segmented,
} from './ui';

const appVersion = Constants.expoConfig?.version ?? '';

type SettingsPage =
  | 'hub'
  | 'profile'
  | 'region'
  | 'money'
  | 'payments'
  | 'notifications'
  | 'privacy'
  | 'security'
  | 'extraFactor'
  | 'themes'
  | 'admin';

type Props = {
  email: string;
  username: string;
  firstName: string;
  middleName: string;
  lastName: string;
  displayName: string;
  phone: string;
  country: string;
  currency: string;
  locale: string;
  timezone: string;
  calendarId: string;
  hourCycle: string;
  authPref: 'email' | 'google' | 'telegram';
  profileComplete: boolean;
  tosAccepted: boolean;
  tosVersion?: string | null;
  isAdmin?: boolean;
  planTier?: string;
  token?: string;
  avatarUrl?: string | null;
  /** Immediate local preview after picking a photo. */
  avatarLocalUri?: string | null;
  busy: boolean;
  onUsername: (v: string) => void;
  onFirstName: (v: string) => void;
  onMiddleName: (v: string) => void;
  onLastName: (v: string) => void;
  onDisplayName: (v: string) => void;
  onPhone: (v: string) => void;
  onCountry: (v: string) => void;
  onCurrency: (v: string) => void;
  onLocale: (v: string) => void;
  onTimezone: (v: string) => void;
  onCalendarId: (v: string) => void;
  onHourCycle: (v: string) => void;
  loanRequireApproval: boolean;
  onLoanRequireApproval: (v: boolean) => void;
  askRecurringReceived: boolean;
  onAskRecurringReceived: (v: boolean) => void;
  /** When SMS auto-import is turned on: permission + full inbox scan + account prompts. */
  onActivateSmsImport?: () => Promise<void> | void;
  onAuthPref: (v: 'email' | 'google' | 'telegram') => void;
  onSave: () => void | Promise<void>;
  onSaveRegion?: () => void | Promise<void>;
  /** Settings save on change; this shows whether the last change reached the server. */
  saveState?: 'idle' | 'saving' | 'saved' | 'error';
  onAvatar: () => void;
  onTos: () => void;
  onBanks: () => void;
  onExportData: () => void;
  onExportLedger?: () => void;
  onDeleteAccount: () => void;
  onClearAI: () => void;
  onLogout: () => void;
  onSettingsPageChange?: (detail: boolean) => void;
  currentPassword?: string;
  changePasswordNew?: string;
  onCurrentPassword?: (v: string) => void;
  onChangePasswordNew?: (v: string) => void;
  onChangePassword?: () => void;
};

type FAName = React.ComponentProps<typeof FontAwesome>['name'];

const ICON_TINTS: Record<string, string> = {
  teal: '#159E9E',
  blue: '#2F7DD3',
  orange: '#E07B12',
  violet: '#8B5CF6',
  pink: '#E0457B',
  green: '#0E8A6A',
  slate: '#5B6B82',
  red: '#DC3B3B',
};

/** Rounded block of rows with an optional small heading above it, like phone settings. */
function Group({ title, footer, children }: { title?: string; footer?: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {title ? (
        <Text style={{ color: colors.muted, fontFamily: fonts.uiSemi, fontSize: 12.5, marginLeft: 14, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          {title}
        </Text>
      ) : null}
      <View style={{ backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
        {children}
      </View>
      {/* Groups carry no description lines. */}
      {footer && false ? <Text>{footer}</Text> : null}
    </View>
  );
}

function RowIcon({ icon, tint }: { icon: FAName; tint: keyof typeof ICON_TINTS }) {
  return (
    <View style={{ width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: ICON_TINTS[tint] }}>
      <FontAwesome name={icon} size={15} color="#FFFFFF" />
    </View>
  );
}

/** A row that opens a page: icon, title, optional value on the right, and an arrow. */
function NavRow({
  icon,
  tint = 'teal',
  title,
  subtitle,
  value,
  onPress,
  last,
  danger,
}: {
  icon?: FAName;
  tint?: keyof typeof ICON_TINTS;
  title: string;
  subtitle?: string;
  value?: string;
  onPress: () => void;
  last?: boolean;
  danger?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 13,
        backgroundColor: pressed ? colors.surfaceMuted : 'transparent',
      })}
    >
      {icon ? <RowIcon icon={icon} tint={danger ? 'red' : tint} /> : null}
      <View
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          minHeight: 32,
        }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: danger ? colors.error : colors.text, fontFamily: fonts.uiMedium, fontSize: 15.5 }}>{title}</Text>

        </View>
        {value ? (
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 14, maxWidth: 150 }} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
        {danger ? null : <FontAwesome name="angle-right" size={20} color={colors.borderStrong} />}
      </View>
      {last ? null : (
        <View style={{ position: 'absolute', left: icon ? 58 : 14, right: 0, bottom: 0, height: 1, backgroundColor: colors.border }} />
      )}
    </Pressable>
  );
}

/** A row with a switch. Changes apply at once; there is never a Save button. */
function ToggleRow({
  icon,
  tint = 'teal',
  title,
  subtitle,
  value,
  onChange,
  disabled,
  last,
}: {
  icon?: FAName;
  tint?: keyof typeof ICON_TINTS;
  title: string;
  subtitle?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  last?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 }}>
      {icon ? <RowIcon icon={icon} tint={tint} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.text, fontFamily: fonts.uiMedium, fontSize: 15.5 }}>{title}</Text>

      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: colors.borderStrong, true: colors.primary }}
        thumbColor="#FFFFFF"
      />
      {last ? null : <View style={{ position: 'absolute', left: icon ? 58 : 14, right: 0, bottom: 0, height: 1, backgroundColor: colors.border }} />}
    </View>
  );
}

/** Padding around pickers and fields placed inside a group. */
function Inset({ children }: { children: React.ReactNode }) {
  return <View style={{ paddingHorizontal: 14, paddingVertical: 10, gap: 10 }}>{children}</View>;
}

const NOTIFY_KEY = 'lony_notify_prefs_v1';
type NotifyPrefs = { loans: boolean; splits: boolean; goals: boolean; inbox: boolean };
const DEFAULT_NOTIFY: NotifyPrefs = { loans: true, splits: true, goals: true, inbox: true };

const HOUR_CYCLES = [
  { value: '24h', labelKey: 'settings.hourCycle.24h' },
  { value: '12h', labelKey: 'settings.hourCycle.12h' },
] as const;

export function SettingsScreen(props: Props) {
  const { colors } = useTheme();
  const [page, setPage] = useState<SettingsPage>('hub');
  const [notify, setNotify] = useState<NotifyPrefs>(DEFAULT_NOTIFY);
  const [smsAutoImport, setSmsAutoImport] = useState(true);
  const [smsCheckupHour, setSmsCheckupHour] = useState('8');
  const [biometricsLock, setBiometricsLock] = useState(false);
  const [biometricsLabel, setBiometricsLabel] = useState('Biometrics');
  const [biometricsSupported, setBiometricsSupported] = useState(false);
  const [biometricsBusy, setBiometricsBusy] = useState(false);
  const [lockMethod, setLockMethod] = useState<AppLockMethod>('none');
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaKind, setMfaKind] = useState<'pin' | 'pattern' | 'password'>('pin');
  const [mfaDraft, setMfaDraft] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);
  const [locales, setLocales] = useState<AppLocale[]>([]);
  const [calendars, setCalendars] = useState<AppCalendar[]>([]);

  // Notification choices are remembered on this phone.
  useEffect(() => {
    SecureStore.getItemAsync(NOTIFY_KEY)
      .then((raw) => {
        if (raw) setNotify({ ...DEFAULT_NOTIFY, ...(JSON.parse(raw) as Partial<NotifyPrefs>) });
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const on = await getSmsAutoImportEnabled();
      const t = await getSmsCheckupTime();
      if (!cancelled) {
        setSmsAutoImport(on);
        setSmsCheckupHour(String(t.hour));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [enabled, avail, method] = await Promise.all([
        getBiometricsLockEnabled(),
        getBiometricsAvailability(),
        getAppLockMethod(),
      ]);
      if (cancelled) return;
      setBiometricsLock(enabled || method === 'biometrics');
      setBiometricsLabel(avail.label);
      setBiometricsSupported(avail.available && avail.enrolled);
      setLockMethod(method === 'none' && enabled ? 'biometrics' : method);
      const secretOn = method === 'pin' || method === 'pattern' || method === 'password';
      setMfaEnabled(secretOn);
      if (secretOn) setMfaKind(method);
    })();
    return () => {
      cancelled = true;
    };
  }, [page]);

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
          // Keep the user's locale active (loop above would leave the last pack active).
          const current = (locRes.locales ?? []).find((l) => l.code === props.locale);
          if (current) {
            setActivePack({
              locale: current.code,
              name: current.name,
              dir: current.dir,
              messages: parseLocaleMessages(current.messages),
            });
          } else {
            setActivePack({ locale: props.locale || 'en' });
          }
        }
        setCalendars(calRes.calendars ?? []);
      } catch {
        // offline: keep bundled English
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.locale]);

  function goHub() {
    setPage('hub');
    props.onSettingsPageChange?.(false);
  }

  function goPage(p: SettingsPage) {
    setPage(p);
    props.onSettingsPageChange?.(p !== 'hub');
  }

  function confirmDelete() {
    Alert.alert(
      t(props.locale, 'settings.deleteConfirmTitle'),
      t(props.locale, 'settings.deleteConfirmBody'),
      [
        { text: t(props.locale, 'common.cancel'), style: 'cancel' },
        {
          text: t(props.locale, 'common.continue'),
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              t(props.locale, 'settings.deleteConfirmTitle2'),
              t(props.locale, 'settings.deleteConfirmBody2'),
              [
                { text: t(props.locale, 'common.cancel'), style: 'cancel' },
                { text: t(props.locale, 'settings.deleteForever'), style: 'destructive', onPress: props.onDeleteAccount },
              ],
            );
          },
        },
      ],
    );
  }

  function Back({ title }: { title: string }) {
    const state = props.saveState;
    return (
      <ScreenHeader
        title={title}
        onBack={goHub}
        right={
          state === 'saving' || state === 'saved' || state === 'error' ? (
            <Text
              style={{
                color: state === 'error' ? colors.error : colors.muted,
                fontFamily: fonts.ui,
                fontSize: 12,
              }}
            >
              {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved ✓' : 'Not saved'}
            </Text>
          ) : undefined
        }
      />
    );
  }

  if (page === 'themes') {
    return <ThemesScreen onBack={goHub} />;
  }

  if (page === 'admin' && props.isAdmin && props.token) {
    return (
      <AdminScreen
        token={props.token}
        locale={props.locale}
        onBack={goHub}
        onError={(msg) => Alert.alert(t(props.locale, 'admin'), msg)}
      />
    );
  }

  const L = props.locale;
  const premium = props.isAdmin || props.planTier === 'plus' || props.planTier === 'pro' || props.planTier === 'premium';
  const languageName = locales.find((l) => l.code === props.locale)?.name || props.locale || 'English';
  const lockLabel =
    lockMethod === 'biometrics' || biometricsLock
      ? biometricsLabel
      : lockMethod === 'pin'
        ? 'PIN'
        : lockMethod === 'pattern'
          ? 'Pattern'
          : lockMethod === 'password'
            ? 'Password'
            : t(L, 'settings.off');

  if (page === 'region') {
    const localeOpts =
      locales.length > 0
        ? locales.map((l) => ({ id: l.code, label: `${l.name} (${l.code})` }))
        : [{ id: props.locale || 'en', label: props.locale || 'en' }];
    const hourOpts = HOUR_CYCLES.map((h) => ({ id: h.value, label: t(L, h.labelKey) }));
    return (
      <View style={{ gap: space.lg }}>
        <Back title={t(L, 'settings.languageRegion')} />
        <Group title={t(L, 'settings.groupLanguage')}>
          <Inset>
            <SearchSelect
              label={t(L, 'settings.language')}
              value={props.locale}
              onChange={(code) => {
                props.onLocale(code);
                // Switch the words at once; bundled packs already cover every key.
                const pack = locales.find((l) => l.code === code);
                setActivePack(
                  pack ? { locale: pack.code, name: pack.name, dir: pack.dir, messages: parseLocaleMessages(pack.messages) } : { locale: code },
                );
                applyNativeDirection(code);
              }}
              options={localeOpts}
            />
          </Inset>
        </Group>
        <Group title={t(L, 'settings.groupMoney')} footer={t(L, 'settings.currencyFooter')}>
          <Inset>
            <SearchSelect label={t(L, 'settings.baseCurrency')} value={props.currency} onChange={props.onCurrency} options={CURRENCIES} />
          </Inset>
        </Group>
        <Group title={t(L, 'settings.groupDates')}>
          <Inset>
            <SearchSelect
              label={t(L, 'settings.calendar')}
              value={
                props.calendarId === 'hijri'
                  ? 'islamic'
                  : props.calendarId === 'ethiopian'
                    ? 'ethiopic'
                    : props.calendarId === 'solar_hijri' || props.calendarId === 'jalali'
                      ? 'persian'
                      : props.calendarId
              }
              onChange={props.onCalendarId}
              options={CALENDARS}
            />
            <SearchSelect
              label={t(L, 'settings.hourCycle')}
              value={props.hourCycle === 'ethiopian_6' ? '24h' : props.hourCycle}
              onChange={props.onHourCycle}
              options={hourOpts}
            />
            <SearchSelect label={t(L, 'settings.timezone')} value={resolveTimezoneId(props.timezone)} onChange={props.onTimezone} options={TIMEZONES} />
          </Inset>
        </Group>
        {I18nManager.isRTL ? <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>{t(L, 'settings.rtlNotice')}</Text> : null}
      </View>
    );
  }

  if (page === 'money') {
    const smsHourOpts = Array.from({ length: 24 }, (_, h) => ({ id: String(h), label: `${String(h).padStart(2, '0')}:00` }));
    return (
      <View style={{ gap: space.lg }}>
        <Back title={t(L, 'settings.moneyTracking')} />
        <Group title={t(L, 'settings.groupSms')} footer={t(L, 'settings.smsFooter')}>
          <ToggleRow
            icon="envelope"
            tint="green"
            title={t(L, 'settings.smsAutoImport')}
            subtitle={t(L, 'settings.smsAutoImportSub')}
            value={smsAutoImport}
            last={!smsAutoImport}
            onChange={(v) => {
              setSmsAutoImport(v);
              void (async () => {
                if (v) {
                  if (props.onActivateSmsImport) await props.onActivateSmsImport();
                  else await setSmsAutoImportEnabled(true);
                  await scheduleDailySmsCheckup();
                } else {
                  await setSmsAutoImportEnabled(false);
                  await cancelDailySmsCheckup();
                }
              })();
            }}
          />
          {smsAutoImport ? (
            <Inset>
              <SearchSelect
                label={t(L, 'settings.smsDailyCheckup')}
                value={smsCheckupHour}
                onChange={(id) => {
                  setSmsCheckupHour(id);
                  void setSmsCheckupTime(Number(id), 0);
                }}
                options={smsHourOpts}
              />
            </Inset>
          ) : null}
        </Group>
        <Group title={t(L, 'settings.groupLoans')}>
          <ToggleRow
            icon="handshake-o"
            tint="orange"
            title={t(L, 'settings.loanApproval')}
            subtitle={t(L, 'settings.loanApprovalSub')}
            value={props.loanRequireApproval}
            onChange={props.onLoanRequireApproval}
          />
          <ToggleRow
            icon="repeat"
            tint="blue"
            title={t(L, 'settings.askRecurringReceived')}
            subtitle={t(L, 'settings.askRecurringReceivedHint')}
            value={props.askRecurringReceived}
            onChange={props.onAskRecurringReceived}
            last
          />
        </Group>
        <Group title={t(L, 'payments')} footer={t(L, 'settings.paymentsHint')}>
          <NavRow icon="university" tint="teal" title={t(L, 'settings.manageBanks')} onPress={props.onBanks} last />
        </Group>
      </View>
    );
  }

  if (page === 'profile') {
    const missing = !props.username.trim() || !props.firstName.trim() || !props.lastName.trim();
    return (
      <View style={{ gap: space.lg }}>
        <Back title={t(L, 'profile')} />
        <View style={{ alignItems: 'center', gap: 10 }}>
          <Pressable onPress={props.onAvatar} disabled={props.busy} accessibilityLabel={t(L, 'profile.changePhoto')}>
            <AuthenticatedAvatar path={props.avatarUrl} localUri={props.avatarLocalUri} token={props.token} size={104} fallbackLetter={props.displayName || props.firstName || '?'} />
            <View
              style={{
                position: 'absolute',
                right: 0,
                bottom: 0,
                width: 34,
                height: 34,
                borderRadius: 17,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.primary,
                borderWidth: 3,
                borderColor: colors.background,
              }}
            >
              <IconCamera size={15} color={colors.onPrimary} />
            </View>
          </Pressable>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
            {props.busy ? t(L, 'profile.uploading') : t(L, 'settings.tapPhoto')}
          </Text>
        </View>
        {missing ? (
          <Text style={{ color: colors.warning, fontFamily: fonts.ui, fontSize: 13, textAlign: 'center' }}>{t(L, 'settings.nameNeeded')}</Text>
        ) : null}
        <Group title={t(L, 'settings.groupName')}>
          <Inset>
            <Field label={t(L, 'profile.firstName')} value={props.firstName} onChange={props.onFirstName} />
            <Field label={t(L, 'profile.lastName')} value={props.lastName} onChange={props.onLastName} />
            <Field label={t(L, 'profile.middleName')} value={props.middleName} onChange={props.onMiddleName} />
            <Field label={t(L, 'profile.displayName')} value={props.displayName} onChange={props.onDisplayName} />
          </Inset>
        </Group>
        <Group title={t(L, 'settings.groupAccount')} footer={props.email}>
          <Inset>
            <Field label={t(L, 'profile.username')} value={props.username} onChange={props.onUsername} />
            <PhoneField value={props.phone} country={props.country} onCountryChange={props.onCountry} onChange={props.onPhone} />
            <SearchSelect label={t(L, 'profile.country')} value={props.country} onChange={props.onCountry} options={COUNTRIES} />
          </Inset>
        </Group>
        <Group title={t(L, 'profile.signInPreference')}>
          <Inset>
            <Segmented
              value={props.authPref}
              onChange={(v) => props.onAuthPref(v as 'email' | 'google' | 'telegram')}
              options={[
                { id: 'email', label: 'Email' },
                { id: 'google', label: 'Google' },
                { id: 'telegram', label: 'Telegram' },
              ]}
            />
          </Inset>
        </Group>
      </View>
    );
  }

  if (page === 'notifications') {
    const setPref = (key: keyof NotifyPrefs) => (v: boolean) => {
      const next = { ...notify, [key]: v };
      setNotify(next);
      void SecureStore.setItemAsync(NOTIFY_KEY, JSON.stringify(next)).catch(() => undefined);
    };
    return (
      <View style={{ gap: space.lg }}>
        <Back title={t(L, 'notifications')} />
        <Group title={t(L, 'settings.groupTellMe')} footer={t(L, 'settings.notifyFooter')}>
          <ToggleRow icon="money" tint="orange" title={t(L, 'settings.notifyLoanAlerts')} subtitle={t(L, 'settings.notifyLoanAlertsSub')} value={notify.loans} onChange={setPref('loans')} />
          <ToggleRow icon="users" tint="violet" title={t(L, 'settings.notifySplits')} subtitle={t(L, 'settings.notifySplitsSub')} value={notify.splits} onChange={setPref('splits')} />
          <ToggleRow icon="flag" tint="green" title={t(L, 'settings.notifyGoals')} subtitle={t(L, 'settings.notifyGoalsSub')} value={notify.goals} onChange={setPref('goals')} />
          <ToggleRow icon="bell" tint="blue" title={t(L, 'settings.notifyInbox')} subtitle={t(L, 'settings.notifyInboxSub')} value={notify.inbox} onChange={setPref('inbox')} last />
        </Group>
      </View>
    );
  }

  if (page === 'privacy') {
    return (
      <View style={{ gap: space.lg }}>
        <Back title={t(L, 'privacy')} />
        <Group title={t(L, 'settings.groupYourData')} footer={t(L, 'settings.privacyHint')}>
          <NavRow icon="download" tint="blue" title={t(L, 'settings.exportData')} subtitle={t(L, 'settings.exportDataSub')} onPress={props.onExportData} last={!props.onExportLedger} />
          {props.onExportLedger ? (
            <NavRow icon="table" tint="green" title={t(L, 'settings.exportLedger')} subtitle={t(L, 'settings.exportLedgerSub')} onPress={props.onExportLedger} last />
          ) : null}
        </Group>
        <Group title={t(L, 'settings.groupAi')}>
          <NavRow
            icon="magic"
            tint="violet"
            title={t(L, 'settings.clearAiInsights')}
            subtitle={t(L, 'settings.clearAiSub')}
            onPress={() =>
              Alert.alert(t(L, 'settings.clearAiInsights'), t(L, 'settings.clearAiConfirm'), [
                { text: t(L, 'common.cancel'), style: 'cancel' },
                { text: t(L, 'common.clear'), style: 'destructive', onPress: props.onClearAI },
              ])
            }
            last
          />
        </Group>
        <Group footer={t(L, 'settings.deleteFooter')}>
          <NavRow icon="trash" title={t(L, 'settings.deleteAccount')} onPress={confirmDelete} danger last />
        </Group>
      </View>
    );
  }

  if (page === 'security') {
    return (
      <View style={{ gap: space.lg }}>
        <Back title={t(L, 'settings.security')} />
        <Group title={t(L, 'settings.appLock')} footer={t(L, 'settings.appLockHint')}>
          <ToggleRow
            icon="lock"
            tint="slate"
            title={biometricsLabel}
            subtitle={biometricsSupported || biometricsLock ? t(L, 'settings.biometricsHint') : t(L, 'settings.biometricsUnavailable')}
            value={biometricsLock}
            disabled={biometricsBusy || (!biometricsSupported && !biometricsLock)}
            onChange={(v) => {
              void (async () => {
                setBiometricsBusy(true);
                try {
                  if (v) {
                    const res = await enableBiometricsLock();
                    if (!res.ok) {
                      Alert.alert(t(L, 'settings.appLock'), res.error || `Could not enable ${biometricsLabel}`);
                      setBiometricsLock(false);
                      return;
                    }
                    await setBiometricsAsLockMethod();
                    setBiometricsLock(true);
                    setLockMethod('biometrics');
                  } else {
                    const res = await disableBiometricsLock();
                    if (!res.ok) {
                      Alert.alert(t(L, 'settings.appLock'), res.error || `Could not disable ${biometricsLabel}`);
                      setBiometricsLock(true);
                      return;
                    }
                    if (lockMethod === 'biometrics') {
                      await clearAppLock();
                      setLockMethod('none');
                    }
                    setBiometricsLock(false);
                  }
                } finally {
                  setBiometricsBusy(false);
                }
              })();
            }}
          />
          <NavRow
            icon="key"
            tint="orange"
            title={t(L, 'settings.extraFactor')}
            value={mfaEnabled ? mfaKind.toUpperCase() : t(L, 'settings.off')}
            onPress={() => goPage('extraFactor')}
            last={!(lockMethod !== 'none' || biometricsLock)}
          />
          {lockMethod !== 'none' || biometricsLock ? (
            <NavRow
              title={t(L, 'settings.turnOffLock')}
              danger
              last
              onPress={() =>
                Alert.alert(t(L, 'settings.turnOffLock'), t(L, 'settings.turnOffLockConfirm'), [
                  { text: t(L, 'common.cancel'), style: 'cancel' },
                  {
                    text: t(L, 'settings.turnOff'),
                    style: 'destructive',
                    onPress: () => {
                      void (async () => {
                        await clearAppLock();
                        await disableBiometricsLock().catch(() => undefined);
                        setLockMethod('none');
                        setBiometricsLock(false);
                        setMfaEnabled(false);
                      })();
                    },
                  },
                ])
              }
            />
          ) : null}
        </Group>
        <Group title={t(L, 'settings.accountPassword')} footer={t(L, 'settings.changePasswordHint').replace('{email}', props.email)}>
          <Inset>
            <Field label={t(L, 'settings.currentPassword')} value={props.currentPassword ?? ''} onChange={props.onCurrentPassword ?? (() => undefined)} secure />
            <Field label={t(L, 'settings.newPassword')} value={props.changePasswordNew ?? ''} onChange={props.onChangePasswordNew ?? (() => undefined)} secure />
            <PrimaryButton
              label={props.busy ? t(L, 'common.working') : t(L, 'settings.updatePassword')}
              onPress={props.onChangePassword ?? (() => undefined)}
              disabled={props.busy || !props.onChangePassword || !(props.currentPassword ?? '').trim() || !(props.changePasswordNew ?? '').trim()}
            />
          </Inset>
        </Group>
      </View>
    );
  }

  if (page === 'extraFactor') {
    const saveSecret = async (kind: 'pin' | 'pattern' | 'password', secret: string) => {
      setMfaBusy(true);
      try {
        const res = await setAppLockMethod(kind, secret);
        if (!res.ok) {
          Alert.alert(t(L, 'settings.extraFactor'), res.error || 'Could not save');
          return;
        }
        await disableBiometricsLock().catch(() => undefined);
        setBiometricsLock(false);
        setLockMethod(kind);
        setMfaEnabled(true);
        setMfaDraft('');
        Alert.alert(t(L, 'settings.extraFactor'), t(L, 'settings.extraFactorSaved'));
        goPage('security');
      } finally {
        setMfaBusy(false);
      }
    };
    return (
      <View style={{ gap: space.lg }}>
        <Back title={t(L, 'settings.extraFactor')} />
        <Group footer={t(L, 'settings.extraFactorHint')}>
          <ToggleRow
            icon="key"
            tint="orange"
            title={t(L, 'settings.extraFactorToggle')}
            value={mfaEnabled}
            last
            onChange={(v) => {
              void (async () => {
                if (!v) {
                  await clearAppLock();
                  setMfaEnabled(false);
                  if (lockMethod === 'pin' || lockMethod === 'pattern' || lockMethod === 'password') {
                    setLockMethod(biometricsLock ? 'biometrics' : 'none');
                    if (biometricsLock) await setBiometricsAsLockMethod();
                  }
                  setMfaDraft('');
                  return;
                }
                setMfaEnabled(true);
                setMfaDraft('');
              })();
            }}
          />
        </Group>
        {mfaEnabled ? (
          <Group title={t(L, 'settings.chooseMethod')}>
            <Inset>
              <Segmented
                value={mfaKind}
                onChange={(v) => {
                  setMfaKind(v as 'pin' | 'pattern' | 'password');
                  setMfaDraft('');
                }}
                options={[
                  { id: 'pin', label: t(L, 'settings.methodPin') },
                  { id: 'pattern', label: t(L, 'settings.methodPattern') },
                  { id: 'password', label: t(L, 'settings.methodPassword') },
                ]}
              />
              {mfaKind === 'pattern' ? (
                <PatternPad disabled={mfaBusy} onComplete={(key) => void saveSecret('pattern', key)} />
              ) : (
                <>
                  <Field
                    label={mfaKind === 'pin' ? t(L, 'settings.methodPin') : t(L, 'settings.methodPassword')}
                    value={mfaDraft}
                    onChange={setMfaDraft}
                    secure
                    keyboardType={mfaKind === 'pin' ? 'number-pad' : 'default'}
                    placeholder={mfaKind === 'pin' ? '123456' : '••••••'}
                  />
                  <PrimaryButton
                    label={mfaBusy ? t(L, 'common.loading') : mfaKind === 'pin' ? 'Set PIN' : 'Set password'}
                    disabled={mfaBusy || !mfaDraft.trim()}
                    onPress={() => void saveSecret(mfaKind, mfaDraft)}
                  />
                </>
              )}
            </Inset>
          </Group>
        ) : null}
      </View>
    );
  }

  // Hub
  return (
    <View style={{ gap: space.lg }}>
      <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 26, letterSpacing: -0.5 }}>{t(L, 'settings')}</Text>

      <Pressable
        onPress={() => goPage('profile')}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          padding: 14,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
        })}
      >
        <AuthenticatedAvatar path={props.avatarUrl} localUri={props.avatarLocalUri} token={props.token} size={58} fallbackLetter={props.displayName || props.firstName || '?'} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 18 }} numberOfLines={1}>
            {props.displayName || [props.firstName, props.lastName].filter(Boolean).join(' ') || props.username || props.email}
          </Text>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }} numberOfLines={1}>
            {props.username ? `@${props.username}` : props.email}
          </Text>
          <View
            style={{
              alignSelf: 'flex-start',
              marginTop: 4,
              paddingHorizontal: 9,
              paddingVertical: 3,
              borderRadius: radii.full,
              backgroundColor: premium ? colors.secondarySoft : colors.surfaceMuted,
            }}
          >
            <Text style={{ color: premium ? colors.secondary : colors.muted, fontFamily: fonts.uiSemi, fontSize: 11 }}>
              {premium ? `★ ${t(L, 'settings.premium')}` : t(L, 'settings.freePlan')}
            </Text>
          </View>
        </View>
        <FontAwesome name="angle-right" size={22} color={colors.borderStrong} />
      </Pressable>

      {!props.profileComplete ? (
        <Pressable onPress={() => goPage('profile')} style={{ padding: 12, borderRadius: 14, backgroundColor: colors.warningSoft }}>
          <Text style={{ color: colors.warning, fontFamily: fonts.uiSemi, fontSize: 13.5 }}>{t(L, 'settings.finishProfile')}</Text>
        </Pressable>
      ) : null}

      <Group title={t(L, 'settings.groupGeneral')}>
        <NavRow icon="globe" tint="blue" title={t(L, 'settings.languageRegion')} value={`${languageName} · ${props.currency || '—'}`} onPress={() => goPage('region')} />
        <NavRow icon="paint-brush" tint="pink" title={t(L, 'settings.appearance')} onPress={() => goPage('themes')} />
        <NavRow icon="bell" tint="red" title={t(L, 'notifications')} onPress={() => goPage('notifications')} last />
      </Group>

      <Group title={t(L, 'settings.groupMoneyHub')}>
        <NavRow
          icon="exchange"
          tint="green"
          title={t(L, 'settings.moneyTracking')}
          value={smsAutoImport ? t(L, 'settings.smsOn') : undefined}
          onPress={() => goPage('money')}
        />
        <NavRow icon="university" tint="teal" title={t(L, 'settings.paymentMethods')} onPress={props.onBanks} last />
      </Group>

      <Group title={t(L, 'settings.groupPrivacy')}>
        <NavRow icon="lock" tint="slate" title={t(L, 'settings.security')} value={lockLabel} onPress={() => goPage('security')} />
        <NavRow icon="shield" tint="violet" title={t(L, 'privacy')} onPress={() => goPage('privacy')} last />
      </Group>

      <Group>
        <NavRow
          icon="file-text-o"
          tint="slate"
          title={t(L, 'settings.termsOfService')}
          value={props.tosAccepted ? undefined : t(L, 'settings.notAccepted')}
          onPress={props.onTos}
          last={!props.isAdmin}
        />
        {props.isAdmin ? <NavRow icon="wrench" tint="orange" title={t(L, 'admin')} onPress={() => goPage('admin')} last /> : null}
      </Group>

      <Group>
        <NavRow
          icon="sign-out"
          title={t(L, 'signOut')}
          danger
          last
          onPress={() =>
            Alert.alert(t(L, 'signOut'), t(L, 'settings.signOutConfirm'), [
              { text: t(L, 'common.cancel'), style: 'cancel' },
              { text: t(L, 'signOut'), style: 'destructive', onPress: props.onLogout },
            ])
          }
        />
      </Group>
      <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12, textAlign: 'center' }}>Lony {appVersion}</Text>
    </View>
  );
}

/** Share exported JSON via the system share sheet. */
export async function shareExportJSON(payload: unknown) {
  const body = JSON.stringify(payload, null, 2);
  await Share.share({
    message: body.length > 50000 ? body.slice(0, 50000) + '\n…(truncated)' : body,
    title: 'Lony data export',
  });
}

export async function shareExportNote(title: string, message: string) {
  await Share.share({ title, message });
}
