import { Alert, Share, Text, View } from 'react-native';
import { COUNTRIES, CURRENCIES, LOCALES, TIMEZONES } from './catalogs';
import { PhoneField } from './PhoneField';
import { SearchSelect } from './SearchSelect';
import { fonts, space, useTheme } from './theme';
import {
  Card,
  Field,
  PrimaryButton,
  SecondaryButton,
  SectionLabel,
  ThemeToggle,
} from './ui';

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

export function SettingsScreen(props: Props) {
  const { colors } = useTheme();

  function confirmDelete() {
    Alert.alert(
      'Delete account?',
      'This permanently disables your login and redacts your profile. Loan history for counterparties is kept. Type confirm on the next step.',
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

  return (
    <View style={{ gap: space.md }}>
      <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>Settings</Text>
      {!props.profileComplete ? (
        <Text style={{ color: colors.error, fontFamily: fonts.ui, fontSize: 14 }}>
          Finish your account details to use Lony fully.
        </Text>
      ) : null}

      <Card>
        <SectionLabel>Profile</SectionLabel>
        <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 14 }}>{props.email}</Text>
        <SecondaryButton label={props.busy ? 'Uploading…' : 'Change photo'} onPress={props.onAvatar} disabled={props.busy} />
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

      <Card>
        <SectionLabel>Payment profiles</SectionLabel>
        <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
          Banks and wallets used when sharing how to get paid.
        </Text>
        <SecondaryButton label="Manage banks & wallets" onPress={props.onBanks} />
      </Card>

      <Card>
        <SectionLabel>Notifications</SectionLabel>
        <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
          Push and in-app alerts for loans, repayments, and splits.
        </Text>
      </Card>

      <Card>
        <SectionLabel>Data & privacy</SectionLabel>
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
        <SecondaryButton
          label="Delete account"
          onPress={confirmDelete}
          disabled={props.busy}
        />
      </Card>

      <Card>
        <SectionLabel>Appearance</SectionLabel>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: colors.text, fontFamily: fonts.ui, fontSize: 15 }}>Theme</Text>
          <ThemeToggle />
        </View>
      </Card>

      <Card>
        <SectionLabel>Legal</SectionLabel>
        <SecondaryButton label="Terms of Service" onPress={props.onTos} />
        {props.tosAccepted ? (
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
            Accepted · {props.tosVersion}
          </Text>
        ) : (
          <Text style={{ color: colors.error, fontFamily: fonts.ui, fontSize: 13 }}>Terms not accepted yet</Text>
        )}
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
