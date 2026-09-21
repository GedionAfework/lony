import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api, type Dashboard, type User } from './api';
import { fonts, radii, space, useTheme } from './theme';
import { Banner, Card, EmptyState, Money } from './ui';

type Props = {
  user: User;
  dashboard: Dashboard | null;
  token: string;
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
  if (!rf || !rt) return NaN;
  return (amount / rf) * rt;
}

export function DashboardHome({ user, dashboard, token, onOpenAnalytics, formatMoney }: Props) {
  const { colors } = useTheme();
  const preferred = (user.default_currency_code || '').toUpperCase() || 'USD';
  const [rates, setRates] = useState<Record<string, number>>({ [preferred]: 1 });
  const [asOf, setAsOf] = useState<string | undefined>();
  const [fxReady, setFxReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFxReady(false);
    api
      .fxRates(preferred)
      .then((res) => {
        if (cancelled) return;
        const next: Record<string, number> = { [preferred]: 1 };
        for (const [k, v] of Object.entries(res.rates ?? {})) {
          next[k.toUpperCase()] = Number(v);
        }
        setRates(next);
        setAsOf(res.as_of);
        setFxReady(true);
      })
      .catch(() => {
        if (!cancelled) setFxReady(true);
      });
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
      const r = convert(Number(s.receivables || 0), code, preferred, rates);
      const p = convert(Number(s.payables || 0), code, preferred, rates);
      const d = convert(Number(s.due_soon || 0), code, preferred, rates);
      if (!Number.isFinite(r) || !Number.isFinite(p)) continue;
      recv += r;
      pay += p;
      if (Number.isFinite(d)) due += d;
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

  const topFriends = useMemo(() => {
    const map = new Map<string, { name: string; net: number; recv: number; pay: number }>();
    for (const slice of dashboard?.by_currency ?? []) {
      const code = (slice.currency_code || preferred).toUpperCase();
      for (const fb of slice.friends ?? []) {
        const id = fb.peer.id;
        const prev = map.get(id) ?? { name: fb.peer.display_name, net: 0, recv: 0, pay: 0 };
        const n = convert(Number(fb.net || 0), code, preferred, rates);
        const r = convert(Number(fb.receivables || 0), code, preferred, rates);
        const p = convert(Number(fb.payables || 0), code, preferred, rates);
        if (Number.isFinite(n)) prev.net += n;
        if (Number.isFinite(r)) prev.recv += r;
        if (Number.isFinite(p)) prev.pay += p;
        map.set(id, prev);
      }
    }
    return [...map.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net)).slice(0, 5);
  }, [dashboard, preferred, rates]);

  const currencyShare = useMemo(() => {
    return (dashboard?.by_currency ?? []).map((s) => {
      const code = (s.currency_code || preferred).toUpperCase();
      const net = convert(Number(s.net || 0), code, preferred, rates);
      return {
        code,
        originalNet: Number(s.net || 0),
        convertedNet: Number.isFinite(net) ? net : 0,
        open: s.open_loan_count ?? 0,
      };
    });
  }, [dashboard, preferred, rates]);

  const empty = !dashboard?.by_currency?.length && !(dashboard?.pending_requests ?? 0);
  const netTone = totals.net > 0 ? 'positive' : totals.net < 0 ? 'negative' : 'default';
  const pendingConfirm = dashboard?.pending_confirmations ?? 0;
  const maxAbs = Math.max(...currencyShare.map((c) => Math.abs(c.convertedNet)), 1);

  return (
    <View style={{ gap: space.md }}>
      {empty ? (
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
              Net · {preferred}
            </Text>
            <Money
              value={formatMoney(totals.net.toFixed(2), preferred, user.locale)}
              size="xl"
              tone={netTone}
            />
            <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
              {totals.net > 0 ? 'You are owed' : totals.net < 0 ? 'You owe' : 'Balanced'}
              {fxReady && asOf ? ` · FX ${new Date(asOf).toLocaleDateString(user.locale || 'en')}` : ''}
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

          <Card>
            <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>
              Mix by currency · {preferred}
            </Text>
            {currencyShare.length === 0 ? (
              <EmptyState title="No currency mix" body="Loans in different currencies will split out here." />
            ) : (
              currencyShare.map((c) => (
                <View key={c.code} style={{ gap: 6, paddingVertical: 8 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.text, fontFamily: fonts.uiSemi }}>
                      {c.code} · {c.open} open
                    </Text>
                    <Money
                      value={formatMoney(c.convertedNet.toFixed(2), preferred, user.locale)}
                      size="sm"
                      tone={c.convertedNet >= 0 ? 'positive' : 'negative'}
                    />
                  </View>
                  <View
                    style={{
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: colors.surfaceMuted,
                      overflow: 'hidden',
                    }}
                  >
                    <View
                      style={{
                        width: `${Math.max(8, (Math.abs(c.convertedNet) / maxAbs) * 100)}%`,
                        height: '100%',
                        backgroundColor: c.convertedNet >= 0 ? colors.success : colors.error,
                        borderRadius: 3,
                      }}
                    />
                  </View>
                  <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                    Original {formatMoney(String(c.originalNet), c.code, user.locale)}
                  </Text>
                </View>
              ))
            )}
          </Card>

          <Card>
            <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>
              Top balances · {preferred}
            </Text>
            {topFriends.length === 0 ? (
              <EmptyState title="No friend balances" body="Accepted loans will stack per person here." />
            ) : (
              topFriends.map((f) => (
                <View
                  key={f.name}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingVertical: 10,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                  }}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colors.text, fontFamily: fonts.uiSemi }}>{f.name}</Text>
                    <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                      in {formatMoney(f.recv.toFixed(2), preferred, user.locale)} · out{' '}
                      {formatMoney(f.pay.toFixed(2), preferred, user.locale)}
                    </Text>
                  </View>
                  <Money
                    value={formatMoney(f.net.toFixed(2), preferred, user.locale)}
                    size="sm"
                    tone={f.net >= 0 ? 'positive' : 'negative'}
                  />
                </View>
              ))
            )}
          </Card>

          <Pressable onPress={onOpenAnalytics}>
            <Card>
              <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>Full analytics</Text>
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
                Breakdown by friend, currency, and direction
              </Text>
            </Card>
          </Pressable>
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
