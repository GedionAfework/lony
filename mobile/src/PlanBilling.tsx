import { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { api, type BillingCatalog, type MyBilling, type PlanLimits, type PlanOption, type PlanTier } from './api';
import { BrandLoader } from './BrandLoader';
import { fonts, radii, space, useTheme } from './theme';

const LABEL: Record<PlanTier, string> = { free: 'Free', plus: 'Plus', pro: 'Pro' };
const BLURB: Record<PlanTier, string> = {
  free: 'Track money, loans and goals.',
  plus: 'Unlimited AI help and reports.',
  pro: 'Everything, plus bank sync.',
};
const LIVE = new Set(['active', 'trialing', 'past_due']);

function price(p?: PlanOption): string | null {
  if (!p?.amount_cents || !p.currency) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: p.currency.toUpperCase(),
      minimumFractionDigits: p.amount_cents % 100 === 0 ? 0 : 2,
    }).format(p.amount_cents / 100);
  } catch {
    return `${(p.amount_cents / 100).toFixed(2)} ${p.currency.toUpperCase()}`;
  }
}

function features(l: PlanLimits): { text: string; on: boolean }[] {
  const n = (v: number, unit: string) => (v < 0 ? `Unlimited ${unit}` : `${v.toLocaleString()} ${unit} a month`);
  return [
    { text: 'Accounts, budgets, loans & goals', on: true },
    { text: l.ai_monthly === 0 ? 'AI coach & insights' : l.ai_monthly < 0 ? `Unlimited AI coach (${l.ai_daily}/day)` : n(l.ai_monthly, 'AI requests'), on: l.ai_monthly !== 0 },
    { text: l.captures_monthly === 0 ? 'Receipt & voice capture' : n(l.captures_monthly, 'receipt & voice captures'), on: l.captures_monthly !== 0 },
    { text: 'Analytics reports', on: l.reports },
    { text: 'Trip budgets', on: l.trips },
    { text: l.bank_links > 0 ? `${l.bank_links} connected bank${l.bank_links > 1 ? 's' : ''}` : 'Connected banks', on: l.bank_links !== 0 },
  ];
}

function status(b: MyBilling): string {
  const sub = b.subscription;
  const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  if (b.source === 'polar' && sub) {
    if (sub.status === 'past_due') return 'Payment failed: update your card to keep your plan.';
    if (sub.cancel_at_period_end) return `Cancelled, active until ${day(sub.current_period_end)}.`;
    return sub.current_period_end ? `Renews on ${day(sub.current_period_end)}.` : 'Active subscription.';
  }
  if (b.source === 'trial') {
    const left = b.expires_at ? Math.max(0, Math.ceil((new Date(b.expires_at).getTime() - Date.now()) / 86_400_000)) : 0;
    return left > 0 ? `Free trial: ${left} day${left === 1 ? '' : 's'} left.` : 'Your free trial has ended.';
  }
  if (b.source === 'admin') return b.expires_at ? `Granted by Lony until ${day(b.expires_at)}.` : 'Granted by Lony.';
  return 'Upgrade any time. Cancel whenever you like.';
}

