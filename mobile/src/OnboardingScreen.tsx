import { Text, View } from 'react-native';
import { COUNTRIES, CURRENCIES } from './catalogs';
import { PhoneField } from './PhoneField';
import { SearchSelect } from './SearchSelect';
import { fonts, space, useTheme } from './theme';
import { Card, CheckRow, Field, PrimaryButton, ScreenHeader, SecondaryButton, SectionLabel } from './ui';

type Props = {
  username: string;
  firstName: string;
  lastName: string;
  phone: string;
  country: string;
  currency: string;
  tosAccepted: boolean;
  busy: boolean;
  onUsername: (v: string) => void;
  onFirstName: (v: string) => void;
  onLastName: (v: string) => void;
  onPhone: (v: string) => void;
  onCountry: (v: string) => void;
  onCurrency: (v: string) => void;
  onToggleTos: () => void;
  onSave: () => void;
  onOpenTos: () => void;
};

export function OnboardingScreen({
  username,
  firstName,
  lastName,
  phone,
  country,
  currency,
  tosAccepted,
  busy,
  onUsername,
  onFirstName,
  onLastName,
  onPhone,
  onCountry,
  onCurrency,
  onToggleTos,
  onSave,
  onOpenTos,
}: Props) {
  const { colors } = useTheme();
  const canSave =
    username.trim() &&
    firstName.trim() &&
    lastName.trim() &&
    country.length === 2 &&
    currency.length === 3 &&
    tosAccepted;

  return (
    <View style={{ gap: space.md }}>
      <ScreenHeader title="Finish setup" />
      <Card>
        <SectionLabel>Identity</SectionLabel>
        <Field label="Username" value={username} onChange={onUsername} placeholder="unique handle" />
        <Field label="First name" value={firstName} onChange={onFirstName} />
        <Field label="Last name" value={lastName} onChange={onLastName} />
        <PhoneField value={phone} country={country} onCountryChange={onCountry} onChange={onPhone} />
        <SectionLabel>Locale</SectionLabel>
        <SearchSelect label="Country" value={country} onChange={onCountry} options={COUNTRIES} placeholder="Select country" />
        <SearchSelect label="Currency" value={currency} onChange={onCurrency} options={CURRENCIES} placeholder="Select currency" />
        <CheckRow checked={tosAccepted} label="I accept the Terms of Service" onPress={onToggleTos} />
        <SecondaryButton label="Read Terms" onPress={onOpenTos} />
        <PrimaryButton label={busy ? 'Saving…' : 'Continue'} onPress={onSave} disabled={busy || !canSave} />
      </Card>
    </View>
  );
}
