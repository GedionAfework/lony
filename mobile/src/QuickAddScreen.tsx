import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { api, type CashflowCategory, type CashflowEntry, type MoneyAccount, type User } from './api';
import { formatAmountCommas, stripAmount } from './amountFormat';
import { CURRENCIES } from './catalogs';
import { t } from './i18n';
import { saveCashflowDraft } from './offlineDrafts';
import { SearchSelect } from './SearchSelect';
import { space } from './theme';
import { VoiceAddButton, type VoiceDraft } from './VoiceAddButton';
import { Card, Field, PrimaryButton, ScreenHeader, Segmented } from './ui';

type Kind = 'income' | 'expense';

type Props = {
  user: User;
  token: string;
  kind: Kind;
  onKind: (kind: Kind) => void;
  onBack: () => void;
  onSaved: (entry: CashflowEntry) => void;
  onError: (message: string) => void;
};

function todayIso(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

export function QuickAddScreen({ user, token, kind, onKind, onBack, onSaved, onError }: Props) {
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState('');
  const [title, setTitle] = useState('');
  const [currency, setCurrency] = useState((user.default_currency_code || 'USD').toUpperCase());
  const [categories, setCategories] = useState<CashflowCategory[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [accounts, setAccounts] = useState<MoneyAccount[]>([]);
  const [accountId, setAccountId] = useState('');

  useEffect(() => {
    setCategoryId('');
  }, [kind]);

  useEffect(() => {
    api
      .listCashflowCategories(token, kind)
      .then((res) => {
        const list = [...(res.categories ?? [])].sort((a, b) => {
          const aOther = (a.slug || a.name || '').toLowerCase() === 'other' ? 1 : 0;
          const bOther = (b.slug || b.name || '').toLowerCase() === 'other' ? 1 : 0;
          if (a.is_system !== b.is_system) return a.is_system ? -1 : 1;
          if (aOther !== bOther) return aOther - bOther;
          return (a.name || '').localeCompare(b.name || '');
        });
        setCategories(list);
        if (!categoryId && list[0]) setCategoryId(list[0].id);
      })
      .catch(() => setCategories([]));
  }, [token, kind, categoryId]);

  useEffect(() => {
    api
      .listAccounts(token)
      .then((res) => {
        const list = res.accounts ?? [];
        setAccounts(list);
        setAccountId((current) => {
          const stillValid = list.some(
            (a) => a.id === current && a.currency_code.toUpperCase() === currency.toUpperCase(),
          );
          if (stillValid) return current;
          return list.find((a) => a.currency_code.toUpperCase() === currency.toUpperCase())?.id ?? '';
        });
      })
      .catch(() => setAccounts([]));
  }, [token, currency]);

  const categoryOptions = useMemo(
    () => categories.map((c) => ({ id: c.id, label: c.name, keywords: c.name.toLowerCase() })),
    [categories],
  );
  const accountOptions = useMemo(
    () =>
      accounts
        .filter((a) => a.currency_code.toUpperCase() === currency.toUpperCase())
        .map((a) => ({
          id: a.id,
          label: `${a.name} · ${a.balance} ${a.currency_code}`,
          keywords: `${a.name} ${a.currency_code}`.toLowerCase(),
        })),
    [accounts, currency],
  );

  function applyVoiceDraft(draft: VoiceDraft) {
    if (draft.kind && draft.kind !== kind) onKind(draft.kind);
    if (draft.amount) setAmount(formatAmountCommas(draft.amount));
    if (draft.title) setTitle(draft.title);
    if (draft.currency_code && draft.currency_code.length === 3) setCurrency(draft.currency_code.toUpperCase());
    if (draft.category_id && categories.some((c) => c.id === draft.category_id)) {
      setCategoryId(draft.category_id);
    } else if (draft.category_hint) {
      const hint = draft.category_hint.toLowerCase();
      const hit = categories.find(
        (c) => c.name.toLowerCase().includes(hint) || hint.includes(c.name.toLowerCase()),
      );
      if (hit) setCategoryId(hit.id);
    }
    if (draft.account_id && accounts.some((a) => a.id === draft.account_id)) {
      setAccountId(draft.account_id);
    } else if (draft.account_hint) {
      const hint = draft.account_hint.toLowerCase();
      const hit = accounts.find(
        (a) => a.name.toLowerCase().includes(hint) || hint.includes(a.name.toLowerCase()),
      );
      if (hit) {
        setAccountId(hit.id);
        if (hit.currency_code) setCurrency(hit.currency_code.toUpperCase());
      }
    }
  }

  async function save() {
    const payAmount = stripAmount(amount);
    if (!payAmount || Number(payAmount) <= 0) {
      onError(t(user.locale, 'quickAdd.needAmount'));
      return;
    }
    if (!accountId) {
      onError(t(user.locale, 'quickAdd.needAccount'));
      return;
    }
    const cat = categories.find((c) => c.id === categoryId);
    const label = title.trim() || cat?.name || (kind === 'income' ? t(user.locale, 'quickAdd.income') : t(user.locale, 'quickAdd.expense'));
    setBusy(true);
    const payload = {
      kind,
      title: label,
      amount: payAmount,
      currency_code: currency.trim().toUpperCase(),
      category_id: categoryId || undefined,
      account_id: accountId,
      occurred_at: new Date(`${todayIso()}T12:00:00.000Z`).toISOString(),
    };
    try {
      const res = await api.createCashflow(token, payload);
      onSaved(res.entry);
    } catch (e) {
      const msg = e instanceof Error ? e.message : t(user.locale, 'quickAdd.needAmount');
      const offline =
        msg.toLowerCase().includes('network') ||
        msg.toLowerCase().includes('failed to fetch') ||
        msg.toLowerCase().includes('timeout');
      if (offline) {
        await saveCashflowDraft({
          kind,
          title: payload.title,
          amount: payload.amount,
          currency_code: payload.currency_code,
          category_id: payload.category_id,
          account_id: payload.account_id,
          occurred_at: payload.occurred_at,
          recurrence: 'none',
          is_template: false,
        });
        onError(t(user.locale, 'quickAdd.offline'));
        onBack();
        return;
      }
      onError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: space.md, paddingTop: 4 }}>
      <ScreenHeader
        title={t(user.locale, 'quickAdd.title')}
        onBack={onBack}
        backLabel={t(user.locale, 'common.back')}
        right={
          <VoiceAddButton
            token={token}
            locale={user.locale}
            disabled={busy}
            onDraft={applyVoiceDraft}
            onError={onError}
          />
        }
      />
      <Segmented
        options={[
          { id: 'expense', label: t(user.locale, 'quickAdd.expense') },
          { id: 'income', label: t(user.locale, 'quickAdd.income') },
        ]}
        value={kind}
        onChange={(id) => onKind(id === 'income' ? 'income' : 'expense')}
      />
      <Card>
        <Field label={t(user.locale, 'quickAdd.amount')} value={amount} onChange={setAmount} money />
        <Field
          label={t(user.locale, 'quickAdd.whatFor')}
          value={title}
          onChange={setTitle}
          placeholder={categories.find((c) => c.id === categoryId)?.name}
        />
        <SearchSelect label={t(user.locale, 'quickAdd.category')} value={categoryId} onChange={setCategoryId} options={categoryOptions} />
        <SearchSelect label={t(user.locale, 'common.currency')} value={currency} onChange={setCurrency} options={CURRENCIES} />
        <SearchSelect
          label={t(user.locale, 'quickAdd.account')}
          value={accountId}
          onChange={setAccountId}
          options={accountOptions}
          placeholder={accountOptions.length ? t(user.locale, 'quickAdd.account') : t(user.locale, 'quickAdd.needAccount')}
        />
      </Card>
      <PrimaryButton label={busy ? t(user.locale, 'common.loading') : t(user.locale, 'quickAdd.save')} onPress={() => void save()} disabled={busy} />
    </View>
  );
}
