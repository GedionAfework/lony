import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useEffect, useRef, useState, type ComponentProps, type ReactNode, type RefObject } from 'react';
import { ActivityIndicator, Image, Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';
import { PhoneField } from './PhoneField';
import { passwordHint } from './errors';
import { IconGoogle, IconTelegram } from './icons';
import { fonts, radii, space, useTheme } from './theme';
import { CheckRow } from './ui';

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

const noop = () => undefined;

export function AuthScreens(p: Props) {
  const { colors } = useTheme();
  const { mode } = p;
  const showSwitch = mode === 'login' || mode === 'register';

  return (
    <View style={{ gap: space.lg, paddingTop: space.md }}>
      <Brand compact={!showSwitch} />

      {showSwitch ? (
        <ModeSwitch mode={mode} onLogin={p.onGoLogin} onRegister={p.onGoRegister} disabled={p.busy} />
      ) : null}

      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: radii.xl,
          padding: space.lg,
          gap: space.md,
          borderWidth: 1,
          borderColor: colors.border,
          shadowColor: '#0F172A',
          shadowOpacity: 0.06,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 8 },
          elevation: 2,
        }}
      >
        {mode === 'login' ? <SignIn {...p} /> : null}
        {mode === 'register' ? <Register {...p} /> : null}
        {mode === 'verify' ? <Verify {...p} /> : null}
        {mode === 'forgot' ? <Forgot {...p} /> : null}
        {mode === 'reset' ? <Reset {...p} /> : null}
      </View>

      <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 11, textAlign: 'center', paddingHorizontal: space.lg }}>
        Lony is a shared ledger and reminders. It never holds or moves your money.
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------- screens

function SignIn(p: Props) {
  const { colors } = useTheme();
  const passwordRef = useRef<TextInput>(null);
  const canSubmit = p.email.trim().length > 3 && p.password.length > 0 && !p.busy;
  return (
    <>
      <Heading title="Welcome back" subtitle="Sign in to see your money and loans." />
      <AuthInput
        icon="envelope-o"
        label="Email"
        value={p.email}
        onChangeText={p.onEmail}
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
      />
      <AuthInput
        inputRef={passwordRef}
        icon="lock"
        label="Password"
        value={p.password}
        onChangeText={p.onPassword}
        secret
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={() => canSubmit && p.onLogin()}
      />
      {p.onGoForgot ? (
        <Pressable onPress={p.onGoForgot} hitSlop={10} style={{ alignSelf: 'flex-end', marginTop: -6 }}>
          <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 13 }}>Forgot password?</Text>
        </Pressable>
      ) : null}
      <AuthButton label="Sign in" busyLabel="Signing in" busy={p.busy} disabled={!canSubmit} onPress={p.onLogin} />
      <Divider />
      <SocialButton label="Continue with Google" onPress={p.onGoogle} disabled={p.busy}>
        <IconGoogle size={18} color={colors.text} />
      </SocialButton>
      <SocialButton label="Continue with Telegram" onPress={p.onTelegram} disabled={p.busy}>
        <IconTelegram size={18} color={colors.text} />
      </SocialButton>
    </>
  );
}

