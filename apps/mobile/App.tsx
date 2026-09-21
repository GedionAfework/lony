import { StatusBar } from 'expo-status-bar';
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
import { ThemeProvider, useTheme } from './src/theme';
import { BrandMark, Card, Field, Money, PrimaryButton, SecondaryButton, StatusPill, ThemeToggle, useAppStyles } from './src/ui';

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

type Screen = 'login' | 'register' | 'verify' | 'home' | 'new-loan' | 'loan' | 'banks' | 'activity' | 'chats' | 'profile';

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
  const [profileLocale, setProfileLocale] = useState('en');
  const [profileCurrency, setProfileCurrency] = useState('ETB');
  const [profileTimezone, setProfileTimezone] = useState('Africa/Addis_Ababa');
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

  async function persistTokens(access: string, refresh: string, nextUser: User) {
    await SecureStore.setItemAsync(ACCESS_KEY, access);
    await SecureStore.setItemAsync(REFRESH_KEY, refresh);
    setToken(access);
    setUser(nextUser);
    setProfileName(nextUser.display_name);
    setProfileLocale(nextUser.locale || 'en');
    setProfileCurrency(nextUser.default_currency_code || 'ETB');
    setProfileTimezone(nextUser.timezone || 'Africa/Addis_Ababa');
    setScreen('home');
    registerDevDeviceToken(access).catch(() => undefined);
  }

  async function registerDevDeviceToken(access: string) {
    let deviceId = await SecureStore.getItemAsync('lony.device_id');
    if (!deviceId) {
      deviceId = `dev-${Platform.OS}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      await SecureStore.setItemAsync('lony.device_id', deviceId);
    }
    await api.registerDeviceToken(access, Platform.OS === 'ios' ? 'ios' : 'android', deviceId);
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
        display_name: profileName.trim(),
        locale: profileLocale.trim() || 'en',
        timezone: profileTimezone.trim() || 'Africa/Addis_Ababa',
        default_currency_code: profileCurrency.trim().toUpperCase() || 'ETB',
      });
      setUser(res.user);
      setDashCurrency(res.user.default_currency_code || dashCurrency);
      setScreen('home');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update profile');
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
      await api.claimRepayment(token, selectedLoan.id, {});
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
    if (tab === 'banks') setScreen('banks');
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
          <View style={[styles.flex, { paddingHorizontal: 12, paddingTop: 8 }]}>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <ChatScreen
              token={token}
              friends={friends}
              onBack={() => setScreen('home')}
              onError={(message) => setError(message)}
            />
          </View>
        ) : (
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          {!authed ? (
            <View style={{ gap: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <View style={{ flex: 1, gap: 8 }}>
                <BrandMark />
                <Text style={styles.subtitle}>Shared loan records and reminders. Not a bank.</Text>
              </View>
              <ThemeToggle />
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
              onBanks={() => setScreen('banks')}
              onLogout={onLogout}
              onProfile={() => {
                if (user) {
                  setProfileName(user.display_name);
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

          {screen === 'profile' && user ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Profile</Text>
              <Text style={styles.muted}>{user.email}</Text>
              <Field label="Display name" value={profileName} onChange={setProfileName} />
              <Field label="Locale" value={profileLocale} onChange={setProfileLocale} />
              <Field label="Timezone" value={profileTimezone} onChange={setProfileTimezone} />
              <Field label="Default currency" value={profileCurrency} onChange={setProfileCurrency} />
              <Pressable style={styles.button} onPress={onSaveProfile} disabled={busy || !profileName.trim()}>
                <Text style={styles.buttonText}>{busy ? 'Saving…' : 'Save profile'}</Text>
              </Pressable>
              <Pressable onPress={() => setScreen('home')}>
                <Text style={styles.link}>Back</Text>
              </Pressable>
            </View>
          ) : null}

          {screen === 'new-loan' ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>New loan</Text>
              <Text style={styles.muted}>Shared record only. Money still moves outside the app.</Text>
              <Text style={styles.label}>Friend</Text>
              {friends.map((friend) => (
                <Pressable
                  key={friend.id}
                  style={[styles.row, loanFriendId === friend.peer.id ? styles.selectedRow : null]}
                  onPress={() => setLoanFriendId(friend.peer.id)}
                >
                  <Text style={styles.rowTitle}>{friend.peer.display_name}</Text>
                </Pressable>
              ))}
              <View style={styles.row}>
                <Pressable style={loanRole === 'borrower' ? styles.smallButton : styles.ghostButton} onPress={() => setLoanRole('borrower')}>
                  <Text style={loanRole === 'borrower' ? styles.smallButtonText : styles.ghostButtonText}>I borrow</Text>
                </Pressable>
                <Pressable style={loanRole === 'lender' ? styles.smallButton : styles.ghostButton} onPress={() => setLoanRole('lender')}>
                  <Text style={loanRole === 'lender' ? styles.smallButtonText : styles.ghostButtonText}>I lend</Text>
                </Pressable>
              </View>
              <Field label="Principal" value={principal} onChange={setPrincipal} keyboardType="decimal-pad" />
              <Field label="Flat interest %" value={interest} onChange={setInterest} keyboardType="decimal-pad" />
              <Field label="Currency ETB or USD" value={currency} onChange={setCurrency} />
              <Field label="Due date YYYY-MM-DD" value={dueDate} onChange={setDueDate} />
              <Field label="Note" value={note} onChange={setNote} />
              <Pressable style={styles.button} onPress={onCreateLoan} disabled={busy || !loanFriendId}>
                <Text style={styles.buttonText}>{busy ? 'Working…' : 'Send for acceptance'}</Text>
              </Pressable>
              <Pressable onPress={() => setScreen('home')}>
                <Text style={styles.link}>Back</Text>
              </Pressable>
            </View>
          ) : null}

          {screen === 'loan' && selectedLoan ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{selectedLoan.reference_code}</Text>
              <StatusPill status={selectedLoan.status} />
              <Money
                value={
                  selectedLoan.expected_total
                    ? formatMoney(selectedLoan.expected_total, selectedLoan.currency_code, user?.locale)
                    : statusLabel(selectedLoan.status)
                }
                size="xl"
              />
              <Text style={styles.muted}>
                {selectedLoan.your_role === 'borrower' ? `From ${selectedLoan.lender.display_name}` : `To ${selectedLoan.borrower.display_name}`}
              </Text>
              {selectedLoan.principal ? (
                <Text style={styles.muted}>
                  Principal {formatMoney(selectedLoan.principal, selectedLoan.currency_code, user?.locale)} · flat{' '}
                  {selectedLoan.interest_rate_percent}% · due{' '}
                  {selectedLoan.due_at
                    ? new Date(selectedLoan.due_at).toLocaleDateString(user?.locale || 'en', { year: 'numeric', month: 'short', day: 'numeric' })
                    : '—'}
                </Text>
              ) : null}
              {selectedLoan.can_accept ? (
                <>
                  <Text style={styles.disclaimer}>{DISCLAIMER}</Text>
                  <Pressable
                    style={styles.button}
                    onPress={() => onLoanAction('accept')}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel="Accept loan terms and disclaimer"
                  >
                    <Text style={styles.buttonText}>Accept terms</Text>
                  </Pressable>
                </>
              ) : null}
              {selectedLoan.can_propose_terms ? (
                <View style={{ gap: 8 }}>
                  <Text style={styles.label}>Propose or update terms</Text>
                  <Field label="Principal" value={principal} onChange={setPrincipal} keyboardType="decimal-pad" />
                  <Field label="Flat interest %" value={interest} onChange={setInterest} keyboardType="decimal-pad" />
                  <Field label="Currency ETB or USD" value={currency} onChange={setCurrency} />
                  <Field label="Due date YYYY-MM-DD" value={dueDate} onChange={setDueDate} />
                  <Field label="Note" value={note} onChange={setNote} />
                  <Pressable
                    style={styles.button}
                    onPress={onProposeTerms}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel="Propose loan terms"
                  >
                    <Text style={styles.buttonText}>{busy ? 'Working…' : 'Send terms'}</Text>
                  </Pressable>
                </View>
              ) : null}
              {selectedLoan.can_reject ? (
                <Pressable style={styles.secondaryButton} onPress={() => onLoanAction('reject')} disabled={busy}>
                  <Text style={styles.secondaryButtonText}>Reject</Text>
                </Pressable>
              ) : null}
              {selectedLoan.can_cancel ? (
                <Pressable style={styles.ghostButton} onPress={() => onLoanAction('cancel')} disabled={busy}>
                  <Text style={styles.ghostButtonText}>Cancel</Text>
                </Pressable>
              ) : null}
              {selectedLoan.your_role === 'borrower' &&
              (selectedLoan.status === 'active' || selectedLoan.status === 'overdue') ? (
                <Pressable
                  style={styles.button}
                  onPress={onClaimRepayment}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel="Claim full repayment"
                >
                  <Text style={styles.buttonText}>{busy ? 'Working…' : 'I paid the outstanding amount'}</Text>
                </Pressable>
              ) : null}
              {repayments.length > 0 ? (
                <View style={{ gap: 8 }}>
                  <Text style={styles.label}>Repayments</Text>
                  {repayments.map((rep) => (
                    <View key={rep.id} style={{ gap: 6 }}>
                      <Text style={styles.rowTitle}>
                        {formatMoney(rep.amount, selectedLoan.currency_code, user?.locale)} · {statusLabel(rep.status)}
                      </Text>
                      {rep.note ? <Text style={styles.muted}>{rep.note}</Text> : null}
                      {rep.can_confirm ? (
                        <Pressable
                          style={styles.button}
                          onPress={() => onConfirmRepayment(rep.id)}
                          disabled={busy}
                          accessibilityRole="button"
                          accessibilityLabel="Confirm repayment received"
                        >
                          <Text style={styles.buttonText}>Confirm received</Text>
                        </Pressable>
                      ) : null}
                      {rep.can_reject ? (
                        <>
                          <Field label="Reject reason" value={rejectReason} onChange={setRejectReason} />
                          <Pressable
                            style={styles.secondaryButton}
                            onPress={() => onRejectRepayment(rep.id)}
                            disabled={busy}
                            accessibilityRole="button"
                            accessibilityLabel="Reject repayment claim"
                          >
                            <Text style={styles.secondaryButtonText}>Reject claim</Text>
                          </Pressable>
                        </>
                      ) : null}
                    </View>
                  ))}
                </View>
              ) : null}
              {selectedLoan.your_role === 'lender' && (selectedLoan.status === 'active' || selectedLoan.status === 'overdue') ? (
                <View style={{ gap: 8 }}>
                  <Text style={styles.label}>Share payment profile</Text>
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
                </View>
              ) : null}
              {selectedLoan.your_role === 'borrower' ? (
                <View style={{ gap: 8 }}>
                  <Text style={styles.label}>Where to send repayment</Text>
                  {paymentProfile ? (
                    <>
                      <Text style={styles.rowTitle}>
                        {paymentProfile.label} · •••• {paymentProfile.account_last4}
                      </Text>
                      {revealedNumber ? <Text style={styles.dev}>{revealedNumber}</Text> : null}
                      <Pressable style={styles.secondaryButton} onPress={() => onRevealProfile(paymentProfile.id, true)} disabled={busy}>
                        <Text style={styles.secondaryButtonText}>{busy ? 'Working…' : 'Reveal number'}</Text>
                      </Pressable>
                    </>
                  ) : (
                    <Text style={styles.muted}>The lender has not shared a payment profile yet.</Text>
                  )}
                </View>
              ) : null}
              {selectedLoan.events?.map((ev) => (
                <Text key={ev.id} style={styles.muted}>
                  {ev.event_type} · {ev.created_at.slice(0, 16)}
                </Text>
              ))}
              <Pressable onPress={() => setScreen('home')}>
                <Text style={styles.link}>Back</Text>
              </Pressable>
            </View>
          ) : null}

          {screen === 'activity' && user ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Activity</Text>
              <Text style={styles.muted}>In-app inbox for friends, loans, repayments, and due reminders.</Text>
              {unreadCount > 0 ? (
                <Pressable style={styles.secondaryButton} onPress={onMarkAllNotificationsRead} disabled={busy}>
                  <Text style={styles.secondaryButtonText}>Mark all read</Text>
                </Pressable>
              ) : null}
              {notifications.length === 0 ? (
                <Text style={styles.muted}>No notifications yet.</Text>
              ) : (
                notifications.map((n) => (
                  <Pressable
                    key={n.id}
                    style={styles.row}
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
                    <View style={styles.flex}>
                      <Text style={styles.rowTitle}>
                        {n.read_at ? '' : '• '}
                        {n.title}
                      </Text>
                      <Text style={styles.muted}>{n.body}</Text>
                      <Text style={styles.muted}>
                        {new Date(n.created_at).toLocaleString(user.locale || 'en')}
                      </Text>
                    </View>
                  </Pressable>
                ))
              )}
              <Pressable onPress={() => setScreen('home')}>
                <Text style={styles.link}>Back</Text>
              </Pressable>
            </View>
          ) : null}

          {screen === 'banks' && user ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Payment profiles</Text>
              <Text style={styles.muted}>Account numbers are encrypted. Lists show last 4 only.</Text>
              {bankProfiles.map((profile) => (
                <View key={profile.id} style={{ gap: 8 }}>
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
                      <Pressable style={styles.smallButton} onPress={() => onPatchBank(profile.id)} disabled={busy}>
                        <Text style={styles.smallButtonText}>{busy ? 'Saving…' : 'Save label'}</Text>
                      </Pressable>
                    </View>
                  ) : null}
                  {friends.length > 0 ? (
                    <Pressable
                      style={styles.secondaryButton}
                      onPress={() => onShareBank(profile.id, shareFriendId || friends[0].peer.id)}
                      disabled={busy || friends.length === 0}
                    >
                      <Text style={styles.secondaryButtonText}>Share with friend</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
              {revealedNumber ? <Text style={styles.dev}>Revealed: {revealedNumber}</Text> : null}
              <Text style={styles.label}>Add profile</Text>
              <View style={styles.row}>
                <Pressable style={bankType === 'bank_account' ? styles.smallButton : styles.ghostButton} onPress={() => setBankType('bank_account')}>
                  <Text style={bankType === 'bank_account' ? styles.smallButtonText : styles.ghostButtonText}>Bank</Text>
                </Pressable>
                <Pressable style={bankType === 'mobile_wallet' ? styles.smallButton : styles.ghostButton} onPress={() => setBankType('mobile_wallet')}>
                  <Text style={bankType === 'mobile_wallet' ? styles.smallButtonText : styles.ghostButtonText}>Wallet</Text>
                </Pressable>
                <Pressable style={bankType === 'other' ? styles.smallButton : styles.ghostButton} onPress={() => setBankType('other')}>
                  <Text style={bankType === 'other' ? styles.smallButtonText : styles.ghostButtonText}>Other</Text>
                </Pressable>
              </View>
              <Field label="Label" value={bankLabel} onChange={setBankLabel} />
              <Field label="Institution" value={bankInstitution} onChange={setBankInstitution} />
              <Field label="Account or wallet number" value={bankIdentifier} onChange={setBankIdentifier} />
              {friends.length > 0 ? (
                <>
                  <Text style={styles.label}>Default share friend</Text>
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
              <Pressable style={styles.button} onPress={onCreateBank} disabled={busy || !bankIdentifier.trim()}>
                <Text style={styles.buttonText}>{busy ? 'Working…' : 'Save encrypted profile'}</Text>
              </Pressable>
              {outgoingShares.filter((s) => !s.revoked_at).length > 0 ? <Text style={styles.label}>Shared with</Text> : null}
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
              {incomingShares.length > 0 ? <Text style={styles.label}>Shared with me</Text> : null}
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
              <Pressable onPress={() => { setRevealedNumber(null); setScreen('home'); }}>
                <Text style={styles.link}>Back</Text>
              </Pressable>
            </View>
          ) : null}

          {screen === 'register' ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Create account</Text>
              <Field label="Display name" value={displayName} onChange={setDisplayName} />
              <Field label="Email" value={email} onChange={setEmail} keyboardType="email-address" />
              <Field label="Password" value={password} onChange={setPassword} secure />
              <Text style={styles.disclaimer}>{DISCLAIMER}</Text>
              <Pressable
                style={styles.row}
                onPress={() => setAcceptedDisclaimer((v) => !v)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: acceptedDisclaimer }}
                accessibilityLabel="Accept Lony product disclaimer"
              >
                <Text style={styles.checkbox}>{acceptedDisclaimer ? '[x]' : '[ ]'}</Text>
                <Text style={[styles.muted, styles.flex]}>I understand Lony is a shared ledger, not a bank or escrow.</Text>
              </Pressable>
              <Pressable
                style={styles.button}
                onPress={onRegister}
                disabled={busy || !acceptedDisclaimer}
                accessibilityRole="button"
                accessibilityLabel="Register"
              >
                <Text style={styles.buttonText}>{busy ? 'Working…' : 'Register'}</Text>
              </Pressable>
              <Pressable onPress={() => setScreen('login')} accessibilityRole="link" accessibilityLabel="Go to sign in">
                <Text style={styles.link}>Already have an account? Sign in</Text>
              </Pressable>
            </View>
          ) : null}

          {screen === 'login' ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Sign in</Text>
              <Field label="Email" value={email} onChange={setEmail} keyboardType="email-address" />
              <Field label="Password" value={password} onChange={setPassword} secure />
              <PrimaryButton label={busy ? 'Working…' : 'Sign in'} onPress={onLogin} disabled={busy} />
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
