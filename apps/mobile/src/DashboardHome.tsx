import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api, type Dashboard, type User } from './api';
import { IconAnalytics } from './icons';
import { fonts, radii, space, useTheme } from './theme';
import { Banner, Card, EmptyState, Money } from './ui';

type Props = {
  user: User;
  dashboard: Dashboard | null;
  token: string;
  onOpenAnalytics: () => void;
  formatMoney: (amount: string | null | undefined, currency: string | null | undefined, locale?: string) => string;
};

function convert(amount: number, from: string, to: string, rates: Record<string, number>): number {
  if (from === to) return amount;
  const rf = rates[from];
  const rt = rates[to];
  if (!rf || !rt) return NaN;
  return (amount / rf) * rt;
}

export function DashboardHome({ user, dashboard, token, onOpenAnalytics, formatMoney }: Props) {
  const { colors } = useTheme();
  const slices = dashboard?.by_currency ?? [];
  const preferred = (user.default_currency_code || '').toUpperCase();
  const displayCurrency =
    preferred ||
    (slices.length === 1 ? (slices[0].currency_code || '').toUpperCase() : '') ||
    '';

  const [rates, setRates] = useState<Record<string, number>>(() =>
    displayCurrency ? { [displayCurrency]: 1 } : {},
  );

  useEffect(() => {
    if (!displayCurrency) return;
    let cancelled = false;
    api
      .fxRates(displayCurrency)
      .then((res) => {
        if (cancelled) return;
        const next: Record<string, number> = { [displayCurrency]: 1 };
        for (const [k, v] of Object.entries(res.rates ?? {})) {
          next[k.toUpperCase()] = Number(v);
        }
        setRates(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [displayCurrency, token]);

  const totals = useMemo(() => {
    if (!displayCurrency) {
      return { receivables: 0, payables: 0, net: 0, dueSoon: 0, dueSoonCount: 0, openLoans: 0, pending: 0, currencies: 0 };
    }
    let recv = 0;
    let pay = 0;
    let due = 0;
    let dueCount = 0;
    let open = 0;
    let currencyCount = 0;
    for (const s of slices) {
      const code = (s.currency_code || displayCurrency).toUpperCase();
      const r = convert(Number(s.receivables || 0), code, displayCurrency, rates);
      const p = convert(Number(s.payables || 0), code, displayCurrency, rates);
      const d = convert(Number(s.due_soon || 0), code, displayCurrency, rates);
      if (!Number.isFinite(r) || !Number.isFinite(p)) continue;
      currencyCount += 1;
      recv += r;
      pay += p;
      if (Number.isFinite(d)) due += d;
      dueCount += s.due_soon_count ?? 0;
      open += s.open_loan_count ?? 0;
    }
    return {
      receivables: recv,
      payables: pay,
      net: recv - pay,
      dueSoon: due,
      dueSoonCount: dueCount,
      openLoans: open,
      pending: dashboard?.pending_requests ?? 0,
      currencies: currencyCount,
    };
  }, [slices, displayCurrency, rates, dashboard?.pending_requests]);

  const empty = slices.length === 0 && !(dashboard?.pending_requests ?? 0);
  const netTone = totals.net > 0 ? 'positive' : totals.net < 0 ? 'negative' : 'default';
  const pendingConfirm = dashboard?.pending_confirmations ?? 0;

  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>Dashboard</Text>
        <Pressable
          onPress={onOpenAnalytics}
          accessibilityRole="button"
          accessibilityLabel="Full analytics"
          hitSlop={8}
          style={{
            width: 42,
            height: 42,
            borderRadius: 21,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.surfaceMuted,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <IconAnalytics size={18} color={colors.text} />
        </Pressable>
      </View>

      {!displayCurrency ? (
        <Card>
          <EmptyState
            title="Pick your currency"
            body="Set a default currency in Settings so balances show in the unit you actually use."
          />
        </Card>
      ) : empty ? (
        <Card>
          <EmptyState
            title="Quiet ledger"
            body="No open loans yet. When money moves between friends, the story shows up here."
          />
        </Card>
      ) : (
        <>
          <Card>
            <Text
              style={{
                color: colors.muted,
                fontFamily: fonts.uiSemi,
                fontSize: 12,
                letterSpacing: 0.4,
                textTransform: 'uppercase',
              }}
            >
              Net · {displayCurrency}
            </Text>
            <Money
              value={formatMoney(totals.net.toFixed(2), displayCurrency, user.locale)}
              size="xl"
              tone={netTone}
            />
            <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
              {totals.net > 0 ? 'You are owed overall' : totals.net < 0 ? 'You owe overall' : 'Balanced'}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Stat
                label="Others owe"
                value={formatMoney(totals.receivables.toFixed(2), displayCurrency, user.locale)}
                tone="positive"
              />
              <Stat
                label="You owe"
                value={formatMoney(totals.payables.toFixed(2), displayCurrency, user.locale)}
                tone="negative"
              />
            </View>
          </Card>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <MiniStat label="Open" value={String(totals.openLoans)} />
            <MiniStat label="Pending" value={String(totals.pending)} />
            <MiniStat label="Due soon" value={String(totals.dueSoonCount)} />
          </View>

          <Card>
            <Text style={{ color: colors.muted, fontFamily: fonts.uiSemi, fontSize: 12, textTransform: 'uppercase' }}>
              Coming due
            </Text>
            <Money
              value={formatMoney(totals.dueSoon.toFixed(2), displayCurrency, user.locale)}
              size="md"
              tone={totals.dueSoonCount > 0 ? 'negative' : 'muted'}
            />
            <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
              {totals.dueSoonCount > 0
                ? `${totals.dueSoonCount} loan${totals.dueSoonCount === 1 ? '' : 's'} in the next week`
                : 'Nothing due in the next week'}
              {totals.currencies > 1 ? ` · ${totals.currencies} currencies` : ''}
            </Text>
          </Card>

          {pendingConfirm > 0 ? (
            <Banner
              tone="secondary"
              title="Confirm repayments"
              body={`${pendingConfirm} claim${pendingConfirm === 1 ? '' : 's'} waiting`}
            />
          ) : null}
        </>
      )}
    </View>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'positive' | 'negative';
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.surfaceMuted,
        borderRadius: radii.md,
        padding: 12,
        gap: 6,
      }}
    >
      <Text style={{ color: colors.muted, fontFamily: fonts.uiMedium, fontSize: 12 }}>{label}</Text>
      <Money value={value} size="md" tone={tone} />
    </View>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.surfaceMuted,
        borderRadius: radii.md,
        paddingVertical: 12,
        alignItems: 'center',
        gap: 4,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 18 }}>{value}</Text>
      <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 11 }}>{label}</Text>
    </View>
  );
}
