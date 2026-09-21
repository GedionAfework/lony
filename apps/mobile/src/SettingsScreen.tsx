import { Text, View } from 'react-native';
import { COUNTRIES, CURRENCIES } from './catalogs';
import { PhoneField } from './PhoneField';
import { SearchSelect } from './SearchSelect';
import { fonts, space, useTheme } from './theme';
import {
  Card,
  Field,
  PrimaryButton,
  ScreenHeader,
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
  onLogout: () => void;
  onBack: () => void;
};

export function SettingsScreen(props: Props) {
  const { colors } = useTheme();

  return (
    <View style={{ gap: space.md }}>
      <ScreenHeader title="Settings" onBack={props.onBack} />
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
        <SectionLabel>Sign-in preference</SectionLabel>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {(['email', 'google', 'telegram'] as const).map((p) => {
            const active = props.authPref === p;
            return (
              <SecondaryButton key={p} label={p} onPress={() => props.onAuthPref(p)} disabled={active} />
            );
          })}
        </View>
        <Field label="Locale" value={props.locale} onChange={props.onLocale} />
        <Field label="Timezone" value={props.timezone} onChange={props.onTimezone} />
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
          Push and in-app alerts for loans, repayments, and friend requests.
        </Text>
      </Card>

      <Card>
        <SectionLabel>Data</SectionLabel>
        <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
          Download your data — coming soon.
        </Text>
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
