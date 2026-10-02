import { StatusBar } from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
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
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { api, DISCLAIMER, setTokenRefresher, type AppNotification, type BankProfile, type BankProfileShare, type CashflowEntry, type Dashboard, type Friendship, type Loan, type LoanInstallment, type Repayment, type SearchHit, type User } from './src/api';
import { formatMoney as formatMoneyLocale, stripAmount } from './src/amountFormat';
import { formatDisplayDate, formatDisplayDateTime } from './src/calendarFormat';
import { AnalyticsScreen } from './src/AnalyticsScreen';
import { AppHeader } from './src/AppHeader';
import { AuthScreens } from './src/AuthScreens';
import {
  authenticateWithBiometrics,
  getBiometricsAvailability,
  getBiometricsLockEnabled,
  isWithinBiometricsGrace,
  markBiometricsUnlocked,
} from './src/biometricsLock';
import { BiometricsLockScreen } from './src/BiometricsLockScreen';
import { BottomNav, type TabId } from './src/BottomNav';
import { COUNTRIES, CURRENCIES } from './src/catalogs';
import { ChatScreen } from './src/ChatScreen';
import { ChatSearchScreen } from './src/ChatSearchScreen';
import { DateField } from './src/DateField';
import { DrawerMenu, type DrawerItem } from './src/DrawerMenu';
import { AccountsScreen } from './src/AccountsScreen';
import { CashflowFormScreen, CashflowShowScreen } from './src/CashflowScreens';
import { DatePrefsProvider } from './src/datePrefs';
import { ExpensesScreen, type ExpensesTab } from './src/ExpensesScreen';
import { PlanScreen } from './src/PlanScreen';
import { IconBank, IconCamera, IconPlus, IconSearch } from './src/icons';
import { resolveInstitutionLabel } from './src/institutions';
import { scanReceiptWithCamera } from './src/receiptScan';
import { activateAndSyncSms, syncBankSms } from './src/smsAutoIngest';
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
import { TermsScreen } from './src/TermsScreen';
import { ThemeProvider, fonts, radii, useTheme } from './src/theme';
import { registerPushToken } from './src/push';
import { storageDelete, storageGet, storageSet } from './src/secureStorage';
import { SearchSelect } from './src/SearchSelect';
import { applyNativeDirection, parseLocaleMessages, setActivePack } from './src/i18n';
import { formatError, passwordHint } from './src/errors';
import { SettingsScreen, shareExportJSON, shareExportNote } from './src/SettingsScreen';
import { Card, DueDatePill, EmptyState, Field, Money, PrimaryButton, ScreenHeader, SecondaryButton, SectionLabel, useAppStyles } from './src/ui';

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

function formatLoanEvent(eventType: string): string {
  const map: Record<string, string> = {
    created: 'Loan created',
    terms_proposed: 'Terms proposed',
    accepted: 'Accepted',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
    marked_overdue: 'Marked overdue',
    installment_paid: 'Installment paid',
  };
  return map[eventType] ?? eventType.replaceAll('_', ' ');
}

function formatMoney(amount: string | null | undefined, currency: string | null | undefined, locale = 'en'): string {
  return formatMoneyLocale(amount, currency, locale);
}

function nextInstallmentDue(loan: Loan): string | null {
  const rows = loan.installments ?? [];
  const next = rows.find((row) => row.status === 'scheduled' || row.status === 'overdue');
  return next?.due_at ?? loan.due_at ?? null;
}

type Screen =
  | 'login'
  | 'register'
  | 'verify'
  | 'forgot'
  | 'reset'
  | 'onboarding'
  | 'home'
  | 'loans'
  | 'new-loan'
  | 'loan'
  | 'installment'
  | 'banks'
  | 'chats'
  | 'settings'
  | 'expenses'
  | 'cashflow-new'
  | 'cashflow-show'
  | 'analytics'
  | 'plan'
  | 'accounts'
  | 'peer-profile'
  | 'chat-search'
  | 'tos';

function userDatePrefs(user?: User | null) {
  return {
    locale: user?.locale || 'en',
    calendarId: (user?.calendar_id || 'gregorian') as import('./src/calendarFormat').CalendarId,
    hourCycle: (user?.hour_cycle || '24h') as import('./src/calendarFormat').HourCycle,
    timeZone: user?.timezone || 'UTC',
  };
}

function formatUserDate(iso: string | null | undefined, user?: User | null) {
  return formatDisplayDate(iso, userDatePrefs(user));
}

