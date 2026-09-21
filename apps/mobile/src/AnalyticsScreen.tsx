import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { api, type Dashboard, type User } from './api';
import { fonts, radii, space, useTheme } from './theme';
import { Card, Money, ScreenHeader } from './ui';

type Props = {
  user: User;
  dashboard: Dashboard | null;
  onBack: () => void;
  formatMoney: (amount: string | null | undefined, currency: string | null | undefined, locale?: string) => string;
};

function convert(amount: number, from: string, to: string, rates: Record<string, number>): number {
  if (from === to) return amount;
  const rf = rates[from];
  const rt = rates[to];
  if (!rf || !rt) return amount;
  return (amount / rf) * rt;
}

export function AnalyticsScreen({ user, dashboard, onBack, formatMoney }: Props) {
  const { colors } = useTheme();
  const preferred = (user.default_currency_code || 'USD').toUpperCase();
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

  const friends = useMemo(() => {
    const map = new Map<string, { name: string; net: number }>();
    for (const slice of dashboard?.by_currency ?? []) {
      const code = (slice.currency_code || preferred).toUpperCase();
      for (const fb of slice.friends ?? []) {
        const id = fb.peer.id;
        const prev = map.get(id) ?? { name: fb.peer.display_name, net: 0 };
        prev.net += convert(Number(fb.net || 0), code, preferred, rates);
        map.set(id, prev);
      }
    }
    return [...map.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  }, [dashboard, preferred, rates]);

  const byCurrency = dashboard?.by_currency ?? [];

  return (
    <View style={{ gap: space.md }}>
      <ScreenHeader title="Analytics" onBack={onBack} />
      <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
        All amounts shown in {preferred} using live FX rates.
      </Text>

      <Card>
        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>By currency (original)</Text>
        {byCurrency.length === 0 ? (
          <Text style={{ color: colors.muted, fontFamily: fonts.ui }}>No open loans</Text>
        ) : (
          byCurrency.map((s) => (
            <View
              key={s.currency_code}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                paddingVertical: 8,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
            >
              <Text style={{ color: colors.text, fontFamily: fonts.uiSemi }}>{s.currency_code}</Text>
              <Money
                value={formatMoney(s.net, s.currency_code, user.locale)}
                size="sm"
                tone={Number(s.net) >= 0 ? 'positive' : 'negative'}
              />
            </View>
          ))
        )}
      </Card>

      <Card>
        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>By friend · {preferred}</Text>
        {friends.length === 0 ? (
          <Text style={{ color: colors.muted, fontFamily: fonts.ui }}>No balances yet</Text>
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
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
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
                <Text style={{ color: colors.text, fontFamily: fonts.uiSemi }}>{f.name}</Text>
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
    </View>
  );
}
