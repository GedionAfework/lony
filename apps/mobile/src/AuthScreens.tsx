import { Pressable, Text, View } from 'react-native';
import { fonts, radii, space, useTheme } from './theme';
import { BrandMark, Card, CheckRow, Field, PrimaryButton } from './ui';
import { IconGoogle, IconTelegram } from './icons';

type Mode = 'login' | 'register' | 'verify';

type Props = {
  mode: Mode;
  email: string;
  password: string;
  displayName: string;
  code: string;
  devCode?: string | null;
  busy: boolean;
  acceptedDisclaimer: boolean;
  onEmail: (v: string) => void;
  onPassword: (v: string) => void;
  onDisplayName: (v: string) => void;
  onCode: (v: string) => void;
  onToggleDisclaimer: () => void;
  onLogin: () => void;
  onRegister: () => void;
  onVerify: () => void;
  onGoogle: () => void;
  onTelegram: () => void;
  onGoLogin: () => void;
  onGoRegister: () => void;
};

export function AuthScreens({
  mode,
  email,
  password,
  displayName,
  code,
  devCode,
  busy,
  acceptedDisclaimer,
  onEmail,
  onPassword,
  onDisplayName,
  onCode,
  onToggleDisclaimer,
  onLogin,
  onRegister,
  onVerify,
  onGoogle,
  onTelegram,
  onGoLogin,
  onGoRegister,
}: Props) {
  const { colors } = useTheme();

  return (
    <View style={{ gap: space.lg, paddingTop: space.md }}>
      <View style={{ alignItems: 'center', gap: space.md }}>
        <BrandMark hero />
      </View>

      {mode === 'login' ? (
        <Card>
          <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>Sign in</Text>
          <Field label="Email" value={email} onChange={onEmail} keyboardType="email-address" />
          <Field label="Password" value={password} onChange={onPassword} secure />
          <PrimaryButton label={busy ? 'Working…' : 'Sign in'} onPress={onLogin} disabled={busy} />
          <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 4 }} />
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16 }}>
            <OAuthIcon onPress={onGoogle} disabled={busy || !acceptedDisclaimer} label="Google">
              <IconGoogle size={22} color={colors.text} />
            </OAuthIcon>
            <OAuthIcon onPress={onTelegram} disabled={busy || !acceptedDisclaimer} label="Telegram">
              <IconTelegram size={22} color={colors.text} />
            </OAuthIcon>
          </View>
          <CheckRow
            checked={acceptedDisclaimer}
            label="I accept the product disclaimer"
            onPress={onToggleDisclaimer}
          />
          <Pressable onPress={onGoRegister}>
            <Text style={{ color: colors.tertiary, fontFamily: fonts.uiSemi, textAlign: 'center', paddingVertical: 8 }}>
              Create account
            </Text>
          </Pressable>
        </Card>
      ) : null}

      {mode === 'register' ? (
        <Card>
          <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>Create account</Text>
          <Field label="Display name" value={displayName} onChange={onDisplayName} />
          <Field label="Email" value={email} onChange={onEmail} keyboardType="email-address" />
          <Field label="Password" value={password} onChange={onPassword} secure />
          <CheckRow
            checked={acceptedDisclaimer}
            label="I understand Lony is a shared ledger, not a bank"
            onPress={onToggleDisclaimer}
          />
          <PrimaryButton
            label={busy ? 'Working…' : 'Continue'}
            onPress={onRegister}
            disabled={busy || !acceptedDisclaimer}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 4 }}>
            <OAuthIcon onPress={onGoogle} disabled={busy || !acceptedDisclaimer} label="Google">
              <IconGoogle size={22} color={colors.text} />
            </OAuthIcon>
            <OAuthIcon onPress={onTelegram} disabled={busy || !acceptedDisclaimer} label="Telegram">
              <IconTelegram size={22} color={colors.text} />
            </OAuthIcon>
          </View>
          <Pressable onPress={onGoLogin}>
            <Text style={{ color: colors.tertiary, fontFamily: fonts.uiSemi, textAlign: 'center', paddingVertical: 8 }}>
              Sign in
            </Text>
          </Pressable>
        </Card>
      ) : null}

      {mode === 'verify' ? (
        <Card>
          <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>Verify email</Text>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 14 }}>
            Enter the code sent to {email || 'your email'}.
          </Text>
          {devCode ? (
            <Text style={{ color: colors.secondary, fontFamily: fonts.mono, fontSize: 13 }}>Code: {devCode}</Text>
          ) : null}
          <Field label="Code" value={code} onChange={onCode} keyboardType="number-pad" />
          <PrimaryButton label={busy ? 'Working…' : 'Verify'} onPress={onVerify} disabled={busy} />
          <Pressable onPress={onGoLogin}>
            <Text style={{ color: colors.tertiary, fontFamily: fonts.uiSemi, textAlign: 'center', paddingVertical: 8 }}>
              Back
            </Text>
          </Pressable>
        </Card>
      ) : null}
    </View>
  );
}

function OAuthIcon({
  children,
  onPress,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  label: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        width: 52,
        height: 52,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.surfaceMuted,
        borderWidth: 1,
        borderColor: colors.border,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {children}
    </Pressable>
  );
}
