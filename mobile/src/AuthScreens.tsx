import { Image, Pressable, Text, View } from 'react-native';
import { PhoneField } from './PhoneField';
import { passwordHint } from './errors';
import { IconGoogle, IconTelegram } from './icons';
import { fonts, space, useTheme } from './theme';
import { Card, CheckRow, Field, PrimaryButton } from './ui';

const logo = require('../assets/lony-logo.png');
export type AuthMode = 'login' | 'register' | 'verify' | 'forgot' | 'reset';

type Props = {
  mode: AuthMode;
  email: string;
  password: string;
  confirmPassword?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  phoneCountry?: string;
  displayName: string;
  code: string;
  newPassword?: string;
  devCode?: string | null;
  busy: boolean;
  acceptedDisclaimer: boolean;
  onEmail: (v: string) => void;
  onPassword: (v: string) => void;
  onConfirmPassword?: (v: string) => void;
  onFirstName?: (v: string) => void;
  onLastName?: (v: string) => void;
  onPhone?: (v: string) => void;
  onPhoneCountry?: (v: string) => void;
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
  confirmPassword = '',
  firstName = '',
  lastName = '',
  phone = '',
  phoneCountry = 'ET',
  displayName,
  code,
  newPassword = '',
  devCode,
  busy,
  acceptedDisclaimer,
  onEmail,
  onPassword,
  onConfirmPassword,
  onFirstName,
  onLastName,
  onPhone,
  onPhoneCountry,
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
  const pwdHint = mode === 'register' ? passwordHint(password) : null;
  const confirmMismatch =
    mode === 'register' && confirmPassword.length > 0 && password !== confirmPassword;

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
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13, marginBottom: 4 }}>
            Use your real name and a strong password. You’ll verify your email next.
          </Text>
          <Field label="First name" value={firstName} onChange={onFirstName ?? (() => undefined)} />
          <Field label="Last name" value={lastName} onChange={onLastName ?? (() => undefined)} />
          <Field label="Email" value={email} onChange={onEmail} keyboardType="email-address" />
          {onPhone && onPhoneCountry ? (
            <PhoneField value={phone} country={phoneCountry} onCountryChange={onPhoneCountry} onChange={onPhone} />
          ) : (
            <Field label="Display name" value={displayName} onChange={onDisplayName} />
          )}
          <Field label="Password" value={password} onChange={onPassword} secure />
          {pwdHint ? (
            <Text style={{ color: colors.warning, fontFamily: fonts.ui, fontSize: 12, marginTop: -4 }}>{pwdHint}</Text>
          ) : null}
          <Field
            label="Confirm password"
            value={confirmPassword}
            onChange={onConfirmPassword ?? (() => undefined)}
            secure
          />
          {confirmMismatch ? (
            <Text style={{ color: colors.error, fontFamily: fonts.ui, fontSize: 12, marginTop: -4 }}>
              Passwords do not match.
            </Text>
          ) : null}
          <CheckRow
            checked={acceptedDisclaimer}
            label="I understand Lony is a shared ledger, not a bank or payment processor"
            onPress={onToggleDisclaimer}
          />
          <PrimaryButton
            label={busy ? 'Working…' : 'Continue'}
            onPress={onRegister}
            disabled={busy || !acceptedDisclaimer || Boolean(pwdHint) || confirmMismatch}
          />

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
            Enter the 6-digit code sent to {email || 'your email'}.
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
            Enter the code from your email and choose a new password.
          </Text>
          {devCode ? (
            <Text style={{ color: colors.secondary, fontFamily: fonts.mono, fontSize: 13 }}>Code: {devCode}</Text>
          ) : null}
          <Field label="Code" value={code} onChange={onCode} keyboardType="number-pad" />
          <Field label="New password" value={newPassword} onChange={onNewPassword ?? (() => undefined)} secure />
          <PrimaryButton
            label={busy ? 'Saving…' : 'Update password'}
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
      accessibilityLabel={label}
      style={{
        width: 52,
        height: 52,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surfaceMuted,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </Pressable>
  );
}
