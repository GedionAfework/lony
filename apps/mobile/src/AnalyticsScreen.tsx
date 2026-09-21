import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { api, type Dashboard, type User } from './api';
import { fonts, radii, space, useTheme } from './theme';
import { Card, EmptyState, Money } from './ui';

type Props = {
  user: User;
  dashboard: Dashboard | null;
  formatMoney: (amount: string | null | undefined, currency: string | null | undefined, locale?: string) => string;
};

function convert(amount: number, from: string, to: string, rates: Record<string, number>): number {
  if (from === to) return amount;
  const rf = rates[from];
  const rt = rates[to];
  if (!rf || !rt) return NaN;
  return (amount / rf) * rt;
}

export function AnalyticsScreen({ user, dashboard, formatMoney }: Props) {
  const { colors } = useTheme();
  const preferred = (user.default_currency_code || '').toUpperCase() || 'USD';
  const [rates, setRates] = useState<Record<string, number>>({ [preferred]: 1 });

  useEffect(() => {
    api
      .fxRates(preferred)
      .then((res) => {
        const next: Record<string, number> = { [preferred]: 1 };
        for (const [k, v] of Object.entries(res.rates ?? {})) {
          next[k.toUpperCase()] = Number(v);
        }
        setRates(next);
      })
      .catch(() => undefined);
  }, [preferred]);

  const summary = useMemo(() => {
    let recv = 0;
    let pay = 0;
    let due = 0;
    let open = 0;
    for (const slice of dashboard?.by_currency ?? []) {
      const code = (slice.currency_code || preferred).toUpperCase();
      const r = convert(Number(slice.receivables || 0), code, preferred, rates);
      const p = convert(Number(slice.payables || 0), code, preferred, rates);
      const d = convert(Number(slice.due_soon || 0), code, preferred, rates);
      if (Number.isFinite(r)) recv += r;
      if (Number.isFinite(p)) pay += p;
      if (Number.isFinite(d)) due += d;
      open += slice.open_loan_count ?? 0;
    }
    return { recv, pay, net: recv - pay, due, open };
  }, [dashboard, preferred, rates]);

  const friends = useMemo(() => {
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
    return [...map.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  }, [dashboard, preferred, rates]);

  const byCurrency = useMemo(() => {
    return (dashboard?.by_currency ?? []).map((s) => {
      const code = (s.currency_code || preferred).toUpperCase();
      const converted = convert(Number(s.net || 0), code, preferred, rates);
      return {
        code,
        open: s.open_loan_count ?? 0,
        recv: Number(s.receivables || 0),
        pay: Number(s.payables || 0),
        net: Number(s.net || 0),
        converted: Number.isFinite(converted) ? converted : 0,
      };
    });
  }, [dashboard, preferred, rates]);

  const empty = byCurrency.length === 0;

  return (
    <View style={{ gap: space.md }}>
      <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>Analytics</Text>
      <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
        Everything converted to {preferred}. Original currencies stay in the breakdown.
      </Text>

      {empty ? (
        <Card>
          <EmptyState
            title="Nothing to chart"
            body="Once loans are active, you’ll see direction, currency mix, and who you’re closest with."
          />
        </Card>
      ) : (
        <>
          <Card>
            <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>
              Snapshot · {preferred}
            </Text>
            <Money
              value={formatMoney(summary.net.toFixed(2), preferred, user.locale)}
              size="xl"
              tone={summary.net >= 0 ? 'positive' : 'negative'}
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Mini label="In" value={formatMoney(summary.recv.toFixed(2), preferred, user.locale)} />
              <Mini label="Out" value={formatMoney(summary.pay.toFixed(2), preferred, user.locale)} />
              <Mini label="Due" value={formatMoney(summary.due.toFixed(2), preferred, user.locale)} />
            </View>
          </Card>

          <Card>
            <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>
              Currency breakdown
            </Text>
            {byCurrency.map((s) => (
              <View
                key={s.code}
                style={{
                  gap: 4,
                  paddingVertical: 10,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.text, fontFamily: fonts.uiSemi }}>
                    {s.code} · {s.open} open
                  </Text>
                  <Money
                    value={formatMoney(s.converted.toFixed(2), preferred, user.locale)}
                    size="sm"
                    tone={s.converted >= 0 ? 'positive' : 'negative'}
                  />
                </View>
                <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                  Original net {formatMoney(String(s.net), s.code, user.locale)} · in{' '}
                  {formatMoney(String(s.recv), s.code, user.locale)} · out{' '}
                  {formatMoney(String(s.pay), s.code, user.locale)}
                </Text>
              </View>
            ))}
          </Card>

          <Card>
            <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>
              By friend · {preferred}
            </Text>
            {friends.length === 0 ? (
              <EmptyState title="No people yet" body="Friend-level nets appear after loans settle into balances." />
            ) : (
              friends.map((f) => (
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
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: radii.full,
                        backgroundColor: colors.surfaceMuted,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text style={{ color: colors.text, fontFamily: fonts.uiBold }}>{f.name.slice(0, 1)}</Text>
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ color: colors.text, fontFamily: fonts.uiSemi }}>{f.name}</Text>
                      <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                        in {formatMoney(f.recv.toFixed(2), preferred, user.locale)} · out{' '}
                        {formatMoney(f.pay.toFixed(2), preferred, user.locale)}
                      </Text>
                    </View>
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
        </>
      )}
    </View>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.surfaceMuted,
        borderRadius: radii.md,
        padding: 10,
        gap: 4,
      }}
    >
      <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 11 }}>{label}</Text>
      <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 13 }}>{value}</Text>
    </View>
  );
}
