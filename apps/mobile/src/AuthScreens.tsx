import { Image, Pressable, Text, View } from 'react-native';
import { fonts, radii, space, useTheme } from './theme';
import { Card, CheckRow, Field, PrimaryButton } from './ui';
import { IconGoogle, IconTelegram } from './icons';

const logo = require('../assets/lony-logo.png');
export type AuthMode = 'login' | 'register' | 'verify' | 'forgot' | 'reset';

type Props = {
  mode: AuthMode;
  email: string;
  password: string;
  displayName: string;
  code: string;
  newPassword?: string;
  devCode?: string | null;
  busy: boolean;
  acceptedDisclaimer: boolean;
  onEmail: (v: string) => void;
  onPassword: (v: string) => void;
  onDisplayName: (v: string) => void;
  onCode: (v: string) => void;
  onNewPassword?: (v: string) => void;
  onToggleDisclaimer: () => void;
  onLogin: () => void;
  onRegister: () => void;
  onVerify: () => void;
  onResend?: () => void;
  onForgot?: () => void;
  onSendReset?: () => void;
  onResetPassword?: () => void;
  onGoogle: () => void;
  onTelegram: () => void;
  onGoLogin: () => void;
  onGoRegister: () => void;
  onGoForgot?: () => void;
};

export function AuthScreens({
  mode,
  email,
  password,
  displayName,
  code,
  newPassword = '',
  devCode,
  busy,
  acceptedDisclaimer,
  onEmail,
  onPassword,
  onDisplayName,
  onCode,
  onNewPassword,
  onToggleDisclaimer,
  onLogin,
  onRegister,
  onVerify,
  onResend,
  onSendReset,
  onResetPassword,
  onGoogle,
  onTelegram,
  onGoLogin,
  onGoRegister,
  onGoForgot,
}: Props) {
  const { colors } = useTheme();

  return (
    <View style={{ gap: space.md, paddingTop: space.xl }}>
      <View style={{ alignItems: 'center', marginBottom: space.sm }}>
        <Image
          source={logo}
          style={{ width: 112, height: 112, resizeMode: 'contain' }}
          accessibilityLabel="Lony"
        />
      </View>

      {mode === 'login' ? (
        <Card>
          <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 26, letterSpacing: -0.4 }}>
            Sign in
          </Text>
          <Field label="Email" value={email} onChange={onEmail} keyboardType="email-address" />
          <Field label="Password" value={password} onChange={onPassword} secure />
          {onGoForgot ? (
            <Pressable onPress={onGoForgot} hitSlop={8} style={{ alignSelf: 'flex-end', marginTop: -4 }}>
              <Text style={{ color: colors.tertiary, fontFamily: fonts.uiSemi, fontSize: 13 }}>Forgot password?</Text>
            </Pressable>
          ) : null}
          <PrimaryButton label={busy ? 'Signing in…' : 'Sign in'} onPress={onLogin} disabled={busy} />

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 4 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
            <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>or</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 14 }}>
            <OAuthIcon onPress={onGoogle} disabled={busy} label="Google">
              <IconGoogle size={22} color={colors.text} />
            </OAuthIcon>
            <OAuthIcon onPress={onTelegram} disabled={busy} label="Telegram">
              <IconTelegram size={22} color={colors.text} />
            </OAuthIcon>
          </View>

          <Pressable onPress={onGoRegister} hitSlop={8}>
            <Text style={{ color: colors.muted, fontFamily: fonts.ui, textAlign: 'center', paddingTop: 8, fontSize: 14 }}>
              New here? <Text style={{ color: colors.tertiary, fontFamily: fonts.uiSemi }}>Create account</Text>
            </Text>
          </Pressable>
        </Card>
      ) : null}

      {mode === 'register' ? (
        <Card>
          <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 26, letterSpacing: -0.4 }}>
            Create account
          </Text>
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

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 4 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
            <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>or</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 14 }}>
            <OAuthIcon onPress={onGoogle} disabled={busy || !acceptedDisclaimer} label="Google">
              <IconGoogle size={22} color={colors.text} />
            </OAuthIcon>
            <OAuthIcon onPress={onTelegram} disabled={busy || !acceptedDisclaimer} label="Telegram">
              <IconTelegram size={22} color={colors.text} />
            </OAuthIcon>
          </View>

          <Pressable onPress={onGoLogin} hitSlop={8}>
            <Text style={{ color: colors.muted, fontFamily: fonts.ui, textAlign: 'center', paddingTop: 8, fontSize: 14 }}>
              Already have an account? <Text style={{ color: colors.tertiary, fontFamily: fonts.uiSemi }}>Sign in</Text>
            </Text>
          </Pressable>
        </Card>
      ) : null}

      {mode === 'verify' ? (
        <Card>
          <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 24 }}>Verify email</Text>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 14 }}>
            Enter the code sent to {email || 'your email'}.
          </Text>
          {devCode ? (
            <Text style={{ color: colors.secondary, fontFamily: fonts.mono, fontSize: 13 }}>Code: {devCode}</Text>
          ) : null}
          <Field label="Code" value={code} onChange={onCode} keyboardType="number-pad" />
          <PrimaryButton label={busy ? 'Working…' : 'Verify'} onPress={onVerify} disabled={busy} />
          {onResend ? (
            <Pressable onPress={onResend} disabled={busy} hitSlop={8}>
              <Text style={{ color: colors.tertiary, fontFamily: fonts.uiSemi, textAlign: 'center', paddingVertical: 8 }}>
                Resend code
              </Text>
            </Pressable>
          ) : null}
          <Pressable onPress={onGoLogin} hitSlop={8}>
            <Text style={{ color: colors.muted, fontFamily: fonts.ui, textAlign: 'center', paddingVertical: 4 }}>Back</Text>
          </Pressable>
        </Card>
      ) : null}

      {mode === 'forgot' ? (
        <Card>
          <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 24 }}>Forgot password</Text>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 14 }}>
            Enter your email and we’ll send a reset code.
          </Text>
          <Field label="Email" value={email} onChange={onEmail} keyboardType="email-address" />
          <PrimaryButton label={busy ? 'Sending…' : 'Send code'} onPress={onSendReset ?? (() => undefined)} disabled={busy} />
          <Pressable onPress={onGoLogin} hitSlop={8}>
            <Text style={{ color: colors.tertiary, fontFamily: fonts.uiSemi, textAlign: 'center', paddingVertical: 8 }}>
              Back to sign in
            </Text>
          </Pressable>
        </Card>
      ) : null}

      {mode === 'reset' ? (
        <Card>
          <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 24 }}>Reset password</Text>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 14 }}>
            Enter the code sent to {email || 'your email'}.
          </Text>
          {devCode ? (
            <Text style={{ color: colors.secondary, fontFamily: fonts.mono, fontSize: 13 }}>Code: {devCode}</Text>
          ) : null}
          <Field label="Code" value={code} onChange={onCode} keyboardType="number-pad" />
          <Field label="New password" value={newPassword} onChange={onNewPassword ?? (() => undefined)} secure />
          <PrimaryButton
            label={busy ? 'Updating…' : 'Update password'}
            onPress={onResetPassword ?? (() => undefined)}
            disabled={busy}
          />
          <Pressable onPress={onGoLogin} hitSlop={8}>
            <Text style={{ color: colors.tertiary, fontFamily: fonts.uiSemi, textAlign: 'center', paddingVertical: 8 }}>
              Back to sign in
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
