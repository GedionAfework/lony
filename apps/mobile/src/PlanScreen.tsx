import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { api, type Goal, type MoneyAccount, type User } from './api';
import { stripAmount } from './amountFormat';
import { CURRENCIES } from './catalogs';
import { DateField } from './DateField';
import { SearchSelect } from './SearchSelect';
import { apiBaseUrl, fonts, radii, space, useTheme } from './theme';
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
  { id: 'other', label: 'Other' },
];

function resolveMediaURL(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  const origin = apiBaseUrl.replace(/\/api\/v1\/?$/, '');
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
}

function typeDisplay(g: Goal): string {
  if (g.goal_type === 'custom' && g.type_label) return g.type_label;
  return GOAL_TYPES.find((t) => t.id === g.goal_type)?.label || g.goal_type;
}

function filterKey(g: Goal): string {
  if (g.goal_type === 'custom') return g.type_label?.trim() || 'custom';
  return g.goal_type;
}

export function PlanScreen({ user, token, formatMoney, onError, reloadToken = 0 }: Props) {
  const { colors } = useTheme();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [accounts, setAccounts] = useState<MoneyAccount[]>([]);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'index' | 'create' | 'show'>('index');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [contributeAmount, setContributeAmount] = useState('');
  const [contributeAccount, setContributeAccount] = useState('');
  const [debitAccount, setDebitAccount] = useState(true);

  const [title, setTitle] = useState('');
  const [goalType, setGoalType] = useState('savings');
  const [otherType, setOtherType] = useState('');
  const [currency, setCurrency] = useState((user.default_currency_code || 'USD').toUpperCase());
  const [target, setTarget] = useState('');
  const [current, setCurrent] = useState('0');
  const [targetDate, setTargetDate] = useState('');
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [pendingCover, setPendingCover] = useState<{
    filename: string;
    mime: string;
    attachment_base64: string;
    preview: string;
  } | null>(null);

  const reload = useCallback(async () => {
    try {
      const [g, a] = await Promise.all([api.listGoals(token), api.listAccounts(token).catch(() => ({ accounts: [] }))]);
      setGoals(g.goals ?? []);
      setAccounts(a.accounts ?? []);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not load plans');
    }
  }, [token, onError]);

  useEffect(() => {
    void reload();
  }, [reload, reloadToken]);

  const showFilters = goals.length >= 5;
  const filterOptions = useMemo(() => {
    if (!showFilters) return [];
    const seen = new Map<string, string>();
    for (const g of goals) {
      const key = filterKey(g);
      if (!seen.has(key)) seen.set(key, typeDisplay(g));
    }
    return [{ id: 'all', label: 'All' }, ...[...seen.entries()].map(([id, label]) => ({ id, label }))];
  }, [goals, showFilters]);

  const visible = useMemo(() => {
    if (!showFilters || filter === 'all') return goals;
    return goals.filter((g) => filterKey(g) === filter);
  }, [goals, filter, showFilters]);

  const selected = goals.find((g) => g.id === selectedId) ?? null;

  function resetForm() {
    setTitle('');
    setGoalType('savings');
    setOtherType('');
    setCurrency((user.default_currency_code || 'USD').toUpperCase());
    setTarget('');
    setCurrent('0');
    setTargetDate('');
    setAccountId('');
    setNote('');
    setPendingCover(null);
  }

  function goIndex() {
    setMode('index');
    setSelectedId(null);
    setContributeAmount('');
    setContributeAccount('');
    resetForm();
  }

  async function pickCover(forGoalId?: string) {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.75,
      base64: true,
    });
    if (picked.canceled || !picked.assets?.[0]?.base64) return;
    const asset = picked.assets[0];
    const payload = {
      filename: asset.fileName ?? 'cover.jpg',
      mime: asset.mimeType ?? 'image/jpeg',
      attachment_base64: asset.base64!,
      preview: asset.uri,
    };
    if (forGoalId) {
      setBusy(true);
      try {
        await api.uploadGoalCover(token, forGoalId, {
          filename: payload.filename,
          mime: payload.mime,
          attachment_base64: payload.attachment_base64,
        });
        await reload();
      } catch (e) {
        onError(e instanceof Error ? e.message : 'Could not upload cover');
      } finally {
        setBusy(false);
      }
      return;
    }
    setPendingCover(payload);
  }

  async function onCreate() {
    if (!title.trim()) {
      onError('Title is required');
      return;
    }
    if (goalType === 'other' && !otherType.trim()) {
      onError('Name your plan type');
      return;
    }
    const amount = stripAmount(target);
    if (!amount || Number(amount) <= 0) {
      onError('Enter a target amount');
      return;
    }
    setBusy(true);
    try {
      const apiType = goalType === 'other' ? 'custom' : (goalType as Goal['goal_type']);
      const res = await api.createGoal(token, {
        title: title.trim(),
        goal_type: apiType,
        currency_code: currency,
        target_amount: amount,
        current_amount: stripAmount(current) || undefined,
        target_date: targetDate || undefined,
        linked_account_id: accountId || undefined,
        note: note.trim() || undefined,
        type_label: goalType === 'other' ? otherType.trim() : undefined,
      });
      if (pendingCover && res.goal?.id) {
        await api.uploadGoalCover(token, res.goal.id, {
          filename: pendingCover.filename,
          mime: pendingCover.mime,
          attachment_base64: pendingCover.attachment_base64,
        });
      }
      goIndex();
      await reload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not create plan');
    } finally {
      setBusy(false);
    }
  }

  async function onContribute() {
    if (!selectedId) return;
    const amount = stripAmount(contributeAmount);
    if (!amount || Number(amount) <= 0) {
      onError('Enter a contribution amount');
      return;
    }
    setBusy(true);
    try {
      await api.contributeGoal(token, selectedId, {
        amount,
        account_id: contributeAccount || undefined,
        debit_account: debitAccount && Boolean(contributeAccount),
      });
      setContributeAmount('');
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
      goIndex();
      await reload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not archive');
    } finally {
      setBusy(false);
    }
  }

  async function onClearCover(id: string) {
    setBusy(true);
    try {
      await api.uploadGoalCover(token, id, { clear: true });
      await reload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not remove cover');
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
    const code = (selected?.currency_code || currency).toUpperCase();
    return accounts
      .filter((a) => a.currency_code.toUpperCase() === code)
      .map((a) => ({
        id: a.id,
        label: `${a.name} · ${a.balance} ${a.currency_code}`,
        keywords: a.name.toLowerCase(),
      }));
  })();

  if (mode === 'create') {
    return (
      <View style={{ gap: space.md }}>
        <Pressable onPress={goIndex}>
          <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 14 }}>← Back</Text>
        </Pressable>
        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>New plan</Text>
        <Card>
          <Field label="Title" value={title} onChange={setTitle} />
          <SearchSelect label="Type" value={goalType} onChange={setGoalType} options={GOAL_TYPES} />
          {goalType === 'other' ? <Field label="Type name" value={otherType} onChange={setOtherType} /> : null}
          <SearchSelect label="Currency" value={currency} onChange={setCurrency} options={CURRENCIES} />
          <Field label="Target amount" value={target} onChange={setTarget} money />
          <Field label="Already saved" value={current} onChange={setCurrent} money />
          <DateField label="Target date" value={targetDate} onChange={setTargetDate} />
          {accountOptions.length ? (
            <SearchSelect label="Linked account" value={accountId} onChange={setAccountId} options={accountOptions} />
          ) : null}
          <Field label="Note" value={note} onChange={setNote} />
          <SectionLabel>Cover</SectionLabel>
          {pendingCover ? (
            <Image
              source={{ uri: pendingCover.preview }}
              style={{ width: '100%', height: 140, borderRadius: radii.lg }}
              resizeMode="cover"
            />
          ) : null}
          <SecondaryButton
            label={pendingCover ? 'Change photo' : 'Add photo'}
            onPress={() => void pickCover()}
          />
          {pendingCover ? <SecondaryButton label="Remove photo" onPress={() => setPendingCover(null)} /> : null}
          <PrimaryButton label={busy ? 'Saving…' : 'Create'} onPress={onCreate} disabled={busy} />
        </Card>
      </View>
    );
  }

  if (mode === 'show' && selected) {
    const pct = Math.min(100, Math.max(0, Math.round(selected.progress_percent || 0)));
    const done = selected.status === 'completed';
    const cover = resolveMediaURL(selected.cover_image_url);
    return (
      <View style={{ gap: space.md }}>
        <Pressable onPress={goIndex}>
          <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 14 }}>← Back</Text>
        </Pressable>
        <Card>
          {cover ? (
            <Image
              source={{
                uri: cover,
                headers: token ? { Authorization: `Bearer ${token}` } : undefined,
              }}
              style={{ width: '100%', height: 180, borderRadius: radii.lg }}
              resizeMode="cover"
            />
          ) : null}
          <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>{selected.title}</Text>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
            {typeDisplay(selected)}
            {selected.target_date ? ` · ${selected.target_date}` : ''}
            {done ? ' · Done' : ''}
          </Text>
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
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
            {formatMoney(selected.current_amount, selected.currency_code, user.locale)} of{' '}
            {formatMoney(selected.target_amount, selected.currency_code, user.locale)} · {pct}%
          </Text>
          {selected.note ? (
            <Text style={{ color: colors.textSecondary, fontFamily: fonts.ui, fontSize: 14 }}>{selected.note}</Text>
          ) : null}

          {!done && selected.status === 'active' ? (
            <>
              <SectionLabel>Contribute</SectionLabel>
              <Field label="Amount" value={contributeAmount} onChange={setContributeAmount} money />
              {contributeAccountOptions.length ? (
                <>
                  <SearchSelect
                    label="From account"
                    value={contributeAccount}
                    onChange={setContributeAccount}
                    options={contributeAccountOptions}
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
                        {debitAccount ? '✓ Debit this account' : 'Log only'}
                      </Text>
                    </Pressable>
                  ) : null}
                </>
              ) : null}
              <PrimaryButton label={busy ? 'Saving…' : 'Add contribution'} onPress={onContribute} disabled={busy} />
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <Chip label={cover ? 'Change photo' : 'Add photo'} onPress={() => void pickCover(selected.id)} />
                {cover ? <Chip label="Remove photo" onPress={() => void onClearCover(selected.id)} /> : null}
                <Chip label="Archive" onPress={() => onArchive(selected.id)} danger />
              </View>
            </>
          ) : null}
        </Card>
      </View>
    );
  }

  return (
    <View style={{ gap: space.md }}>
      <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>Plan</Text>

      <PrimaryButton
        label="New plan"
        onPress={() => {
          resetForm();
          setMode('create');
        }}
      />

      {showFilters && filterOptions.length > 1 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {filterOptions.map((t) => {
            const active = filter === t.id;
            return (
              <Pressable
                key={t.id}
                onPress={() => setFilter(t.id)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: radii.full,
                  backgroundColor: active ? colors.primarySoft : colors.surfaceMuted,
                  borderWidth: 1,
                  borderColor: active ? colors.primary : colors.border,
                }}
              >
                <Text
                  style={{
                    color: active ? colors.primary : colors.muted,
                    fontFamily: fonts.uiSemi,
                    fontSize: 12,
                  }}
                >
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <Card>
        <SectionLabel>Your plans ({visible.length})</SectionLabel>
        {visible.length === 0 ? (
          <EmptyState title="No plans yet" body="Create a plan to track savings, travel, or a purchase." />
        ) : (
          visible.map((g) => {
            const pct = Math.min(100, Math.max(0, Math.round(g.progress_percent || 0)));
            const cover = resolveMediaURL(g.cover_image_url);
            return (
              <Pressable
                key={g.id}
                onPress={() => {
                  setSelectedId(g.id);
                  setContributeAccount(g.linked_account_id || '');
                  setContributeAmount('');
                  setDebitAccount(true);
                  setMode('show');
                }}
                style={{
                  gap: 10,
                  paddingVertical: 14,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                }}
              >
                {cover ? (
                  <Image
                    source={{
                      uri: cover,
                      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                    }}
                    style={{ width: '100%', height: 120, borderRadius: radii.lg }}
                    resizeMode="cover"
                  />
                ) : (
                  <View
                    style={{
                      height: 56,
                      borderRadius: radii.lg,
                      backgroundColor: colors.primarySoft,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 13 }}>
                      {typeDisplay(g)}
                    </Text>
                  </View>
                )}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>{g.title}</Text>
                    <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                      {typeDisplay(g)}
                      {g.target_date ? ` · ${g.target_date}` : ''}
                    </Text>
                  </View>
                  <Text style={{ color: colors.primary, fontFamily: fonts.uiBold, fontSize: 14 }}>{pct}%</Text>
                </View>
                <View style={{ height: 8, borderRadius: radii.full, backgroundColor: colors.surfaceMuted }}>
                  <View
                    style={{
                      height: 8,
                      width: `${Math.max(pct > 0 ? 4 : 0, pct)}%`,
                      borderRadius: radii.full,
                      backgroundColor: colors.primary,
                    }}
                  />
                </View>
                <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                  {formatMoney(g.current_amount, g.currency_code, user.locale)} of{' '}
                  {formatMoney(g.target_amount, g.currency_code, user.locale)}
                </Text>
              </Pressable>
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