function Register(p: Props) {
  const { colors } = useTheme();
  const lastRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);
  const confirm = p.confirmPassword ?? '';
  const hint = passwordHint(p.password);
  const mismatch = confirm.length > 0 && p.password !== confirm;
  const matches = confirm.length > 0 && p.password === confirm;
  const canSubmit =
    !p.busy && p.acceptedDisclaimer && !hint && matches && p.email.trim().length > 3 && Boolean((p.firstName ?? '').trim());

  return (
    <>
      <Heading title="Create your account" subtitle="It takes a minute. We'll email you a code to confirm." />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <AuthInput
            icon="user-o"
            label="First name"
            value={p.firstName ?? ''}
            onChangeText={p.onFirstName ?? noop}
            autoCapitalize="words"
            autoComplete="given-name"
            textContentType="givenName"
            returnKeyType="next"
            onSubmitEditing={() => lastRef.current?.focus()}
          />
        </View>
        <View style={{ flex: 1 }}>
          <AuthInput
            inputRef={lastRef}
            label="Last name"
            value={p.lastName ?? ''}
            onChangeText={p.onLastName ?? noop}
            autoCapitalize="words"
            autoComplete="family-name"
            textContentType="familyName"
            returnKeyType="next"
            onSubmitEditing={() => emailRef.current?.focus()}
          />
        </View>
      </View>
      <AuthInput
        inputRef={emailRef}
        icon="envelope-o"
        label="Email"
        value={p.email}
        onChangeText={p.onEmail}
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
      />
      {p.onPhone && p.onPhoneCountry ? (
        <PhoneField value={p.phone ?? ''} country={p.phoneCountry ?? 'US'} onCountryChange={p.onPhoneCountry} onChange={p.onPhone} />
      ) : (
        <AuthInput icon="id-badge" label="Display name" value={p.displayName} onChangeText={p.onDisplayName} />
      )}
      <View style={{ gap: 6 }}>
        <AuthInput
          inputRef={passwordRef}
          icon="lock"
          label="Password"
          value={p.password}
          onChangeText={p.onPassword}
          secret
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="next"
          onSubmitEditing={() => confirmRef.current?.focus()}
        />
        {p.password ? <Strength password={p.password} hint={hint} /> : null}
      </View>
      <AuthInput
        inputRef={confirmRef}
        icon="lock"
        label="Confirm password"
        value={confirm}
        onChangeText={p.onConfirmPassword ?? noop}
        secret
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="done"
        error={mismatch ? 'Passwords do not match.' : undefined}
        ok={matches}
      />
      <CheckRow
        checked={p.acceptedDisclaimer}
        label="I understand Lony is a shared ledger, not a bank or payment processor"
        onPress={p.onToggleDisclaimer}
      />
      <AuthButton label="Create account" busyLabel="Creating account" busy={p.busy} disabled={!canSubmit} onPress={p.onRegister} />
      <Divider />
      <SocialButton label="Sign up with Google" onPress={p.onGoogle} disabled={p.busy}>
        <IconGoogle size={18} color={colors.text} />
      </SocialButton>
    </>
  );
}

function Verify(p: Props) {
  const { colors } = useTheme();
  const [cooldown, setCooldown] = useCooldown();
  return (
    <>
      <BackLink onPress={p.onGoLogin} />
      <Heading
        title="Check your email"
        subtitle={`Enter the 6-digit code we sent to ${p.email || 'your email'}.`}
        icon="envelope-open-o"
      />
      {p.devCode ? <DevCode code={p.devCode} /> : null}
      <OtpInput value={p.code} onChange={p.onCode} autoFocus />
      <AuthButton
        label="Verify email"
        busyLabel="Checking"
        busy={p.busy}
        disabled={p.busy || p.code.replace(/\D/g, '').length < 6}
        onPress={p.onVerify}
      />
      {p.onResend ? (
        <Pressable
          onPress={() => {
            p.onResend?.();
            setCooldown(30);
          }}
          disabled={p.busy || cooldown > 0}
          hitSlop={10}
          style={{ alignSelf: 'center' }}
        >
          <Text style={{ color: cooldown > 0 ? colors.muted : colors.primary, fontFamily: fonts.uiSemi, fontSize: 14 }}>
            {cooldown > 0 ? `Resend code in ${cooldown}s` : "Didn't get it? Resend code"}
          </Text>
        </Pressable>
      ) : null}
    </>
  );
}

function Forgot(p: Props) {
  return (
    <>
      <BackLink onPress={p.onGoLogin} />
      <Heading title="Reset your password" subtitle="Enter your email and we'll send you a code." icon="key" />
      <AuthInput
        icon="envelope-o"
        label="Email"
        value={p.email}
        onChangeText={p.onEmail}
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="send"
        onSubmitEditing={() => p.onSendReset?.()}
        autoFocus
      />
      <AuthButton
        label="Send code"
        busyLabel="Sending"
        busy={p.busy}
        disabled={p.busy || p.email.trim().length < 4}
        onPress={p.onSendReset ?? noop}
      />
    </>
  );
}

