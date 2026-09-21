import { StatusBar } from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
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
import { AnalyticsScreen } from './src/AnalyticsScreen';
import { AppHeader } from './src/AppHeader';
import { AuthScreens } from './src/AuthScreens';
import { BottomNav, type TabId } from './src/BottomNav';
import { COUNTRIES, CURRENCIES } from './src/catalogs';
import { ChatScreen } from './src/ChatScreen';
import { ChatSearchScreen } from './src/ChatSearchScreen';
import { DashboardHome } from './src/DashboardHome';
import { DateField } from './src/DateField';
import { DrawerMenu, type DrawerItem } from './src/DrawerMenu';
import { IconSearch } from './src/icons';
import { LoansScreen } from './src/LoansScreen';
import { NewLoanScreen } from './src/NewLoanScreen';
import { PeerProfileScreen } from './src/PeerProfileScreen';
import {
  idTokenFromGoogleResponse,
  openTelegramLogin,
  parseTelegramDeepLink,
  useGoogleIdTokenAuth,
} from './src/oauth';
import { OnboardingScreen } from './src/OnboardingScreen';
import { PlaceholderScreen } from './src/PlaceholderScreen';
import { TermsScreen } from './src/TermsScreen';
import { ThemeProvider, radii, useTheme } from './src/theme';
import { registerPushToken } from './src/push';
import { SearchSelect } from './src/SearchSelect';
import { SettingsScreen } from './src/SettingsScreen';
import { Card, EmptyState, Field, Money, PrimaryButton, ScreenHeader, SecondaryButton, SectionLabel, StatusPill, useAppStyles } from './src/ui';

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

