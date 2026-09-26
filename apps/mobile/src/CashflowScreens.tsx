import * as Contacts from 'expo-contacts';
import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import {
  api,
  type CashflowCategory,
  type CashflowEntry,
  type Friendship,
  type Loan,
  type MoneyAccount,
  type PeerHit,
  type SearchHit,
  type User,
} from './api';
import { stripAmount, formatAmountCommas } from './amountFormat';
import { CURRENCIES } from './catalogs';
import { DateField } from './DateField';
import { IconContact, IconEdit, IconSearch, IconTrash } from './icons';
import { dialForCountry, toE164 } from './phone';
import { SearchSelect } from './SearchSelect';
import { fonts, radii, space, useTheme } from './theme';
import {
  Card,
  EmptyState,
  Field,
  PrimaryButton,
  ScreenHeader,
  SecondaryButton,
  SectionLabel,
  Segmented,
} from './ui';

type Kind = 'income' | 'expense';

type Props = {
  user: User;
  token: string;
  kind: Kind;
  friends: Friendship[];
  loans?: Loan[];
  editing?: CashflowEntry | null;
  countryCode?: string;
  onBack: () => void;
  onSaved: (entry: CashflowEntry) => void;
  onError: (message: string) => void;
  onLookupPhone?: (
    e164: string,
  ) => Promise<
    | { status: 'selected'; id: string; name: string }
    | { status: 'invited' | 'pending' | 'error' }
  >;
  onFriendsChanged?: () => void;
};

type SplitFriend = {
  id: string;
  name: string;
  selected: boolean;
  value: string;
};

const RECURRENCE = [
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'yearly', label: 'Yearly' },
  { id: 'other', label: 'Other' },
];

const PAY_MODES = [
  { id: 'full', label: 'Pay remaining in full' },
  { id: 'partial', label: 'Pay a fixed amount' },
  { id: 'percent', label: 'Pay a percent' },
];

