import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api, type Goal, type MoneyAccount, type User } from './api';
import { stripAmount, formatAmountCommas } from './amountFormat';
import { CURRENCIES } from './catalogs';
import { DateField } from './DateField';
import { SearchSelect } from './SearchSelect';
import { fonts, radii, space, useTheme } from './theme';
import {
  Card,
  EmptyState,
  Field,
  PrimaryButton,
  SecondaryButton,
  SectionLabel,
} from './ui';

type Props = {
  user: User;
  token: string;
  formatMoney: (amount: string | null | undefined, currency: string | null | undefined, locale?: string) => string;
  onError: (message: string) => void;
  reloadToken?: number;
};

const GOAL_TYPES = [
  { id: 'travel', label: 'Travel' },
  { id: 'purchase', label: 'Purchase' },
  { id: 'savings', label: 'Savings' },
  { id: 'debt_payoff', label: 'Debt payoff' },
  { id: 'custom', label: 'Custom' },
];

function progressLabel(g: Goal): string {
  const pct = Math.round(g.progress_percent || 0);
  return `${pct}%`;
}

export function PlanScreen({ user, token, formatMoney, onError, reloadToken = 0 }: Props) {
  const { colors } = useTheme();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [accounts, setAccounts] = useState<MoneyAccount[]>([]);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [contributeId, setContributeId] = useState<string | null>(null);
  const [contributeAmount, setContributeAmount] = useState('');
  const [contributeAccount, setContributeAccount] = useState('');
  const [debitAccount, setDebitAccount] = useState(true);

  const [title, setTitle] = useState('');
  const [goalType, setGoalType] = useState('savings');
  const [currency, setCurrency] = useState((user.default_currency_code || 'ETB').toUpperCase());
  const [target, setTarget] = useState('');
  const [current, setCurrent] = useState('0');
  const [targetDate, setTargetDate] = useState('');
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');

  const reload = useCallback(async () => {
    try {
      const [g, a] = await Promise.all([api.listGoals(token), api.listAccounts(token).catch(() => ({ accounts: [] }))]);
      setGoals(g.goals ?? []);
      setAccounts(a.accounts ?? []);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not load goals');
    }
  }, [token, onError]);

  useEffect(() => {
    void reload();
  }, [reload, reloadToken]);

  function resetForm() {
    setTitle('');
    setGoalType('savings');
    setCurrency((user.default_currency_code || 'ETB').toUpperCase());
    setTarget('');
    setCurrent('0');
    setTargetDate('');
    setAccountId('');
    setNote('');
    setCreating(false);
  }

  async function onCreate() {
    if (!title.trim()) {
      onError('Title is required');
      return;
    }
    const amount = stripAmount(target);
    if (!amount || Number(amount) <= 0) {
      onError('Enter a target amount');
      return;
    }
    setBusy(true);
    try {
      await api.createGoal(token, {
        title: title.trim(),
        goal_type: goalType as Goal['goal_type'],
        currency_code: currency,
        target_amount: amount,
        current_amount: stripAmount(current) || undefined,
        target_date: targetDate || undefined,
        linked_account_id: accountId || undefined,
        note: note.trim() || undefined,
      });
      resetForm();
      await reload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not create goal');
    } finally {
      setBusy(false);
    }
  }

  async function onContribute() {
    if (!contributeId) return;
    const amount = stripAmount(contributeAmount);
    if (!amount || Number(amount) <= 0) {
      onError('Enter a contribution amount');
      return;
    }
    setBusy(true);
    try {
      await api.contributeGoal(token, contributeId, {
        amount,
        account_id: contributeAccount || undefined,
        debit_account: debitAccount && Boolean(contributeAccount),
      });
      setContributeId(null);
      setContributeAmount('');
      setContributeAccount('');
      await reload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not contribute');
    } finally {
      setBusy(false);
    }
  }

  async function onArchive(id: string) {
    setBusy(true);
    try {
      await api.updateGoal(token, id, { status: 'archived' });
      await reload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not archive');
    } finally {
      setBusy(false);
    }
  }

  const accountOptions = accounts
    .filter((a) => a.currency_code.toUpperCase() === currency.toUpperCase())
    .map((a) => ({
      id: a.id,
      label: `${a.name} · ${a.balance} ${a.currency_code}`,
      keywords: a.name.toLowerCase(),
    }));

  const contributeAccountOptions = (() => {
    const g = goals.find((x) => x.id === contributeId);
    const code = (g?.currency_code || currency).toUpperCase();
    return accounts
      .filter((a) => a.currency_code.toUpperCase() === code)
      .map((a) => ({
        id: a.id,
        label: `${a.name} · ${a.balance} ${a.currency_code}`,
        keywords: a.name.toLowerCase(),
      }));
  })();

  return (
    <View style={{ gap: space.md }}>
      <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>Plan</Text>
      <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
        Save toward travel, purchases, emergency funds, or paying down debt.
      </Text>

      {!creating && !contributeId ? (
        <PrimaryButton
          label="New goal"
          onPress={() => {
            resetForm();
            setCreating(true);
          }}
        />
      ) : null}

      {creating ? (
        <Card>
          <SectionLabel>New goal</SectionLabel>
          <Field label="Title" value={title} onChange={setTitle} placeholder="e.g. Visit Lisbon" />
          <SearchSelect label="Type" value={goalType} onChange={setGoalType} options={GOAL_TYPES} />
          <SearchSelect label="Currency" value={currency} onChange={setCurrency} options={CURRENCIES} />
          <Field label="Target amount" value={target} onChange={setTarget} money />
          <Field label="Already saved (optional)" value={current} onChange={setCurrent} money />
          <DateField label="Target date (optional)" value={targetDate} onChange={setTargetDate} />
          {accountOptions.length ? (
            <SearchSelect
              label="Linked account (optional)"
              value={accountId}
              onChange={setAccountId}
              options={accountOptions}
              placeholder="Where you’ll save"
            />
          ) : null}
          <Field label="Note (optional)" value={note} onChange={setNote} />
          <PrimaryButton label={busy ? 'Saving…' : 'Create goal'} onPress={onCreate} disabled={busy} />
          <SecondaryButton label="Cancel" onPress={resetForm} />
        </Card>
      ) : null}

      {contributeId ? (
        <Card>
          <SectionLabel>Contribute</SectionLabel>
          <Field
            label="Amount"
            value={contributeAmount}
            onChange={setContributeAmount}
            money
            placeholder={formatAmountCommas('100')}
          />
          {contributeAccountOptions.length ? (
            <>
              <SearchSelect
                label="From account"
                value={contributeAccount}
                onChange={setContributeAccount}
                options={contributeAccountOptions}
                placeholder="Optional"
              />
              {contributeAccount ? (
                <Pressable
                  onPress={() => setDebitAccount((v) => !v)}
                  style={{
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderRadius: radii.md,
                    borderWidth: 1,
                    borderColor: debitAccount ? colors.primary : colors.border,
                    backgroundColor: debitAccount ? colors.primarySoft : colors.surfaceMuted,
                  }}
                >
                  <Text style={{ color: colors.text, fontFamily: fonts.ui, fontSize: 13 }}>
                    {debitAccount ? '✓ Debit this account' : 'Log only (don’t change balance)'}
                  </Text>
                </Pressable>
              ) : null}
            </>
          ) : null}
          <PrimaryButton label={busy ? 'Saving…' : 'Add contribution'} onPress={onContribute} disabled={busy} />
          <SecondaryButton
            label="Cancel"
            onPress={() => {
              setContributeId(null);
              setContributeAmount('');
              setContributeAccount('');
            }}
          />
        </Card>
      ) : null}

      <Card>
        <SectionLabel>Your goals</SectionLabel>
        {goals.length === 0 ? (
          <EmptyState
            title="No goals yet"
            body="Create a travel or savings goal, link an account, and contribute as you save."
          />
        ) : (
          goals.map((g) => {
            const pct = Math.min(100, Math.max(0, Math.round(g.progress_percent || 0)));
            const done = g.status === 'completed';
            return (
              <View
                key={g.id}
                style={{
                  gap: 8,
                  paddingVertical: 14,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 15 }}>{g.title}</Text>
                    <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                      {GOAL_TYPES.find((t) => t.id === g.goal_type)?.label || g.goal_type}
                      {g.target_date ? ` · by ${g.target_date}` : ''}
                      {done ? ' · Done' : ''}
                    </Text>
                  </View>
                  <Text style={{ color: colors.primary, fontFamily: fonts.uiBold, fontSize: 14 }}>
                    {progressLabel(g)}
                  </Text>
                </View>
                <View style={{ height: 10, borderRadius: radii.full, backgroundColor: colors.surfaceMuted }}>
                  <View
                    style={{
                      height: 10,
                      width: `${Math.max(pct > 0 ? 4 : 0, pct)}%`,
                      borderRadius: radii.full,
                      backgroundColor: done ? colors.success : colors.primary,
                    }}
                  />
                </View>
                <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                  {formatMoney(g.current_amount, g.currency_code, user.locale)} of{' '}
                  {formatMoney(g.target_amount, g.currency_code, user.locale)}
                  {g.eta_months != null && !done
                    ? ` · ~${g.eta_months} mo at recent pace`
                    : ''}
                </Text>
                {!done && g.status === 'active' ? (
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    <Chip
                      label="Contribute"
                      onPress={() => {
                        setCreating(false);
                        setContributeId(g.id);
                        setContributeAccount(g.linked_account_id || '');
                        setContributeAmount('');
                        setDebitAccount(true);
                      }}
                    />
                    <Chip label="Archive" onPress={() => onArchive(g.id)} danger />
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </Card>
    </View>
  );
}

function Chip({
  label,
  onPress,
  danger,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: radii.full,
        backgroundColor: danger ? colors.warningSoft : colors.primarySoft,
        borderWidth: 1,
        borderColor: danger ? colors.warning : colors.primary,
      }}
    >
      <Text
        style={{
          color: danger ? colors.warning : colors.primary,
          fontFamily: fonts.uiSemi,
          fontSize: 12,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
