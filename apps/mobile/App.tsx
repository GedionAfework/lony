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
import { api, type BankProfile, type BankProfileShare, type Dashboard, type Friendship, type Loan, type SearchHit, type User } from './src/api';
import { colors } from './src/theme';

const ACCESS_KEY = 'lony.access_token';
const REFRESH_KEY = 'lony.refresh_token';

type Screen = 'login' | 'register' | 'verify' | 'home' | 'new-loan' | 'loan' | 'banks';

export default function App() {
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
        setToken(token);
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
    setToken(access);
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
    setToken(null);
    setFriends([]);
    setIncoming([]);
    setHits([]);
    setLoans([]);
    setDashboard(null);
    setLoanFilter('');
    setSelectedLoan(null);
    setPassword('');
    setScreen('login');
  }

  async function refreshFriends(access = token) {
    if (!access) {
      return;
    }
    const [friendRes, incomingRes, loanRes, dashRes, bankRes, shareRes, inShareRes] = await Promise.all([
      api.listFriends(access),
      api.listIncoming(access),
      api.listLoans(access, loanFilter ? { currency: dashCurrency, filter: loanFilter } : {}),
      api.dashboard(access),
      api.listBankProfiles(access),
      api.listBankShares(access, false),
      api.listBankShares(access, true),
    ]);
    setFriends(friendRes.friends ?? []);
    setIncoming(incomingRes.requests ?? []);
    setLoans(loanRes.loans ?? []);
    setDashboard(dashRes.dashboard);
    setBankProfiles(bankRes.bank_profiles ?? []);
    setOutgoingShares(shareRes.shares ?? []);
    setIncomingShares(inShareRes.shares ?? []);
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
          <Text style={styles.brand}>Lony</Text>
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

          {screen === 'home' && user && dashboard ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Dashboard</Text>
              <View style={styles.row}>
                {dashboard.by_currency.map((slice) => (
                  <Pressable
                    key={slice.currency_code}
                    style={dashCurrency === slice.currency_code ? styles.smallButton : styles.ghostButton}
                    onPress={() => onDashCurrency(slice.currency_code)}
                  >
                    <Text
                      style={dashCurrency === slice.currency_code ? styles.smallButtonText : styles.ghostButtonText}
                    >
                      {slice.currency_code}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {(() => {
                const slice = dashboard.by_currency.find((c) => c.currency_code === dashCurrency);
                if (!slice) {
                  return null;
                }
                return (
                  <View style={{ gap: 10 }}>
                    <Text style={styles.hero}>
                      {slice.net} {slice.currency_code}
                    </Text>
                    <Text style={styles.muted}>Net in this currency only. No blended total.</Text>
                    <Pressable style={styles.row} onPress={() => applyLoanFilter('receivables')}>
                      <Text style={styles.rowTitle}>Others owe me</Text>
                      <Text style={styles.muted}>
                        {slice.receivables} {slice.currency_code}
                      </Text>
                    </Pressable>
                    <Pressable style={styles.row} onPress={() => applyLoanFilter('payables')}>
                      <Text style={styles.rowTitle}>I owe others</Text>
                      <Text style={styles.muted}>
                        {slice.payables} {slice.currency_code}
                      </Text>
                    </Pressable>
                    <Pressable style={styles.row} onPress={() => applyLoanFilter('due_soon')}>
                      <Text style={styles.rowTitle}>Due soon</Text>
                      <Text style={styles.muted}>
                        {slice.due_soon_count} · {slice.due_soon} {slice.currency_code}
                      </Text>
                    </Pressable>
                    <Pressable style={styles.row} onPress={() => applyLoanFilter('pending_action')}>
                      <Text style={styles.rowTitle}>Pending requests</Text>
                      <Text style={styles.muted}>{String(dashboard.pending_requests)}</Text>
                    </Pressable>
                    <Pressable style={styles.row} onPress={() => applyLoanFilter('pending_confirmations')}>
                      <Text style={styles.rowTitle}>Pending confirmations</Text>
                      <Text style={styles.muted}>{String(dashboard.pending_confirmations)}</Text>
                    </Pressable>
                    {slice.friends.length > 0 ? <Text style={styles.label}>Per friend</Text> : null}
                    {slice.friends.map((fb) => (
                      <View key={fb.peer.id} style={styles.row}>
                        <View style={styles.flex}>
                          <Text style={styles.rowTitle}>{fb.peer.display_name}</Text>
                          <Text style={styles.muted}>
                            net {fb.net} {slice.currency_code}
                          </Text>
                        </View>
                      </View>
                    ))}
                    {loanFilter ? (
                      <Pressable onPress={() => applyLoanFilter(loanFilter)}>
                        <Text style={styles.link}>Clear loan filter</Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })()}
            </View>
          ) : null}

            </View>
          ) : null}

          {screen === 'home' && user ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Payment profiles</Text>
              <Text style={styles.muted}>Encrypted destinations. Lony never moves money.</Text>
              {bankProfiles.slice(0, 2).map((profile) => (
                <View key={profile.id} style={styles.row}>
                  <View style={styles.flex}>
                    <Text style={styles.rowTitle}>
                      {profile.label}
                      {profile.is_preferred ? ' · preferred' : ''}
                    </Text>
                    <Text style={styles.muted}>•••• {profile.account_last4}</Text>
                  </View>
                </View>
              ))}
              <Pressable style={styles.button} onPress={() => { setShareFriendId(friends[0]?.peer.id ?? ''); setScreen('banks'); }}>
                <Text style={styles.buttonText}>Manage profiles</Text>
              </Pressable>
            </View>
          ) : null}

          {screen === 'home' && user ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Find people</Text>
              <Field label="Email or name" value={query} onChange={setQuery} />
              <Pressable style={styles.button} onPress={onSearch} disabled={busy}>
                <Text style={styles.buttonText}>{busy ? 'Working…' : 'Search'}</Text>
              </Pressable>
              {hits.map((hit) => (
                <View key={hit.id} style={styles.row}>
                  <View style={styles.flex}>
                    <Text style={styles.rowTitle}>{hit.display_name}</Text>
                    <Text style={styles.muted}>{hit.username ?? 'No username'}</Text>
                  </View>
                  <Pressable style={styles.smallButton} onPress={() => onAdd(hit)} disabled={busy}>
                    <Text style={styles.smallButtonText}>Add</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          {screen === 'home' && incoming.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Requests</Text>
              {incoming.map((req) => (
                <View key={req.id} style={styles.row}>
                  <View style={styles.flex}>
                    <Text style={styles.rowTitle}>{req.peer.display_name}</Text>
                    <Text style={styles.muted}>Wants to connect</Text>
                  </View>
                  <Pressable style={styles.smallButton} onPress={() => onAccept(req.id)} disabled={busy}>
                    <Text style={styles.smallButtonText}>Accept</Text>
                  </Pressable>
                  <Pressable style={styles.ghostButton} onPress={() => onReject(req.id)} disabled={busy}>
                    <Text style={styles.ghostButtonText}>Reject</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          {screen === 'home' && user ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Friends</Text>
              {friends.length === 0 ? (
                <Text style={styles.muted}>No connections yet. Search by email to add someone.</Text>
              ) : (
                friends.map((friend) => (
                  <View key={friend.id} style={styles.row}>
                    <View style={styles.flex}>
                      <Text style={styles.rowTitle}>{friend.peer.display_name}</Text>
                      <Text style={styles.muted}>{friend.peer.username ?? friend.status}</Text>
                    </View>
                    <Pressable style={styles.ghostButton} onPress={() => onRemove(friend.id)} disabled={busy}>
                      <Text style={styles.ghostButtonText}>Remove</Text>
                    </Pressable>
                  </View>
                ))
              )}
            </View>
          ) : null}

          {screen === 'home' && user ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{loanFilter ? `Loans · ${loanFilter}` : 'Loans'}</Text>
              <Pressable
                style={styles.button}
                onPress={() => {
                  setLoanFriendId(friends[0]?.peer.id ?? '');
                  setScreen('new-loan');
                }}
                disabled={friends.length === 0}
              >
                <Text style={styles.buttonText}>New loan</Text>
              </Pressable>
              {loans.length === 0 ? (
                <Text style={styles.muted}>No loans yet. Add a friend, then record a shared ledger entry.</Text>
              ) : (
                loans.map((loan) => (
                  <Pressable key={loan.id} style={styles.row} onPress={() => openLoan(loan.id)}>
                    <View style={styles.flex}>
                      <Text style={styles.rowTitle}>
                        {loan.reference_code} · {loan.your_role}
                      </Text>
                      <Text style={styles.muted}>
                        {loan.expected_total ? `${loan.expected_total} ${loan.currency_code}` : 'Waiting for terms'} · {loan.status}
                      </Text>
                    </View>
                  </Pressable>
                ))
              )}
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
              <Text style={styles.hero}>
                {selectedLoan.expected_total ? `${selectedLoan.expected_total} ${selectedLoan.currency_code}` : selectedLoan.status}
              </Text>
              <Text style={styles.muted}>
                {selectedLoan.your_role === 'borrower' ? `From ${selectedLoan.lender.display_name}` : `To ${selectedLoan.borrower.display_name}`}
              </Text>
              <Text style={styles.muted}>Status: {selectedLoan.status}</Text>
              {selectedLoan.principal ? (
                <Text style={styles.muted}>
                  Principal {selectedLoan.principal} · {selectedLoan.interest_basis} {selectedLoan.interest_rate_percent}% · due {selectedLoan.due_at?.slice(0, 10)}
                </Text>
              ) : null}
              {selectedLoan.can_accept ? (
                <Pressable style={styles.button} onPress={() => onLoanAction('accept')} disabled={busy}>
                  <Text style={styles.buttonText}>Accept terms</Text>
                </Pressable>
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
                    <Pressable style={styles.ghostButton} onPress={() => onArchiveBank(profile.id)} disabled={busy}>
                      <Text style={styles.ghostButtonText}>Archive</Text>
                    </Pressable>
                  </View>
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
  keyboardType?: 'email-address' | 'number-pad' | 'decimal-pad' | 'default';
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  smallButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    minHeight: 44,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallButtonText: { color: colors.onPrimary, fontWeight: '700' },
  ghostButton: {
    borderRadius: 10,
    minHeight: 44,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostButtonText: { color: colors.tertiary, fontWeight: '600' },
  selectedRow: { backgroundColor: colors.surfaceHigh, borderRadius: 10, padding: 8 },
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