function formatUserDateTime(iso: string | null | undefined, user?: User | null) {
  return formatDisplayDateTime(iso, userDatePrefs(user));
}

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
  const scrollRef = useRef<ScrollView>(null);

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
  const [selectedInstallment, setSelectedInstallment] = useState<LoanInstallment | null>(null);
  const [loanFriendId, setLoanFriendId] = useState<string>('');
  const [loanLockedPeer, setLoanLockedPeer] = useState<{ id: string; display_name: string } | null>(null);
  const [chatThreadOpen, setChatThreadOpen] = useState(false);
  const [planDetailOpen, setPlanDetailOpen] = useState(false);
  const [accountsPanelOpen, setAccountsPanelOpen] = useState(false);
  const [settingsDetailOpen, setSettingsDetailOpen] = useState(false);
  const [avatarLocalUri, setAvatarLocalUri] = useState<string | null>(null);
  const [loanRole, setLoanRole] = useState<'borrower' | 'lender'>('borrower');
  const [loanKind, setLoanKind] = useState<'one_time' | 'long_term'>('one_time');
  const [partyMode, setPartyMode] = useState<'alone' | 'shared'>('alone');
  const [lenderIds, setLenderIds] = useState<string[]>([]);
  const [principal, setPrincipal] = useState('');
  const [interest, setInterest] = useState('0');
  const [currency, setCurrency] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [interestPeriodMonths, setInterestPeriodMonths] = useState('');
  const [installmentCount, setInstallmentCount] = useState('12');
  const [institutionType, setInstitutionType] = useState('');
  const [institutionId, setInstitutionId] = useState('');
  const [institutionOther, setInstitutionOther] = useState('');
  const [institutionLabel, setInstitutionLabel] = useState('');
  const [startDate, setStartDate] = useState('');
  const [note, setNote] = useState('');
  const [loanTitle, setLoanTitle] = useState('');
  const [expensesTab, setExpensesTab] = useState<ExpensesTab>('dashboard');
  const [selectedCashflow, setSelectedCashflow] = useState<CashflowEntry | null>(null);
  const [cashflowKind, setCashflowKind] = useState<'income' | 'expense'>('expense');
  const [cashflowPrefill, setCashflowPrefill] = useState<import('./src/CashflowScreens').CashflowFormPrefill | null>(
    null,
  );
  const [cashflowReload, setCashflowReload] = useState(0);
  const [accountsReload, setAccountsReload] = useState(0);
  const [wealthReload, setWealthReload] = useState(0);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [dashCurrency, setDashCurrency] = useState('');
  const [loanFilter, setLoanFilter] = useState('');
  const [peerLoanFilter, setPeerLoanFilter] = useState<{
    peerId: string;
    peerName: string;
    loanIds: string[];
  } | null>(null);
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
  const [profileCalendarId, setProfileCalendarId] = useState('gregorian');
  const [profileHourCycle, setProfileHourCycle] = useState('24h');
  const [loanRequireApproval, setLoanRequireApproval] = useState(true);
  const [askRecurringReceived, setAskRecurringReceived] = useState(true);
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
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPhoneCountry, setRegPhoneCountry] = useState('ET');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [devCode, setDevCode] = useState<string | undefined>();
  const [currentPassword, setCurrentPassword] = useState('');
  const [changePasswordNew, setChangePasswordNew] = useState('');
  const [acceptedDisclaimer, setAcceptedDisclaimer] = useState(false);

  async function loadLocalePack(code: string) {
    const localeCode = code || 'en';
    try {
      const res = await api.listLocales(localeCode);
      if ('locale' in res && res.locale) {
        setActivePack({
          locale: res.locale.code,
          name: res.locale.name,
          dir: res.locale.dir,
          messages: parseLocaleMessages(res.locale.messages),
        });
        applyNativeDirection(res.locale.code);
        return;
      }
    } catch {
      // fall through to bundled English
    }
    setActivePack({ locale: localeCode });
    applyNativeDirection(localeCode);
  }

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
    setProfileCalendarId(next.calendar_id || 'gregorian');
    setProfileHourCycle(next.hour_cycle === 'ethiopian_6' ? '24h' : next.hour_cycle || '24h');
    setLoanRequireApproval(next.loan_require_approval !== false);
    setAskRecurringReceived(next.ask_recurring_received !== false);
    setProfileCurrency(next.default_currency_code ?? '');
    setProfileTimezone(next.timezone || 'UTC');
    setCurrency((c) => c || next.default_currency_code || '');
    setDashCurrency((c) => c || next.default_currency_code || '');
    setOnboardingTos(Boolean(next.tos_accepted_at));
    void loadLocalePack(next.locale || 'en');
  }

  function enterAuthed(next: User, access: string) {
    setToken(access);
    applyUserProfile(next);
    registerPushToken(access).catch(() => undefined);
    setScreen(next.profile_complete ? 'home' : 'onboarding');
  }

  const [appLocked, setAppLocked] = useState(false);
  const [bioLabel, setBioLabel] = useState('Screen lock');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const unlockingRef = useRef(false);
  const appLockedRef = useRef(false);
  /** Bumped on each successful unlock — cancels stale "lock on background" work. */
  const unlockGenerationRef = useRef(0);
  /** While > Date.now(), ignore AppState (biometric sheet backgrounds the app). */
  const ignoreAppStateUntilRef = useRef(0);

  function setLocked(next: boolean) {
    appLockedRef.current = next;
    setAppLocked(next);
  }

  function pauseAppStateHandling(ms: number) {
    ignoreAppStateUntilRef.current = Math.max(ignoreAppStateUntilRef.current, Date.now() + ms);
  }

  function shouldIgnoreAppState(): boolean {
    return unlockingRef.current || Date.now() < ignoreAppStateUntilRef.current;
  }

  async function promptUnlock() {
    if (unlockingRef.current) return;
    if (!appLockedRef.current) return;
    unlockingRef.current = true;
    setUnlocking(true);
    setUnlockError(null);
    // Fingerprint / Face ID UI temporarily backgrounds the app on Android/iOS.
    pauseAppStateHandling(20_000);
    const genAtStart = unlockGenerationRef.current;
    try {
      const ok = await authenticateWithBiometrics('Unlock Lony');
      if (ok) {
        unlockGenerationRef.current = genAtStart + 1;
        await markBiometricsUnlocked();
        setLocked(false);
        setUnlockError(null);
        // Absorb the post-auth AppState bounce back to "active".
        pauseAppStateHandling(4_000);
      } else {
        setLocked(true);
        setUnlockError('Authentication failed. Try again.');
        pauseAppStateHandling(1_000);
      }
    } finally {
      setUnlocking(false);
      unlockingRef.current = false;
    }
  }

  useEffect(() => {
    if (!token) {
      setLocked(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const on = await getBiometricsLockEnabled();
      if (cancelled) return;
      if (!on) {
        setLocked(false);
        return;
      }
      const avail = await getBiometricsAvailability();
      if (cancelled) return;
      if (!avail.available || !avail.enrolled) {
        setLocked(false);
        return;
      }
      setBioLabel(avail.label);
      // Stay unlocked for 1 hour after the last successful unlock.
      if (await isWithinBiometricsGrace()) {
        if (cancelled) return;
        setLocked(false);
        return;
      }
      setLocked(true);
      void promptUnlock();
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (!token) return;
      if (shouldIgnoreAppState()) return;

      // Leaving the app: only lock if the 1-hour unlock grace already expired.
      if (next === 'background') {
        const genWhenBackgrounded = unlockGenerationRef.current;
        void (async () => {
          const on = await getBiometricsLockEnabled();
          if (!on) return;
          if (unlockGenerationRef.current !== genWhenBackgrounded) return;
          if (shouldIgnoreAppState()) return;
          if (await isWithinBiometricsGrace()) return;
          setLocked(true);
        })();
        return;
      }

      // Coming back: prompt only if locked and grace expired.
      if (
        next === 'active' &&
        (prev === 'background' || prev === 'inactive') &&
        !shouldIgnoreAppState()
      ) {
        void (async () => {
          const on = await getBiometricsLockEnabled();
          if (!on) return;
          if (await isWithinBiometricsGrace()) {
            setLocked(false);
            return;
          }
          if (!appLockedRef.current) setLocked(true);
          void promptUnlock();
        })();
      }
    });
    return () => sub.remove();
  }, [token]);

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
    setTokenRefresher(async () => {
      const refresh = await storageGet(REFRESH_KEY);
      if (!refresh) return null;
      try {
        const tokens = await api.refresh(refresh);
        await storageSet(ACCESS_KEY, tokens.access_token);
        await storageSet(REFRESH_KEY, tokens.refresh_token);
        setToken(tokens.access_token);
        applyUserProfile(tokens.user);
        return tokens.access_token;
      } catch {
        await storageDelete(ACCESS_KEY);
        await storageDelete(REFRESH_KEY);
        setToken(null);
        setUser(null);
        setScreen('login');
        return null;
      }
    });
    return () => setTokenRefresher(null);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const access = await storageGet(ACCESS_KEY);
        const refresh = await storageGet(REFRESH_KEY);
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
          await storageSet(ACCESS_KEY, tokens.access_token);
          await storageSet(REFRESH_KEY, tokens.refresh_token);
          enterAuthed(tokens.user, tokens.access_token);
          return;
        }
        await storageDelete(ACCESS_KEY);
        await storageDelete(REFRESH_KEY);
      } catch {
        await storageDelete(ACCESS_KEY);
        await storageDelete(REFRESH_KEY);
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

  useEffect(() => {
    if (screen !== 'settings') {
      setSettingsDetailOpen(false);
    }
  }, [screen]);

  async function persistTokens(access: string, refresh: string, nextUser: User) {
    await storageSet(ACCESS_KEY, access);
    await storageSet(REFRESH_KEY, refresh);
    enterAuthed(nextUser, access);
  }

  async function onRegister() {
    setBusy(true);
    setError(null);
    try {
      const fn = firstName.trim();
      const ln = lastName.trim();
      if (!fn || !ln) {
        setError('First and last name are required.');
        return;
      }
      if (!email.trim() || !email.includes('@')) {
        setError('Enter a valid email address.');
        return;
      }
      const hint = passwordHint(password);
      if (hint) {
        setError(hint);
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
      if (!regPhone.trim()) {
        setError('Phone number is required.');
        return;
      }
      const name = `${fn} ${ln}`.trim();
      setDisplayName(name);
      const res = await api.register(email.trim(), password, name, acceptedDisclaimer, {
        first_name: fn,
        last_name: ln,
        phone_e164: regPhone.trim(),
        country_code: regPhoneCountry,
      });
      setDevCode(res.verification_code);
      setProfileFirstName(fn);
      setProfileLastName(ln);
      setProfilePhone(regPhone.trim());
      setProfileCountry(regPhoneCountry);
      setScreen('verify');
    } catch (e) {
      setError(formatError(e, 'Registration failed'));
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
      setError(formatError(e, 'Verification failed'));
    } finally {
      setBusy(false);
    }
  }

  async function onResendVerification() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.resendVerification(email.trim());
      setDevCode(res.verification_code);
      setError(res.verification_hint);
    } catch (e) {
      setError(formatError(e, 'Could not resend code'));
    } finally {
      setBusy(false);
    }
  }

  async function onSendResetCode() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.forgotPassword(email.trim());
      setDevCode(res.verification_code);
      setCode('');
      setNewPassword('');
      setScreen('reset');
      setError(res.verification_hint);
    } catch (e) {
      setError(formatError(e, 'Could not send reset code'));
    } finally {
      setBusy(false);
    }
  }

  async function onResetPassword() {
    setBusy(true);
    setError(null);
    try {
      await api.resetPassword(email.trim(), code.trim(), newPassword);
      setPassword(newPassword);
      setNewPassword('');
      setCode('');
      setDevCode(undefined);
      setScreen('login');
      setError('Password updated. Sign in with your new password.');
    } catch (e) {
      setError(formatError(e, 'Could not reset password'));
    } finally {
      setBusy(false);
    }
  }

  async function onChangePassword() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await api.changePassword(token, currentPassword, changePasswordNew);
      setCurrentPassword('');
      setChangePasswordNew('');
      setError('Password updated.');
    } catch (e) {
      setError(formatError(e, 'Could not change password'));
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
      const message = formatError(e, 'Sign in failed');
      setError(message);
      if (/verify/i.test(message)) {
        setScreen('verify');
      }
    } finally {
      setBusy(false);
    }
  }

  async function onLogout() {
    const token = await storageGet(ACCESS_KEY);
    if (token) {
      try {
        await api.logout(token);
      } catch {
        // still clear local session
      }
    }
    await storageDelete(ACCESS_KEY);
    await storageDelete(REFRESH_KEY);
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
    setAvatarLocalUri(null);
    setSettingsDetailOpen(false);
    setScreen('login');
  }

  async function onExportData() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.exportMyData(token);
      await shareExportJSON(res.export);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  }

  async function onExportLedger() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.exportLedgerCSV(token);
      const body = [
        '=== cashflow.csv ===',
        res.cashflow_csv,
        '=== transfers.csv ===',
        res.transfers_csv,
        '=== accounts.csv ===',
        res.accounts_csv,
      ].join('\n');
      await shareExportNote('Lony ledger CSV', body);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ledger export failed');
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteAccount() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount(token);
      await onLogout();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete account');
      setBusy(false);
    }
  }

  async function onClearAI() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await api.clearAIInsights(token);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not clear AI history');
    } finally {
      setBusy(false);
    }
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
        setError(formatError(e, 'Could not load your data'));
      });
    }
  }, [screen, token]);

  useEffect(() => {
    if (screen !== 'home' || !token) return;
    let cancelled = false;
    (async () => {
      try {
        const acc = await api.listAccounts(token);
        if (cancelled) return;
        const accountId = acc.accounts?.[0]?.id;
        const res = await syncBankSms(token, accountId);
        if (!cancelled && (res.imported > 0 || res.accountsAdded > 0)) {
          setCashflowReload((n) => n + 1);
          setWealthReload((n) => n + 1);
          setAccountsReload((n) => n + 1);
        }
      } catch {
        /* silent — SMS sync is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [screen, token]);

  async function onActivateSmsImport() {
    if (!token || !user) return;
    setBusy(true);
    try {
      const res = await activateAndSyncSms(
        token,
        (profileCurrency || user.default_currency_code || 'USD').toUpperCase(),
      );
      if (res.imported > 0 || res.accountsAdded > 0) {
        setCashflowReload((n) => n + 1);
        setWealthReload((n) => n + 1);
        setAccountsReload((n) => n + 1);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'SMS import failed');
    } finally {
      setBusy(false);
    }
  }

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
    // Bonds form when a loan/split is accepted â€” open a loan with this person.
    setLoanFriendId(hit.id);
    setLoanLockedPeer({ id: hit.id, display_name: hit.display_name });
    setCurrency(user?.default_currency_code ?? '');
    setHits([]);
    setQuery('');
    setScreen('new-loan');
  }

  async function onAccept(id: string) {
    // Legacy pending friendship rows: accepting still upgrades the bond.
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
        calendar_id: profileCalendarId.trim() || 'gregorian',
        hour_cycle: profileHourCycle.trim() || '24h',
        timezone: profileTimezone.trim() || 'UTC',
        default_currency_code: profileCurrency.trim().toUpperCase(),
      });
      applyUserProfile(res.user);
      setCurrency(res.user.default_currency_code ?? '');
      setDashCurrency(res.user.default_currency_code ?? '');
      setSettingsDetailOpen(false);
      setScreen(res.user.profile_complete ? 'home' : 'onboarding');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update profile');
    } finally {
      setBusy(false);
    }
  }

  async function onSaveRegion() {
    if (!token) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.patchMe(token, {
        locale: profileLocale.trim() || 'en',
        calendar_id: profileCalendarId.trim() || 'gregorian',
        hour_cycle: profileHourCycle.trim() === 'ethiopian_6' ? '24h' : profileHourCycle.trim() || '24h',
        timezone: profileTimezone.trim() || 'UTC',
        ...(profileCurrency.trim().length === 3
          ? { default_currency_code: profileCurrency.trim().toUpperCase() }
          : {}),
        loan_require_approval: loanRequireApproval,
        ask_recurring_received: askRecurringReceived,
      });
      applyUserProfile(res.user);
      setCurrency(res.user.default_currency_code ?? '');
      setDashCurrency(res.user.default_currency_code ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update preferences');
    } finally {
      setBusy(false);
    }
  }

  async function onSaveAskRecurring(next: boolean) {
    setAskRecurringReceived(next);
    if (!token) return;
    try {
      const res = await api.patchMe(token, { ask_recurring_received: next });
      applyUserProfile(res.user);
    } catch (e) {
      setAskRecurringReceived(!next);
      setError(e instanceof Error ? e.message : 'Could not update preference');
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
    if (picked.canceled || !picked.assets?.[0]) {
      return;
    }
    const asset = picked.assets[0];
    let b64 = asset.base64 ?? null;
    if (!b64 && asset.uri) {
      try {
        const legacy = await import('expo-file-system/legacy');
        b64 = await legacy.readAsStringAsync(asset.uri, { encoding: 'base64' });
      } catch {
        setError('Could not read the selected photo');
        return;
      }
    }
    if (!b64) {
      setError('Could not read the selected photo');
      return;
    }
    if (asset.uri) {
      setAvatarLocalUri(asset.uri);
    }
    setBusy(true);
    setError(null);
    try {
      const mime = asset.mimeType || (asset.uri?.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
      const res = await api.uploadAvatar(token, {
        filename: asset.fileName ?? (mime === 'image/png' ? 'avatar.png' : 'avatar.jpg'),
        mime,
        attachment_base64: b64,
      });
      applyUserProfile(res.user);
      // Keep localUri so preview stays visible while AuthenticatedAvatar caches remote.
    } catch (e) {
      setAvatarLocalUri(null);
      setError(e instanceof Error ? e.message : 'Could not upload photo');
    } finally {
      setBusy(false);
    }
  }

  async function onGoogleSignIn() {
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
    if (!token) {
      return;
    }
    const institutionName =
      resolveInstitutionLabel(institutionType, institutionId, institutionOther).trim() ||
      institutionOther.trim() ||
      (institutionType ? institutionType.replace(/_/g, ' ') : '');
    const alone =
      loanKind === 'long_term' &&
      (partyMode === 'alone' || (!loanLockedPeer && lenderIds.length === 0 && !loanFriendId));
    const lenders = alone
      ? []
      : loanLockedPeer
        ? [loanLockedPeer.id]
        : lenderIds.length
          ? lenderIds
          : loanFriendId
            ? [loanFriendId]
            : [];
    if (loanKind === 'one_time' && !loanFriendId && !loanLockedPeer) {
      return;
    }
    if (loanKind === 'long_term') {
      if (!institutionName) {
        setError('Select or enter the financial institution');
        return;
      }
      if (!alone && lenders.length === 0) {
        setError('Add at least one lender, or choose Alone');
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const period = Number(interestPeriodMonths) || 0;
      const months = Number(stripAmount(installmentCount)) || 0;
      const principalRaw = stripAmount(principal);
      const interestRaw = stripAmount(interest) || '0';
      const hasTerms =
        loanKind === 'long_term'
          ? Boolean(principalRaw && currency.trim() && months >= 2)
          : Boolean(principalRaw && dueDate.trim() && currency.trim());
      if (loanKind === 'one_time' && dueDate.trim() && dueDate.trim() < new Date().toISOString().slice(0, 10)) {
        setError('Due date cannot be before today');
        setBusy(false);
        return;
      }
      if (loanKind === 'one_time' && startDate.trim() && dueDate.trim() && dueDate.trim() < startDate.trim()) {
        setError('Due date cannot be before the start date');
        setBusy(false);
        return;
      }
      if (principalRaw && !currency.trim()) {
        setError('Select a currency');
        setBusy(false);
        return;
      }
      if (loanKind === 'one_time' && Number(interestRaw) > 0 && period < 1) {
        setError('Set an interest calculating period (months)');
        setBusy(false);
        return;
      }
      if (!loanTitle.trim() && !institutionName) {
        setError('Add a title so you can tell loans apart');
        setBusy(false);
        return;
      }
      const body: Parameters<typeof api.createLoan>[1] = {
        role: alone ? 'borrower' : loanRole,
        loan_kind: loanKind === 'long_term' || alone ? 'long_term' : 'one_time',
      };
      if (!alone && lenders[0]) {
        body.counterparty_id = lenders[0];
      }
      if (!alone && lenders.length > 1) {
        body.co_lender_ids = lenders.slice(1);
      }
      if (loanKind === 'long_term' || alone) {
        body.party_mode = alone ? 'alone' : 'shared';
        body.institution_label = institutionName;
        if (institutionType) {
          body.institution_type = institutionType;
        }
      }
      if (hasTerms) {
        body.principal = principalRaw;
        body.currency_code = currency.trim().toUpperCase();
        body.interest_rate_percent = interestRaw;
        if (loanKind === 'one_time' && !alone) {
          body.due_at = new Date(`${dueDate.trim()}T12:00:00.000Z`).toISOString();
          if (period > 0) body.interest_period_months = period;
        } else {
          body.installment_count = months;
          body.interest_period_months = months;
          if (startDate.trim()) {
            body.start_at = new Date(`${startDate.trim()}T12:00:00.000Z`).toISOString();
          }
        }
      }
      if (note.trim()) {
        body.note = note.trim();
      }
      if (loanTitle.trim()) {
        body.title = loanTitle.trim();
      } else if (institutionName) {
        body.title = institutionName;
      }
      const created = await api.createLoan(token, body);
      setSelectedLoan(created.loan);
      setInstitutionLabel(institutionName);
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

  async function onMarkInstallmentPaid() {
    if (!token || !selectedLoan || !selectedInstallment) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.markInstallmentPaid(token, selectedLoan.id, selectedInstallment.id);
      setSelectedLoan(res.loan);
      const next = (res.loan.installments ?? []).find((row) => row.id === selectedInstallment.id) ?? null;
      setSelectedInstallment(next);
      await refreshFriends();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not mark installment paid');
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
        if (Platform.OS === 'web' && typeof fetch === 'function') {
          const blob = await fetch(asset.uri).then((r) => r.blob());
          body.proof_base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = String(reader.result || '');
              const idx = result.indexOf(',');
              resolve(idx >= 0 ? result.slice(idx + 1) : result);
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
        } else {
          body.proof_base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'base64' });
        }
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
  const detailChromeHidden =
    chatThreadOpen ||
    planDetailOpen ||
    accountsPanelOpen ||
    settingsDetailOpen;

  const showNav =
    authed &&
    user?.profile_complete &&
    !detailChromeHidden &&
    (screen === 'home' || screen === 'loans' || screen === 'chats' || screen === 'chat-search');

  const showChrome =
    authed &&
    user?.profile_complete &&
    !detailChromeHidden &&
    !['login', 'register', 'verify', 'onboarding', 'tos', 'loan', 'installment', 'new-loan', 'cashflow-new', 'cashflow-show', 'peer-profile', 'banks'].includes(screen);

  function drawerActive(): DrawerItem | null {
    if (screen === 'expenses' || screen === 'home' || screen === 'cashflow-new' || screen === 'cashflow-show') {
      return 'expenses';
    }
    if (screen === 'accounts') return 'accounts';
    if (
      screen === 'loans' ||
      screen === 'chats' ||
      screen === 'chat-search' ||
      screen === 'loan' ||
      screen === 'installment' ||
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
    if (s === 'loans' || s === 'loan' || s === 'new-loan' || s === 'installment') return 'loans';
    if (s === 'chats' || s === 'chat-search' || s === 'peer-profile') return 'chats';
    return 'home';
  }

  function goTab(tab: TabId) {
    if (tab === 'home') {
      setExpensesTab('dashboard');
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
    setPeerLoanFilter(null);
    if (item === 'expenses') {
      setExpensesTab('dashboard');
      setScreen('home');
    }
    if (item === 'accounts') setScreen('accounts');
    if (item === 'loans') setScreen('loans');
    if (item === 'analytics') setScreen('analytics');
    if (item === 'plan') setScreen('plan');
    if (item === 'settings') {
      if (user) applyUserProfile(user);
      setScreen('settings');
    }
  }

  const selfInitial = user
    ? ((user.first_name || user.display_name || user.username || '?').trim().slice(0, 1).toUpperCase() || '?')
    : '?';

  const headerSearch =
    showChrome && (screen === 'chats' || screen === 'chat-search') ? (
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

  const headerCamera =
    showChrome && screen === 'home' && token ? (
      <Pressable
        onPress={async () => {
          try {
            setBusy(true);
            let accountId: string | undefined;
            try {
              const acc = await api.listAccounts(token);
              accountId = acc.accounts?.[0]?.id;
            } catch {
              /* optional */
            }
            const draft = await scanReceiptWithCamera(token, accountId);
            if (draft) {
              setCashflowKind(draft.kind === 'income' ? 'income' : 'expense');
              setSelectedCashflow(null);
              setCashflowPrefill({
                title: draft.title || 'Receipt',
                amount: draft.amount || '',
                currency_code: draft.currency_code || undefined,
                note: draft.note,
                occurred_at: draft.occurred_at,
              });
              setExpensesTab('expenses');
              setScreen('cashflow-new');
            }
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Receipt scan failed');
          } finally {
            setBusy(false);
          }
        }}
        accessibilityRole="button"
        accessibilityLabel="Scan receipt"
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
        <IconCamera size={18} color={colors.text} />
      </Pressable>
    ) : undefined;

  const headerRight = headerSearch ?? headerCamera;

  return (
    <DatePrefsProvider
      value={{
        calendarId: profileCalendarId || user?.calendar_id || 'gregorian',
        hourCycle: profileHourCycle || user?.hour_cycle || '24h',
        timeZone: profileTimezone || user?.timezone || 'UTC',
        locale: profileLocale || user?.locale || 'en',
      }}
    >
    <SafeAreaView style={styles.safe}>
      <StatusBar style={resolved === 'dark' ? 'light' : 'dark'} />
      {token && appLocked ? (
        <BiometricsLockScreen
          busy={unlocking}
          label={bioLabel}
          error={unlockError}
          onUnlock={() => void promptUnlock()}
        />
      ) : null}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <DrawerMenu
          open={drawerOpen}
          active={drawerActive()}
          locale={user?.locale}
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
          ref={scrollRef}
          contentContainerStyle={[
            styles.container,
            showNav ? { paddingBottom: 96 } : null,
            screen === 'new-loan' ? { paddingBottom: 280 } : null,
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
        >
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {showChrome ? <AppHeader onMenu={() => setDrawerOpen(true)} right={headerRight} /> : null}

          {!authed && (screen === 'login' || screen === 'register' || screen === 'verify' || screen === 'forgot' || screen === 'reset') ? (
            <AuthScreens
              mode={screen}
              email={email}
              password={password}
              confirmPassword={confirmPassword}
              firstName={firstName}
              lastName={lastName}
              phone={regPhone}
              phoneCountry={regPhoneCountry}
              displayName={displayName}
              code={code}
              newPassword={newPassword}
              devCode={devCode}
              busy={busy}
              acceptedDisclaimer={acceptedDisclaimer}
              onEmail={setEmail}
              onPassword={setPassword}
              onConfirmPassword={setConfirmPassword}
              onFirstName={setFirstName}
              onLastName={setLastName}
              onPhone={setRegPhone}
              onPhoneCountry={setRegPhoneCountry}
              onDisplayName={setDisplayName}
              onCode={setCode}
              onNewPassword={setNewPassword}
              onToggleDisclaimer={() => setAcceptedDisclaimer((v) => !v)}
              onLogin={onLogin}
              onRegister={onRegister}
              onVerify={onVerify}
              onResend={onResendVerification}
              onSendReset={onSendResetCode}
              onResetPassword={onResetPassword}
              onGoogle={onGoogleSignIn}
              onTelegram={onTelegramSignIn}
              onGoLogin={() => setScreen('login')}
              onGoRegister={() => setScreen('register')}
              onGoForgot={() => {
                setError(null);
                setDevCode(undefined);
                setScreen('forgot');
              }}
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
            <ExpensesScreen
              user={user}
              token={token}
              friends={friends}
              loans={loans}
              tab={expensesTab}
              onTab={setExpensesTab}
              formatMoney={formatMoney}
              onError={(message) => setError(message)}
              onOpenLoan={openLoan}
              reloadToken={cashflowReload}
              wealthReloadToken={wealthReload + accountsReload}
              onOpenAccounts={() => setScreen('accounts')}
              onOpenEntry={(entry) => {
                setSelectedCashflow(entry);
                setScreen('cashflow-show');
              }}
            />
          ) : null}

          {screen === 'accounts' && user && token ? (
            <AccountsScreen
              user={user}
              token={token}
              formatMoney={formatMoney}
              onError={(message) => setError(message)}
              reloadToken={accountsReload}
              onPanelChange={setAccountsPanelOpen}
              onChanged={() => {
                setAccountsReload((n) => n + 1);
                setWealthReload((n) => n + 1);
              }}
            />
          ) : null}

          {screen === 'cashflow-new' && user && token ? (
            <CashflowFormScreen
              user={user}
              token={token}
              kind={cashflowKind}
              friends={friends}
              loans={loans}
              editing={selectedCashflow}
              prefill={cashflowPrefill}
              countryCode={profileCountry || user.country_code || 'US'}
              onBack={() => {
                setSelectedCashflow(null);
                setCashflowPrefill(null);
                setScreen('home');
              }}
              onSaved={() => {
                setSelectedCashflow(null);
                setCashflowPrefill(null);
                setCashflowReload((n) => n + 1);
                setWealthReload((n) => n + 1);
                setExpensesTab(cashflowKind === 'income' ? 'income' : 'expenses');
                setScreen('home');
              }}
              onError={(message) => setError(message)}
              onFriendsChanged={() => {
                void refreshFriends();
              }}
              onLookupPhone={async (e164) => {
                try {
                  const res = await api.lookupPhone(token, e164);
                  if (res.user) {
                    return {
                      status: 'selected' as const,
                      id: res.user.id,
                      name: res.user.display_name,
                    };
                  }
                  await api.invitePhone(token, e164).catch(() => undefined);
                  return { status: 'invited' as const };
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Could not look up phone');
                  return { status: 'error' as const };
                }
              }}
            />
          ) : null}

          {screen === 'cashflow-show' && user && token && selectedCashflow ? (
            <CashflowShowScreen
              user={user}
              token={token}
              entry={selectedCashflow}
              friends={friends}
              formatMoney={formatMoney}
              onBack={() => {
                setSelectedCashflow(null);
                setScreen('home');
              }}
              onEdit={() => {
                setCashflowKind(
                  selectedCashflow.kind === 'income' || selectedCashflow.is_template ? 'income' : 'expense',
                );
                setScreen('cashflow-new');
              }}
              onDeleted={() => {
                setSelectedCashflow(null);
                setCashflowReload((n) => n + 1);
                setWealthReload((n) => n + 1);
                setScreen('home');
              }}
              onOpenLoan={openLoan}
              onError={(message) => setError(message)}
              onUpdated={(entry) => {
                setSelectedCashflow(entry);
                setCashflowReload((n) => n + 1);
                setWealthReload((n) => n + 1);
              }}
            />
          ) : null}

          {screen === 'loans' && user ? (
            <View style={{ gap: 12 }}>
              {peerLoanFilter ? (
                <ScreenHeader title={peerLoanFilter.peerName} onBack={() => setPeerLoanFilter(null)} />
              ) : null}
              <LoansScreen
                user={user}
                loans={
                  peerLoanFilter
                    ? loans.filter((l) => peerLoanFilter.loanIds.includes(l.id))
                    : loans
                }
                onOpenLoan={openLoan}
                formatMoney={formatMoney}
                onOpenPeer={
                  peerLoanFilter
                    ? undefined
                    : (peerId, peerName, loanIds) => {
                        setPeerLoanFilter({ peerId, peerName, loanIds });
                      }
                }
                peerDetail={Boolean(peerLoanFilter)}
              />
            </View>
          ) : null}

          {screen === 'analytics' && user && token ? (
            <AnalyticsScreen
              user={user}
              token={token}
              dashboard={dashboard}
              formatMoney={formatMoney}
              onError={(message) => setError(message)}
              onOpenDeepLink={(link) => {
                const path = link.replace(/^lony:\/\//i, '').replace(/^\//, '').toLowerCase();
                if (path === 'expenses' || path === 'expenses/') {
                  setExpensesTab('dashboard');
                  setScreen('home');
                  return;
                }
                if (path === 'expenses/new' || path.startsWith('expenses/new')) {
                  setCashflowKind('expense');
                  setExpensesTab('expenses');
                  setScreen('cashflow-new');
                  return;
                }
                if (path === 'plan' || path.startsWith('plan')) {
                  setScreen('plan');
                  return;
                }
                if (path === 'loans' || path.startsWith('loans')) {
                  setScreen('loans');
                  return;
                }
                if (path === 'insights' || path.startsWith('insights') || path === 'analytics') {
                  setScreen('analytics');
                }
              }}
            />
          ) : null}

          {screen === 'plan' && user && token ? (
            <PlanScreen
              user={user}
              token={token}
              formatMoney={formatMoney}
              onError={(message) => setError(message)}
              onDetailChange={setPlanDetailOpen}
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
              calendarId={profileCalendarId}
              hourCycle={profileHourCycle}
              authPref={profileAuthPref}
              profileComplete={Boolean(user.profile_complete)}
              tosAccepted={Boolean(user.tos_accepted_at)}
              tosVersion={user.tos_version}
              isAdmin={user.role === 'admin'}
              planTier={user.plan_tier}
              token={token ?? undefined}
              avatarUrl={user.avatar_url}
              avatarLocalUri={avatarLocalUri}
              busy={busy}
              onSettingsPageChange={setSettingsDetailOpen}
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
              onCalendarId={setProfileCalendarId}
              onHourCycle={setProfileHourCycle}
              loanRequireApproval={loanRequireApproval}
              onLoanRequireApproval={setLoanRequireApproval}
              askRecurringReceived={askRecurringReceived}
              onAskRecurringReceived={(v) => {
                void onSaveAskRecurring(v);
              }}
              onActivateSmsImport={() => onActivateSmsImport()}
              onAuthPref={setProfileAuthPref}
              onSave={onSaveProfile}
              onSaveRegion={onSaveRegion}
              onAvatar={onPickAvatar}
              onTos={() => setScreen('tos')}
              onBanks={() => {
                setScreen('banks');
                api.listPaymentRails().then((res) => setPaymentRails(res.rails ?? [])).catch(() => undefined);
              }}
              onExportData={onExportData}
              onExportLedger={onExportLedger}
              onDeleteAccount={onDeleteAccount}
              onClearAI={onClearAI}
              onLogout={onLogout}
              currentPassword={currentPassword}
              changePasswordNew={changePasswordNew}
              onCurrentPassword={setCurrentPassword}
              onChangePasswordNew={setChangePasswordNew}
              onChangePassword={onChangePassword}
            />
          ) : null}

          {screen === 'new-loan' && user && token ? (
            <NewLoanScreen
              token={token}
              friends={friends}
              loanFriendId={loanFriendId}
              lenderIds={lenderIds}
              loanRole={loanRole}
              loanKind={loanKind}
              partyMode={partyMode}
              principal={principal}
              interest={interest}
              currency={currency}
              dueDate={dueDate}
              interestPeriodMonths={interestPeriodMonths}
              installmentCount={installmentCount}
              institutionType={institutionType}
              institutionId={institutionId}
              institutionOther={institutionOther}
              startDate={startDate}
              note={note}
              loanTitle={loanTitle}
              busy={busy}
              countryCode={profileCountry || user.country_code || 'US'}
              lockedPeer={loanLockedPeer}
              onSelectFriend={setLoanFriendId}
              onToggleLender={(id) => {
                setLenderIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
                setLoanFriendId(id);
              }}
              onRole={setLoanRole}
              onLoanKind={(kind) => {
                setLoanKind(kind);
                if (kind === 'long_term') {
                  setPartyMode('alone');
                }
              }}
              onPartyMode={(mode) => {
                setPartyMode(mode);
                if (mode === 'alone') {
                  setLenderIds([]);
                  setLoanFriendId('');
                }
              }}
              onPrincipal={setPrincipal}
              onInterest={setInterest}
              onCurrency={setCurrency}
              onDueDate={setDueDate}
              onInterestPeriodMonths={setInterestPeriodMonths}
              onInstallmentCount={setInstallmentCount}
              onInstitutionType={setInstitutionType}
              onInstitutionId={setInstitutionId}
              onInstitutionOther={setInstitutionOther}
              onStartDate={setStartDate}
              onNote={setNote}
              onLoanTitle={setLoanTitle}
              onBack={() => setScreen(loanLockedPeer ? 'chats' : 'loans')}
              onCreate={onCreateLoan}
              onError={(message) => setError(message)}
              onFieldFocus={(y) => {
                scrollRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true });
              }}
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
                  setLenderIds((prev) => (prev.includes(res.user!.id) ? prev : [...prev, res.user!.id]));
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

          {screen === 'peer-profile' && peerProfile && user && token ? (
            <PeerProfileScreen
              token={token}
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
            <View style={{ gap: 14, paddingTop: 4 }}>
              <ScreenHeader
                title={selectedLoan.title || selectedLoan.reference_code}
                onBack={() => setScreen('loans')}
                right={
                  <DueDatePill
                    dueAt={nextInstallmentDue(selectedLoan)}
                    status={selectedLoan.status}
                    locale={user?.locale}
                  />
                }
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
                {selectedLoan.title ? (
                  <Text style={[styles.muted, { marginBottom: 4 }]}>{selectedLoan.reference_code}</Text>
                ) : null}
                {(() => {
                  if (selectedLoan.institution_label) {
                    return (
                      <Text style={[styles.link, { fontFamily: fonts.uiSemi, fontSize: 15 }]}>
                        {selectedLoan.institution_label}
                      </Text>
                    );
                  }
                  if (selectedLoan.borrower.id === selectedLoan.lender.id) {
                    return <Text style={styles.muted}>Your debt</Text>;
                  }
                  const peer =
                    selectedLoan.your_role === 'borrower' ? selectedLoan.lender : selectedLoan.borrower;
                  const prefix = selectedLoan.your_role === 'borrower' ? 'From' : 'To';
                  if (peer?.id) {
                    return (
                      <Pressable
                        onPress={() => {
                          setChatPeerId(peer.id);
                          setScreen('chats');
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`${prefix} ${peer.display_name}`}
                      >
                        <Text style={[styles.link, { fontFamily: fonts.uiSemi, fontSize: 15 }]}>
                          {prefix} {peer.display_name}
                        </Text>
                      </Pressable>
                    );
                  }
                  return <Text style={styles.muted}>{prefix} â€” Invite to Lony</Text>;
                })()}
                {selectedLoan.loan_kind === 'long_term' && selectedLoan.installment_amount ? (
                  <Text style={[styles.muted, { marginTop: 6 }]}>
                    {formatMoney(selectedLoan.installment_amount, selectedLoan.currency_code, user?.locale)}/mo
                    {selectedLoan.installment_count ? ` Â· ${selectedLoan.installment_count} months` : ''}
                  </Text>
                ) : null}
                {selectedLoan.interest_period_months && selectedLoan.loan_kind !== 'long_term' ? (
                  <Text style={[styles.muted, { marginTop: 4 }]}>
                    Interest period Â· {selectedLoan.interest_period_months} mo
                  </Text>
                ) : null}
              </Card>

              {selectedLoan.installments && selectedLoan.installments.length > 0 ? (
                <Card>
                  <SectionLabel>Monthly repayments</SectionLabel>
                  {(() => {
                    const nextUnpaidId =
                      selectedLoan.installments.find(
                        (row) => row.status === 'scheduled' || row.status === 'overdue',
                      )?.id ?? null;
                    const startToday = new Date();
                    startToday.setHours(0, 0, 0, 0);
                    return selectedLoan.installments.map((inst) => {
                      const due = new Date(inst.due_at);
                      const paid = inst.status === 'paid';
                      const startDue = new Date(due.getFullYear(), due.getMonth(), due.getDate());
                      const passed = !paid && startDue < startToday;
                      const isNext = !paid && inst.id === nextUnpaidId;
                      let toneBg = colors.surface;
                      let toneFg = colors.text;
                      if (isNext) {
                        toneBg = colors.successSoft;
                        toneFg = colors.success;
                      } else if (passed) {
                        toneBg = colors.warningSoft;
                        toneFg = colors.warning;
                      }
                      return (
                        <Pressable
                          key={inst.id}
                          onPress={() => {
                            setSelectedInstallment(inst);
                            setScreen('installment');
                          }}
                          style={{
                            flexDirection: 'row',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            paddingVertical: 12,
                            paddingHorizontal: 12,
                            marginBottom: 8,
                            borderRadius: radii.md,
                            backgroundColor: toneBg,
                            borderWidth: 1,
                            borderColor: colors.border,
                            gap: 10,
                          }}
                        >
                          <View style={{ flex: 1, gap: 2 }}>
                            <Text style={{ color: toneFg, fontFamily: fonts.uiSemi, fontSize: 14 }}>
                              {formatUserDate(inst.due_at, user)}
                            </Text>
                            <Text style={{ color: toneFg, fontFamily: fonts.ui, fontSize: 12, opacity: 0.85 }}>
                              {paid ? 'Paid' : formatUserDate(inst.due_at, user)}
                            </Text>
                          </View>
                          <Text style={{ color: toneFg, fontFamily: fonts.uiSemi, fontSize: 14 }}>
                            {formatMoney(inst.amount, selectedLoan.currency_code, user?.locale)}
                          </Text>
                        </Pressable>
                      );
                    });
                  })()}
                </Card>
              ) : null}

              {selectedLoan.can_accept ? (
                <Card>
                  <Text style={styles.disclaimer}>{DISCLAIMER}</Text>
                  <PrimaryButton label="Accept terms" onPress={() => onLoanAction('accept')} disabled={busy} />
                </Card>
              ) : null}

              {selectedLoan.can_propose_terms ? (
                <Card>
                  <SectionLabel>Propose or update terms</SectionLabel>
                  <Field label="Principal" value={principal} onChange={setPrincipal} money />
                  <Field label="Flat interest %" value={interest} onChange={setInterest} keyboardType="decimal-pad" />
                  <SearchSelect label="Currency" value={currency} onChange={setCurrency} options={CURRENCIES} />
                  <DateField
                    label="Due date"
                    value={dueDate}
                    onChange={setDueDate}
                    minDate={new Date().toISOString().slice(0, 10)}
                  />
                  <Field label="Note" value={note} onChange={setNote} />
                  <PrimaryButton label={busy ? 'Workingâ€¦' : 'Send terms'} onPress={onProposeTerms} disabled={busy} />
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
              (selectedLoan.status === 'active' || selectedLoan.status === 'overdue') &&
              !(selectedLoan.installments && selectedLoan.installments.length > 0) ? (
                <Card>
                  <PrimaryButton label={busy ? 'Workingâ€¦' : 'I paid (optional proof)'} onPress={onClaimRepayment} disabled={busy} />
                </Card>
              ) : null}

              {repayments.length > 0 ? (
                <Card>
                  <SectionLabel>Repayments</SectionLabel>
                  {repayments.map((rep) => (
                    <View key={rep.id} style={{ gap: 8 }}>
                      <Text style={styles.rowTitle}>
                        {formatMoney(rep.amount, selectedLoan.currency_code, user?.locale)} Â· {statusLabel(rep.status)}
                      </Text>
                      {rep.note ? <Text style={styles.muted}>{rep.note}</Text> : null}
                      {rep.proof_url ? <Text style={styles.dev}>Proof Â· {rep.proof_name || 'attachment'}</Text> : null}
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

              {selectedLoan.your_role === 'lender' &&
              selectedLoan.borrower.id !== selectedLoan.lender.id &&
              (selectedLoan.status === 'active' || selectedLoan.status === 'overdue') ? (
                <Card>
                  <SectionLabel>Payment profile</SectionLabel>
                  {bankProfiles.length === 0 ? (
                    <Pressable
                      onPress={() => setScreen('banks')}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 10,
                        minHeight: 52,
                        borderRadius: radii.md,
                        backgroundColor: colors.primarySoft,
                        borderWidth: 1,
                        borderColor: colors.primary,
                      }}
                    >
                      <IconBank size={18} color={colors.primary} />
                      <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 15 }}>
                        Add a payment profile
                      </Text>
                    </Pressable>
                  ) : (
                    bankProfiles.map((profile) => (
                      <Pressable
                        key={profile.id}
                        onPress={() => onShareBank(profile.id, selectedLoan.borrower.id, selectedLoan.id)}
                        disabled={busy}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 12,
                          minHeight: 56,
                          paddingHorizontal: 16,
                          borderRadius: radii.md,
                          backgroundColor: colors.primary,
                          opacity: busy ? 0.5 : 1,
                          marginBottom: 8,
                        }}
                      >
                        <IconBank size={20} color={colors.onPrimary} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colors.onPrimary, fontFamily: fonts.uiSemi, fontSize: 15 }}>
                            Share {profile.label}
                          </Text>
                          <Text style={{ color: colors.onPrimary, opacity: 0.8, fontFamily: fonts.ui, fontSize: 12 }}>
                            â€¢â€¢â€¢â€¢ {profile.account_last4} â†’ {selectedLoan.borrower.display_name}
                          </Text>
                        </View>
                      </Pressable>
                    ))
                  )}
                </Card>
              ) : null}

              {selectedLoan.your_role === 'borrower' && selectedLoan.borrower.id !== selectedLoan.lender.id ? (
                <Card>
                  <SectionLabel>Where to send repayment</SectionLabel>
                  {paymentProfile ? (
                    <>
                      <Text style={styles.rowTitle}>
                        {paymentProfile.label} Â· â€¢â€¢â€¢â€¢ {paymentProfile.account_last4}
                      </Text>
                      {revealedNumber ? <Text style={styles.dev}>{revealedNumber}</Text> : null}
                      <SecondaryButton
                        label={busy ? 'Workingâ€¦' : 'Reveal number'}
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
                  {selectedLoan.events
                    .filter((ev) =>
                      ['created', 'accepted', 'rejected', 'cancelled', 'marked_overdue', 'installment_paid'].includes(
                        ev.event_type,
                      ),
                    )
                    .map((ev) => (
                      <View key={ev.id} style={{ gap: 2, paddingVertical: 6 }}>
                        <Text style={styles.rowTitle}>{formatLoanEvent(ev.event_type)}</Text>
                        <Text style={styles.muted}>
                          {formatUserDateTime(ev.created_at, user)}
                        </Text>
                      </View>
                    ))}
                </Card>
              ) : null}
            </View>
          ) : null}

          {screen === 'installment' && selectedLoan && selectedInstallment ? (
            <View style={{ gap: 14, paddingTop: 4 }}>
              <ScreenHeader
                title={`Payment ${selectedInstallment.sequence}`}
                onBack={() => {
                  setSelectedInstallment(null);
                  setScreen('loan');
                }}
                right={
                  <DueDatePill
                    dueAt={selectedInstallment.due_at}
                    status={selectedInstallment.status === 'paid' ? 'completed' : selectedInstallment.status}
                    locale={user?.locale}
                  />
                }
              />
              <Card>
                <View
                  style={{
                    borderRadius: radii.md,
                    backgroundColor:
                      selectedInstallment.status === 'paid' ? colors.successSoft : colors.warningSoft,
                    padding: 16,
                    gap: 8,
                  }}
                >
                  <Money
                    value={formatMoney(
                      selectedInstallment.amount,
                      selectedLoan.currency_code,
                      user?.locale,
                    )}
                    size="xl"
                  />
                  <Text
                    style={{
                      color:
                        selectedInstallment.status === 'paid' ? colors.success : colors.warning,
                      fontFamily: fonts.uiSemi,
                      fontSize: 15,
                    }}
                  >
                    {selectedInstallment.status === 'paid' ? 'Paid' : 'Unpaid'}
                  </Text>
                  <Text style={styles.muted}>
                    Due {formatUserDate(selectedInstallment.due_at, user)}
                  </Text>
                  {selectedLoan.institution_label ? (
                    <Text style={styles.muted}>{selectedLoan.institution_label}</Text>
                  ) : null}
                </View>
              </Card>

              {selectedInstallment.status === 'paid' && selectedInstallment.paid_at ? (
                <Card>
                  <Text style={styles.muted}>
                    Marked paid {formatUserDateTime(selectedInstallment.paid_at, user)}
                  </Text>
                </Card>
              ) : null}

              {selectedLoan.your_role === 'borrower' &&
              selectedInstallment.status !== 'paid' &&
              (selectedLoan.status === 'active' || selectedLoan.status === 'overdue') ? (
                <Card>
                  <PrimaryButton
                    label={busy ? 'Workingâ€¦' : 'I paid'}
                    onPress={onMarkInstallmentPaid}
                    disabled={busy}
                  />
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
                            {profile.is_preferred ? ' Â· preferred' : ''}
                          </Text>
                          <Text style={styles.muted}>
                            {profile.profile_type} Â· â€¢â€¢â€¢â€¢ {profile.account_last4}
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
                          <PrimaryButton label={busy ? 'Savingâ€¦' : 'Save label'} onPress={() => onPatchBank(profile.id)} disabled={busy} />
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
                  label={busy ? 'Workingâ€¦' : 'Save encrypted profile'}
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
                        <Text style={styles.rowTitle}>{share.profile.label} Â· â€¢â€¢â€¢â€¢ {share.profile.account_last4}</Text>
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
                        <Text style={styles.rowTitle}>{share.profile.label} Â· â€¢â€¢â€¢â€¢ {share.profile.account_last4}</Text>
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
        {showNav && (screen === 'loans' || screen === 'home') ? (
          <Pressable
            onPress={() => {
              if (screen === 'loans') {
                setLoanFriendId('');
                setLoanLockedPeer(null);
                setLenderIds([]);
                setLoanKind('one_time');
                setPartyMode('alone');
                setCurrency(user?.default_currency_code ?? '');
                setLoanTitle('');
                setScreen('new-loan');
                return;
              }
              const kind = expensesTab === 'income' ? 'income' : 'expense';
              setCashflowKind(kind);
              setSelectedCashflow(null);
              if (expensesTab === 'dashboard') {
                setExpensesTab('expenses');
              }
              setScreen('cashflow-new');
            }}
            accessibilityRole="button"
            accessibilityLabel={screen === 'loans' ? 'New loan' : expensesTab === 'income' ? 'New income' : 'New expense'}
            style={{
              position: 'absolute',
              left: 20,
              bottom: 96,
              width: 56,
              height: 56,
              borderRadius: 28,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.primary,
              borderWidth: 3,
              borderColor: colors.fabBorder,
              shadowColor: '#000',
              shadowOpacity: 0.12,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 4 },
              elevation: 4,
            }}
          >
            <IconPlus size={24} color={colors.onPrimary} />
          </Pressable>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
    </DatePrefsProvider>
  );
}