function todayIso(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

function isOtherCategory(cat: CashflowCategory | undefined): boolean {
  if (!cat) return false;
  return cat.slug === 'other' || cat.name.toLowerCase() === 'other';
}

function monthBounds(d = new Date()): { from: string; to: string } {
  const from = new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1));
  const to = new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 1));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function round2(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

export function CashflowFormScreen({
  user,
  token,
  kind,
  friends,
  loans = [],
  editing,
  countryCode,
  onBack,
  onSaved,
  onError,
  onLookupPhone,
  onFriendsChanged,
}: Props) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [categories, setCategories] = useState<CashflowCategory[]>([]);
  const [title, setTitle] = useState(editing?.title ?? '');
  const [amount, setAmount] = useState(
    editing?.amount ? formatAmountCommas(editing.amount) : '',
  );
  const [categoryId, setCategoryId] = useState(editing?.category_id ?? '');
  const [newCategory, setNewCategory] = useState('');
  const [note, setNote] = useState(editing?.note ?? '');
  const [date, setDate] = useState(editing?.occurred_at?.slice(0, 10) ?? todayIso());
  const [currency, setCurrency] = useState(
    (editing?.currency_code || user.default_currency_code || 'USD').toUpperCase(),
  );
  const [recurrence, setRecurrence] = useState(editing?.recurrence || 'monthly');
  const [accounts, setAccounts] = useState<MoneyAccount[]>([]);
  const [accountId, setAccountId] = useState(editing?.account_id ?? '');

  // Expense flow choices
  const [isLoanPayment, setIsLoanPayment] = useState('no');
  const [isRecurring, setIsRecurring] = useState(
    editing?.recurrence && editing.recurrence !== 'none' ? 'yes' : 'no',
  );
  const [payWith, setPayWith] = useState('alone');
  const [splitMode, setSplitMode] = useState<'equal' | 'percent' | 'flat'>('equal');
  const [splitFriends, setSplitFriends] = useState<SplitFriend[]>([]);
  const [peerQuery, setPeerQuery] = useState('');
  const [peerHits, setPeerHits] = useState<SearchHit[]>([]);
  const [knownPeers, setKnownPeers] = useState<PeerHit[]>([]);
  const [peerSearching, setPeerSearching] = useState(false);
  const [inviteHint, setInviteHint] = useState<string | null>(null);
  const [customPeriodCategory, setCustomPeriodCategory] = useState('');
  const [loanId, setLoanId] = useState('');
  const [payMode, setPayMode] = useState('full');
  const [payPercent, setPayPercent] = useState('10');

  // Income period
  const [incomePeriodic, setIncomePeriodic] = useState(
    editing?.is_template || (editing?.recurrence && editing.recurrence !== 'none') ? 'yes' : 'no',
  );

  const acceptedFriends = useMemo(
    () => friends.filter((f) => f.status === 'accepted' || !f.status || f.status === 'active'),
    [friends],
  );

  const recommendationPeers = useMemo(() => {
    if (knownPeers.length > 0) return knownPeers;
    // Fallback: bonded friends until /peers loads
    return acceptedFriends.map((f) => ({
      id: f.peer.id,
      display_name: f.peer.display_name,
      username: f.peer.username,
      interaction_count: f.interaction_count ?? 0,
      bond: f.bond || 'acquaintance',
      is_bonded: true,
    }));
  }, [knownPeers, acceptedFriends]);

  const filteredRecPeers = useMemo(() => {
    const q = peerQuery.trim().toLowerCase();
    if (!q) return recommendationPeers;
    return recommendationPeers.filter((p) => {
      const name = p.display_name.toLowerCase();
      const userName = (p.username || '').toLowerCase();
      return name.includes(q) || userName.includes(q) || userName.startsWith(q.replace(/^@/, ''));
    });
  }, [recommendationPeers, peerQuery]);

  useEffect(() => {
    let cancelled = false;
    api
      .listPeers(token)
      .then((res) => {
        if (!cancelled) setKnownPeers(res.peers ?? []);
      })
      .catch(() => {
        if (!cancelled) setKnownPeers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [token, friends]);

  const payableLoans = useMemo(
    () =>
      loans.filter(
        (l) =>
          l.your_role === 'borrower' &&
          ['active', 'overdue', 'repayment_pending'].includes(l.status),
      ),
    [loans],
  );

  useEffect(() => {
    api
      .listCashflowCategories(token, kind)
      .then((res) => {
        const list = res.categories ?? [];
        setCategories(list);
        if (!categoryId && list[0]) setCategoryId(list[0].id);
      })
      .catch((e) => onError(e instanceof Error ? e.message : 'Could not load categories'));
  }, [token, kind, categoryId, onError]);

  useEffect(() => {
    api
      .listAccounts(token)
      .then((res) => {
        const list = res.accounts ?? [];
        setAccounts(list);
        if (!accountId && list.length === 1) setAccountId(list[0].id);
        if (accountId && list.length && !list.some((a) => a.id === accountId)) {
          setAccountId('');
        }
      })
      .catch(() => setAccounts([]));
  }, [token, accountId]);

  useEffect(() => {
    setSplitFriends((prev) => {
      const byId = new Map(prev.map((f) => [f.id, f]));
      return recommendationPeers.map((p) => {
        const existing = byId.get(p.id);
        return (
          existing ?? {
            id: p.id,
            name: p.display_name,
            selected: false,
            value: '',
          }
        );
      });
    });
  }, [recommendationPeers]);

  const selectedCategory = categories.find((c) => c.id === categoryId);
  const showNewCategory = isOtherCategory(selectedCategory);
  const selectedLoan = payableLoans.find((l) => l.id === loanId);
  const totalAmount = Number(stripAmount(amount) || 0);
  const selectedSplit = splitFriends.filter((f) => f.selected);
  const partyCount = selectedSplit.length + 1;
  const isPeriodicForm =
    kind === 'income'
      ? incomePeriodic === 'yes'
      : kind === 'expense' && isLoanPayment === 'no' && isRecurring === 'yes';
  const periodicNeedsCustomCategory = isPeriodicForm && recurrence === 'other';

  const equalShare = useMemo(() => {
    if (partyCount <= 0 || !Number.isFinite(totalAmount) || totalAmount <= 0) return '0.00';
    return round2(totalAmount / partyCount);
  }, [partyCount, totalAmount]);

  const splitPreview = useMemo(() => {
    if (payWith !== 'friends' || selectedSplit.length === 0 || totalAmount <= 0) {
      return { yours: round2(totalAmount || 0), others: [] as { name: string; amount: string }[] };
    }
    if (splitMode === 'equal') {
      return {
        yours: equalShare,
        others: selectedSplit.map((f) => ({ name: f.name, amount: equalShare })),
      };
    }
    if (splitMode === 'percent') {
      const others = selectedSplit.map((f) => {
        const pct = Number(f.value) || 0;
        return { name: f.name, amount: round2((totalAmount * pct) / 100), pct };
      });
      const othersSum = others.reduce((s, o) => s + Number(o.amount), 0);
      return { yours: round2(Math.max(0, totalAmount - othersSum)), others };
    }
    const others = selectedSplit.map((f) => ({
      name: f.name,
      amount: round2(Number(stripAmount(f.value) || 0)),
    }));
    const othersSum = others.reduce((s, o) => s + Number(o.amount), 0);
    return { yours: round2(Math.max(0, totalAmount - othersSum)), others };
  }, [payWith, selectedSplit, totalAmount, splitMode, equalShare]);

  function toggleFriend(id: string) {
    setSplitFriends((rows) =>
      rows.map((f) => {
        if (f.id !== id) return f;
        const selected = !f.selected;
        return {
          ...f,
          selected,
          value: selected && splitMode === 'equal' ? equalShare : f.value,
        };
      }),
    );
  }

  function selectPeer(id: string, name: string) {
    setInviteHint(null);
    setSplitFriends((rows) => {
      const existing = rows.find((f) => f.id === id);
      if (existing?.selected) {
        return rows.map((f) => (f.id === id ? { ...f, selected: false } : f));
      }
      if (existing) {
        return rows.map((f) =>
          f.id === id
            ? { ...f, selected: true, name, value: splitMode === 'equal' ? equalShare : f.value }
            : f,
        );
      }
      return [
        ...rows,
        {
          id,
          name,
          selected: true,
          value: splitMode === 'equal' ? equalShare : '',
        },
      ];
    });
    setPeerQuery('');
    setPeerHits([]);
  }

  const remoteOnly = useMemo(() => {
    const knownIds = new Set(recommendationPeers.map((p) => p.id));
    return peerHits.filter((h) => !knownIds.has(h.id));
  }, [peerHits, recommendationPeers]);

  useEffect(() => {
    const q = peerQuery.trim();
    if (q.length < 2) {
      setPeerHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      setPeerSearching(true);
      api
        .searchUsers(token, q)
        .then((res) => {
          if (!cancelled) setPeerHits(res.users ?? []);
        })
        .catch(() => {
          if (!cancelled) setPeerHits([]);
        })
        .finally(() => {
          if (!cancelled) setPeerSearching(false);
        });
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [peerQuery, token]);

  async function pickContact() {
    if (!onLookupPhone) {
      onError('Phone lookup is unavailable');
      return;
    }
    const perm = await Contacts.requestPermissionsAsync();
    if (!perm.granted) {
      onError('Contacts permission is required to add someone by phone');
      return;
    }
    const picked = await Contacts.presentContactPickerAsync();
    if (!picked) return;
    const numbers = picked.phoneNumbers ?? [];
    const raw = numbers[0]?.number;
    if (!raw) {
      onError('That contact has no phone number');
      return;
    }
    const digits = raw.replace(/\D/g, '');
    const dial = dialForCountry(countryCode || user.country_code || 'US');
    let e164 = raw.trim().startsWith('+') ? `+${digits}` : toE164(countryCode || user.country_code || 'US', digits);
    if (!e164.startsWith('+') && dial && digits.startsWith(dial)) {
      e164 = `+${digits}`;
    }
    await handlePhoneLookup(e164);
  }

  async function handlePhoneLookup(e164: string) {
    if (!onLookupPhone) return;
    const result = await onLookupPhone(e164);
    onFriendsChanged?.();
    if (result.status === 'selected') {
      selectPeer(result.id, result.name);
      setInviteHint(null);
    } else if (result.status === 'invited') {
      setInviteHint(`Invite sent to ${e164}. When they join, send them a split — accepting it connects you.`);
      const body = encodeURIComponent(
        `Join me on Lony to split expenses: https://lony.app — add your phone ${e164} after signup.`,
      );
      try {
        await Linking.openURL(`sms:${e164}?body=${body}`);
      } catch {
        // ignore
      }
    }
  }

  async function searchSubmit() {
    const q = peerQuery.trim();
    if (!q) return;
    const digits = q.replace(/\D/g, '');
    if (q.startsWith('+') || digits.length >= 8) {
      const e164 = q.startsWith('+') ? `+${digits}` : toE164(countryCode || user.country_code || 'US', digits);
      await handlePhoneLookup(e164);
    }
  }

  function selectRemoteUser(hit: SearchHit) {
    selectPeer(hit.id, hit.display_name);
    setInviteHint(`Split request will go to ${hit.display_name}. When they accept, you’ll be connected.`);
  }

  function setFriendValue(id: string, value: string) {
    setSplitFriends((rows) => rows.map((f) => (f.id === id ? { ...f, value } : f)));
  }

  useEffect(() => {
    if (splitMode !== 'equal') return;
    setSplitFriends((rows) =>
      rows.map((f) => (f.selected ? { ...f, value: equalShare } : f)),
    );
  }, [equalShare, splitMode]);

  async function onSave() {
    const cleaned = stripAmount(amount);
    if (!title.trim()) {
      onError('Title is required');
      return;
    }
    if (!cleaned && !(kind === 'expense' && isLoanPayment === 'yes' && loanId)) {
      onError('Enter an amount');
      return;
    }
    if (kind === 'expense' && payWith === 'friends' && selectedSplit.length === 0) {
      onError('Pick at least one person, or choose Alone');
      return;
    }
    if (kind === 'expense' && payWith === 'friends' && splitMode === 'percent') {
      const pctSum = selectedSplit.reduce((s, f) => s + (Number(f.value) || 0), 0);
      if (pctSum <= 0 || pctSum > 100) {
        onError('Friend percents must add up to at most 100');
        return;
      }
    }
    setBusy(true);
    try {
      let catId = categoryId || undefined;
      if (showNewCategory && newCategory.trim()) {
        const created = await api.createCashflowCategory(token, { kind, name: newCategory.trim() });
        catId = created.category.id;
      }
      if (periodicNeedsCustomCategory && customPeriodCategory.trim()) {
        const created = await api.createCashflowCategory(token, {
          kind,
          name: customPeriodCategory.trim(),
        });
        catId = created.category.id;
      }

      let payAmount = cleaned;
      if (kind === 'expense' && isLoanPayment === 'yes' && loanId && selectedLoan) {
        const remaining = Number(selectedLoan.expected_total || selectedLoan.principal || 0);
        const installment = Number(selectedLoan.installment_amount || 0);
        if (payMode === 'full') {
          payAmount = remaining.toFixed(2);
        } else if (payMode === 'partial' && installment > 0 && !cleaned) {
          payAmount = installment.toFixed(2);
        } else if (payMode === 'percent') {
          const pct = Number(payPercent);
          if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
            onError('Enter a percent between 1 and 100');
            setBusy(false);
            return;
          }
          payAmount = ((remaining * pct) / 100).toFixed(2);
        } else if (!cleaned) {
          onError('Enter the amount to pay');
          setBusy(false);
          return;
        }
      }

    if (!payAmount) {
      onError('Enter an amount');
      setBusy(false);
      return;
    }
    if (!accountId) {
      onError('Choose which account this belongs to');
      setBusy(false);
      return;
    }

    const periodic = isPeriodicForm;
      if (periodicNeedsCustomCategory && !customPeriodCategory.trim()) {
        onError('Name your custom category for this schedule');
        setBusy(false);
        return;
      }
      const periodValue = periodic
        ? recurrence === 'other'
          ? 'monthly'
          : recurrence
        : 'none';

      const payload = {
        title: title.trim(),
        amount: payAmount,
        currency_code: currency.trim().toUpperCase(),
        category_id: catId,
        account_id: accountId,
        note: note.trim() || undefined,
        occurred_at: new Date(`${date}T12:00:00.000Z`).toISOString(),
        recurrence: periodValue as 'weekly' | 'monthly' | 'yearly' | 'none',
      };

      let entry: CashflowEntry;
      if (editing) {
        const res = await api.updateCashflow(token, editing.id, payload);
        entry = res.entry;
      } else {
        try {
          const res = await api.createCashflow(token, {
            kind,
            ...payload,
            is_template: periodic,
          });
          entry = res.entry;
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Could not save';
          const offline =
            msg.toLowerCase().includes('network') ||
            msg.toLowerCase().includes('failed to fetch') ||
            msg.toLowerCase().includes('timeout');
          if (offline && !editing) {
            const { saveCashflowDraft } = await import('./offlineDrafts');
            await saveCashflowDraft({
              kind,
              title: payload.title,
              amount: payload.amount,
              currency_code: payload.currency_code,
              category_id: payload.category_id,
              account_id: accountId,
              note: payload.note,
              occurred_at: payload.occurred_at,
              recurrence: payload.recurrence,
              is_template: periodic,
            });
            onError('You’re offline — draft saved on this device. Open Expenses to sync later.');
            setBusy(false);
            return;
          }
          throw e;
        }

        if (kind === 'expense' && isLoanPayment === 'no' && payWith === 'friends') {
          for (const friend of selectedSplit) {
            let shareAmount: string | undefined;
            let sharePercent: number | undefined;
            if (splitMode === 'equal') {
              shareAmount = equalShare;
            } else if (splitMode === 'percent') {
              sharePercent = Number(friend.value) || 0;
            } else {
              shareAmount = stripAmount(friend.value) || '0';
            }
            if (shareAmount && Number(shareAmount) <= 0) continue;
            if (sharePercent != null && sharePercent <= 0) continue;
            try {
              const shared = await api.shareCashflow(token, entry.id, {
                friend_id: friend.id,
                ...(shareAmount ? { share_amount: shareAmount } : { share_percent: sharePercent }),
              });
              entry = shared.entry;
            } catch (e) {
              onError(e instanceof Error ? e.message : `Share with ${friend.name} failed`);
            }
          }
        }

        if (kind === 'expense' && isLoanPayment === 'yes' && loanId) {
          try {
            await api.claimRepayment(token, loanId, {
              amount: payAmount,
              note: title.trim() || 'Expense payment',
            });
          } catch (e) {
            onError(e instanceof Error ? e.message : 'Expense saved, but loan payment failed');
          }
        }
      }
      onSaved(entry);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  const categoryOptions = categories.map((c) => ({
    id: c.id,
    label: c.name,
    keywords: c.name.toLowerCase(),
  }));

  const accountOptions = accounts
    .filter((a) => a.currency_code.toUpperCase() === currency.toUpperCase())
    .map((a) => ({
      id: a.id,
      label: `${a.name} · ${a.balance} ${a.currency_code}`,
      keywords: `${a.name} ${a.currency_code}`.toLowerCase(),
    }));

  const loanOptions = payableLoans.map((l) => ({
    id: l.id,
    label: l.title || l.institution_label || l.reference_code,
    keywords: (l.title || l.reference_code || '').toLowerCase(),
  }));

  return (
    <View style={{ gap: space.md, paddingTop: 4 }}>
      <ScreenHeader
        title={editing ? 'Edit' : kind === 'income' ? 'New income' : 'New expense'}
        onBack={onBack}
      />
      <Card>
        {kind === 'expense' && !editing ? (
          <>
            <SectionLabel>Is this a loan payment?</SectionLabel>
            <Segmented
              options={[
                { id: 'no', label: 'No' },
                { id: 'yes', label: 'Yes' },
              ]}
              value={isLoanPayment}
              onChange={setIsLoanPayment}
            />
          </>
        ) : null}

        {kind === 'expense' && !editing && isLoanPayment === 'yes' ? (
          <>
            <SearchSelect
              label="Loan"
              value={loanId}
              onChange={(id) => {
                setLoanId(id);
                const loan = payableLoans.find((l) => l.id === id);
                if (!loan) return;
                setTitle(loan.title || loan.institution_label || `Loan ${loan.reference_code}`);
                if (loan.currency_code) setCurrency(loan.currency_code.toUpperCase());
                if (loan.installment_amount) {
                  setPayMode('partial');
                  setAmount(formatAmountCommas(loan.installment_amount));
                } else {
                  setPayMode('full');
                  setAmount(formatAmountCommas(loan.expected_total || loan.principal || ''));
                }
              }}
              options={loanOptions}
              placeholder="Select a loan"
            />
            {loanId ? (
              <>
                <SearchSelect
                  label="Payment"
                  value={payMode}
                  onChange={(mode) => {
                    setPayMode(mode);
                    if (!selectedLoan) return;
                    if (mode === 'partial' && selectedLoan.installment_amount) {
                      setAmount(formatAmountCommas(selectedLoan.installment_amount));
                    } else if (mode === 'full') {
                      setAmount(
                        formatAmountCommas(selectedLoan.expected_total || selectedLoan.principal || ''),
                      );
                    }
                  }}
                  options={PAY_MODES}
                />
                {payMode === 'partial' ? (
                  <Field label="Amount" value={amount} onChange={setAmount} money />
                ) : null}
                {payMode === 'percent' ? (
                  <Field
                    label="Percent of remaining"
                    value={payPercent}
                    onChange={setPayPercent}
                    keyboardType="decimal-pad"
                  />
                ) : null}
                {selectedLoan ? (
                  <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                    Remaining{' '}
                    {formatAmountCommas(selectedLoan.expected_total || selectedLoan.principal || '0')}{' '}
                    {selectedLoan.currency_code}
                    {selectedLoan.installment_amount
                      ? `\nInstallment ${formatAmountCommas(selectedLoan.installment_amount)}`
                      : ''}
                  </Text>
                ) : null}
              </>
            ) : null}
            <Field label="Title" value={title} onChange={setTitle} />
            <DateField label="Date" value={date} onChange={setDate} />
            <Field label="Note" value={note} onChange={setNote} />
          </>
        ) : (
          <>
            <Field label="Title" value={title} onChange={setTitle} />
            <Field label="Amount" value={amount} onChange={setAmount} money />
            <SearchSelect label="Currency" value={currency} onChange={setCurrency} options={CURRENCIES} />
            <SearchSelect
              label="Account"
              value={accountId}
              onChange={setAccountId}
              options={accountOptions}
              placeholder={
                accountOptions.length ? 'Which account?' : `Add a ${currency} account first`
              }
            />
            <SearchSelect
              label="Category"
              value={categoryId}
              onChange={(id) => {
                setCategoryId(id);
                setNewCategory('');
              }}
              options={categoryOptions}
            />
            {showNewCategory ? (
              <Field label="Custom category" value={newCategory} onChange={setNewCategory} />
            ) : null}
            <DateField label="Date" value={date} onChange={setDate} />

            {kind === 'income' ? (
              <>
                <SectionLabel>Recurring?</SectionLabel>
                <Segmented
                  options={[
                    { id: 'no', label: 'One-time' },
                    { id: 'yes', label: 'Recurring' },
                  ]}
                  value={incomePeriodic}
                  onChange={setIncomePeriodic}
                />
                {incomePeriodic === 'yes' ? (
                  <>
                    <SearchSelect label="Period" value={recurrence} onChange={setRecurrence} options={RECURRENCE} />
                    {recurrence === 'other' ? (
                      <Field
                        label="Your category"
                        value={customPeriodCategory}
                        onChange={setCustomPeriodCategory}
                        placeholder="e.g. Side hustle"
                      />
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}

            {kind === 'expense' && !editing && isLoanPayment === 'no' ? (
              <>
                <SectionLabel>Recurring payment?</SectionLabel>
                <Segmented
                  options={[
                    { id: 'no', label: 'One-time' },
                    { id: 'yes', label: 'Recurring' },
                  ]}
                  value={isRecurring}
                  onChange={setIsRecurring}
                />
                {isRecurring === 'yes' ? (
                  <>
                    <SearchSelect label="Period" value={recurrence} onChange={setRecurrence} options={RECURRENCE} />
                    {recurrence === 'other' ? (
                      <Field
                        label="Your category"
                        value={customPeriodCategory}
                        onChange={setCustomPeriodCategory}
                        placeholder="e.g. Gym membership"
                      />
                    ) : null}
                  </>
                ) : null}

                <SectionLabel>Who’s paying?</SectionLabel>
                <Segmented
                  options={[
                    { id: 'alone', label: 'Alone' },
                    { id: 'friends', label: 'With friends' },
                  ]}
                  value={payWith}
                  onChange={setPayWith}
                />

                {payWith === 'friends' ? (
                  <>
                    {(peerQuery.trim() ? filteredRecPeers : recommendationPeers).length > 0 ? (
                      <>
                        <SectionLabel>
                          {peerQuery.trim() ? 'People you know' : 'People you’ve interacted with'}
                        </SectionLabel>
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={{ gap: 12, paddingVertical: 4 }}
                        >
                          {(peerQuery.trim() ? filteredRecPeers : recommendationPeers).map((p) => {
                            const row = splitFriends.find((s) => s.id === p.id);
                            const active = Boolean(row?.selected);
                            const initial = p.display_name.slice(0, 1).toUpperCase();
                            return (
                              <Pressable
                                key={p.id}
                                onPress={() => selectPeer(p.id, p.display_name)}
                                accessibilityLabel={p.display_name}
                                style={{ width: 72, alignItems: 'center', gap: 6 }}
                              >
                                <View
                                  style={{
                                    width: 56,
                                    height: 56,
                                    borderRadius: 28,
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    backgroundColor: active ? colors.primarySoft : colors.surfaceMuted,
                                    borderWidth: 2,
                                    borderColor: active ? colors.primary : colors.border,
                                  }}
                                >
                                  <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 20 }}>
                                    {initial}
                                  </Text>
                                </View>
                                <Text
                                  numberOfLines={2}
                                  style={{
                                    color: colors.text,
                                    fontFamily: fonts.uiSemi,
                                    fontSize: 11,
                                    textAlign: 'center',
                                    lineHeight: 14,
                                  }}
                                >
                                  {p.display_name}
                                </Text>
                                {p.bond === 'close' ? (
                                  <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 10 }}>Close</Text>
                                ) : null}
                              </Pressable>
                            );
                          })}
                        </ScrollView>
                      </>
                    ) : null}

                    <SectionLabel>Find someone</SectionLabel>
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8,
                        minHeight: 48,
                        borderRadius: 24,
                        paddingLeft: 14,
                        paddingRight: 6,
                        backgroundColor: colors.surfaceMuted,
                        borderWidth: 1,
                        borderColor: colors.border,
                      }}
                    >
                      <IconSearch size={18} color={colors.muted} />
                      <TextInput
                        style={{
                          flex: 1,
                          color: colors.text,
                          fontFamily: fonts.ui,
                          fontSize: 15,
                          paddingVertical: 10,
                        }}
                        value={peerQuery}
                        onChangeText={setPeerQuery}
                        placeholder="Search @username or phone"
                        placeholderTextColor={colors.muted}
                        autoCapitalize="none"
                        autoCorrect={false}
                        onSubmitEditing={() => {
                          void searchSubmit();
                        }}
                        returnKeyType="search"
                        blurOnSubmit={false}
                      />
                      <Pressable
                        onPress={() => {
                          void pickContact();
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="Pick from contacts"
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 20,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: colors.primarySoft,
                        }}
                      >
                        <IconContact size={18} color={colors.primary} />
                      </Pressable>
                    </View>
                    {inviteHint ? (
                      <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>{inviteHint}</Text>
                    ) : null}
                    {peerSearching ? (
                      <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>Searching…</Text>
                    ) : null}
                    {remoteOnly.map((hit) => (
                      <Pressable
                        key={hit.id}
                        onPress={() => selectRemoteUser(hit)}
                        style={{
                          paddingVertical: 12,
                          paddingHorizontal: 12,
                          borderRadius: radii.md,
                          backgroundColor: colors.surfaceMuted,
                          marginBottom: 8,
                          borderWidth: 1,
                          borderColor: colors.border,
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 12,
                        }}
                      >
                        <View
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 20,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: colors.surface,
                          }}
                        >
                          <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 16 }}>
                            {hit.display_name.slice(0, 1).toUpperCase()}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colors.text, fontFamily: fonts.uiSemi }}>{hit.display_name}</Text>
                          {hit.username ? (
                            <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                              @{hit.username}
                            </Text>
                          ) : (
                            <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                              Tap to include in this split
                            </Text>
                          )}
                        </View>
                      </Pressable>
                    ))}

                    <SectionLabel>Split</SectionLabel>
                    <Segmented
                      options={[
                        { id: 'equal', label: 'Equally' },
                        { id: 'percent', label: '%' },
                        { id: 'flat', label: 'Flat' },
                      ]}
                      value={splitMode}
                      onChange={(id) => setSplitMode(id as 'equal' | 'percent' | 'flat')}
                    />

                    {selectedSplit.length === 0 ? (
                      <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
                        Tap a circle or search by username / phone.
                      </Text>
                    ) : (
                      selectedSplit.map((f) => (
                        <View
                          key={f.id}
                          style={{
                            gap: 8,
                            padding: 12,
                            borderRadius: radii.md,
                            backgroundColor: colors.primarySoft,
                            borderWidth: 1,
                            borderColor: colors.primary,
                          }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                            <View
                              style={{
                                width: 36,
                                height: 36,
                                borderRadius: radii.full,
                                backgroundColor: colors.surface,
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              <Text style={{ color: colors.primary, fontFamily: fonts.uiBold, fontSize: 14 }}>
                                {f.name.slice(0, 1).toUpperCase()}
                              </Text>
                            </View>
                            <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, flex: 1 }}>{f.name}</Text>
                            <Pressable onPress={() => toggleFriend(f.id)} hitSlop={8}>
                              <Text style={{ color: colors.warning, fontFamily: fonts.uiSemi, fontSize: 13 }}>
                                Remove
                              </Text>
                            </Pressable>
                          </View>
                          {splitMode === 'percent' ? (
                            <Field
                              label="Their %"
                              value={f.value}
                              onChange={(v) => setFriendValue(f.id, v)}
                              keyboardType="decimal-pad"
                            />
                          ) : null}
                          {splitMode === 'flat' ? (
                            <Field
                              label="Their amount"
                              value={f.value}
                              onChange={(v) => setFriendValue(f.id, v)}
                              money
                            />
                          ) : null}
                          {splitMode === 'equal' ? (
                            <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
                              Share {equalShare} {currency}
                            </Text>
                          ) : null}
                        </View>
                      ))
                    )}

                    {selectedSplit.length > 0 && totalAmount > 0 ? (
                      <View
                        style={{
                          marginTop: 8,
                          padding: 12,
                          borderRadius: radii.md,
                          backgroundColor: colors.surfaceMuted,
                          gap: 4,
                        }}
                      >
                        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 13 }}>
                          You {formatAmountCommas(splitPreview.yours)} {currency}
                        </Text>
                        {splitPreview.others.map((o) => (
                          <Text key={o.name} style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
                            {o.name} {formatAmountCommas(o.amount)} {currency}
                          </Text>
                        ))}
                      </View>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}

            <Field label="Note" value={note} onChange={setNote} />
          </>
        )}

        <PrimaryButton label={busy ? 'Saving…' : 'Save'} onPress={onSave} disabled={busy} />
      </Card>
      <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
        {kind === 'income' && incomePeriodic === 'yes'
          ? 'We’ll add today’s expected amount. Tap Received on the detail page when it lands.'
          : kind === 'expense' && payWith === 'friends'
            ? 'Each person’s share becomes a loan request. When they accept, you’re connected.'
            : 'Saved to your cashflow for this date.'}
      </Text>
    </View>
  );
}

type ShowProps = {
  user: User;
  token: string;
  entry: CashflowEntry;
  friends: Friendship[];
  formatMoney: (amount: string | null | undefined, currency: string | null | undefined, locale?: string) => string;
  onBack: () => void;
  onEdit: () => void;
  onDeleted: () => void;
  onOpenLoan: (id: string) => void;
  onError: (message: string) => void;
  onUpdated: (entry: CashflowEntry) => void;
};

export function CashflowShowScreen({
  user,
  token,
  entry,
  formatMoney,
  onBack,
  onEdit,
  onDeleted,
  onOpenLoan,
  onError,
  onUpdated,
}: ShowProps) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [monthEntries, setMonthEntries] = useState<CashflowEntry[]>([]);
  const [current, setCurrent] = useState(entry);
  const [accounts, setAccounts] = useState<MoneyAccount[]>([]);
  const [receiveAccountId, setReceiveAccountId] = useState(entry.account_id ?? '');
  const income = current.kind === 'income';
  const period = useMemo(() => monthBounds(), []);

  useEffect(() => {
    setCurrent(entry);
    setReceiveAccountId(entry.account_id ?? '');
  }, [entry]);

  useEffect(() => {
    api
      .listAccounts(token)
      .then((res) => setAccounts(res.accounts ?? []))
      .catch(() => setAccounts([]));
  }, [token]);

  useEffect(() => {
    const templateId = current.is_template ? current.id : current.template_id;
    if (!templateId && !current.is_template) {
      setMonthEntries([current]);
      return;
    }
    const tid = templateId || current.id;
    api
      .listCashflow(token, {
        kind: current.kind === 'income' ? 'income' : 'expense',
        from: period.from,
        to: period.to,
      })
      .then((res) => {
        const rows = (res.entries ?? []).filter((e) => e.template_id === tid || e.id === tid);
        setMonthEntries(rows.length ? rows : [current]);
      })
      .catch(() => setMonthEntries([current]));
  }, [token, current, period.from, period.to]);

  async function onDelete() {
    setBusy(true);
    try {
      await api.deleteCashflow(token, current.id);
      onDeleted();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not delete');
    } finally {
      setBusy(false);
    }
  }

  async function onReceive(target: CashflowEntry) {
    setBusy(true);
    try {
      const res = await api.receiveCashflow(
        token,
        target.id,
        receiveAccountId ? { account_id: receiveAccountId } : undefined,
      );
      setCurrent(res.entry);
      onUpdated(res.entry);
      setMonthEntries((rows) => rows.map((r) => (r.id === res.entry.id ? res.entry : r)));
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not confirm');
    } finally {
      setBusy(false);
    }
  }

  const monthLabel = new Date(period.from).toLocaleDateString(user.locale || 'en', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const expected = current.status === 'expected' || current.is_template;
  const receiveAccountOptions = accounts
    .filter((a) => a.currency_code.toUpperCase() === (current.currency_code || '').toUpperCase())
    .map((a) => ({
      id: a.id,
      label: `${a.name} · ${a.balance} ${a.currency_code}`,
      keywords: a.name.toLowerCase(),
    }));

  return (
    <View style={{ gap: space.md, paddingTop: 4 }}>
      <ScreenHeader title={current.title || current.category} onBack={onBack} />

      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1, gap: 6 }}>
            <Text
              style={{
                color: income ? colors.success : colors.warning,
                fontFamily: fonts.uiSemi,
                fontSize: 12,
                textTransform: 'uppercase',
              }}
            >
              {expected ? (income ? 'Expected' : 'Due') : income ? 'Income' : 'Expense'}
            </Text>
            <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 28 }}>
              {income ? '+' : '−'}
              {formatMoney(current.amount, current.currency_code, user.locale)}
            </Text>
            <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 14 }}>{current.category}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              onPress={onEdit}
              hitSlop={8}
              style={{
                width: 40,
                height: 40,
                borderRadius: radii.full,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.surfaceMuted,
              }}
            >
              <IconEdit size={16} color={colors.text} />
            </Pressable>
            <Pressable
              onPress={onDelete}
              disabled={busy}
              hitSlop={8}
              style={{
                width: 40,
                height: 40,
                borderRadius: radii.full,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.surfaceMuted,
                opacity: busy ? 0.5 : 1,
              }}
            >
              <IconTrash size={16} color={colors.warning} />
            </Pressable>
          </View>
        </View>
        {current.note ? (
          <Text style={{ color: colors.text, fontFamily: fonts.ui, fontSize: 14, marginTop: 8 }}>{current.note}</Text>
        ) : null}
        {expected ? (
          <View style={{ marginTop: 12, gap: space.sm }}>
            {receiveAccountOptions.length ? (
              <SearchSelect
                label="Account"
                value={receiveAccountId}
                onChange={setReceiveAccountId}
                options={receiveAccountOptions}
                placeholder="Which account?"
              />
            ) : null}
            <PrimaryButton
              label={busy ? 'Saving…' : income ? 'Received' : 'Paid'}
              onPress={() => onReceive(current)}
              disabled={busy}
            />
          </View>
        ) : null}
      </Card>

      <Card>
        <SectionLabel>
          {income ? `Received in ${monthLabel}` : `Spent in ${monthLabel}`}
        </SectionLabel>
        {monthEntries.length === 0 ? (
          <EmptyState
            title={income ? 'Nothing received yet' : 'Nothing spent yet'}
            body="Occurrences for this month show up here."
          />
        ) : (
          monthEntries.map((row) => {
            const rowExpected = row.status === 'expected';
            return (
              <View
                key={row.id}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingVertical: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                  gap: 10,
                }}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 14 }}>
                    {formatMoney(row.amount, row.currency_code, user.locale)}
                  </Text>
                  <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                    {new Date(row.occurred_at).toLocaleDateString(user.locale || 'en', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                    {rowExpected ? (income ? '  Expected' : '  Due') : ''}
                  </Text>
                </View>
                {rowExpected ? (
                  <Pressable
                    onPress={() => onReceive(row)}
                    disabled={busy}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: radii.full,
                      backgroundColor: colors.primary,
                      opacity: busy ? 0.6 : 1,
                    }}
                  >
                    <Text style={{ color: colors.onPrimary, fontFamily: fonts.uiSemi, fontSize: 12 }}>
                      {income ? 'Received' : 'Paid'}
                    </Text>
                  </Pressable>
                ) : (
                  <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                    {income ? 'Received' : 'Paid'}
                  </Text>
                )}
              </View>
            );
          })
        )}
      </Card>

      {current.linked_loan_id ? (
        <Card>
          <SecondaryButton label="Open linked loan" onPress={() => onOpenLoan(current.linked_loan_id!)} />
        </Card>
      ) : null}
    </View>
  );
}
