import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api, type MoneyAccount } from './api';
import { addSuggestedAccount, retryHeldTransfers, saveReviewedSms } from './smsAutoIngest';
import { isPersonalNumber, knownSenderInstitution } from './smsClassify';
import { matchAccount } from './smsAccounts';
import {
  loadReviewState,
  resolvePendingAccount,
  resolveReview,
  trustSender,
  type SmsPendingAccount,
  type SmsReviewItem,
} from './smsReview';
import { fonts, radii, useTheme } from './theme';
import { stripAmount } from './amountFormat';
import { Card, Field, PrimaryButton, SecondaryButton } from './ui';

type Props = {
  token: string;
  userId?: string;
  locale?: string;
  /** Changes when a sync may have added items. */
  reloadKey?: number;
  formatMoney: (amount: string | null | undefined, currency: string | null | undefined, locale?: string) => string;
  onChanged?: () => void;
  onError: (message: string) => void;
};

const SHOWN = 4;

/**
 * Bank SMS that need the user's answer: accounts found in their messages (never added on
 * their own) and messages that look like money but are not certain.
 */
export function SmsReviewCard({ token, userId, locale, reloadKey, formatMoney, onChanged, onError }: Props) {
  const { colors } = useTheme();
  const [reviews, setReviews] = useState<SmsReviewItem[]>([]);
  const [pending, setPending] = useState<SmsPendingAccount[]>([]);
  const [accounts, setAccounts] = useState<MoneyAccount[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [chosen, setChosen] = useState<Record<string, { account?: string; kind?: 'income' | 'expense'; amount?: string }>>({});

  const load = useCallback(async () => {
    const state = await loadReviewState(userId);
    setReviews(state.reviews);
    setPending(state.pendingAccounts);
    if (state.reviews.length) {
      const res = await api.listAccounts(token).catch(() => ({ accounts: [] as MoneyAccount[] }));
      setAccounts((res.accounts ?? []).filter((a) => a.account_type !== 'cash'));
    }
  }, [token, userId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  if (!reviews.length && !pending.length) return null;

  async function run(key: string, work: () => Promise<unknown>) {
    setBusy(key);
    try {
      await work();
      await load();
      onChanged?.();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not update');
    } finally {
      setBusy(null);
    }
  }

  const accountsFor = (item: SmsReviewItem) => {
    const cur = (item.currency || '').toUpperCase();
    const same = accounts.filter((a) => !cur || a.currency_code.toUpperCase() === cur);
    return same.length ? same : accounts;
  };

  /** The account the message belongs to when only one can be it; otherwise the user picks. */
  const guessAccount = (item: SmsReviewItem, options: MoneyAccount[]): MoneyAccount | undefined => {
    if (options.length === 1) return options[0];
    const m = matchAccount(options, {
      institution: item.institution,
      last4: item.accountLast4,
      currency: item.currency || options[0]?.currency_code || '',
    });
    return m.kind === 'found' ? m.account : undefined;
  };

  /** What Lony would do with a message: its direction, account and amount, and what is missing. */
  const planFor = (item: SmsReviewItem) => {
    const pick = chosen[item.id] || {};
    const kind = pick.kind ?? item.kind ?? undefined;
    const options = accountsFor(item);
    const accountId = pick.account ?? guessAccount(item, options)?.id;
    const account = options.find((a) => a.id === accountId);
    const amount = item.amount || stripAmount(pick.amount || '') || null;
    const missing = [
      !kind ? 'choose Money in or Money out' : null,
      !account && options.length ? 'choose the account' : null,
      !amount ? 'enter the amount' : null,
    ].filter(Boolean) as string[];
    const canTrust = Boolean(item.sender) && !isPersonalNumber(item.sender) && !knownSenderInstitution(item.sender);
    return { pick, kind, options, accountId, account, amount, missing, canTrust };
  };

  // Clear messages are saved together with "Save all"; only the vague ones are listed.
  // A message the user started answering stays listed so it does not jump away mid-answer.
  const ready = reviews.filter((r) => {
    const p = planFor(r);
    return p.options.length > 0 && p.missing.length === 0 && !chosen[r.id];
  });
  const vague = reviews.filter((r) => !ready.includes(r));
  const shown = showAll ? vague : vague.slice(0, SHOWN);

  async function saveAll() {
    setBusy('all');
    let failed = 0;
    let trustedAny = false;
    for (const item of ready) {
      const p = planFor(item);
      if (!p.account || !p.kind || !p.amount) continue;
      try {
        if (p.canTrust && item.sender) {
          await trustSender(item.sender, userId);
          trustedAny = true;
        }
        await saveReviewedSms(token, { ...item, kind: p.kind, amount: p.amount }, p.account, userId);
      } catch {
        failed++;
      }
    }
    try {
      if (trustedAny) await retryHeldTransfers(token, userId);
      await load();
      onChanged?.();
    } finally {
      setBusy(null);
    }
    if (failed) onError(`${failed} message(s) could not be saved. They are still in the list.`);
  }

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16, flex: 1 }}>From your bank messages</Text>
        {ready.length > 0 ? (
          <Pressable
            onPress={() => void saveAll()}
            disabled={busy !== null}
            accessibilityRole="button"
            style={{
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: radii.full,
              backgroundColor: colors.primary,
              opacity: busy !== null ? 0.6 : 1,
            }}
          >
            <Text style={{ color: colors.onPrimary, fontFamily: fonts.uiSemi, fontSize: 13 }}>
              {busy === 'all' ? 'Saving…' : `Save all (${ready.length})`}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {ready.length > 0 ? (
        <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
          {ready.length} clear {ready.length === 1 ? 'message' : 'messages'} ready to save
          {vague.length ? `, ${vague.length} need${vague.length === 1 ? 's' : ''} you` : ''}.
        </Text>
      ) : null}

      {pending.map((acct) => (
        <View key={acct.key} style={{ gap: 6, paddingVertical: 6 }}>
          <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 14 }}>
            {acct.label} · {acct.currency}
          </Text>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
            Found in your messages. Add it?
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <PrimaryButton
                label={busy === acct.key ? 'Adding…' : 'Add account'}
                disabled={busy !== null}
                onPress={() => void run(acct.key, () => addSuggestedAccount(token, acct, userId))}
              />
            </View>
            <View style={{ flex: 1 }}>
              <SecondaryButton
                label="Not mine"
                disabled={busy !== null}
                onPress={() => void run(acct.key, () => resolvePendingAccount(acct.key, userId))}
              />
            </View>
          </View>
        </View>
      ))}

      {shown.map((item) => {
        const { pick, kind, options, accountId, account, amount, missing, canTrust } = planFor(item);
        const from = item.institution || item.sender || 'Unknown sender';
        return (
          <View key={item.id} style={{ gap: 6, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 14 }}>
              {from} · {item.amount ? formatMoney(item.amount, item.currency, locale) : 'amount unclear'}
            </Text>
            <Text numberOfLines={3} style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
              {item.body}
            </Text>
            <Text style={{ color: colors.tertiary, fontFamily: fonts.ui, fontSize: 12 }}>{item.reason}</Text>

            <View style={{ flexDirection: 'row', gap: 6 }}>
              {(['income', 'expense'] as const).map((k) => (
                <Chip key={k} label={k === 'income' ? 'Money in' : 'Money out'} active={kind === k} onPress={() => setChosen((c) => ({ ...c, [item.id]: { ...pick, kind: k } }))} />
              ))}
            </View>
            {options.length > 1 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {options.map((a) => (
                  <Chip key={a.id} label={a.name} active={accountId === a.id} onPress={() => setChosen((c) => ({ ...c, [item.id]: { ...pick, account: a.id } }))} />
                ))}
              </View>
            ) : null}
            {!item.amount ? (
              <Field
                label="Amount"
                value={pick.amount ?? ''}
                onChange={(v) => setChosen((c) => ({ ...c, [item.id]: { ...pick, amount: v } }))}
                money
              />
            ) : null}
            {options.length && missing.length ? (
              <Text style={{ color: colors.warning, fontFamily: fonts.ui, fontSize: 12 }}>
                To save, {missing.join(' and ')}.
              </Text>
            ) : null}
            {!options.length ? (
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>Add an account first to save this.</Text>
            ) : null}

            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  label={busy === item.id ? 'Saving…' : account ? `Save to ${account.name}` : 'Save'}
                  disabled={busy !== null || !options.length}
                  onPress={() => {
                    if (!account || !kind || !amount) {
                      onError(`To save, ${missing.join(' and ')}.`);
                      return;
                    }
                    void run(item.id, async () => {
                      if (canTrust && item.sender) await trustSender(item.sender, userId);
                      await saveReviewedSms(token, { ...item, kind, amount }, account, userId);
                      if (canTrust) await retryHeldTransfers(token, userId);
                    });
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <SecondaryButton label="Ignore" disabled={busy !== null} onPress={() => void run(item.id, () => resolveReview(item.id, userId))} />
              </View>
            </View>
          </View>
        );
      })}
      {vague.length > SHOWN ? (
        <Pressable onPress={() => setShowAll((v) => !v)} style={{ paddingVertical: 6 }}>
          <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 13 }}>
            {showAll ? 'Show fewer' : `Show all ${vague.length}`}
          </Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: radii.full,
        borderWidth: 1,
        borderColor: active ? colors.primary : colors.border,
        backgroundColor: active ? colors.primarySoft : 'transparent',
      }}
    >
      <Text style={{ color: active ? colors.primary : colors.text, fontFamily: fonts.ui, fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}