/** Plans with their monthly and yearly prices; buying opens secure checkout in the browser. */
export function PlanBilling({ token, onChanged, onError }: { token: string; onChanged?: () => void; onError: (m: string) => void }) {
  const { colors } = useTheme();
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
  const [mine, setMine] = useState<MyBilling | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, m] = await Promise.all([api.billingCatalog(), api.myBilling(token)]);
      setCatalog(c);
      setMine(m);
      setFailed(null);
      return m;
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'Could not load your plan');
      return null;
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // Back from checkout in the browser: pick up the new plan.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void load().then((m) => m && onChanged?.());
    });
    return () => sub.remove();
  }, [load, onChanged]);

  async function open(kind: 'checkout' | 'portal', planKey?: string) {
    setBusy(planKey || kind);
    try {
      const { url } = kind === 'checkout' && planKey ? await api.startCheckout(token, planKey) : await api.billingPortal(token);
      await WebBrowser.openBrowserAsync(url);
      const m = await load();
      if (m) onChanged?.();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not open checkout');
    } finally {
      setBusy(null);
    }
  }

  if (failed && !mine) {
    return (
      <Pressable onPress={() => void load()} style={{ padding: space.md }}>
        <Text style={{ color: colors.muted, fontFamily: fonts.ui }}>{failed} · Tap to try again</Text>
      </Pressable>
    );
  }
  if (!catalog || !mine) return <BrandLoader label="Loading plans" />;

  const subscribed = Boolean(mine.source === 'polar' && mine.subscription && LIVE.has(mine.subscription.status));
  const anyBuyable = catalog.plans.some((p) => p.available);

  return (
    <View style={{ gap: space.md }}>
      <View style={{ padding: space.md, borderRadius: 18, backgroundColor: colors.primary, gap: 4 }}>
        <Text style={{ color: colors.onPrimary, opacity: 0.8, fontFamily: fonts.uiSemi, fontSize: 12 }}>YOUR PLAN</Text>
        <Text style={{ color: colors.onPrimary, fontFamily: fonts.uiBold, fontSize: 24 }}>
          {LABEL[mine.tier]}
          {mine.source === 'trial' ? '  · Trial' : ''}
        </Text>
        <Text style={{ color: colors.onPrimary, opacity: 0.85, fontFamily: fonts.ui, fontSize: 13 }}>{status(mine)}</Text>
        {mine.can_manage ? (
          <Pressable
            onPress={() => void open('portal')}
            disabled={busy !== null}
            style={{ alignSelf: 'flex-start', marginTop: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.full, backgroundColor: 'rgba(255,255,255,0.18)' }}
          >
            <Text style={{ color: colors.onPrimary, fontFamily: fonts.uiSemi, fontSize: 13 }}>{busy === 'portal' ? 'Opening…' : 'Manage billing'}</Text>
          </Pressable>
        ) : null}
      </View>

      {!anyBuyable ? (
        <View style={{ padding: 12, borderRadius: 14, backgroundColor: colors.warningSoft }}>
          <Text style={{ color: colors.warning, fontFamily: fonts.uiSemi, fontSize: 13 }}>
            Online payments are being set up. Paid plans will be available to buy here soon.
          </Text>
        </View>
      ) : null}

      {catalog.tiers.map(({ tier, limits }) => {
        const monthly = catalog.plans.find((p) => p.tier === tier && p.interval === 'month');
        const yearly = catalog.plans.find((p) => p.tier === tier && p.interval === 'year');
        const mPrice = price(monthly);
        const yPrice = price(yearly);
        const save =
          monthly?.amount_cents && yearly?.amount_cents && monthly.currency === yearly.currency
            ? Math.round((1 - yearly.amount_cents / (monthly.amount_cents * 12)) * 100)
            : 0;
        const current = mine.tier === tier;
        const featured = tier === 'pro';
        return (
          <View
            key={tier}
            style={{
              padding: space.md,
              gap: 10,
              borderRadius: 18,
              borderWidth: featured || current ? 2 : 1,
              borderColor: current ? colors.success : featured ? colors.primary : colors.border,
              backgroundColor: colors.surface,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 18 }}>{LABEL[tier]}</Text>
              {current ? <Pill text="Current" color={colors.success} /> : featured ? <Pill text="Best value" color={colors.primary} /> : null}
            </View>
            <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>{BLURB[tier]}</Text>

            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
              <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 30, letterSpacing: -0.5 }}>{tier === 'free' ? '$0' : mPrice ?? '—'}</Text>
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 14 }}>{tier === 'free' ? '/forever' : '/month'}</Text>
            </View>
            {tier !== 'free' && yPrice ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
                  or <Text style={{ color: colors.text, fontFamily: fonts.uiSemi }}>{yPrice}</Text>/year
                </Text>
                {save > 0 ? <Pill text={`save ${save}%`} color={colors.success} /> : null}
              </View>
            ) : null}

            <View style={{ gap: 6 }}>
              {features(limits).map((f) => (
                <View key={f.text} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: f.on ? 1 : 0.5 }}>
                  <FontAwesome name={f.on ? 'check' : 'times'} size={12} color={f.on ? colors.success : colors.muted} />
                  <Text style={{ color: colors.text, fontFamily: fonts.ui, fontSize: 13 }}>{f.text}</Text>
                </View>
              ))}
            </View>

            {tier === 'free' ? null : subscribed ? (
              current ? null : (
                <BuyButton label="Switch in billing" onPress={() => void open('portal')} busy={busy === 'portal'} disabled={busy !== null} />
              )
            ) : (
              <View style={{ gap: 8 }}>
                {[monthly, yearly].map((opt) =>
                  opt ? (
                    <BuyButton
                      key={opt.key}
                      primary={opt.interval === 'year'}
                      label={`${opt.interval === 'year' ? 'Yearly' : 'Monthly'} · ${price(opt) ?? ''}`}
                      onPress={() => void open('checkout', opt.key)}
                      busy={busy === opt.key}
                      disabled={!opt.available || busy !== null}
                    />
                  ) : null,
                )}
              </View>
            )}
          </View>
        );
      })}
      <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12, textAlign: 'center' }}>
        Payments are handled securely by Polar in your browser. Cancel any time from Manage billing.
      </Text>
    </View>
  );
}

function Pill({ text, color }: { text: string; color: string }) {
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: radii.full, backgroundColor: `${color}22` }}>
      <Text style={{ color, fontFamily: fonts.uiSemi, fontSize: 11 }}>{text}</Text>
    </View>
  );
}

function BuyButton({ label, onPress, busy, disabled, primary }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean; primary?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => ({
        minHeight: 46,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        backgroundColor: primary ? colors.primary : colors.surfaceMuted,
      })}
    >
      <Text style={{ color: primary ? colors.onPrimary : colors.text, fontFamily: fonts.uiSemi, fontSize: 14.5 }}>{busy ? 'Opening…' : label}</Text>
    </Pressable>
  );
}
