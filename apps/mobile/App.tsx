import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api, type User } from './src/api';
import { colors } from './src/theme';

const ACCESS_KEY = 'equilend.access_token';
const REFRESH_KEY = 'equilend.refresh_token';

type Screen = 'login' | 'register' | 'verify' | 'home';

export default function App() {
  const [screen, setScreen] = useState<Screen>('login');
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | undefined>();

  useEffect(() => {
    (async () => {
      try {
        const token = await SecureStore.getItemAsync(ACCESS_KEY);
        if (!token) {
          return;
        }
        const me = await api.me(token);
        setUser(me.user);
        setScreen('home');
      } catch {
        await SecureStore.deleteItemAsync(ACCESS_KEY);
        await SecureStore.deleteItemAsync(REFRESH_KEY);
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  async function persistTokens(access: string, refresh: string, nextUser: User) {
    await SecureStore.setItemAsync(ACCESS_KEY, access);
    await SecureStore.setItemAsync(REFRESH_KEY, refresh);
    setUser(nextUser);
    setScreen('home');
  }

  async function onRegister() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.register(email.trim(), password, displayName.trim());
      setDevCode(res.verification_code);
      setScreen('verify');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  }

  async function onVerify() {
    setBusy(true);
    setError(null);
    try {
      await api.verify(email.trim(), code.trim());
      const tokens = await api.login(email.trim(), password);
      await persistTokens(tokens.access_token, tokens.refresh_token, tokens.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed');
    } finally {
      setBusy(false);
    }
  }

  async function onLogin() {
    setBusy(true);
    setError(null);
    try {
      const tokens = await api.login(email.trim(), password);
      await persistTokens(tokens.access_token, tokens.refresh_token, tokens.user);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Sign in failed';
      setError(message);
      if (message.toLowerCase().includes('verify')) {
        setScreen('verify');
      }
    } finally {
      setBusy(false);
    }
  }

  async function onLogout() {
    const token = await SecureStore.getItemAsync(ACCESS_KEY);
    if (token) {
      try {
        await api.logout(token);
      } catch {
        // still clear local session
      }
    }
    await SecureStore.deleteItemAsync(ACCESS_KEY);
    await SecureStore.deleteItemAsync(REFRESH_KEY);
    setUser(null);
    setPassword('');
    setScreen('login');
  }

  if (booting) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.brand}>EquiLend</Text>
          <Text style={styles.kicker}>LEDGER</Text>
          <Text style={styles.subtitle}>Shared loan records and reminders. Not a bank.</Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {screen === 'home' && user ? (
            <View style={styles.card}>
              <Text style={styles.label}>Signed in</Text>
              <Text style={styles.hero}>{user.display_name}</Text>
              <Text style={styles.muted}>{user.email}</Text>
              <Pressable style={styles.secondaryButton} onPress={onLogout}>
                <Text style={styles.secondaryButtonText}>Sign out</Text>
              </Pressable>
            </View>
          ) : null}

          {screen === 'register' ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Create account</Text>
              <Field label="Display name" value={displayName} onChange={setDisplayName} />
              <Field label="Email" value={email} onChange={setEmail} keyboardType="email-address" />
              <Field label="Password" value={password} onChange={setPassword} secure />
              <Pressable style={styles.button} onPress={onRegister} disabled={busy}>
                <Text style={styles.buttonText}>{busy ? 'Working…' : 'Register'}</Text>
              </Pressable>
              <Pressable onPress={() => setScreen('login')}>
                <Text style={styles.link}>Already have an account? Sign in</Text>
              </Pressable>
            </View>
          ) : null}

          {screen === 'login' ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Sign in</Text>
              <Field label="Email" value={email} onChange={setEmail} keyboardType="email-address" />
              <Field label="Password" value={password} onChange={setPassword} secure />
              <Pressable style={styles.button} onPress={onLogin} disabled={busy}>
                <Text style={styles.buttonText}>{busy ? 'Working…' : 'Sign in'}</Text>
              </Pressable>
              <Pressable onPress={() => setScreen('register')}>
                <Text style={styles.link}>New here? Create an account</Text>
              </Pressable>
            </View>
          ) : null}

          {screen === 'verify' ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Verify email</Text>
              <Text style={styles.muted}>
                Enter the 6-digit code for {email || 'your account'}.
              </Text>
              {devCode ? <Text style={styles.dev}>Dev code: {devCode}</Text> : null}
              <Field label="Code" value={code} onChange={setCode} keyboardType="number-pad" />
              <Pressable style={styles.button} onPress={onVerify} disabled={busy}>
                <Text style={styles.buttonText}>{busy ? 'Working…' : 'Verify and continue'}</Text>
              </Pressable>
              <Pressable onPress={() => setScreen('login')}>
                <Text style={styles.link}>Back to sign in</Text>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({
  label,
  value,
  onChange,
  secure,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  secure?: boolean;
  keyboardType?: 'email-address' | 'number-pad' | 'default';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        secureTextEntry={secure}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboardType ?? 'default'}
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { padding: 16, paddingTop: 48, gap: 16 },
  brand: { color: colors.text, fontSize: 28, fontWeight: '700' },
  kicker: { color: colors.primary, fontSize: 10, letterSpacing: 3, fontWeight: '600' },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 20, marginBottom: 8 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.outline,
  },
  cardTitle: { color: colors.text, fontSize: 20, fontWeight: '600' },
  hero: { color: colors.primary, fontSize: 24, fontWeight: '700' },
  field: { gap: 6 },
  label: { color: colors.muted, fontSize: 12, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  input: {
    backgroundColor: colors.surfaceLowest,
    color: colors.text,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 14,
    fontSize: 16,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 16 },
  secondaryButton: {
    backgroundColor: colors.surfaceHigh,
    borderRadius: 12,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { color: colors.text, fontWeight: '600' },
  link: { color: colors.tertiary, textAlign: 'center', paddingVertical: 8 },
  muted: { color: colors.muted, fontSize: 14 },
  error: { color: colors.error, fontSize: 14 },
  dev: { color: colors.secondary, fontSize: 13, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
});
