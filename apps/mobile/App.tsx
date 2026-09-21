import { StatusBar } from 'expo-status-bar';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import {
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
  useFonts as useMono,
} from '@expo-google-fonts/jetbrains-mono';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  useFonts as useManrope,
} from '@expo-google-fonts/manrope';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { api, DISCLAIMER, type AppNotification, type BankProfile, type BankProfileShare, type Dashboard, type Friendship, type Loan, type Repayment, type SearchHit, type User } from './src/api';
import { BottomNav, type TabId } from './src/BottomNav';
import { ChatScreen } from './src/ChatScreen';
import { DashboardHome } from './src/DashboardHome';
import {
  idTokenFromGoogleResponse,
  openTelegramLogin,
  parseTelegramDeepLink,
  useGoogleIdTokenAuth,
} from './src/oauth';
import { TermsScreen } from './src/TermsScreen';
import { ThemeProvider, useTheme } from './src/theme';
import { BrandMark, Card, CheckRow, EmptyState, Field, Money, PrimaryButton, ScreenHeader, SecondaryButton, SectionLabel, StatusPill, ThemeToggle, useAppStyles } from './src/ui';

const ACCESS_KEY = 'lony.access_token';
const REFRESH_KEY = 'lony.refresh_token';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending acceptance',
  active: 'Active',
  overdue: 'Overdue',
  repayment_pending: 'Repayment pending confirmation',
  completed: 'Completed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replaceAll('_', ' ');
}

function formatMoney(amount: string | null | undefined, currency: string | null | undefined, locale = 'en'): string {
  if (!amount) {
    return '';
  }
  const n = Number(amount);
  if (Number.isFinite(n)) {
    try {
      return new Intl.NumberFormat(locale, {
        style: currency ? 'currency' : 'decimal',
        currency: currency || undefined,
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      }).format(n);
    } catch {
      /* fall through */
    }
  }
  return currency ? `${amount} ${currency}` : amount;
}

type Screen = 'login' | 'register' | 'verify' | 'home' | 'new-loan' | 'loan' | 'banks' | 'activity' | 'chats' | 'profile' | 'tos';