function Reset(p: Props) {
  const newPassword = p.newPassword ?? '';
  const hint = newPassword ? passwordHint(newPassword) : null;
  return (
    <>
      <BackLink onPress={p.onGoLogin} />
      <Heading title="Choose a new password" subtitle="Enter the code from your email, then your new password." icon="shield" />
      {p.devCode ? <DevCode code={p.devCode} /> : null}
      <OtpInput value={p.code} onChange={p.onCode} autoFocus />
      <View style={{ gap: 6 }}>
        <AuthInput
          icon="lock"
          label="New password"
          value={newPassword}
          onChangeText={p.onNewPassword ?? noop}
          secret
          autoComplete="new-password"
          textContentType="newPassword"
        />
        {newPassword ? <Strength password={newPassword} hint={hint} /> : null}
      </View>
      <AuthButton
        label="Update password"
        busyLabel="Saving"
        busy={p.busy}
        disabled={p.busy || p.code.replace(/\D/g, '').length < 6 || !newPassword || Boolean(hint)}
        onPress={p.onResetPassword ?? noop}
      />
    </>
  );
}

// ---------------------------------------------------------------- pieces

function Brand({ compact }: { compact: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: 6 }}>
      <View
        style={{
          width: compact ? 64 : 84,
          height: compact ? 64 : 84,
          borderRadius: compact ? 20 : 26,
          backgroundColor: colors.primarySoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Image source={logo} style={{ width: compact ? 46 : 62, height: compact ? 46 : 62, resizeMode: 'contain' }} accessibilityLabel="Lony" />
      </View>
      {!compact ? (
        <>
          <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 28, letterSpacing: -0.6 }}>Lony</Text>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 14, textAlign: 'center' }}>
            Your money, budgets and loans in one place.
          </Text>
        </>
      ) : null}
    </View>
  );
}

function ModeSwitch({ mode, onLogin, onRegister, disabled }: { mode: AuthMode; onLogin: () => void; onRegister: () => void; disabled: boolean }) {
  const { colors } = useTheme();
  const tab = (label: string, active: boolean, onPress: () => void) => (
    <Pressable
      onPress={onPress}
      disabled={disabled || active}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={{
        flex: 1,
        paddingVertical: 11,
        borderRadius: radii.full,
        alignItems: 'center',
        backgroundColor: active ? colors.surface : 'transparent',
        shadowColor: '#0F172A',
        shadowOpacity: active ? 0.08 : 0,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
        elevation: active ? 2 : 0,
      }}
    >
      <Text style={{ color: active ? colors.text : colors.muted, fontFamily: active ? fonts.uiBold : fonts.uiSemi, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', backgroundColor: colors.surfaceMuted, borderRadius: radii.full, padding: 4 }}>
      {tab('Sign in', mode === 'login', onLogin)}
      {tab('Create account', mode === 'register', onRegister)}
    </View>
  );
}

function Heading({ title, subtitle, icon }: { title: string; subtitle?: string; icon?: ComponentProps<typeof FontAwesome>['name'] }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {icon ? (
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 16,
            backgroundColor: colors.primarySoft,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 4,
          }}
        >
          <FontAwesome name={icon} size={20} color={colors.primary} />
        </View>
      ) : null}
      <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 24, letterSpacing: -0.4 }}>{title}</Text>
      {subtitle ? <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 14, lineHeight: 20 }}>{subtitle}</Text> : null}
    </View>
  );
}

type AuthInputProps = Omit<TextInputProps, 'style' | 'secureTextEntry'> & {
  label: string;
  icon?: ComponentProps<typeof FontAwesome>['name'];
  secret?: boolean;
  error?: string;
  ok?: boolean;
  inputRef?: RefObject<TextInput | null>;
};

