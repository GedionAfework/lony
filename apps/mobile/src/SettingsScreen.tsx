import { useEffect, useState } from 'react';
import { Alert, I18nManager, Pressable, Share, Switch, Text, View } from 'react-native';
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
} from './ui';

type SettingsPage =
  | 'hub'
  | 'profile'
  | 'region'
  | 'payments'
  | 'notifications'
  | 'privacy'
  | 'security'
  | 'extraFactor'
  | 'themes'
  | 'legal'
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

function HubRow({
  title,
  subtitle,
  onPress,
}: {
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        gap: 4,
      }}
    >
      <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>{title}</Text>
      <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>{subtitle}</Text>
    </Pressable>
  );
}

const HOUR_CYCLES = [
  { value: '24h', labelKey: 'settings.hourCycle.24h' },
  { value: '12h', labelKey: 'settings.hourCycle.12h' },
] as const;

export function SettingsScreen(props: Props) {
  const { colors } = useTheme();
  const [page, setPage] = useState<SettingsPage>('hub');
  const [pushLoans, setPushLoans] = useState(true);
  const [pushSplits, setPushSplits] = useState(true);
  const [pushGoals, setPushGoals] = useState(true);
  const [inAppAll, setInAppAll] = useState(true);
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
    return <ScreenHeader title={title} onBack={goHub} />;
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

  if (page === 'region') {
    const localeOpts =
      locales.length > 0
        ? locales.map((l) => ({ id: l.code, label: `${l.name} (${l.code})` }))
        : [{ id: props.locale || 'en', label: props.locale || 'en' }];
    const calendarOpts = CALENDARS;
    const hourOpts = HOUR_CYCLES.map((h) => ({
      id: h.value,
      label: t(props.locale, h.labelKey),
    }));
    const smsHourOpts = Array.from({ length: 24 }, (_, h) => ({
      id: String(h),
      label: `${String(h).padStart(2, '0')}:00`,
    }));
    return (
      <View style={{ gap: space.md }}>
        <Back title={t(props.locale, 'settings.region')} />
        <Card>
          <SearchSelect
            label={t(props.locale, 'settings.language')}
            value={props.locale}
            onChange={(code) => {
              props.onLocale(code);
              // Always flip the active pack immediately — bundled en/fr/am-ET packs
              // already cover every key, so the UI switches even if the API's
              // locale list hasn't loaded yet or is missing this code.
              const pack = locales.find((l) => l.code === code);
              setActivePack(
                pack
                  ? {
                      locale: pack.code,
                      name: pack.name,
                      dir: pack.dir,
                      messages: parseLocaleMessages(pack.messages),
                    }
                  : { locale: code },
              );
              applyNativeDirection(code);
            }}
            options={localeOpts}
          />
          <SearchSelect
            label={t(props.locale, 'settings.calendar')}
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
            options={calendarOpts}
          />
          <SearchSelect
            label={t(props.locale, 'settings.hourCycle')}
            value={props.hourCycle === 'ethiopian_6' ? '24h' : props.hourCycle}
            onChange={props.onHourCycle}
            options={hourOpts}
          />
          <SearchSelect
            label={t(props.locale, 'settings.timezone')}
            value={resolveTimezoneId(props.timezone)}
            onChange={props.onTimezone}
            options={TIMEZONES}
          />
          <SearchSelect
            label={t(props.locale, 'settings.baseCurrency')}
            value={props.currency}
            onChange={props.onCurrency}
            options={CURRENCIES}
          />
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingVertical: 12,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              gap: 12,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontFamily: fonts.ui, fontSize: 15 }}>
                {t(props.locale, 'settings.smsAutoImport')}
              </Text>
            </View>
            <Switch
              value={smsAutoImport}
              onValueChange={(v) => {
                setSmsAutoImport(v);
                void (async () => {
                  if (v) {
                    if (props.onActivateSmsImport) {
                      await props.onActivateSmsImport();
                    } else {
                      await setSmsAutoImportEnabled(true);
                    }
                    await scheduleDailySmsCheckup();
                  } else {
                    await setSmsAutoImportEnabled(false);
                    await cancelDailySmsCheckup();
                  }
                })();
              }}
              trackColor={{ false: colors.borderStrong, true: colors.primarySoft }}
              thumbColor={smsAutoImport ? colors.primary : colors.muted}
            />
          </View>
          {smsAutoImport ? (
            <>
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12, marginTop: 4 }}>
                {t(props.locale, 'settings.smsAutoImportHint')}
              </Text>
              <SearchSelect
                label={t(props.locale, 'settings.smsDailyCheckup')}
                value={smsCheckupHour}
                onChange={(id) => {
                  setSmsCheckupHour(id);
                  void setSmsCheckupTime(Number(id), 0);
                }}
                options={smsHourOpts}
              />
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12, marginBottom: 8 }}>
                {t(props.locale, 'settings.smsDailyCheckupHint')}
              </Text>
            </>
          ) : null}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingVertical: 12,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              gap: 12,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontFamily: fonts.ui, fontSize: 15 }}>
                {t(props.locale, 'settings.loanApproval')}
              </Text>
            </View>
            <Switch
              value={props.loanRequireApproval}
              onValueChange={props.onLoanRequireApproval}
              trackColor={{ false: colors.borderStrong, true: colors.primarySoft }}
              thumbColor={props.loanRequireApproval ? colors.primary : colors.muted}
            />
          </View>
          {I18nManager.isRTL ? (
            <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
              {t(props.locale, 'settings.rtlNotice')}
            </Text>
          ) : null}
          <PrimaryButton
            label={props.busy ? t(props.locale, 'common.loading') : t(props.locale, 'save')}
            onPress={() => {
              void (async () => {
                try {
                  if (props.onSaveRegion) await props.onSaveRegion();
                  else await props.onSave?.();
                  goHub();
                } catch {
                  /* error surfaced by parent */
                }
              })();
            }}
            disabled={props.busy}
          />
        </Card>
      </View>
    );
  }

  if (page === 'profile') {
    return (
      <View style={{ gap: space.md }}>
        <Back title={t(props.locale, 'profile')} />
        {!props.profileComplete ? (
          <Text style={{ color: colors.error, fontFamily: fonts.ui, fontSize: 14 }}>
            {t(props.locale, 'settings.profileIncomplete')}
          </Text>
        ) : null}
        <Card>
          <View style={{ alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <AuthenticatedAvatar
              path={props.avatarUrl}
              localUri={props.avatarLocalUri}
              token={props.token}
              size={96}
              fallbackLetter={props.displayName || props.firstName || '?'}
            />
            <Pressable
              onPress={props.onAvatar}
              disabled={props.busy}
              accessibilityLabel={t(props.locale, 'profile.changePhoto')}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: radii.full,
                backgroundColor: colors.primarySoft,
                borderWidth: 1,
                borderColor: colors.primary,
                opacity: props.busy ? 0.5 : 1,
              }}
            >
              <IconCamera size={16} color={colors.primary} />
              <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 14 }}>
                {props.busy
                  ? t(props.locale, 'profile.uploading')
                  : props.avatarUrl || props.avatarLocalUri
                    ? t(props.locale, 'profile.changePhoto')
                    : t(props.locale, 'profile.addPhoto')}
              </Text>
            </Pressable>
          </View>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 14 }}>{props.email}</Text>
          <Field label={t(props.locale, 'profile.username')} value={props.username} onChange={props.onUsername} />
          <Field label={t(props.locale, 'profile.firstName')} value={props.firstName} onChange={props.onFirstName} />
          <Field label={t(props.locale, 'profile.middleName')} value={props.middleName} onChange={props.onMiddleName} />
          <Field label={t(props.locale, 'profile.lastName')} value={props.lastName} onChange={props.onLastName} />
          <Field label={t(props.locale, 'profile.displayName')} value={props.displayName} onChange={props.onDisplayName} />
          <PhoneField
            value={props.phone}
            country={props.country}
            onCountryChange={props.onCountry}
            onChange={props.onPhone}
          />
          <SearchSelect label={t(props.locale, 'profile.country')} value={props.country} onChange={props.onCountry} options={COUNTRIES} />
          <SectionLabel>{t(props.locale, 'profile.signInPreference')}</SectionLabel>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {(['email', 'google', 'telegram'] as const).map((p) => {
              const active = props.authPref === p;
              return (
                <SecondaryButton key={p} label={p} onPress={() => props.onAuthPref(p)} disabled={active} />
              );
            })}
          </View>
          <PrimaryButton
            label={props.busy ? t(props.locale, 'common.saving') : t(props.locale, 'save')}
            onPress={props.onSave}
            disabled={props.busy || !props.username.trim() || !props.firstName.trim() || !props.lastName.trim()}
          />
        </Card>
      </View>
    );
  }

  if (page === 'payments') {
    return (
      <View style={{ gap: space.md }}>
        <Back title={t(props.locale, 'payments')} />
        <Card>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
            {t(props.locale, 'settings.paymentsHint')}
          </Text>
          <PrimaryButton label={t(props.locale, 'settings.manageBanks')} onPress={props.onBanks} />
        </Card>
      </View>
    );
  }

  if (page === 'notifications') {
    return (
      <View style={{ gap: space.md }}>
        <Back title={t(props.locale, 'notifications')} />
        <Card>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13, marginBottom: 8 }}>
            {t(props.locale, 'settings.notificationsHint')}
          </Text>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingVertical: 12,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              gap: 12,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontFamily: fonts.ui, fontSize: 15 }}>
                {t(props.locale, 'settings.askRecurringReceived')}
              </Text>
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12, marginTop: 2 }}>
                {t(props.locale, 'settings.askRecurringReceivedHint')}
              </Text>
            </View>
            <Switch
              value={props.askRecurringReceived}
              onValueChange={props.onAskRecurringReceived}
              trackColor={{ false: colors.borderStrong, true: colors.primarySoft }}
              thumbColor={props.askRecurringReceived ? colors.primary : colors.muted}
            />
          </View>
          {(
            [
              { label: t(props.locale, 'settings.notifyLoanAlerts'), value: pushLoans, onChange: setPushLoans },
              { label: t(props.locale, 'settings.notifySplits'), value: pushSplits, onChange: setPushSplits },
              { label: t(props.locale, 'settings.notifyGoals'), value: pushGoals, onChange: setPushGoals },
              { label: t(props.locale, 'settings.notifyInbox'), value: inAppAll, onChange: setInAppAll },
            ] as { label: string; value: boolean; onChange: (v: boolean) => void }[]
          ).map(({ label, value, onChange }) => (
            <View
              key={label}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
            >
              <Text style={{ color: colors.text, fontFamily: fonts.ui, fontSize: 15, flex: 1 }}>{label}</Text>
              <Switch
                value={value}
                onValueChange={onChange}
                trackColor={{ false: colors.borderStrong, true: colors.primarySoft }}
                thumbColor={value ? colors.primary : colors.muted}
              />
            </View>
          ))}
        </Card>
      </View>
    );
  }

  if (page === 'privacy') {
    return (
      <View style={{ gap: space.md }}>
        <Back title={t(props.locale, 'privacy')} />
        <Card>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
            {t(props.locale, 'settings.privacyHint')}
          </Text>
          <SecondaryButton
            label={props.busy ? t(props.locale, 'common.working') : t(props.locale, 'settings.exportData')}
            onPress={props.onExportData}
            disabled={props.busy}
          />
          {props.onExportLedger ? (
            <SecondaryButton
              label={props.busy ? t(props.locale, 'common.working') : t(props.locale, 'settings.exportLedger')}
              onPress={props.onExportLedger}
              disabled={props.busy}
            />
          ) : null}
          <SecondaryButton
            label={props.busy ? t(props.locale, 'common.working') : t(props.locale, 'settings.clearAiInsights')}
            onPress={props.onClearAI}
            disabled={props.busy}
          />
          <SecondaryButton label={t(props.locale, 'settings.deleteAccount')} onPress={confirmDelete} disabled={props.busy} />
        </Card>
      </View>
    );
  }

  if (page === 'security') {
    return (
      <View style={{ gap: space.md }}>
        <Back title={t(props.locale, 'settings.security')} />
        <Card>
          <SectionLabel>{t(props.locale, 'settings.appLock')}</SectionLabel>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13, marginBottom: 8 }}>
            {t(props.locale, 'settings.appLockHint')}
          </Text>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingVertical: 12,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              gap: 12,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontFamily: fonts.ui, fontSize: 15 }}>
                {biometricsLabel}
              </Text>
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12, marginTop: 2 }}>
                {t(props.locale, 'settings.biometricsHint')}
              </Text>
            </View>
            <Switch
              value={biometricsLock}
              disabled={biometricsBusy || (!biometricsSupported && !biometricsLock)}
              onValueChange={(v) => {
                void (async () => {
                  setBiometricsBusy(true);
                  try {
                    if (v) {
                      const res = await enableBiometricsLock();
                      if (!res.ok) {
                        Alert.alert('Screen lock', res.error || `Could not enable ${biometricsLabel}`);
                        setBiometricsLock(false);
                        return;
                      }
                      await setBiometricsAsLockMethod();
                      setBiometricsLock(true);
                      setLockMethod('biometrics');
                    } else {
                      const res = await disableBiometricsLock();
                      if (!res.ok) {
                        Alert.alert('Screen lock', res.error || `Could not disable ${biometricsLabel}`);
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
              trackColor={{ false: colors.borderStrong, true: colors.primarySoft }}
              thumbColor={biometricsLock ? colors.primary : colors.muted}
            />
          </View>

          <Pressable
            onPress={() => goPage('extraFactor')}
            style={{
              marginTop: 12,
              paddingVertical: 12,
              borderTopWidth: 1,
              borderTopColor: colors.border,
              gap: 4,
            }}
          >
            <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 15 }}>
              {t(props.locale, 'settings.extraFactor')}
            </Text>
            <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
              {mfaEnabled
                ? t(props.locale, 'settings.extraFactorOn').replace('{method}', mfaKind)
                : t(props.locale, 'settings.extraFactorOff')}
            </Text>
          </Pressable>
          {lockMethod !== 'none' || biometricsLock ? (
            <SecondaryButton
              label={t(props.locale, 'settings.turnOffLock')}
              onPress={() => {
                void (async () => {
                  await clearAppLock();
                  await disableBiometricsLock().catch(() => undefined);
                  setLockMethod('none');
                  setBiometricsLock(false);
                  setMfaEnabled(false);
                })();
              }}
            />
          ) : null}
        </Card>
        <Card>
          <SectionLabel>{t(props.locale, 'settings.accountPassword')}</SectionLabel>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
            {t(props.locale, 'settings.changePasswordHint').replace('{email}', props.email)}
          </Text>
          <Field
            label={t(props.locale, 'settings.currentPassword')}
            value={props.currentPassword ?? ''}
            onChange={props.onCurrentPassword ?? (() => undefined)}
            secure
          />
          <Field
            label={t(props.locale, 'settings.newPassword')}
            value={props.changePasswordNew ?? ''}
            onChange={props.onChangePasswordNew ?? (() => undefined)}
            secure
          />
          <PrimaryButton
            label={props.busy ? t(props.locale, 'common.working') : t(props.locale, 'settings.updatePassword')}
            onPress={props.onChangePassword ?? (() => undefined)}
            disabled={props.busy || !props.onChangePassword}
          />
        </Card>
      </View>
    );
  }

  if (page === 'extraFactor') {
    return (
      <View style={{ gap: space.md }}>
        <Back title={t(props.locale, 'settings.extraFactor')} />
        <Card>
          <SectionLabel>{t(props.locale, 'settings.extraFactor')}</SectionLabel>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13, marginBottom: 8 }}>
            {t(props.locale, 'settings.extraFactorHint')}
          </Text>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingVertical: 12,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              gap: 12,
            }}
          >
            <Text style={{ color: colors.text, fontFamily: fonts.ui, fontSize: 15, flex: 1 }}>
              {t(props.locale, 'settings.extraFactorToggle')}
            </Text>
            <Switch
              value={mfaEnabled}
              onValueChange={(v) => {
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
              trackColor={{ false: colors.borderStrong, true: colors.primarySoft }}
              thumbColor={mfaEnabled ? colors.primary : colors.muted}
            />
          </View>

          {mfaEnabled ? (
            <>
              <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 14, marginTop: 12 }}>
                {t(props.locale, 'settings.chooseMethod')}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 8 }}>
                {(
                  [
                    ['pin', t(props.locale, 'settings.methodPin')],
                    ['pattern', t(props.locale, 'settings.methodPattern')],
                    ['password', t(props.locale, 'settings.methodPassword')],
                  ] as const
                ).map(([id, label]) => (
                  <SecondaryButton
                    key={id}
                    label={label}
                    onPress={() => {
                      setMfaKind(id);
                      setMfaDraft('');
                    }}
                  />
                ))}
              </View>
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12, marginBottom: 8 }}>
                {t(props.locale, 'settings.activeMethod')}: {mfaKind}
              </Text>

              {mfaKind === 'pattern' ? (
                <PatternPad
                  disabled={mfaBusy}
                  onComplete={(key) => {
                    void (async () => {
                      setMfaBusy(true);
                      try {
                        const res = await setAppLockMethod('pattern', key);
                        if (!res.ok) {
                          Alert.alert(t(props.locale, 'settings.extraFactor'), res.error || 'Could not save');
                          return;
                        }
                        await disableBiometricsLock().catch(() => undefined);
                        setBiometricsLock(false);
                        setLockMethod('pattern');
                        setMfaEnabled(true);
                        Alert.alert(
                          t(props.locale, 'settings.extraFactor'),
                          t(props.locale, 'settings.extraFactorSaved'),
                        );
                        goPage('security');
                      } finally {
                        setMfaBusy(false);
                      }
                    })();
                  }}
                />
              ) : (
                <>
                  <Field
                    label={
                      mfaKind === 'pin'
                        ? t(props.locale, 'settings.methodPin')
                        : t(props.locale, 'settings.methodPassword')
                    }
                    value={mfaDraft}
                    onChange={setMfaDraft}
                    secure
                    keyboardType={mfaKind === 'pin' ? 'number-pad' : 'default'}
                    placeholder={mfaKind === 'pin' ? '123456' : '••••••'}
                  />
                  <PrimaryButton
                    label={mfaBusy ? t(props.locale, 'common.loading') : t(props.locale, 'save')}
                    disabled={mfaBusy}
                    onPress={() => {
                      void (async () => {
                        setMfaBusy(true);
                        try {
                          const res = await setAppLockMethod(mfaKind, mfaDraft);
                          if (!res.ok) {
                            Alert.alert(t(props.locale, 'settings.extraFactor'), res.error || 'Could not save');
                            return;
                          }
                          await disableBiometricsLock().catch(() => undefined);
                          setBiometricsLock(false);
                          setLockMethod(mfaKind);
                          setMfaEnabled(true);
                          setMfaDraft('');
                          Alert.alert(
                            t(props.locale, 'settings.extraFactor'),
                            t(props.locale, 'settings.extraFactorSaved'),
                          );
                          goPage('security');
                        } finally {
                          setMfaBusy(false);
                        }
                      })();
                    }}
                  />
                </>
              )}
            </>
          ) : null}
        </Card>
      </View>
    );
  }

  if (page === 'legal') {
    return (
      <View style={{ gap: space.md }}>
        <Back title={t(props.locale, 'legal')} />
        <Card>
          <SecondaryButton label={t(props.locale, 'settings.termsOfService')} onPress={props.onTos} />
          {props.tosAccepted ? (
            <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
              {t(props.locale, 'settings.accepted').replace('{version}', props.tosVersion || '')}
            </Text>
          ) : (
            <Text style={{ color: colors.error, fontFamily: fonts.ui, fontSize: 13 }}>
              {t(props.locale, 'settings.notAccepted')}
            </Text>
          )}
        </Card>
      </View>
    );
  }

  return (
    <View style={{ gap: space.md }}>
      <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>
        {t(props.locale, 'settings')}
      </Text>
      {!props.profileComplete ? (
        <Text style={{ color: colors.error, fontFamily: fonts.ui, fontSize: 14 }}>
          {t(props.locale, 'settings.finishProfile')}
        </Text>
      ) : null}
      {(props.planTier || 'free').toLowerCase() !== 'premium' && !props.isAdmin ? (
        <Card>
          <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 15 }}>
            {t(props.locale, 'settings.freePlan')}
          </Text>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13, marginTop: 4 }}>
            {t(props.locale, 'settings.freePlanHint')}
          </Text>
        </Card>
      ) : (
        <Card>
          <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 15 }}>
            {t(props.locale, 'settings.premium')}
          </Text>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13, marginTop: 4 }}>
            {t(props.locale, 'settings.premiumUnlocked')}
          </Text>
        </Card>
      )}
      <Card>
        <HubRow
          title={t(props.locale, 'profile')}
          subtitle={t(props.locale, 'settings.profileSubtitle')}
          onPress={() => goPage('profile')}
        />
        <HubRow
          title={t(props.locale, 'settings.region')}
          subtitle={t(props.locale, 'settings.regionSubtitle')}
          onPress={() => goPage('region')}
        />
        <HubRow title={t(props.locale, 'themes')} subtitle={t(props.locale, 'settings.themesSubtitle')} onPress={() => goPage('themes')} />
        <HubRow title={t(props.locale, 'payments')} subtitle={t(props.locale, 'settings.paymentsSubtitle')} onPress={() => goPage('payments')} />
        <HubRow title={t(props.locale, 'notifications')} subtitle={t(props.locale, 'settings.notificationsSubtitle')} onPress={() => goPage('notifications')} />
        <HubRow title={t(props.locale, 'privacy')} subtitle={t(props.locale, 'settings.privacySubtitle')} onPress={() => goPage('privacy')} />
        <HubRow
          title={t(props.locale, 'settings.security')}
          subtitle={t(props.locale, 'settings.securitySubtitle')}
          onPress={() => goPage('security')}
        />
        <HubRow title={t(props.locale, 'legal')} subtitle={t(props.locale, 'settings.legalSubtitle')} onPress={() => goPage('legal')} />
        {props.isAdmin ? (
          <HubRow title={t(props.locale, 'admin')} subtitle={t(props.locale, 'settings.adminSubtitle')} onPress={() => goPage('admin')} />
        ) : null}
      </Card>
      <SecondaryButton label={t(props.locale, 'signOut')} onPress={props.onLogout} />
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
