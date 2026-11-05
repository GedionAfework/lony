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
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [justSaved, setJustSaved] = useState(0);
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

  if (!reviews.length && !pending.length && !justSaved) return null;

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
    const list = [...ready];
    setProgress({ done: 0, total: list.length });
    let failed = 0;
    let saved = 0;
    let trustedAny = false;
    for (const item of list) {
      const p = planFor(item);
      if (!p.account || !p.kind || !p.amount) continue;
      try {
        if (p.canTrust && item.sender) {
          await trustSender(item.sender, userId);
          trustedAny = true;
        }
        await saveReviewedSms(token, { ...item, kind: p.kind, amount: p.amount }, p.account, userId);
        saved++;
      } catch {
        failed++;
      }
      setProgress({ done: saved + failed, total: list.length });
    }
    try {
      if (trustedAny) await retryHeldTransfers(token, userId);
      await load();
      onChanged?.();
    } finally {
      setBusy(null);
      setProgress(null);
    }
    if (saved) {
      setJustSaved(saved);
      setTimeout(() => setJustSaved(0), 3500);
    }
    if (failed) onError(`${failed} message(s) could not be saved. They are still in the list.`);
  }

  // What "Save all" would add, per currency, so the button says what it does.
  const readyTotals = (() => {
    const by = new Map<string, { in: number; out: number }>();
    for (const r of ready) {
      const p = planFor(r);
      const cur = (r.currency || p.account?.currency_code || '').toUpperCase();
      const row = by.get(cur) || { in: 0, out: 0 };
      const n = Number(p.amount) || 0;
      if (p.kind === 'income') row.in += n;
      else row.out += n;
      by.set(cur, row);
    }
    return [...by.entries()];
  })();

  return (
    <Card>
      <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 16 }}>From your bank messages</Text>

      {justSaved > 0 && ready.length === 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: colors.successSoft }}>
          <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.success }}>
            <Text style={{ color: '#fff', fontFamily: fonts.uiBold, fontSize: 14 }}>✓</Text>
          </View>
          <Text style={{ color: colors.success, fontFamily: fonts.uiSemi, fontSize: 14 }}>
            Saved {justSaved} {justSaved === 1 ? 'message' : 'messages'}
          </Text>
        </View>
      ) : null}

      {ready.length > 0 ? (
        <View style={{ gap: 12, padding: 14, borderRadius: 18, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primary + '33' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary }}>
              <Text style={{ color: colors.onPrimary, fontFamily: fonts.uiBold, fontSize: 16 }}>{ready.length}</Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 15 }}>
                {ready.length === 1 ? 'Message ready to save' : 'Messages ready to save'}
              </Text>
              {readyTotals.map(([cur, tot]) => (
                <Text key={cur} style={{ color: colors.textSecondary, fontFamily: fonts.ui, fontSize: 12.5 }}>
                  {tot.in > 0 ? <Text style={{ color: colors.success, fontFamily: fonts.uiSemi }}>+{formatMoney(tot.in.toFixed(2), cur, locale)}</Text> : null}
                  {tot.in > 0 && tot.out > 0 ? '   ' : ''}
                  {tot.out > 0 ? <Text style={{ color: colors.secondary, fontFamily: fonts.uiSemi }}>−{formatMoney(tot.out.toFixed(2), cur, locale)}</Text> : null}
                </Text>
              ))}
            </View>
          </View>
          {progress ? (
            <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surface, overflow: 'hidden' }}>
              <View style={{ height: '100%', width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%`, backgroundColor: colors.primary }} />
            </View>
          ) : null}
          <Pressable
            onPress={() => void saveAll()}
            disabled={busy !== null}
            accessibilityRole="button"
            style={({ pressed }) => ({
              height: 48,
              borderRadius: 14,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.primary,
              opacity: busy !== null ? 0.7 : pressed ? 0.88 : 1,
            })}
          >
            <Text style={{ color: colors.onPrimary, fontFamily: fonts.uiBold, fontSize: 15 }}>
              {progress ? `Saving ${progress.done} of ${progress.total}…` : ready.length === 1 ? 'Save it' : `Save all ${ready.length}`}
            </Text>
          </Pressable>
          {vague.length ? (
            <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12, textAlign: 'center' }}>
              {vague.length} more {vague.length === 1 ? 'needs' : 'need'} a quick check below
            </Text>
          ) : null}
        </View>
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
