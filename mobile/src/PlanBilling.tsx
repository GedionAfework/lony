import { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, Switch, Text, View } from 'react-native';
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

      {catalog.tiers.map(({ tier, limits }) => (
        <TierCard
          key={tier}
          tier={tier}
          limits={limits}
          options={catalog.plans.filter((p) => p.tier === tier)}
          current={mine.tier === tier}
          trial={mine.source === 'trial'}
          subscribed={subscribed}
          busy={busy}
          onBuy={(key) => void open('checkout', key)}
          onManage={() => void open('portal')}
          onExpired={() => void load()}
        />
      ))}
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

/** "2d 04:12:33" until `to`, ticking every second; calls onDone once when it reaches zero. */
function useCountdown(to?: string | null, onDone?: () => void): string | null {
  const target = to ? new Date(to).getTime() : NaN;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!Number.isFinite(target)) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [target]);
  const left = Number.isFinite(target) ? target - now : NaN;
  const ended = Number.isFinite(left) && left <= 0;
  useEffect(() => {
    if (ended) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ended]);
  if (!Number.isFinite(left) || left <= 0) return null;
  const s = Math.floor(left / 1000);
  const d = Math.floor(s / 86400);
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return d > 0 ? `${d}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}

function DiscountLine({ option, onExpired }: { option: PlanOption; onExpired: () => void }) {
  const { colors } = useTheme();
  const left = useCountdown(option.discount?.ends_at, onExpired);
  const d = option.discount;
  if (!d) return null;
  const off = d.kind === 'percent' ? `${Math.round(d.value)}% off` : `${price({ ...option, amount_cents: d.off_cents }) ?? ''} off`;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
      <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: radii.full, backgroundColor: colors.error }}>
        <Text style={{ color: '#fff', fontFamily: fonts.uiBold, fontSize: 11.5 }}>{off}</Text>
      </View>
      {d.label ? <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 12.5 }}>{d.label}</Text> : null}
      {left ? (
        <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12.5 }}>
          Ends in <Text style={{ color: colors.error, fontFamily: fonts.uiBold }}>{left}</Text>
        </Text>
      ) : null}
    </View>
  );
}

/** One tier: a monthly/yearly switch, the price (with any discount and its countdown) and features. */
function TierCard({
  tier,
  limits,
  options,
  current,
  trial,
  subscribed,
  busy,
  onBuy,
  onManage,
  onExpired,
}: {
  tier: PlanTier;
  limits: PlanLimits;
  options: PlanOption[];
  current: boolean;
  trial: boolean;
  subscribed: boolean;
  busy: string | null;
  onBuy: (key: string) => void;
  onManage: () => void;
  onExpired: () => void;
}) {
  const { colors } = useTheme();
  const monthly = options.find((o) => o.interval === 'month');
  const yearly = options.find((o) => o.interval === 'year');
  const [period, setPeriod] = useState<'month' | 'year'>(monthly ? 'month' : 'year');
  const chosen = period === 'year' ? yearly ?? monthly : monthly ?? yearly;
  const now = price(chosen);
  const was = chosen?.discount && chosen.list_cents ? price({ ...chosen, amount_cents: chosen.list_cents }) : null;
  const save =
    monthly?.amount_cents && yearly?.amount_cents && monthly.currency === yearly.currency
      ? Math.round((1 - yearly.amount_cents / (monthly.amount_cents * 12)) * 100)
      : 0;
  const featured = tier === 'pro';

  return (
    <View
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

      {monthly && yearly ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ color: period === 'month' ? colors.text : colors.muted, fontFamily: period === 'month' ? fonts.uiBold : fonts.ui, fontSize: 13 }}>Monthly</Text>
          <Switch
            value={period === 'year'}
            onValueChange={(v) => setPeriod(v ? 'year' : 'month')}
            trackColor={{ false: colors.borderStrong, true: colors.primary }}
            thumbColor="#FFFFFF"
            accessibilityLabel="Bill yearly"
          />
          <Text style={{ color: period === 'year' ? colors.text : colors.muted, fontFamily: period === 'year' ? fonts.uiBold : fonts.ui, fontSize: 13 }}>Yearly</Text>
          {save > 0 ? <Pill text={`save ${save}%`} color={colors.success} /> : null}
        </View>
      ) : null}

      {tier === 'free' ? (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
          <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 30, letterSpacing: -0.5 }}>$0</Text>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 14 }}>/forever</Text>
        </View>
      ) : chosen ? (
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
            {was ? (
              <Text style={{ color: colors.muted, fontFamily: fonts.uiSemi, fontSize: 16, textDecorationLine: 'line-through' }}>{was}</Text>
            ) : null}
            <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 30, letterSpacing: -0.5 }}>{now ?? '—'}</Text>
            <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 14 }}>/{chosen.interval === 'year' ? 'year' : 'month'}</Text>
          </View>
          {chosen.interval === 'year' && chosen.amount_cents ? (
            <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12.5 }}>
              {price({ ...chosen, amount_cents: Math.round(chosen.amount_cents / 12) })} a month, billed yearly
            </Text>
          ) : null}
          <DiscountLine key={chosen.key} option={chosen} onExpired={onExpired} />
        </View>
      ) : (
        <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>Not offered right now</Text>
      )}

      <View style={{ gap: 6 }}>
        {features(limits).map((f) => (
          <View key={f.text} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: f.on ? 1 : 0.5 }}>
            <FontAwesome name={f.on ? 'check' : 'times'} size={12} color={f.on ? colors.success : colors.muted} />
            <Text style={{ color: colors.text, fontFamily: fonts.ui, fontSize: 13 }}>{f.text}</Text>
          </View>
        ))}
      </View>

      {tier === 'free' ? null : subscribed ? (
        current ? null : <BuyButton label="Switch in billing" onPress={onManage} busy={busy === 'portal'} disabled={busy !== null} />
      ) : chosen ? (
        <BuyButton
          primary={featured}
          label={`${current && trial ? `Keep ${LABEL[tier]}` : `Get ${LABEL[tier]}`} · ${now ?? ''}/${chosen.interval === 'year' ? 'yr' : 'mo'}`}
          onPress={() => onBuy(chosen.key)}
          busy={busy === chosen.key}
          disabled={!chosen.available || busy !== null}
        />
      ) : null}
    </View>
  );
}