type Screen =
  | 'login'
  | 'register'
  | 'verify'
  | 'onboarding'
  | 'home'
  | 'loans'
  | 'new-loan'
  | 'loan'
  | 'banks'
  | 'chats'
  | 'settings'
  | 'expenses'
  | 'analytics'
  | 'plan'
  | 'peer-profile'
  | 'chat-search'
  | 'tos';

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
  const [drawerOpen, setDrawerOpen] = useState(false);
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
  const [loanLockedPeer, setLoanLockedPeer] = useState<{ id: string; display_name: string } | null>(null);
  const [chatThreadOpen, setChatThreadOpen] = useState(false);
  const [loanRole, setLoanRole] = useState<'borrower' | 'lender'>('borrower');
  const [principal, setPrincipal] = useState('');
  const [interest, setInterest] = useState('0');
  const [currency, setCurrency] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [dashCurrency, setDashCurrency] = useState('');
  const [loanFilter, setLoanFilter] = useState('');
  const [bankProfiles, setBankProfiles] = useState<BankProfile[]>([]);
  const [outgoingShares, setOutgoingShares] = useState<BankProfileShare[]>([]);
  const [incomingShares, setIncomingShares] = useState<BankProfileShare[]>([]);
  const [paymentProfile, setPaymentProfile] = useState<BankProfile | null>(null);
  const [revealedNumber, setRevealedNumber] = useState<string | null>(null);
  const [bankLabel, setBankLabel] = useState('');
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
  const [profileCountry, setProfileCountry] = useState('');
  const [profileAuthPref, setProfileAuthPref] = useState<'email' | 'google' | 'telegram'>('email');
  const [profileLocale, setProfileLocale] = useState('en');
  const [paymentRails, setPaymentRails] = useState<import('./src/api').PaymentRail[]>([]);
  const [selectedRail, setSelectedRail] = useState('');
  const [bankCountry, setBankCountry] = useState('');
  const [bankRailCode, setBankRailCode] = useState('');
  const [profileCurrency, setProfileCurrency] = useState('');
  const [profileTimezone, setProfileTimezone] = useState('UTC');
  const [onboardingTos, setOnboardingTos] = useState(false);
  const [chatLoanId, setChatLoanId] = useState<string | null>(null);
  const [chatPeerId, setChatPeerId] = useState<string | null>(null);
  const [peerProfile, setPeerProfile] = useState<{ id: string; display_name: string; username?: string | null } | null>(null);
  const [editingBankId, setEditingBankId] = useState<string | null>(null);
  const [editBankLabel, setEditBankLabel] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | undefined>();
  const [acceptedDisclaimer, setAcceptedDisclaimer] = useState(false);

  function applyUserProfile(next: User) {
    setUser(next);
    setProfileName(next.display_name);
    setProfileUsername(next.username ?? '');
    setProfileFirstName(next.first_name ?? '');
    setProfileMiddleName(next.middle_name ?? '');
    setProfileLastName(next.last_name ?? '');
    setProfilePhone(next.phone_e164 ?? '');
    setProfileCountry(next.country_code ?? '');
    setProfileAuthPref((next.preferred_auth_provider as 'email' | 'google' | 'telegram') || 'email');
    setProfileLocale(next.locale || 'en');
    setProfileCurrency(next.default_currency_code ?? '');
    setProfileTimezone(next.timezone || 'UTC');
    setCurrency((c) => c || next.default_currency_code || '');
    setDashCurrency((c) => c || next.default_currency_code || '');
    setOnboardingTos(Boolean(next.tos_accepted_at));
  }

  function enterAuthed(next: User, access: string) {
    setToken(access);
    applyUserProfile(next);
    registerPushToken(access).catch(() => undefined);
    setScreen(next.profile_complete ? 'home' : 'onboarding');
  }

  function syncDashCurrency(dash: Dashboard | null, preferred?: string | null) {
    const codes = dash?.by_currency?.map((c) => c.currency_code).filter(Boolean) ?? [];
    if (!codes.length) {
      setDashCurrency(preferred ?? '');
      return;
    }
    setDashCurrency((current) => {
      if (preferred && codes.includes(preferred)) {
        return preferred;
      }
      if (current && codes.includes(current)) {
        return current;
      }
      return codes[0];
    });
  }

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
            enterAuthed(me.user, access);
            return;
          }
        } catch {
          /* try refresh */
        }
        if (refresh) {
          const tokens = await api.refresh(refresh);
          await SecureStore.setItemAsync(ACCESS_KEY, tokens.access_token);
          await SecureStore.setItemAsync(REFRESH_KEY, tokens.refresh_token);
          enterAuthed(tokens.user, tokens.access_token);
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
    enterAuthed(nextUser, access);
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
      api.listLoans(access, {
        ...(loanFilter ? { filter: loanFilter } : {}),
      }),
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
    syncDashCurrency(dashRes.dashboard, user?.default_currency_code);
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
      const res = await api.listLoans(token, next ? { filter: next } : {});
      setLoans(res.loans ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load loans');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if ((screen === 'home' || screen === 'loans') && token) {
      refreshFriends(token).catch((e) => {
        setError(e instanceof Error ? e.message : 'Could not load friends');
      });
    }
  }, [screen, token]);

  useEffect(() => {
    if (user && token && !user.profile_complete && !['onboarding', 'tos', 'settings', 'login', 'register', 'verify'].includes(screen)) {
      setScreen('onboarding');
    }
  }, [user, token, screen]);

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
    if (!profileUsername.trim() || !profileFirstName.trim() || !profileLastName.trim()) {
      setError('Username, first name, and last name are required');
      return;
    }
    if (profileCountry.trim().length !== 2 || profileCurrency.trim().length !== 3) {
      setError('Select a country and currency');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (onboardingTos && !user?.tos_accepted_at) {
        await api.acceptTOS(token);
      }
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
        timezone: profileTimezone.trim() || 'UTC',
        default_currency_code: profileCurrency.trim().toUpperCase(),
      });
      applyUserProfile(res.user);
      setCurrency(res.user.default_currency_code ?? '');
      setDashCurrency(res.user.default_currency_code ?? '');
      setScreen(res.user.profile_complete ? 'home' : 'onboarding');
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
      const hasTerms = Boolean(principal.trim() && dueDate.trim() && currency.trim());
      if (principal.trim() && !currency.trim()) {
        setError('Select a currency');
        setBusy(false);
        return;
      }
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
  const showNav =
    authed &&
    user?.profile_complete &&
    !chatThreadOpen &&
    (screen === 'home' || screen === 'loans' || screen === 'chats' || screen === 'chat-search');

  const showChrome =
    authed &&
    user?.profile_complete &&
    !chatThreadOpen &&
    !['login', 'register', 'verify', 'onboarding', 'tos'].includes(screen);

  function drawerActive(): DrawerItem | null {
    if (screen === 'expenses') return 'expenses';
    if (
      screen === 'loans' ||
      screen === 'home' ||
      screen === 'chats' ||
      screen === 'chat-search' ||
      screen === 'loan' ||
      screen === 'new-loan' ||
      screen === 'peer-profile'
    ) {
      return 'loans';
    }
    if (screen === 'analytics') return 'analytics';
    if (screen === 'plan') return 'plan';
    if (screen === 'settings' || screen === 'banks') return 'settings';
    return null;
  }

  function tabFromScreen(s: Screen): TabId {
    if (s === 'loans') return 'loans';
    if (s === 'chats' || s === 'chat-search' || s === 'peer-profile') return 'chats';
    return 'home';
  }

  function goTab(tab: TabId) {
    if (tab === 'home') {
      setScreen('home');
      return;
    }
    if (tab === 'loans') {
      setScreen('loans');
      return;
    }
    if (tab === 'chats') setScreen('chats');
  }

  function onDrawerSelect(item: DrawerItem) {
    if (item === 'expenses') setScreen('expenses');
    if (item === 'loans') setScreen('loans');
    if (item === 'analytics') setScreen('analytics');
    if (item === 'plan') setScreen('plan');
    if (item === 'settings') {
      if (user) applyUserProfile(user);
      setScreen('settings');
    }
  }

  const loansModule =
    screen === 'home' ||
    screen === 'loans' ||
    screen === 'chats' ||
    screen === 'chat-search' ||
    screen === 'loan' ||
    screen === 'new-loan' ||
    screen === 'peer-profile';

  const selfInitial = user
    ? ((user.first_name || user.display_name || user.username || '?').trim().slice(0, 1).toUpperCase() || '?')
    : '?';

  const headerSearch =
    showChrome && loansModule ? (
      <Pressable
        onPress={() => setScreen('chat-search')}
        accessibilityRole="button"
        accessibilityLabel="Search people"
        style={{
          width: 40,
          height: 40,
          borderRadius: radii.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.surfaceMuted,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <IconSearch size={18} color={colors.text} />
      </Pressable>
    ) : undefined;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style={resolved === 'dark' ? 'light' : 'dark'} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <DrawerMenu
          open={drawerOpen}
          active={drawerActive()}
          onClose={() => setDrawerOpen(false)}
          onSelect={onDrawerSelect}
        />
        {screen === 'chats' && user && token ? (
          <View style={[styles.flex, { paddingHorizontal: chatThreadOpen ? 12 : 16, paddingTop: chatThreadOpen ? 4 : 8 }]}>
            {showChrome ? <AppHeader onMenu={() => setDrawerOpen(true)} right={headerSearch} /> : null}
            {error ? <Text style={[styles.error, { paddingTop: 8 }]}>{error}</Text> : null}
            <ChatScreen
              token={token}
              userId={user.id}
              selfInitial={selfInitial}
              friends={friends}
              openLoanId={chatLoanId}
              openPeerId={chatPeerId}
              onLoanOpened={() => setChatLoanId(null)}
              onPeerOpened={() => setChatPeerId(null)}
              onError={(message) => setError(message)}
              onActiveChange={setChatThreadOpen}
              onOpenLoan={openLoan}
              onOpenProfile={(peer) => {
                setPeerProfile(peer);
                setScreen('peer-profile');
              }}
              onCreateLoanWith={(peer) => {
                setLoanFriendId(peer.id);
                setLoanLockedPeer({ id: peer.id, display_name: peer.display_name });
                setCurrency(user.default_currency_code ?? '');
                setScreen('new-loan');
              }}
            />
          </View>
        ) : screen === 'chat-search' && user && token ? (
          <ScrollView contentContainerStyle={[styles.container, showNav ? { paddingBottom: 96 } : null]} keyboardShouldPersistTaps="handled">
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {showChrome ? <AppHeader onMenu={() => setDrawerOpen(true)} right={headerSearch} /> : null}
            <ChatSearchScreen
              token={token}
              onError={(message) => setError(message)}
              onOpenChat={(peer) => {
                setChatPeerId(peer.id);
                setScreen('chats');
              }}
            />
          </ScrollView>
        ) : (
        <ScrollView
          contentContainerStyle={[styles.container, showNav ? { paddingBottom: 96 } : null]}
          keyboardShouldPersistTaps="handled"
        >
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {showChrome ? <AppHeader onMenu={() => setDrawerOpen(true)} right={headerSearch} /> : null}

          {!authed && (screen === 'login' || screen === 'register' || screen === 'verify') ? (
            <AuthScreens
              mode={screen}
              email={email}
              password={password}
              displayName={displayName}
              code={code}
              devCode={devCode}
              busy={busy}
              acceptedDisclaimer={acceptedDisclaimer}
              onEmail={setEmail}
              onPassword={setPassword}
              onDisplayName={setDisplayName}
              onCode={setCode}
              onToggleDisclaimer={() => setAcceptedDisclaimer((v) => !v)}
              onLogin={onLogin}
              onRegister={onRegister}
              onVerify={onVerify}
              onGoogle={onGoogleSignIn}
              onTelegram={onTelegramSignIn}
              onGoLogin={() => setScreen('login')}
              onGoRegister={() => setScreen('register')}
            />
          ) : null}

          {screen === 'onboarding' && user ? (
            <OnboardingScreen
              username={profileUsername}
              firstName={profileFirstName}
              lastName={profileLastName}
              phone={profilePhone}
              country={profileCountry}
              currency={profileCurrency}
              tosAccepted={onboardingTos || Boolean(user.tos_accepted_at)}
              busy={busy}
              onUsername={setProfileUsername}
              onFirstName={setProfileFirstName}
              onLastName={setProfileLastName}
              onPhone={setProfilePhone}
              onCountry={setProfileCountry}
              onCurrency={setProfileCurrency}
              onToggleTos={() => setOnboardingTos((v) => !v)}
              onSave={onSaveProfile}
              onOpenTos={() => setScreen('tos')}
            />
          ) : null}

          {screen === 'home' && user && token ? (
            <DashboardHome
              user={user}
              dashboard={dashboard}
              token={token}
              onOpenAnalytics={() => setScreen('analytics')}
              formatMoney={formatMoney}
            />
          ) : null}

          {screen === 'loans' && user ? (
            <LoansScreen
              user={user}
              loans={loans}
              loanFilter={loanFilter}
              onFilter={applyLoanFilter}
              onOpenLoan={openLoan}
              onNewLoan={() => {
                setLoanFriendId(friends[0]?.peer.id ?? '');
                setLoanLockedPeer(null);
                setCurrency(user.default_currency_code ?? '');
                setScreen('new-loan');
              }}
              formatMoney={formatMoney}
            />
          ) : null}

          {screen === 'expenses' ? (
            <PlaceholderScreen
              title="Expenses"
              emptyTitle="Nothing spent here"
              emptyBody="Expenses — including loan-related cash — will land in this tracker. Still empty, still calm."
            />
          ) : null}

          {screen === 'analytics' && user ? (
            <AnalyticsScreen user={user} dashboard={dashboard} formatMoney={formatMoney} />
          ) : null}

          {screen === 'plan' ? (
            <PlaceholderScreen
              title="Plan"
              emptyTitle="No plan yet"
              emptyBody="Budgets and goals will live here. For now it’s a blank page with good intentions."
            />
          ) : null}

          {screen === 'tos' ? (
            <View style={[styles.card, { minHeight: 480 }]}>
              <TermsScreen
                token={token}
                requireAccept={Boolean(token)}
                onAccepted={async () => {
                  if (token) {
                    const me = await api.me(token);
                    applyUserProfile(me.user);
                    setOnboardingTos(true);
                  }
                  setScreen(token ? (user?.profile_complete ? 'settings' : 'onboarding') : 'register');
                }}
                onBack={() => setScreen(token ? (user?.profile_complete ? 'settings' : 'onboarding') : 'register')}
              />
            </View>
          ) : null}

          {screen === 'settings' && user ? (
            <SettingsScreen
              email={user.email}
              username={profileUsername}
              firstName={profileFirstName}
              middleName={profileMiddleName}
              lastName={profileLastName}
              displayName={profileName}
              phone={profilePhone}
              country={profileCountry}
              currency={profileCurrency}
              locale={profileLocale}
              timezone={profileTimezone}
              authPref={profileAuthPref}
              profileComplete={Boolean(user.profile_complete)}
              tosAccepted={Boolean(user.tos_accepted_at)}
              tosVersion={user.tos_version}
              busy={busy}
              onUsername={setProfileUsername}
              onFirstName={setProfileFirstName}
              onMiddleName={setProfileMiddleName}
              onLastName={setProfileLastName}
              onDisplayName={setProfileName}
              onPhone={setProfilePhone}
              onCountry={setProfileCountry}
              onCurrency={setProfileCurrency}
              onLocale={setProfileLocale}
              onTimezone={setProfileTimezone}
              onAuthPref={setProfileAuthPref}
              onSave={onSaveProfile}
              onAvatar={onPickAvatar}
              onTos={() => setScreen('tos')}
              onBanks={() => {
                setScreen('banks');
                api.listPaymentRails().then((res) => setPaymentRails(res.rails ?? [])).catch(() => undefined);
              }}
              onLogout={onLogout}
            />
          ) : null}

          {screen === 'new-loan' && user && token ? (
            <NewLoanScreen
              friends={friends}
              loanFriendId={loanFriendId}
              loanRole={loanRole}
              principal={principal}
              interest={interest}
              currency={currency}
              dueDate={dueDate}
              note={note}
              busy={busy}
              countryCode={profileCountry || user.country_code || 'ET'}
              lockedPeer={loanLockedPeer}
              onSelectFriend={setLoanFriendId}
              onRole={setLoanRole}
              onPrincipal={setPrincipal}
              onInterest={setInterest}
              onCurrency={setCurrency}
              onDueDate={setDueDate}
              onNote={setNote}
              onBack={() => setScreen(loanLockedPeer ? 'chats' : 'loans')}
              onCreate={onCreateLoan}
              onError={(message) => setError(message)}
              onLookupPhone={async (e164) => {
                if (!token) return 'error';
                setBusy(true);
                setError(null);
                try {
                  const res = await api.lookupPhone(token, e164);
                  if (!res.found || !res.user) {
                    return 'invited';
                  }
                  setLoanFriendId(res.user.id);
                  await refreshFriends(token);
                  return 'selected';
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Could not look up phone');
                  return 'error';
                } finally {
                  setBusy(false);
                }
              }}
            />
          ) : null}

          {screen === 'peer-profile' && peerProfile && user ? (
            <PeerProfileScreen
              peer={peerProfile}
              isSelf={peerProfile.id === user.id}
              selfInitial={selfInitial}
              onBack={() => setScreen('chats')}
              onMessage={() => {
                setChatPeerId(peerProfile.id);
                setScreen('chats');
              }}
              onCreateLoan={
                peerProfile.id === user.id
                  ? undefined
                  : () => {
                      setLoanFriendId(peerProfile.id);
                      setLoanLockedPeer({ id: peerProfile.id, display_name: peerProfile.display_name });
                      setCurrency(user.default_currency_code ?? '');
                      setScreen('new-loan');
                    }
              }
            />
          ) : null}

          {screen === 'loan' && selectedLoan ? (
            <View style={{ gap: 14 }}>
              <ScreenHeader
                title={selectedLoan.reference_code}
                onBack={() => setScreen('loans')}
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
                  <SearchSelect label="Currency" value={currency} onChange={setCurrency} options={CURRENCIES} />
                  <DateField label="Due date" value={dueDate} onChange={setDueDate} />
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

          {screen === 'banks' && user ? (
            <View style={{ gap: 14 }}>
              <ScreenHeader title="Payment profiles" onBack={() => { setRevealedNumber(null); setScreen('settings'); }} />
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
                <SearchSelect label="Account country" value={bankCountry} onChange={setBankCountry} options={COUNTRIES} />
                <SecondaryButton
                  label={paymentRails.length ? `Refresh types (${paymentRails.length})` : 'Load payment types'}
                  onPress={() => {
                    api.listPaymentRails().then((res) => setPaymentRails(res.rails ?? [])).catch((e) => setError(e instanceof Error ? e.message : 'Could not load rails'));
                  }}
                />
                <SearchSelect
                  label="Payment type"
                  value={selectedRail}
                  onChange={(code) => {
                    const rail =
                      paymentRails.find((r) => r.code === code) ??
                      [
                        { code: 'bank_local', label: 'Local bank', profile_type: 'bank_account' },
                        { code: 'iban', label: 'IBAN', profile_type: 'iban' },
                        { code: 'swift', label: 'SWIFT', profile_type: 'swift' },
                        { code: 'mobile_money', label: 'Mobile money', profile_type: 'mobile_money' },
                        { code: 'paypal', label: 'PayPal', profile_type: 'paypal' },
                        { code: 'wise', label: 'Wise', profile_type: 'wise' },
                        { code: 'crypto_wallet', label: 'Crypto', profile_type: 'crypto_wallet' },
                        { code: 'other', label: 'Other', profile_type: 'other' },
                      ].find((r) => r.code === code);
                    setSelectedRail(code);
                    setBankRailCode(code);
                    if (rail) {
                      setBankType(rail.profile_type);
                      setBankLabel(rail.label);
                    }
                  }}
                  options={(paymentRails.length
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
                  ).map((r) => ({ id: r.code, label: r.label, keywords: `${r.code} ${r.label}`.toLowerCase() }))}
                  placeholder="Select payment type"
                />
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
                <PrimaryButton
                  label={busy ? 'Working…' : 'Save encrypted profile'}
                  onPress={onCreateBank}
                  disabled={busy || !bankIdentifier.trim() || !bankCountry || !selectedRail}
                />
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
        </ScrollView>
        )}
        {showNav ? (
          <BottomNav active={tabFromScreen(screen)} unread={unreadCount} onChange={goTab} />
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