function AuthInput({ label, icon, secret, error, ok, inputRef, ...input }: AuthInputProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const [shown, setShown] = useState(false);
  const borderColor = error ? colors.error : focused ? colors.primary : colors.border;
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 13 }}>{label}</Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          minHeight: 52,
          paddingHorizontal: 14,
          borderRadius: radii.md,
          borderWidth: focused || error ? 1.5 : 1,
          borderColor,
          backgroundColor: focused ? colors.surface : colors.surfaceMuted,
        }}
      >
        {icon ? <FontAwesome name={icon} size={16} color={focused ? colors.primary : colors.muted} /> : null}
        <TextInput
          ref={inputRef}
          {...input}
          accessibilityLabel={label}
          secureTextEntry={secret && !shown}
          autoCapitalize={input.autoCapitalize ?? 'none'}
          autoCorrect={false}
          placeholderTextColor={colors.muted}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          style={{ flex: 1, color: colors.text, fontFamily: fonts.uiMedium, fontSize: 16, paddingVertical: 12 }}
        />
        {ok ? <FontAwesome name="check-circle" size={18} color={colors.success} /> : null}
        {secret ? (
          <Pressable onPress={() => setShown((v) => !v)} hitSlop={10} accessibilityLabel={shown ? 'Hide password' : 'Show password'}>
            <FontAwesome name={shown ? 'eye-slash' : 'eye'} size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={{ color: colors.error, fontFamily: fonts.ui, fontSize: 12 }}>{error}</Text> : null}
    </View>
  );
}

/** Four bars: length, mixed case, a number, a symbol. The hint names what is missing. */
function Strength({ password, hint }: { password: string; hint: string | null }) {
  const { colors } = useTheme();
  const score = [
    password.length >= 8,
    /[a-z]/.test(password) && /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;
  const tone = score <= 1 ? colors.error : score === 2 ? colors.warning : colors.success;
  const label = hint || (score >= 4 ? 'Strong password' : score === 3 ? 'Good password' : 'Add more variety');
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i < score ? tone : colors.border }} />
        ))}
      </View>
      <Text style={{ color: hint ? colors.warning : colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

/** Six code boxes over one hidden field, so paste and SMS autofill still work. */
function OtpInput({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const { colors } = useTheme();
  const ref = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const digits = value.replace(/\D/g, '').slice(0, 6);
  return (
    <Pressable onPress={() => ref.current?.focus()} accessibilityLabel="Verification code">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const active = focused && i === Math.min(digits.length, 5);
          return (
            <View
              key={i}
              style={{
                flex: 1,
                aspectRatio: 0.86,
                maxHeight: 60,
                borderRadius: radii.md,
                borderWidth: active ? 2 : 1,
                borderColor: active ? colors.primary : digits[i] ? colors.text : colors.border,
                backgroundColor: digits[i] ? colors.surface : colors.surfaceMuted,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: colors.text, fontFamily: fonts.monoSemi, fontSize: 22 }}>{digits[i] ?? ''}</Text>
            </View>
          );
        })}
      </View>
      <TextInput
        ref={ref}
        value={digits}
        onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={6}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        caretHidden
        style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
      />
    </Pressable>
  );
}

function AuthButton({ label, busyLabel, busy, disabled, onPress }: { label: string; busyLabel: string; busy: boolean; disabled: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
      style={({ pressed }) => ({
        minHeight: 54,
        borderRadius: radii.md,
        backgroundColor: colors.primary,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 10,
        opacity: disabled && !busy ? 0.45 : pressed ? 0.85 : 1,
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}
    >
      {busy ? <ActivityIndicator color={colors.onPrimary} /> : null}
      <Text style={{ color: colors.onPrimary, fontFamily: fonts.uiBold, fontSize: 16 }}>{busy ? `${busyLabel}…` : label}</Text>
    </Pressable>
  );
}

function SocialButton({ label, onPress, disabled, children }: { label: string; onPress: () => void; disabled: boolean; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => ({
        minHeight: 50,
        borderRadius: radii.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        opacity: disabled ? 0.5 : 1,
      })}
    >
      {children}
      <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

function Divider() {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
      <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>or</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
    </View>
  );
}

function BackLink({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityLabel="Back to sign in" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' }}>
      <FontAwesome name="arrow-left" size={14} color={colors.muted} />
      <Text style={{ color: colors.muted, fontFamily: fonts.uiSemi, fontSize: 13 }}>Back to sign in</Text>
    </Pressable>
  );
}

function DevCode({ code }: { code: string }) {
  const { colors } = useTheme();
  return (
    <Text style={{ color: colors.secondary, fontFamily: fonts.mono, fontSize: 13 }}>Development code: {code}</Text>
  );
}

function useCooldown(): [number, (s: number) => void] {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, setLeft];
}
