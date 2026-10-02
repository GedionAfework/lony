import { useEffect, useState } from 'react';
import { Alert, I18nManager, Pressable, Share, Switch, Text, View } from 'react-native';
import { AdminScreen } from './AdminScreen';
import { AuthenticatedAvatar } from './AuthenticatedAvatar';
import { api, type AppCalendar, type AppLocale } from './api';
import { COUNTRIES, CURRENCIES, CALENDARS, TIMEZONES, resolveTimezoneId } from './catalogs';
import { getSmsAutoImportEnabled, setSmsAutoImportEnabled } from './smsAutoIngest';
import {
  disableBiometricsLock,
  enableBiometricsLock,
  getBiometricsAvailability,
  getBiometricsLockEnabled,
} from './biometricsLock';
import { applyNativeDirection, parseLocaleMessages, setActivePack, t } from './i18n';
import { IconCamera } from './icons';
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
  onSave: () => void;
  onSaveRegion?: () => void;
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
  const [biometricsLock, setBiometricsLock] = useState(false);
  const [biometricsLabel, setBiometricsLabel] = useState('Biometrics');
  const [biometricsSupported, setBiometricsSupported] = useState(false);
  const [biometricsBusy, setBiometricsBusy] = useState(false);
  const [locales, setLocales] = useState<AppLocale[]>([]);
  const [calendars, setCalendars] = useState<AppCalendar[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const on = await getSmsAutoImportEnabled();
      if (!cancelled) setSmsAutoImport(on);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [enabled, avail] = await Promise.all([getBiometricsLockEnabled(), getBiometricsAvailability()]);
      if (cancelled) return;
      setBiometricsLock(enabled);
      setBiometricsLabel(avail.label);
      setBiometricsSupported(avail.available && avail.enrolled);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
        // offline: keep bundled English
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      'Delete account?',
      'This permanently disables your login and redacts your profile. Loan history for counterparties is kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            Alert.alert('Confirm deletion', 'Your account will be deleted immediately.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete forever', style: 'destructive', onPress: props.onDeleteAccount },
            ]);
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
    return (
      <View style={{ gap: space.md }}>
        <Back title="Preferences" />
        <Card>
          <SearchSelect
            label={t(props.locale, 'settings.language')}
            value={props.locale}
            onChange={(code) => {
              props.onLocale(code);
              const pack = locales.find((l) => l.code === code);
              if (pack) {
                setActivePack({
                  locale: pack.code,
                  name: pack.name,
                  dir: pack.dir,
                  messages: parseLocaleMessages(pack.messages),
                });
                applyNativeDirection(pack.code);
              }
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
                  } else {
                    await setSmsAutoImportEnabled(false);
                  }
                })();
              }}
              trackColor={{ false: colors.borderStrong, true: colors.primarySoft }}
              thumbColor={smsAutoImport ? colors.primary : colors.muted}
            />
          </View>
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
                {t(props.locale, 'settings.biometricsLock')}
              </Text>
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12, marginTop: 2 }}>
                {t(props.locale, 'settings.biometricsLockHint') ||
                  `Require ${biometricsLabel} when opening Lony`}
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
                      setBiometricsLock(true);
                    } else {
                      const res = await disableBiometricsLock();
                      if (!res.ok) {
                        Alert.alert('Screen lock', res.error || `Could not disable ${biometricsLabel}`);
                        setBiometricsLock(true);
                        return;
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
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingVertical: 12,
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
              RTL layout is active. Reload the app if the layout looks mirrored incorrectly.
            </Text>
          ) : null}
          <PrimaryButton
            label={props.busy ? 'Saving…' : t(props.locale, 'save')}
            onPress={props.onSaveRegion ?? props.onSave}
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
            Finish your account details to use Lony fully.
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
              accessibilityLabel="Change photo"
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
                {props.busy ? 'Uploading…' : props.avatarUrl || props.avatarLocalUri ? 'Change photo' : 'Add photo'}
              </Text>
            </Pressable>
          </View>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 14 }}>{props.email}</Text>
          <Field label="Username" value={props.username} onChange={props.onUsername} />
          <Field label="First name" value={props.firstName} onChange={props.onFirstName} />
          <Field label="Middle name" value={props.middleName} onChange={props.onMiddleName} />
          <Field label="Last name" value={props.lastName} onChange={props.onLastName} />
          <Field label="Display name" value={props.displayName} onChange={props.onDisplayName} />
          <PhoneField
            value={props.phone}
            country={props.country}
            onCountryChange={props.onCountry}
            onChange={props.onPhone}
          />
          <SearchSelect label="Country" value={props.country} onChange={props.onCountry} options={COUNTRIES} />
          <SectionLabel>Sign-in preference</SectionLabel>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {(['email', 'google', 'telegram'] as const).map((p) => {
              const active = props.authPref === p;
              return (
                <SecondaryButton key={p} label={p} onPress={() => props.onAuthPref(p)} disabled={active} />
              );
            })}
          </View>
          <PrimaryButton
            label={props.busy ? 'Saving…' : t(props.locale, 'save')}
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
            Banks and wallets used when sharing how to get paid on loans.
          </Text>
          <PrimaryButton label="Manage banks & wallets" onPress={props.onBanks} />
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
            Choose what you want to hear about. Device push still requires a registered token.
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
                Ask received for recurring payments
              </Text>
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12, marginTop: 2 }}>
                When on, we’ll ask if you got today’s recurring income (or paid a bill). Turn off to auto-apply the amount.
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
              { label: 'Loan & repayment alerts', value: pushLoans, onChange: setPushLoans },
              { label: 'Expense splits', value: pushSplits, onChange: setPushSplits },
              { label: 'Goal reminders', value: pushGoals, onChange: setPushGoals },
              { label: 'In-app inbox', value: inAppAll, onChange: setInAppAll },
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
            Download a copy of your Lony data, clear AI insight history, or delete your account.
          </Text>
          <SecondaryButton
            label={props.busy ? 'Working…' : 'Export my data'}
            onPress={props.onExportData}
            disabled={props.busy}
          />
          {props.onExportLedger ? (
            <SecondaryButton
              label={props.busy ? 'Working…' : 'Export ledger CSV'}
              onPress={props.onExportLedger}
              disabled={props.busy}
            />
          ) : null}
          <SecondaryButton
            label={props.busy ? 'Working…' : 'Clear AI insights'}
            onPress={props.onClearAI}
            disabled={props.busy}
          />
          <SecondaryButton label="Delete account" onPress={confirmDelete} disabled={props.busy} />
        </Card>
      </View>
    );
  }

  if (page === 'security') {
    return (
      <View style={{ gap: space.md }}>
        <Back title={t(props.locale, 'settings.security')} />
        <Card>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
            Change the password for {props.email}.
          </Text>
          <Field
            label="Current password"
            value={props.currentPassword ?? ''}
            onChange={props.onCurrentPassword ?? (() => undefined)}
            secure
          />
          <Field
            label="New password"
            value={props.changePasswordNew ?? ''}
            onChange={props.onChangePasswordNew ?? (() => undefined)}
            secure
          />
          <PrimaryButton
            label={props.busy ? 'Working…' : 'Update password'}
            onPress={props.onChangePassword ?? (() => undefined)}
            disabled={props.busy || !props.onChangePassword}
          />
        </Card>
      </View>
    );
  }

  if (page === 'legal') {
    return (
      <View style={{ gap: space.md }}>
        <Back title={t(props.locale, 'legal')} />
        <Card>
          <SecondaryButton label="Terms of Service" onPress={props.onTos} />
          {props.tosAccepted ? (
            <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
              Accepted · {props.tosVersion}
            </Text>
          ) : (
            <Text style={{ color: colors.error, fontFamily: fonts.ui, fontSize: 13 }}>Terms not accepted yet</Text>
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
          Finish your profile to use Lony fully.
        </Text>
      ) : null}
      {(props.planTier || 'free').toLowerCase() !== 'premium' && !props.isAdmin ? (
        <Card>
          <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 15 }}>Free plan</Text>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13, marginTop: 4 }}>
            Insights AI (Analysis, Reports, Coach) requires Premium. Ask an admin to upgrade your account.
          </Text>
        </Card>
      ) : (
        <Card>
          <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 15 }}>Premium</Text>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13, marginTop: 4 }}>
            AI personas are unlocked for this account.
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
          title="Preferences"
          subtitle={t(props.locale, 'settings.regionSubtitle')}
          onPress={() => goPage('region')}
        />
        <HubRow title={t(props.locale, 'themes')} subtitle={t(props.locale, 'settings.themesSubtitle')} onPress={() => goPage('themes')} />
        <HubRow title={t(props.locale, 'payments')} subtitle={t(props.locale, 'settings.paymentsSubtitle')} onPress={() => goPage('payments')} />
        <HubRow title={t(props.locale, 'notifications')} subtitle={t(props.locale, 'settings.notificationsSubtitle')} onPress={() => goPage('notifications')} />
        <HubRow
          title="Preferences"
          subtitle="Recurring income prompts and related options"
          onPress={() => goPage('notifications')}
        />
        <HubRow title={t(props.locale, 'privacy')} subtitle={t(props.locale, 'settings.privacySubtitle')} onPress={() => goPage('privacy')} />
        <HubRow title={t(props.locale, 'settings.security')} subtitle={t(props.locale, 'settings.securitySubtitle')} onPress={() => goPage('security')} />
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
