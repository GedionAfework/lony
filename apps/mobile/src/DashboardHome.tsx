import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api, type Dashboard, type User } from './api';
import { fonts, radii, space, useTheme } from './theme';
import { Banner, BrandMark, Card, Money, ThemeToggle } from './ui';

type Props = {
  user: User;
  dashboard: Dashboard | null;
  token: string;
  onMenu: () => void;
  onOpenAnalytics: () => void;
  formatMoney: (amount: string | null | undefined, currency: string | null | undefined, locale?: string) => string;
};

type Totals = {
  currency: string;
  receivables: number;
  payables: number;
  net: number;
  dueSoon: number;
  dueSoonCount: number;
  openLoans: number;
  pending: number;
  asOf?: string;
};

function convert(amount: number, from: string, to: string, rates: Record<string, number>): number {
  if (from === to) return amount;
  const rf = rates[from];
  const rt = rates[to];
  if (!rf || !rt) return amount;
  return (amount / rf) * rt;
}

export function DashboardHome({ user, dashboard, token, onMenu, onOpenAnalytics, formatMoney }: Props) {
  const { colors } = useTheme();
  const preferred = (user.default_currency_code || 'USD').toUpperCase();
  const [rates, setRates] = useState<Record<string, number>>({ [preferred]: 1 });
  const [asOf, setAsOf] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    api
      .fxRates(preferred)
      .then((res) => {
        if (cancelled) return;
        const next: Record<string, number> = {};
        for (const [k, v] of Object.entries(res.rates ?? {})) {
          next[k.toUpperCase()] = Number(v);
        }
        next[preferred] = 1;
        setRates(next);
        setAsOf(res.as_of);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [preferred, token]);

  const totals = useMemo<Totals>(() => {
    const slices = dashboard?.by_currency ?? [];
    let recv = 0;
    let pay = 0;
    let due = 0;
    let dueCount = 0;
    let open = 0;
    for (const s of slices) {
      const code = (s.currency_code || preferred).toUpperCase();
      recv += convert(Number(s.receivables || 0), code, preferred, rates);
      pay += convert(Number(s.payables || 0), code, preferred, rates);
      due += convert(Number(s.due_soon || 0), code, preferred, rates);
      dueCount += s.due_soon_count ?? 0;
      open += s.open_loan_count ?? 0;
    }
    return {
      currency: preferred,
      receivables: recv,
      payables: pay,
      net: recv - pay,
      dueSoon: due,
      dueSoonCount: dueCount,
      openLoans: open,
      pending: dashboard?.pending_requests ?? 0,
      asOf,
    };
  }, [dashboard, preferred, rates, asOf]);

  const netTone = totals.net > 0 ? 'positive' : totals.net < 0 ? 'negative' : 'default';
  const pendingConfirm = dashboard?.pending_confirmations ?? 0;

  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable
          onPress={onMenu}
          accessibilityRole="button"
          accessibilityLabel="Open menu"
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
          <Text style={{ color: colors.text, fontSize: 20, lineHeight: 22 }}>☰</Text>
        </Pressable>
        <BrandMark />
        <ThemeToggle />
      </View>

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
          Net · {preferred}
        </Text>
        <Money
          value={formatMoney(totals.net.toFixed(2), preferred, user.locale)}
          size="xl"
          tone={netTone}
        />
        <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
          {totals.net > 0 ? 'You are owed' : totals.net < 0 ? 'You owe' : 'Balanced'}
          {asOf ? ` · rates ${new Date(asOf).toLocaleDateString(user.locale || 'en')}` : ''}
        </Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Stat
            label="Others owe"
            value={formatMoney(totals.receivables.toFixed(2), preferred, user.locale)}
            tone="positive"
          />
          <Stat
            label="You owe"
            value={formatMoney(totals.payables.toFixed(2), preferred, user.locale)}
            tone="negative"
          />
        </View>
      </Card>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <MiniStat label="Open" value={String(totals.openLoans)} />
        <MiniStat label="Pending" value={String(totals.pending)} />
        <MiniStat label="Due soon" value={String(totals.dueSoonCount)} />
      </View>

      {pendingConfirm > 0 ? (
        <Banner
          tone="secondary"
          title="Confirm repayments"
          body={`${pendingConfirm} claim${pendingConfirm === 1 ? '' : 's'} waiting`}
        />
      ) : null}
      {totals.dueSoonCount > 0 ? (
        <Banner
          tone="tertiary"
          title="Due soon"
          body={`${formatMoney(totals.dueSoon.toFixed(2), preferred, user.locale)} across ${totals.dueSoonCount} loan${totals.dueSoonCount === 1 ? '' : 's'}`}
        />
      ) : null}

      <Pressable onPress={onOpenAnalytics}>
        <Card>
          <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>Analytics</Text>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
            Full breakdown by friend and currency
          </Text>
        </Card>
      </Pressable>
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
