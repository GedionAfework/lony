import { useState } from 'react';
import { Alert, Image, Pressable, Share, Switch, Text, View } from 'react-native';
import { AdminScreen } from './AdminScreen';
import { COUNTRIES, CURRENCIES, LOCALES, TIMEZONES } from './catalogs';
import { t } from './i18n';
import { IconCamera } from './icons';
import { PhoneField } from './PhoneField';
import { SearchSelect } from './SearchSelect';
import { ThemesScreen } from './ThemesScreen';
import { fonts, mediaURL, radii, space, useTheme } from './theme';
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
  | 'payments'
  | 'notifications'
  | 'privacy'
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
  authPref: 'email' | 'google' | 'telegram';
  profileComplete: boolean;
  tosAccepted: boolean;
  tosVersion?: string | null;
  isAdmin?: boolean;
  planTier?: string;
  token?: string;
  avatarUrl?: string | null;
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
  onAuthPref: (v: 'email' | 'google' | 'telegram') => void;
  onSave: () => void;
  onAvatar: () => void;
  onTos: () => void;
  onBanks: () => void;
  onExportData: () => void;
  onExportLedger?: () => void;
  onDeleteAccount: () => void;
  onClearAI: () => void;
  onLogout: () => void;
  onSettingsPageChange?: (detail: boolean) => void;
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

export function SettingsScreen(props: Props) {
  const { colors } = useTheme();
  const [page, setPage] = useState<SettingsPage>('hub');
  const [pushLoans, setPushLoans] = useState(true);
  const [pushSplits, setPushSplits] = useState(true);
  const [pushGoals, setPushGoals] = useState(true);
  const [inAppAll, setInAppAll] = useState(true);

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

  if (page === 'profile') {
    return (
      <View style={{ gap: space.md }}>
        <Back title="Profile" />
        {!props.profileComplete ? (
          <Text style={{ color: colors.error, fontFamily: fonts.ui, fontSize: 14 }}>
            Finish your account details to use Lony fully.
          </Text>
        ) : null}
        <Card>
          <View style={{ alignItems: 'center', gap: 12, marginBottom: 8 }}>
            {(() => {
              const uri = mediaURL(props.avatarUrl);
              return uri ? (
                <Image
                  source={{
                    uri,
                    headers: props.token ? { Authorization: `Bearer ${props.token}` } : undefined,
                  }}
                  style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: colors.surfaceMuted }}
                />
              ) : (
                <View
                  style={{
                    width: 96,
                    height: 96,
                    borderRadius: 48,
                    backgroundColor: colors.surfaceMuted,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: colors.muted, fontFamily: fonts.uiSemi, fontSize: 28 }}>
                    {(props.displayName || props.firstName || '?').slice(0, 1).toUpperCase()}
                  </Text>
                </View>
              );
            })()}
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
                {props.busy ? 'Uploading…' : props.avatarUrl ? 'Change photo' : 'Add photo'}
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
          <SearchSelect label="Currency" value={props.currency} onChange={props.onCurrency} options={CURRENCIES} />
          <SearchSelect label="Locale" value={props.locale} onChange={props.onLocale} options={LOCALES} />
          <SearchSelect label="Timezone" value={props.timezone} onChange={props.onTimezone} options={TIMEZONES} />
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
            label={props.busy ? 'Saving…' : 'Save'}
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
        <Back title="Payments" />
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
        <Back title="Notifications" />
        <Card>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13, marginBottom: 8 }}>
            Choose what you want to hear about. Device push still requires a registered token.
          </Text>
          {(
            [
              ['Loan & repayment alerts', pushLoans, setPushLoans],
              ['Expense splits', pushSplits, setPushSplits],
              ['Goal reminders', pushGoals, setPushGoals],
              ['In-app inbox', inAppAll, setInAppAll],
            ] as const
          ).map(([label, value, setter]) => (
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
                onValueChange={setter}
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
        <Back title="Data & privacy" />
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

  if (page === 'legal') {
    return (
      <View style={{ gap: space.md }}>
        <Back title="Legal" />
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
        <HubRow title={t(props.locale, 'profile')} subtitle="Photo, name, locale, sign-in preference" onPress={() => goPage('profile')} />
        <HubRow title={t(props.locale, 'themes')} subtitle="Built-in looks and custom colors" onPress={() => goPage('themes')} />
        <HubRow title={t(props.locale, 'payments')} subtitle="Banks & wallets for getting paid" onPress={() => goPage('payments')} />
        <HubRow title={t(props.locale, 'notifications')} subtitle="Loans, splits, and goals" onPress={() => goPage('notifications')} />
        <HubRow title={t(props.locale, 'privacy')} subtitle="Export, clear AI, delete account" onPress={() => goPage('privacy')} />
        <HubRow title={t(props.locale, 'legal')} subtitle="Terms of Service" onPress={() => goPage('legal')} />
        {props.isAdmin ? (
          <HubRow title={t(props.locale, 'admin')} subtitle="Platform KPIs and AI kill switch" onPress={() => goPage('admin')} />
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