export default function App() {
  const [manropeLoaded] = useManrope({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
  });
  const [monoLoaded] = useMono({
    JetBrainsMono_500Medium,
    JetBrainsMono_600SemiBold,
  });
  const fontsReady = manropeLoaded && monoLoaded;

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppShell fontsReady={fontsReady} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function AppShell({ fontsReady }: { fontsReady: boolean }) {
  const styles = useAppStyles();
  const { colors, resolved } = useTheme();
  const googleAuth = useGoogleIdTokenAuth();

  const [screen, setScreen] = useState<Screen>('login');
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [friends, setFriends] = useState<Friendship[]>([]);
  const [incoming, setIncoming] = useState<Friendship[]>([]);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [query, setQuery] = useState('');
  const [loans, setLoans] = useState<Loan[]>([]);
  const [selectedLoan, setSelectedLoan] = useState<Loan | null>(null);
  const [loanFriendId, setLoanFriendId] = useState<string>('');
  const [loanRole, setLoanRole] = useState<'borrower' | 'lender'>('borrower');
  const [principal, setPrincipal] = useState('1000');
  const [interest, setInterest] = useState('5');
  const [currency, setCurrency] = useState('ETB');
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [dashCurrency, setDashCurrency] = useState('ETB');
  const [loanFilter, setLoanFilter] = useState('');
  const [bankProfiles, setBankProfiles] = useState<BankProfile[]>([]);
  const [outgoingShares, setOutgoingShares] = useState<BankProfileShare[]>([]);
  const [incomingShares, setIncomingShares] = useState<BankProfileShare[]>([]);
  const [paymentProfile, setPaymentProfile] = useState<BankProfile | null>(null);
  const [revealedNumber, setRevealedNumber] = useState<string | null>(null);
  const [bankLabel, setBankLabel] = useState('CBE checking');
  const [bankType, setBankType] = useState('bank_account');
  const [bankInstitution, setBankInstitution] = useState('');
  const [bankIdentifier, setBankIdentifier] = useState('');
  const [shareFriendId, setShareFriendId] = useState('');
  const [repayments, setRepayments] = useState<Repayment[]>([]);
  const [rejectReason, setRejectReason] = useState('');
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [profileName, setProfileName] = useState('');
  const [profileUsername, setProfileUsername] = useState('');
  const [profileFirstName, setProfileFirstName] = useState('');
  const [profileMiddleName, setProfileMiddleName] = useState('');
  const [profileLastName, setProfileLastName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileCountry, setProfileCountry] = useState('ET');
  const [profileAuthPref, setProfileAuthPref] = useState<'email' | 'google' | 'telegram'>('email');
  const [profileLocale, setProfileLocale] = useState('en');
  const [paymentRails, setPaymentRails] = useState<import('./src/api').PaymentRail[]>([]);
  const [selectedRail, setSelectedRail] = useState('');
  const [bankCountry, setBankCountry] = useState('ET');
  const [bankRailCode, setBankRailCode] = useState('');
  const [profileCurrency, setProfileCurrency] = useState('ETB');
  const [profileTimezone, setProfileTimezone] = useState('Africa/Addis_Ababa');
  const [chatLoanId, setChatLoanId] = useState<string | null>(null);
  const [editingBankId, setEditingBankId] = useState<string | null>(null);
  const [editBankLabel, setEditBankLabel] = useState('');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | undefined>();
  const [acceptedDisclaimer, setAcceptedDisclaimer] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const access = await SecureStore.getItemAsync(ACCESS_KEY);
        const refresh = await SecureStore.getItemAsync(REFRESH_KEY);
        if (!access && !refresh) {
          return;
        }
        try {
          if (access) {
            const me = await api.me(access);
            setToken(access);
            setUser(me.user);
            setProfileName(me.user.display_name);
            setProfileUsername(me.user.username ?? '');
            setProfileLocale(me.user.locale || 'en');
            setProfileCurrency(me.user.default_currency_code || 'ETB');
            setProfileTimezone(me.user.timezone || 'Africa/Addis_Ababa');
            setScreen('home');
            registerDevDeviceToken(access).catch(() => undefined);
            return;
          }
        } catch {
          /* try refresh */
        }
        if (refresh) {
          const tokens = await api.refresh(refresh);
          await SecureStore.setItemAsync(ACCESS_KEY, tokens.access_token);
          await SecureStore.setItemAsync(REFRESH_KEY, tokens.refresh_token);
          setToken(tokens.access_token);
          setUser(tokens.user);
          setProfileName(tokens.user.display_name);
          setProfileUsername(tokens.user.username ?? '');
          setProfileLocale(tokens.user.locale || 'en');
          setProfileCurrency(tokens.user.default_currency_code || 'ETB');
          setProfileTimezone(tokens.user.timezone || 'Africa/Addis_Ababa');
          setScreen('home');
          registerDevDeviceToken(tokens.access_token).catch(() => undefined);
          return;
        }
        await SecureStore.deleteItemAsync(ACCESS_KEY);
        await SecureStore.deleteItemAsync(REFRESH_KEY);
      } catch {
        await SecureStore.deleteItemAsync(ACCESS_KEY);
        await SecureStore.deleteItemAsync(REFRESH_KEY);
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  useEffect(() => {
    const handleUrl = (url: string | null) => {
      if (!url || !url.includes('oauth/telegram')) {
        return;
      }
      const fields = parseTelegramDeepLink(url);
      if (!fields) {
        return;
      }
      if (!acceptedDisclaimer) {
        setAcceptedDisclaimer(true);
      }
      setBusy(true);
      setError(null);
      completeTelegramAuth(fields)
        .catch((e) => setError(e instanceof Error ? e.message : 'Telegram sign-in failed'))
        .finally(() => setBusy(false));
    };
    Linking.getInitialURL().then(handleUrl).catch(() => undefined);
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => sub.remove();
  }, [acceptedDisclaimer]);

  async function persistTokens(access: string, refresh: string, nextUser: User) {
    await SecureStore.setItemAsync(ACCESS_KEY, access);
    await SecureStore.setItemAsync(REFRESH_KEY, refresh);
    setToken(access);
    setUser(nextUser);
    setProfileName(nextUser.display_name);
    setProfileUsername(nextUser.username ?? '');
    setProfileLocale(nextUser.locale || 'en');
    setProfileCurrency(nextUser.default_currency_code || 'ETB');
    setProfileTimezone(nextUser.timezone || 'Africa/Addis_Ababa');
    setScreen('home');
    registerDevDeviceToken(access).catch(() => undefined);
  }

  async function registerDevDeviceToken(access: string) {
    // Remote push was removed from Expo Go (SDK 53+). In-app inbox still works.
    // Push tokens need a development/production build (eas build).
    if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
      return;
    }
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        return;
      }
      const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
      const push = projectId
        ? await Notifications.getExpoPushTokenAsync({ projectId })
        : await Notifications.getExpoPushTokenAsync();
      if (!push.data.startsWith('ExponentPushToken[') && !push.data.startsWith('ExpoPushToken[')) {
        return;
      }
      await api.registerDeviceToken(access, Platform.OS === 'ios' ? 'ios' : 'android', push.data);
    } catch {
      /* Skip when push is unavailable; worker should not get fake tokens. */
    }
  }

  async function onRegister() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.register(email.trim(), password, displayName.trim(), acceptedDisclaimer);
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
    setToken(null);
    setFriends([]);
    setIncoming([]);
    setHits([]);
    setLoans([]);
    setDashboard(null);
    setLoanFilter('');
    setSelectedLoan(null);
    setRepayments([]);
    setNotifications([]);
    setUnreadCount(0);
    setPassword('');
    setScreen('login');
  }

  async function refreshFriends(access = token) {
    if (!access) {
      return;
    }
    const [friendRes, incomingRes, loanRes, dashRes, bankRes, shareRes, inShareRes, notifyRes] = await Promise.all([
      api.listFriends(access),
      api.listIncoming(access),
      api.listLoans(access, loanFilter ? { currency: dashCurrency, filter: loanFilter } : {}),
      api.dashboard(access),
      api.listBankProfiles(access),
      api.listBankShares(access, false),
      api.listBankShares(access, true),
      api.listNotifications(access),
    ]);
    setFriends(friendRes.friends ?? []);
    setIncoming(incomingRes.requests ?? []);
    setLoans(loanRes.loans ?? []);
    setDashboard(dashRes.dashboard);
    setBankProfiles(bankRes.bank_profiles ?? []);
    setOutgoingShares(shareRes.shares ?? []);
    setIncomingShares(inShareRes.shares ?? []);
    setNotifications(notifyRes.notifications ?? []);
    setUnreadCount(notifyRes.unread_count ?? 0);
  }

  async function applyLoanFilter(filter: string) {
    if (!token) {
      return;
    }
    const next = loanFilter === filter ? '' : filter;
    setLoanFilter(next);
    setBusy(true);
    try {
      const res = await api.listLoans(token, next ? { currency: dashCurrency, filter: next } : {});
      setLoans(res.loans ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load loans');
    } finally {
      setBusy(false);
    }
  }

  async function onDashCurrency(code: string) {
    setDashCurrency(code);
    if (!token) {
      return;
    }
    try {
      const res = await api.listLoans(token, loanFilter ? { currency: code, filter: loanFilter } : {});
      setLoans(res.loans ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load loans');
    }
  }

  useEffect(() => {
    if (screen === 'home' && token) {
      refreshFriends(token).catch((e) => {
        setError(e instanceof Error ? e.message : 'Could not load friends');
      });
    }
  }, [screen, token]);

  async function onSearch() {
    if (!token) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.searchUsers(token, query.trim());
      setHits(res.users);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setBusy(false);
    }
  }

  async function onAdd(hit: SearchHit) {
    if (!token) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.sendRequest(token, { user_id: hit.id });
      setHits([]);
      setQuery('');
      await refreshFriends();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send request');
    } finally {
      setBusy(false);
    }
  }

  async function onAccept(id: string) {
    if (!token) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.acceptRequest(token, id);
      await refreshFriends();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not accept');
    } finally {
      setBusy(false);
    }
  }

  async function onReject(id: string) {
    if (!token) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.rejectRequest(token, id);
      await refreshFriends();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reject');
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(id: string) {
    if (!token) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.removeFriend(token, id);
      await refreshFriends();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove');
    } finally {
      setBusy(false);
    }
  }

  async function onBlock(peerId: string) {
    if (!token) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.blockUser(token, peerId);
      await refreshFriends();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not block');
    } finally {
      setBusy(false);
    }
  }

  async function onSaveProfile() {
    if (!token) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.patchMe(token, {
        display_name: profileName.trim() || `${profileFirstName} ${profileLastName}`.trim(),
        username: profileUsername.trim(),
        first_name: profileFirstName.trim(),
        middle_name: profileMiddleName.trim() || undefined,
        last_name: profileLastName.trim(),
        phone_e164: profilePhone.trim() || undefined,
        country_code: profileCountry.trim().toUpperCase(),
        preferred_auth_provider: profileAuthPref,
        locale: profileLocale.trim() || 'en',
        timezone: profileTimezone.trim() || 'Africa/Addis_Ababa',
        default_currency_code: profileCurrency.trim().toUpperCase() || 'ETB',
      });
      setUser(res.user);
      setProfileUsername(res.user.username ?? '');
      setProfileFirstName(res.user.first_name ?? '');
      setProfileMiddleName(res.user.middle_name ?? '');
      setProfileLastName(res.user.last_name ?? '');
      setProfilePhone(res.user.phone_e164 ?? '');
      setProfileCountry(res.user.country_code ?? 'ET');
      setProfileAuthPref((res.user.preferred_auth_provider as 'email' | 'google' | 'telegram') || 'email');
      setDashCurrency(res.user.default_currency_code || dashCurrency);
      setScreen('home');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update profile');
    } finally {
      setBusy(false);
    }
  }

  async function onPickAvatar() {
    if (!token) {
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      base64: true,
    });
    if (picked.canceled || !picked.assets?.[0]?.base64) {
      return;
    }
    const asset = picked.assets[0];
    setBusy(true);
    setError(null);
    try {
      const res = await api.uploadAvatar(token, {
        filename: asset.fileName ?? 'avatar.jpg',
        mime: asset.mimeType ?? 'image/jpeg',
        attachment_base64: asset.base64!,
      });
      setUser(res.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload photo');
    } finally {
      setBusy(false);
    }
  }

  async function onGoogleSignIn() {
    if (!acceptedDisclaimer) {
      setError('Accept the disclaimer to continue');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let idToken = process.env.EXPO_PUBLIC_GOOGLE_ID_TOKEN?.trim() || '';
      if (!idToken) {
        if (!googleAuth.configured) {
          throw new Error('Set EXPO_PUBLIC_GOOGLE_CLIENT_ID (or EXPO_PUBLIC_GOOGLE_ID_TOKEN for local testing).');
        }
        const result = await googleAuth.promptAsync();
        idToken = idTokenFromGoogleResponse(result) ?? '';
        if (!idToken) {
          throw new Error('Google sign-in was cancelled or did not return an ID token');
        }
      }
      const tokens = await api.oauth({
        provider: 'google',
        id_token: idToken,
        accepted_disclaimer: true,
      });
      await persistTokens(tokens.access_token, tokens.refresh_token, tokens.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Google sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  async function completeTelegramAuth(fields: Record<string, string>) {
    const tokens = await api.oauth({
      provider: 'telegram',
      telegram: fields,
      accepted_disclaimer: true,
    });
    await persistTokens(tokens.access_token, tokens.refresh_token, tokens.user);
  }

  async function onTelegramSignIn() {
    if (!acceptedDisclaimer) {
      setError('Accept the disclaimer to continue');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const fields = await openTelegramLogin();
      if (!fields) {
        setError('Telegram sign-in cancelled. Ensure TELEGRAM_BOT_USERNAME is set on the API.');
        return;
      }
      await completeTelegramAuth(fields);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Telegram sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  async function onPatchBank(id: string) {
    if (!token || !editBankLabel.trim()) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.patchBankProfile(token, id, { label: editBankLabel.trim() });
      setEditingBankId(null);
      const banks = await api.listBankProfiles(token);
      setBankProfiles(banks.bank_profiles ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update profile');
    } finally {
      setBusy(false);
    }
  }

  async function onCreateLoan() {
    if (!token || !loanFriendId) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const hasTerms = Boolean(principal.trim() && dueDate.trim());
      const created = await api.createLoan(token, {
        counterparty_id: loanFriendId,
        role: loanRole,
        ...(hasTerms
          ? {
              principal: principal.trim(),
              currency_code: currency.trim().toUpperCase(),
              interest_rate_percent: interest.trim() || '0',
              due_at: new Date(`${dueDate.trim()}T12:00:00.000Z`).toISOString(),
            }
          : {}),
        note: note.trim() || undefined,
      });
      setSelectedLoan(created.loan);
      setScreen('loan');
      await refreshFriends();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create loan');
    } finally {
      setBusy(false);
    }
  }

  async function openLoan(id: string) {
    if (!token) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.getLoan(token, id);
      setSelectedLoan(res.loan);
      setRevealedNumber(null);
      setPaymentProfile(null);
      setRejectReason('');
      try {
        const repay = await api.listRepayments(token, id);
        setRepayments(repay.repayments ?? []);
      } catch {
        setRepayments([]);
      }
      if (res.loan.your_role === 'borrower') {
        try {
          const pay = await api.loanPaymentProfile(token, id);
          setPaymentProfile(pay.bank_profile);
        } catch {
          setPaymentProfile(null);
        }
      }
      setScreen('loan');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load loan');
    } finally {
      setBusy(false);
    }
  }

  async function onProposeTerms() {
    if (!token || !selectedLoan || !principal.trim() || !dueDate.trim()) {
      setError('Principal and due date are required to propose terms');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.proposeTerms(token, selectedLoan.id, {
        principal: principal.trim(),
        currency_code: currency.trim().toUpperCase(),
        interest_rate_percent: interest.trim() || '0',
        due_at: new Date(`${dueDate.trim()}T12:00:00.000Z`).toISOString(),
        note: note.trim() || undefined,
      });
      setSelectedLoan(res.loan);
      await refreshFriends();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not propose terms');
    } finally {
      setBusy(false);
    }
  }

  async function onClaimRepayment() {
    if (!token || !selectedLoan) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: {
        amount?: string;
        note?: string;
        proof_filename?: string;
        proof_mime?: string;
        proof_base64?: string;
      } = {};
      const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
      if (!picked.canceled && picked.assets?.[0]) {
        const asset = picked.assets[0];
        body.proof_filename = asset.name;
        body.proof_mime = asset.mimeType ?? 'application/octet-stream';
        body.proof_base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'base64' });
      }
      await api.claimRepayment(token, selectedLoan.id, body);
      const [loanRes, repayRes] = await Promise.all([
        api.getLoan(token, selectedLoan.id),
        api.listRepayments(token, selectedLoan.id),
      ]);
      setSelectedLoan(loanRes.loan);
      setRepayments(repayRes.repayments ?? []);
      await refreshFriends();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not claim repayment');
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmRepayment(id: string) {
    if (!token || !selectedLoan) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.confirmRepayment(token, id);
      const [loanRes, repayRes] = await Promise.all([
        api.getLoan(token, selectedLoan.id),
        api.listRepayments(token, selectedLoan.id),
      ]);
      setSelectedLoan(loanRes.loan);
      setRepayments(repayRes.repayments ?? []);
      await refreshFriends();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not confirm repayment');
    } finally {
      setBusy(false);
    }
  }

  async function onRejectRepayment(id: string) {
    if (!token || !selectedLoan) {
      return;
    }
    const reason = rejectReason.trim() || 'Amount or proof does not match';
    setBusy(true);
    setError(null);
    try {
      await api.rejectRepayment(token, id, reason);
      setRejectReason('');
      const [loanRes, repayRes] = await Promise.all([
        api.getLoan(token, selectedLoan.id),
        api.listRepayments(token, selectedLoan.id),
      ]);
      setSelectedLoan(loanRes.loan);
      setRepayments(repayRes.repayments ?? []);
      await refreshFriends();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reject repayment');
    } finally {
      setBusy(false);
    }
  }

  async function onMarkNotificationRead(id: string) {
    if (!token) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.markNotificationRead(token, id);
      const res = await api.listNotifications(token);
      setNotifications(res.notifications ?? []);
      setUnreadCount(res.unread_count ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not mark read');
    } finally {
      setBusy(false);
    }
  }

  async function onMarkAllNotificationsRead() {
    if (!token) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.markAllNotificationsRead(token);
      const res = await api.listNotifications(token);
      setNotifications(res.notifications ?? []);
      setUnreadCount(res.unread_count ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not mark all read');
    } finally {
      setBusy(false);
    }
  }

  async function onLoanAction(kind: 'accept' | 'reject' | 'cancel') {
    if (!token || !selectedLoan) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res =
        kind === 'accept'
          ? await api.acceptLoan(token, selectedLoan.id)
          : kind === 'reject'
            ? await api.rejectLoan(token, selectedLoan.id)
            : await api.cancelLoan(token, selectedLoan.id);
      setSelectedLoan(res.loan);
      await refreshFriends();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Loan action failed');
    } finally {
      setBusy(false);
    }
  }

  async function onCreateBank() {
    if (!token || !bankIdentifier.trim()) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createBankProfile(token, {
        profile_type: bankType,
        label: bankLabel.trim() || 'Payment profile',
        institution_name: bankInstitution.trim() || undefined,
        account_identifier: bankIdentifier.trim(),
        currency_code: profileCurrency.trim().toUpperCase() || undefined,
        country_code: bankCountry.trim().toUpperCase() || undefined,
        rail_code: bankRailCode.trim() || selectedRail || undefined,
        is_preferred: bankProfiles.length === 0,
      });
      setBankIdentifier('');
      await refreshFriends();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save payment profile');
    } finally {
      setBusy(false);
    }
  }

  async function onPreferBank(id: string) {
    if (!token) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.preferBankProfile(token, id);
      await refreshFriends();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not set preferred');
    } finally {
      setBusy(false);
    }
  }

  async function onArchiveBank(id: string) {
    if (!token) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.archiveBankProfile(token, id);
      await refreshFriends();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not archive');
    } finally {
      setBusy(false);
    }
  }

  async function onShareBank(profileId: string, recipientId: string, loanId?: string) {
    if (!token) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.shareBankProfile(token, profileId, {
        recipient_id: recipientId,
        loan_id: loanId,
      });
      await refreshFriends();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not share');
    } finally {
      setBusy(false);
    }
  }

  async function onRevokeShare(id: string) {
    if (!token) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.revokeBankShare(token, id);
      await refreshFriends();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not revoke');
    } finally {
      setBusy(false);
    }
  }

  async function onRevealProfile(id: string, fromLoan = false) {
    if (!token) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = fromLoan && selectedLoan
        ? await api.loanPaymentProfile(token, selectedLoan.id, true)
        : await api.getBankProfile(token, id, true);
      setRevealedNumber(res.bank_profile.account_identifier ?? null);
      if (fromLoan) {
        setPaymentProfile(res.bank_profile);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reveal requires a recent sign-in');
    } finally {
      setBusy(false);
    }
  }

  if (booting || !fontsReady) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const authed = Boolean(user && token);
  const showNav = authed && !['login', 'register', 'verify', 'loan', 'new-loan', 'profile'].includes(screen);

  function tabFromScreen(s: Screen): TabId {
    if (s === 'banks') return 'banks';
    if (s === 'activity') return 'activity';
    if (s === 'chats') return 'chats';
    return 'dashboard';
  }

  function goTab(tab: TabId) {
    if (tab === 'dashboard' || tab === 'loans') {
      setScreen('home');
      if (tab === 'loans') {
        applyLoanFilter(loanFilter || '');
      }
      return;
    }
    if (tab === 'banks') {
      setScreen('banks');
      api.listPaymentRails().then((res) => setPaymentRails(res.rails ?? [])).catch(() => undefined);
    }
    if (tab === 'activity') setScreen('activity');
    if (tab === 'chats') setScreen('chats');
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style={resolved === 'dark' ? 'light' : 'dark'} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        {screen === 'chats' && user && token ? (
          <View style={styles.flex}>
            {error ? <Text style={[styles.error, { paddingHorizontal: 16, paddingTop: 8 }]}>{error}</Text> : null}
            <ChatScreen
              token={token}
              friends={friends}
              openLoanId={chatLoanId}
              onLoanOpened={() => setChatLoanId(null)}
              onBack={() => setScreen('home')}
              onError={(message) => setError(message)}
            />
          </View>
        ) : (
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          {!authed ? (
            <View style={styles.authHero}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <BrandMark hero />
                <ThemeToggle />
              </View>
              <Text style={styles.authSub}>Shared loan records and reminders. Not a bank.</Text>
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {screen === 'home' && user ? (
            <DashboardHome
              user={user}
              dashboard={dashboard}
              dashCurrency={dashCurrency}
              loans={loans}
              friends={friends}
              loanFilter={loanFilter}
              onCurrency={onDashCurrency}
              onFilter={applyLoanFilter}
              onOpenLoan={openLoan}
              onNewLoan={() => {
                setLoanFriendId(friends[0]?.peer.id ?? '');
                setScreen('new-loan');
              }}
              onBanks={() => {
                setScreen('banks');
                api.listPaymentRails().then((res) => setPaymentRails(res.rails ?? [])).catch(() => undefined);
              }}
              onLogout={onLogout}
              onProfile={() => {
                if (user) {
                  setProfileName(user.display_name);
                  setProfileUsername(user.username ?? '');
                  setProfileFirstName(user.first_name ?? '');
                  setProfileMiddleName(user.middle_name ?? '');
                  setProfileLastName(user.last_name ?? '');
                  setProfilePhone(user.phone_e164 ?? '');
                  setProfileCountry(user.country_code ?? 'ET');
                  setProfileAuthPref((user.preferred_auth_provider as 'email' | 'google' | 'telegram') || 'email');
                  setProfileLocale(user.locale || 'en');
                  setProfileCurrency(user.default_currency_code || 'ETB');
                  setProfileTimezone(user.timezone || 'Africa/Addis_Ababa');
                }
                setScreen('profile');
              }}
              formatMoney={formatMoney}
            />
          ) : null}

          {screen === 'home' && user ? (
            <View style={{ gap: 12, marginTop: 8 }}>
              <Card>
                <Text style={styles.cardTitle}>Friends</Text>
                <Text style={styles.muted}>Connect before you create a loan.</Text>
                <Field label="Search email or name" value={query} onChange={setQuery} />
                <PrimaryButton label={busy ? 'Working…' : 'Search'} onPress={onSearch} disabled={busy} />
                {hits.map((hit) => (
                  <View key={hit.id} style={styles.row}>
                    <View style={styles.flex}>
                      <Text style={styles.rowTitle}>{hit.display_name}</Text>
                      <Text style={styles.muted}>{hit.username ?? hit.id.slice(0, 8)}</Text>
                    </View>
                    <SecondaryButton label="Add" onPress={() => onAdd(hit)} disabled={busy} />
                  </View>
                ))}
                {incoming.map((req) => (
                  <View key={req.id} style={styles.row}>
                    <View style={styles.flex}>
                      <Text style={styles.rowTitle}>{req.peer.display_name}</Text>
                      <Text style={styles.muted}>Incoming request</Text>
                    </View>
                    <Pressable style={styles.smallButton} onPress={() => onAccept(req.id)} disabled={busy}>
                      <Text style={styles.smallButtonText}>Accept</Text>
                    </Pressable>
                    <Pressable style={styles.ghostButton} onPress={() => onReject(req.id)} disabled={busy}>
                      <Text style={styles.ghostButtonText}>Reject</Text>
                    </Pressable>
                  </View>
                ))}
                {friends.map((friend) => (
                  <View key={friend.id} style={{ gap: 8 }}>
                    <View style={styles.row}>
                      <View style={styles.flex}>
                        <Text style={styles.rowTitle}>{friend.peer.display_name}</Text>
                        <Text style={styles.muted}>Friend</Text>
                      </View>
                    </View>
                    <View style={styles.row}>
                      <Pressable style={styles.ghostButton} onPress={() => onRemove(friend.id)} disabled={busy}>
                        <Text style={styles.ghostButtonText}>Remove</Text>
                      </Pressable>
                      <Pressable style={styles.ghostButton} onPress={() => onBlock(friend.peer.id)} disabled={busy}>
                        <Text style={styles.ghostButtonText}>Block</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </Card>
            </View>
          ) : null}

          {screen === 'tos' ? (
            <View style={[styles.card, { minHeight: 480 }]}>
              <TermsScreen
                token={token}
                requireAccept={Boolean(token)}
                onAccepted={async () => {
                  if (token) {
                    const me = await api.me(token);
                    setUser(me.user);
                  }
                  setScreen(token ? 'profile' : 'register');
                }}
                onBack={() => setScreen(token ? 'profile' : 'register')}
              />
            </View>
          ) : null}

          {screen === 'profile' && user ? (
            <View style={{ gap: 14 }}>
              <ScreenHeader title="Account" onBack={() => setScreen('home')} />
              <Card>
                <Text style={styles.muted}>{user.email}</Text>
                {!user.profile_complete ? (
                  <Text style={styles.error}>Complete your account (names, username, country, currency, and Terms).</Text>
                ) : null}
                <SecondaryButton label={busy ? 'Uploading…' : 'Change profile photo'} onPress={onPickAvatar} disabled={busy} />
                {user.avatar_url ? <Text style={styles.dev}>Photo set</Text> : null}
                <SectionLabel>Identity</SectionLabel>
                <Field label="Username (required)" value={profileUsername} onChange={setProfileUsername} />
                <Field label="First name" value={profileFirstName} onChange={setProfileFirstName} />
                <Field label="Middle name" value={profileMiddleName} onChange={setProfileMiddleName} />
                <Field label="Last name" value={profileLastName} onChange={setProfileLastName} />
                <Field label="Display name" value={profileName} onChange={setProfileName} />
                <Field label="Phone (E.164)" value={profilePhone} onChange={setProfilePhone} keyboardType="phone-pad" />
                <Field label="Country (ISO)" value={profileCountry} onChange={setProfileCountry} />
                <SectionLabel>Sign-in preference</SectionLabel>
                <View style={styles.row}>
                  {(['email', 'google', 'telegram'] as const).map((p) => (
                    <Pressable
                      key={p}
                      style={profileAuthPref === p ? styles.smallButton : styles.ghostButton}
                      onPress={() => setProfileAuthPref(p)}
                    >
                      <Text style={profileAuthPref === p ? styles.smallButtonText : styles.ghostButtonText}>
                        {p}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <SectionLabel>Preferences</SectionLabel>
                <Field label="Locale" value={profileLocale} onChange={setProfileLocale} />
                <Field label="Timezone" value={profileTimezone} onChange={setProfileTimezone} />
                <Field label="Currency preference" value={profileCurrency} onChange={setProfileCurrency} />
                <PrimaryButton
                  label={busy ? 'Saving…' : 'Save account'}
                  onPress={onSaveProfile}
                  disabled={busy || !profileUsername.trim() || !profileFirstName.trim() || !profileLastName.trim()}
                />
                <SecondaryButton label="Read Terms of Service" onPress={() => setScreen('tos')} />
                {user.tos_accepted_at ? (
                  <Text style={styles.dev}>Terms accepted · {user.tos_version}</Text>
                ) : (
                  <Text style={styles.error}>You must accept the Terms of Service.</Text>
                )}
              </Card>
            </View>
          ) : null}

          {screen === 'new-loan' ? (
            <View style={{ gap: 14 }}>
              <ScreenHeader title="New loan" onBack={() => setScreen('home')} />
              <Card>
                <Text style={styles.muted}>Shared record only. Money still moves outside the app.</Text>
                <SectionLabel>Friend</SectionLabel>
                {friends.length === 0 ? (
                  <EmptyState title="No friends yet" body="Add a friend from Home before creating a loan." />
                ) : (
                  friends.map((friend) => (
                    <Pressable
                      key={friend.id}
                      style={[styles.row, loanFriendId === friend.peer.id ? styles.selectedRow : null]}
                      onPress={() => setLoanFriendId(friend.peer.id)}
                    >
                      <Text style={styles.rowTitle}>{friend.peer.display_name}</Text>
                    </Pressable>
                  ))
                )}
                <SectionLabel>Your role</SectionLabel>
                <View style={styles.row}>
                  <Pressable style={loanRole === 'borrower' ? styles.smallButton : styles.ghostButton} onPress={() => setLoanRole('borrower')}>
                    <Text style={loanRole === 'borrower' ? styles.smallButtonText : styles.ghostButtonText}>I borrow</Text>
                  </Pressable>
                  <Pressable style={loanRole === 'lender' ? styles.smallButton : styles.ghostButton} onPress={() => setLoanRole('lender')}>
                    <Text style={loanRole === 'lender' ? styles.smallButtonText : styles.ghostButtonText}>I lend</Text>
                  </Pressable>
                </View>
                <SectionLabel>Terms</SectionLabel>
                <Field label="Principal" value={principal} onChange={setPrincipal} keyboardType="decimal-pad" />
                <Field label="Flat interest %" value={interest} onChange={setInterest} keyboardType="decimal-pad" />
                <Field label="Currency" value={currency} onChange={setCurrency} placeholder="ETB or USD" />
                <Field label="Due date" value={dueDate} onChange={setDueDate} placeholder="YYYY-MM-DD" />
                <Field label="Note" value={note} onChange={setNote} />
                <PrimaryButton label={busy ? 'Working…' : 'Send for acceptance'} onPress={onCreateLoan} disabled={busy || !loanFriendId} />
              </Card>
            </View>
          ) : null}

          {screen === 'loan' && selectedLoan ? (
            <View style={{ gap: 14 }}>
              <ScreenHeader
                title={selectedLoan.reference_code}
                onBack={() => setScreen('home')}
                right={<StatusPill status={selectedLoan.status} />}
              />
              <Card>
                <Money
                  value={
                    selectedLoan.expected_total
                      ? formatMoney(selectedLoan.expected_total, selectedLoan.currency_code, user?.locale)
                      : statusLabel(selectedLoan.status)
                  }
                  size="xl"
                />
                <Text style={styles.muted}>
                  {selectedLoan.your_role === 'borrower'
                    ? `From ${selectedLoan.lender.display_name}`
                    : `To ${selectedLoan.borrower.display_name}`}
                </Text>
                {selectedLoan.principal ? (
                  <Text style={styles.muted}>
                    Principal {formatMoney(selectedLoan.principal, selectedLoan.currency_code, user?.locale)} · flat{' '}
                    {selectedLoan.interest_rate_percent}% · due{' '}
                    {selectedLoan.due_at
                      ? new Date(selectedLoan.due_at).toLocaleDateString(user?.locale || 'en', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })
                      : '—'}
                  </Text>
                ) : null}
                <SecondaryButton
                  label="Open loan chat"
                  onPress={() => {
                    setChatLoanId(selectedLoan.id);
                    setScreen('chats');
                  }}
                />
              </Card>

              {selectedLoan.can_accept ? (
                <Card>
                  <Text style={styles.disclaimer}>{DISCLAIMER}</Text>
                  <PrimaryButton label="Accept terms" onPress={() => onLoanAction('accept')} disabled={busy} />
                </Card>
              ) : null}

              {selectedLoan.can_propose_terms ? (
                <Card>
                  <SectionLabel>Propose or update terms</SectionLabel>
                  <Field label="Principal" value={principal} onChange={setPrincipal} keyboardType="decimal-pad" />
                  <Field label="Flat interest %" value={interest} onChange={setInterest} keyboardType="decimal-pad" />
                  <Field label="Currency" value={currency} onChange={setCurrency} placeholder="ETB or USD" />
                  <Field label="Due date" value={dueDate} onChange={setDueDate} placeholder="YYYY-MM-DD" />
                  <Field label="Note" value={note} onChange={setNote} />
                  <PrimaryButton label={busy ? 'Working…' : 'Send terms'} onPress={onProposeTerms} disabled={busy} />
                </Card>
              ) : null}

              {(selectedLoan.can_reject || selectedLoan.can_cancel) ? (
                <Card>
                  {selectedLoan.can_reject ? (
                    <SecondaryButton label="Reject" onPress={() => onLoanAction('reject')} disabled={busy} />
                  ) : null}
                  {selectedLoan.can_cancel ? (
                    <Pressable style={styles.ghostButton} onPress={() => onLoanAction('cancel')} disabled={busy}>
                      <Text style={styles.ghostButtonText}>Cancel loan</Text>
                    </Pressable>
                  ) : null}
                </Card>
              ) : null}

              {selectedLoan.your_role === 'borrower' &&
              (selectedLoan.status === 'active' || selectedLoan.status === 'overdue') ? (
                <Card>
                  <PrimaryButton label={busy ? 'Working…' : 'I paid (optional proof)'} onPress={onClaimRepayment} disabled={busy} />
                </Card>
              ) : null}

              {repayments.length > 0 ? (
                <Card>
                  <SectionLabel>Repayments</SectionLabel>
                  {repayments.map((rep) => (
                    <View key={rep.id} style={{ gap: 8 }}>
                      <Text style={styles.rowTitle}>
                        {formatMoney(rep.amount, selectedLoan.currency_code, user?.locale)} · {statusLabel(rep.status)}
                      </Text>
                      {rep.note ? <Text style={styles.muted}>{rep.note}</Text> : null}
                      {rep.proof_url ? <Text style={styles.dev}>Proof · {rep.proof_name || 'attachment'}</Text> : null}
                      {rep.can_confirm ? (
                        <PrimaryButton label="Confirm received" onPress={() => onConfirmRepayment(rep.id)} disabled={busy} />
                      ) : null}
                      {rep.can_reject ? (
                        <>
                          <Field label="Reject reason" value={rejectReason} onChange={setRejectReason} />
                          <SecondaryButton label="Reject claim" onPress={() => onRejectRepayment(rep.id)} disabled={busy} />
                        </>
                      ) : null}
                    </View>
                  ))}
                </Card>
              ) : null}

              {selectedLoan.your_role === 'lender' && (selectedLoan.status === 'active' || selectedLoan.status === 'overdue') ? (
                <Card>
                  <SectionLabel>Share payment profile</SectionLabel>
                  {bankProfiles.length === 0 ? (
                    <Pressable onPress={() => setScreen('banks')}>
                      <Text style={styles.link}>Add a payment profile first</Text>
                    </Pressable>
                  ) : (
                    bankProfiles.map((profile) => (
                      <Pressable
                        key={profile.id}
                        style={styles.row}
                        onPress={() => onShareBank(profile.id, selectedLoan.borrower.id, selectedLoan.id)}
                        disabled={busy}
                      >
                        <View style={styles.flex}>
                          <Text style={styles.rowTitle}>
                            {profile.label} · •••• {profile.account_last4}
                          </Text>
                          <Text style={styles.muted}>Share with {selectedLoan.borrower.display_name}</Text>
                        </View>
                      </Pressable>
                    ))
                  )}
                </Card>
              ) : null}

              {selectedLoan.your_role === 'borrower' ? (
                <Card>
                  <SectionLabel>Where to send repayment</SectionLabel>
                  {paymentProfile ? (
                    <>
                      <Text style={styles.rowTitle}>
                        {paymentProfile.label} · •••• {paymentProfile.account_last4}
                      </Text>
                      {revealedNumber ? <Text style={styles.dev}>{revealedNumber}</Text> : null}
                      <SecondaryButton
                        label={busy ? 'Working…' : 'Reveal number'}
                        onPress={() => onRevealProfile(paymentProfile.id, true)}
                        disabled={busy}
                      />
                    </>
                  ) : (
                    <EmptyState title="Waiting on lender" body="The lender has not shared a payment profile yet." />
                  )}
                </Card>
              ) : null}

              {selectedLoan.events?.length ? (
                <Card>
                  <SectionLabel>Timeline</SectionLabel>
                  {selectedLoan.events.map((ev) => (
                    <Text key={ev.id} style={styles.muted}>
                      {ev.event_type} · {ev.created_at.slice(0, 16)}
                    </Text>
                  ))}
                </Card>
              ) : null}
            </View>
          ) : null}

          {screen === 'activity' && user ? (
            <View style={{ gap: 14 }}>
              <ScreenHeader
                title="Inbox"
                onBack={() => setScreen('home')}
                right={
                  unreadCount > 0 ? (
                    <Pressable onPress={onMarkAllNotificationsRead} disabled={busy}>
                      <Text style={styles.link}>Mark all read</Text>
                    </Pressable>
                  ) : null
                }
              />
              <Card>
                <Text style={styles.muted}>Friends, loans, repayments, and due reminders.</Text>
                {notifications.length === 0 ? (
                  <EmptyState title="All quiet" body="When something needs your attention, it shows up here." />
                ) : (
                  notifications.map((n) => (
                    <Pressable
                      key={n.id}
                      style={[styles.row, { alignItems: 'flex-start', paddingVertical: 10 }]}
                      onPress={() => {
                        if (!n.read_at) {
                          onMarkNotificationRead(n.id);
                        }
                        if (n.loan_id) {
                          openLoan(n.loan_id);
                        }
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`${n.title}. ${n.read_at ? 'Read' : 'Unread'}`}
                    >
                      <View
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          marginTop: 6,
                          backgroundColor: n.read_at ? 'transparent' : '#1FA8A8',
                        }}
                      />
                      <View style={styles.flex}>
                        <Text style={styles.rowTitle}>{n.title}</Text>
                        <Text style={styles.muted}>{n.body}</Text>
                        <Text style={styles.muted}>
                          {new Date(n.created_at).toLocaleString(user.locale || 'en')}
                        </Text>
                      </View>
                    </Pressable>
                  ))
                )}
              </Card>
            </View>
          ) : null}

          {screen === 'banks' && user ? (
            <View style={{ gap: 14 }}>
              <ScreenHeader title="Payment profiles" onBack={() => { setRevealedNumber(null); setScreen('home'); }} />
              <Card>
                <Text style={styles.muted}>
                  Encrypted destinations for any rail worldwide. Lists show last 4 only.
                </Text>
                {bankProfiles.length === 0 ? (
                  <EmptyState title="No profiles yet" body="Add a bank, mobile money, wallet, or crypto account below." />
                ) : (
                  bankProfiles.map((profile) => (
                    <View key={profile.id} style={{ gap: 8, paddingVertical: 4 }}>
                      <View style={styles.row}>
                        <View style={styles.flex}>
                          <Text style={styles.rowTitle}>
                            {profile.label}
                            {profile.is_preferred ? ' · preferred' : ''}
                          </Text>
                          <Text style={styles.muted}>
                            {profile.profile_type} · •••• {profile.account_last4}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.row}>
                        {!profile.is_preferred ? (
                          <Pressable style={styles.smallButton} onPress={() => onPreferBank(profile.id)} disabled={busy}>
                            <Text style={styles.smallButtonText}>Preferred</Text>
                          </Pressable>
                        ) : null}
                        <Pressable style={styles.ghostButton} onPress={() => onRevealProfile(profile.id)} disabled={busy}>
                          <Text style={styles.ghostButtonText}>Reveal</Text>
                        </Pressable>
                        <Pressable
                          style={styles.ghostButton}
                          onPress={() => {
                            setEditingBankId(profile.id);
                            setEditBankLabel(profile.label);
                          }}
                          disabled={busy}
                        >
                          <Text style={styles.ghostButtonText}>Edit</Text>
                        </Pressable>
                        <Pressable style={styles.ghostButton} onPress={() => onArchiveBank(profile.id)} disabled={busy}>
                          <Text style={styles.ghostButtonText}>Archive</Text>
                        </Pressable>
                      </View>
                      {editingBankId === profile.id ? (
                        <View style={{ gap: 8 }}>
                          <Field label="Label" value={editBankLabel} onChange={setEditBankLabel} />
                          <PrimaryButton label={busy ? 'Saving…' : 'Save label'} onPress={() => onPatchBank(profile.id)} disabled={busy} />
                        </View>
                      ) : null}
                      {friends.length > 0 ? (
                        <SecondaryButton
                          label="Share with friend"
                          onPress={() => onShareBank(profile.id, shareFriendId || friends[0].peer.id)}
                          disabled={busy}
                        />
                      ) : null}
                    </View>
                  ))
                )}
                {revealedNumber ? <Text style={styles.dev}>Revealed: {revealedNumber}</Text> : null}
              </Card>

              <Card>
                <SectionLabel>Add payment account</SectionLabel>
                <Field label="Account country (ISO)" value={bankCountry} onChange={setBankCountry} placeholder="ET, US, …" />
                <SecondaryButton
                  label={paymentRails.length ? `Refresh types (${paymentRails.length})` : 'Load global payment types'}
                  onPress={() => {
                    api.listPaymentRails().then((res) => setPaymentRails(res.rails ?? [])).catch((e) => setError(e instanceof Error ? e.message : 'Could not load rails'));
                  }}
                />
                <View style={[styles.row, { flexWrap: 'wrap' }]}>
                  {(paymentRails.length
                    ? paymentRails
                    : [
                        { code: 'bank_local', label: 'Local bank', profile_type: 'bank_account' },
                        { code: 'iban', label: 'IBAN', profile_type: 'iban' },
                        { code: 'swift', label: 'SWIFT', profile_type: 'swift' },
                        { code: 'mobile_money', label: 'Mobile money', profile_type: 'mobile_money' },
                        { code: 'paypal', label: 'PayPal', profile_type: 'paypal' },
                        { code: 'wise', label: 'Wise', profile_type: 'wise' },
                        { code: 'crypto_wallet', label: 'Crypto', profile_type: 'crypto_wallet' },
                        { code: 'other', label: 'Other', profile_type: 'other' },
                      ]
                  ).map((rail) => (
                    <Pressable
                      key={rail.code}
                      style={selectedRail === rail.code ? styles.smallButton : styles.ghostButton}
                      onPress={() => {
                        setSelectedRail(rail.code);
                        setBankRailCode(rail.code);
                        setBankType(rail.profile_type);
                        setBankLabel(rail.label);
                      }}
                    >
                      <Text style={selectedRail === rail.code ? styles.smallButtonText : styles.ghostButtonText}>
                        {rail.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Field label="Label" value={bankLabel} onChange={setBankLabel} />
                <Field label="Institution" value={bankInstitution} onChange={setBankInstitution} />
                <Field label="Account or wallet number" value={bankIdentifier} onChange={setBankIdentifier} />
                {friends.length > 0 ? (
                  <>
                    <SectionLabel>Default share friend</SectionLabel>
                    {friends.map((friend) => (
                      <Pressable
                        key={friend.id}
                        style={[styles.row, shareFriendId === friend.peer.id ? styles.selectedRow : null]}
                        onPress={() => setShareFriendId(friend.peer.id)}
                      >
                        <Text style={styles.rowTitle}>{friend.peer.display_name}</Text>
                      </Pressable>
                    ))}
                  </>
                ) : null}
                <PrimaryButton label={busy ? 'Working…' : 'Save encrypted profile'} onPress={onCreateBank} disabled={busy || !bankIdentifier.trim()} />
              </Card>

              {outgoingShares.filter((s) => !s.revoked_at).length > 0 ? (
                <Card>
                  <SectionLabel>Shared with</SectionLabel>
                  {outgoingShares.filter((s) => !s.revoked_at).map((share) => (
                    <View key={share.id} style={styles.row}>
                      <View style={styles.flex}>
                        <Text style={styles.rowTitle}>{share.profile.label} · •••• {share.profile.account_last4}</Text>
                        <Text style={styles.muted}>{share.loan_id ? 'Loan share' : 'Friend share'}</Text>
                      </View>
                      <Pressable style={styles.ghostButton} onPress={() => onRevokeShare(share.id)} disabled={busy}>
                        <Text style={styles.ghostButtonText}>Revoke</Text>
                      </Pressable>
                    </View>
                  ))}
                </Card>
              ) : null}

              {incomingShares.length > 0 ? (
                <Card>
                  <SectionLabel>Shared with me</SectionLabel>
                  {incomingShares.map((share) => (
                    <View key={share.id} style={styles.row}>
                      <View style={styles.flex}>
                        <Text style={styles.rowTitle}>{share.profile.label} · •••• {share.profile.account_last4}</Text>
                        <Text style={styles.muted}>Masked until you reveal</Text>
                      </View>
                      <Pressable style={styles.ghostButton} onPress={() => onRevealProfile(share.profile.id)} disabled={busy}>
                        <Text style={styles.ghostButtonText}>Reveal</Text>
                      </Pressable>
                    </View>
                  ))}
                </Card>
              ) : null}
            </View>
          ) : null}

          {screen === 'register' ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Create account</Text>
              <Text style={styles.muted}>One shared ledger for friends who lend each other money.</Text>
              <Field label="Display name" value={displayName} onChange={setDisplayName} />
              <Field label="Email" value={email} onChange={setEmail} keyboardType="email-address" />
              <Field label="Password" value={password} onChange={setPassword} secure />
              <Text style={styles.disclaimer}>{DISCLAIMER}</Text>
              <CheckRow
                checked={acceptedDisclaimer}
                label="I understand Lony is a shared ledger, not a bank or escrow."
                onPress={() => setAcceptedDisclaimer((v) => !v)}
              />
              <PrimaryButton label={busy ? 'Working…' : 'Register'} onPress={onRegister} disabled={busy || !acceptedDisclaimer} />
              <Pressable onPress={() => setScreen('login')} accessibilityRole="link" accessibilityLabel="Go to sign in">
                <Text style={styles.link}>Already have an account? Sign in</Text>
              </Pressable>
            </View>
          ) : null}

          {screen === 'login' ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Sign in</Text>
              <Text style={styles.muted}>Continue with email, Google, or Telegram.</Text>
              <Field label="Email" value={email} onChange={setEmail} keyboardType="email-address" />
              <Field label="Password" value={password} onChange={setPassword} secure />
              <PrimaryButton label={busy ? 'Working…' : 'Sign in'} onPress={onLogin} disabled={busy} />
              <View style={styles.divider} />
              <Text style={styles.dividerLabel}>or</Text>
              <SecondaryButton
                label="Continue with Google"
                onPress={onGoogleSignIn}
                disabled={busy || !acceptedDisclaimer}
              />
              <SecondaryButton
                label="Continue with Telegram"
                onPress={onTelegramSignIn}
                disabled={busy || !acceptedDisclaimer}
              />
              <CheckRow
                checked={acceptedDisclaimer}
                label="Accept disclaimer (needed for Google / Telegram)"
                onPress={() => setAcceptedDisclaimer((v) => !v)}
              />
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
              <PrimaryButton label={busy ? 'Working…' : 'Verify and continue'} onPress={onVerify} disabled={busy} />
              <Pressable onPress={() => setScreen('login')}>
                <Text style={styles.link}>Back to sign in</Text>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
        )}
        {showNav ? (
          <BottomNav
            active={tabFromScreen(screen)}
            unread={unreadCount}
            onChange={goTab}
            onCreate={() => {
              setLoanFriendId(friends[0]?.peer.id ?? '');
              setScreen('new-loan');
            }}
          />
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
