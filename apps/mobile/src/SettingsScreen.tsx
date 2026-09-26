import { useState } from 'react';
import { Alert, Pressable, Share, Switch, Text, View } from 'react-native';
import { COUNTRIES, CURRENCIES, LOCALES, TIMEZONES } from './catalogs';
import { PhoneField } from './PhoneField';
import { SearchSelect } from './SearchSelect';
import { ThemesScreen } from './ThemesScreen';
import { fonts, space, useTheme } from './theme';
import {
  Card,
  Field,
  PrimaryButton,
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
  | 'legal';

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

  function Back({ label = 'Settings' }: { label?: string }) {
    return (
      <Pressable onPress={() => setPage('hub')}>
        <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 14 }}>← {label}</Text>
      </Pressable>
    );
  }

  if (page === 'themes') {
    return <ThemesScreen onBack={() => setPage('hub')} />;
  }

  if (page === 'profile') {
    return (
      <View style={{ gap: space.md }}>
        <Back />
        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>Profile</Text>
        {!props.profileComplete ? (
          <Text style={{ color: colors.error, fontFamily: fonts.ui, fontSize: 14 }}>
            Finish your account details to use Lony fully.
          </Text>
        ) : null}
        <Card>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 14 }}>{props.email}</Text>
          <SecondaryButton
            label={props.busy ? 'Uploading…' : 'Change photo'}
            onPress={props.onAvatar}
            disabled={props.busy}
          />
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
        <Back />
        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>Payments</Text>
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
        <Back />
        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>Notifications</Text>
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
        <Back />
        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>Data & privacy</Text>
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
        <Back />
        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>Legal</Text>
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
      <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>Settings</Text>
      {!props.profileComplete ? (
        <Text style={{ color: colors.error, fontFamily: fonts.ui, fontSize: 14 }}>
          Finish your profile to use Lony fully.
        </Text>
      ) : null}
      <Card>
        <HubRow title="Profile" subtitle="Photo, name, locale, sign-in preference" onPress={() => setPage('profile')} />
        <HubRow title="Themes" subtitle="Built-in looks and custom colors" onPress={() => setPage('themes')} />
        <HubRow title="Payments" subtitle="Banks & wallets for getting paid" onPress={() => setPage('payments')} />
        <HubRow title="Notifications" subtitle="Loans, splits, and goals" onPress={() => setPage('notifications')} />
        <HubRow title="Data & privacy" subtitle="Export, clear AI, delete account" onPress={() => setPage('privacy')} />
        <HubRow title="Legal" subtitle="Terms of Service" onPress={() => setPage('legal')} />
      </Card>
      <SecondaryButton label="Sign out" onPress={props.onLogout} />
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
