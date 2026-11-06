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
  const [period, setPeriod] = useState<Period>('month');

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
  const hasYear = catalog.plans.some((p) => p.interval === 'year');
  const hasMonth = catalog.plans.some((p) => p.interval === 'month');
  const bestSave = Math.max(0, ...(['plus', 'pro'] as PlanTier[]).map((t) => yearSaving(catalog.plans.filter((p) => p.tier === t))));

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

      <View style={{ gap: 4, marginTop: 4 }}>
        <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 20 }}>{mine.tier === 'free' ? 'Upgrade your plan' : 'Plans'}</Text>
        <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
          {catalog.plans.some((p) => p.discount) ? 'Limited-time offers are on now.' : 'Cancel any time. Keep your plan until the end of the paid period.'}
        </Text>
      </View>
      {hasYear && hasMonth ? <PeriodToggle value={period} onChange={setPeriod} save={bestSave} /> : null}

      {catalog.tiers.map(({ tier, limits }) => (
        <TierCard
          period={hasMonth ? period : 'year'}
          onPeriod={setPeriod}
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

type Period = 'month' | 'year';
const ICON: Record<PlanTier, 'leaf' | 'bolt' | 'diamond'> = { free: 'leaf', plus: 'bolt', pro: 'diamond' };
const GOLD = '#E0A21B';

function yearSaving(options: PlanOption[]): number {
  const m = options.find((o) => o.interval === 'month');
  const y = options.find((o) => o.interval === 'year');
  if (!m?.amount_cents || !y?.amount_cents || m.currency !== y.currency) return 0;
  return Math.round((1 - y.amount_cents / (m.amount_cents * 12)) * 100);
}

/** Monthly / Yearly pill switch shared by every plan card. */
function PeriodToggle({ value, onChange, save }: { value: Period; onChange: (p: Period) => void; save: number }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      style={{ flexDirection: 'row', padding: 4, gap: 4, borderRadius: radii.full, backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border }}
    >
      {(['month', 'year'] as Period[]).map((p) => {
        const on = value === p;
        return (
          <Pressable
            key={p}
            onPress={() => onChange(p)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={{
              flex: 1,
              height: 38,
              borderRadius: radii.full,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              backgroundColor: on ? colors.surface : 'transparent',
              shadowColor: '#000',
              shadowOpacity: on ? 0.08 : 0,
              shadowRadius: 4,
              shadowOffset: { width: 0, height: 1 },
              elevation: on ? 1 : 0,
            }}
          >
            <Text style={{ color: on ? colors.text : colors.muted, fontFamily: fonts.uiBold, fontSize: 14 }}>{p === 'month' ? 'Monthly' : 'Yearly'}</Text>
            {p === 'year' && save > 0 ? (
              <View style={{ paddingHorizontal: 7, paddingVertical: 1, borderRadius: radii.full, backgroundColor: colors.successSoft }}>
                <Text style={{ color: colors.success, fontFamily: fonts.uiBold, fontSize: 11 }}>−{save}%</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
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
        minHeight: 50,
        borderRadius: 14,
        flexDirection: 'row',
        gap: 8,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        backgroundColor: primary ? colors.primary : colors.surfaceMuted,
        borderWidth: primary ? 0 : 1,
        borderColor: colors.border,
      })}
    >
      <Text style={{ color: primary ? colors.onPrimary : colors.text, fontFamily: fonts.uiBold, fontSize: 15 }}>{busy ? 'Opening…' : label}</Text>
      {!busy && primary ? <FontAwesome name="arrow-right" size={13} color={colors.onPrimary} /> : null}
    </Pressable>
  );
}

type Parts = { d: number; h: number; m: number; s: number };

/** Time left until `to`, ticking every second; calls onDone once when it reaches zero. */
function useCountdown(to?: string | null, onDone?: () => void): Parts | null {
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
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

/** Offer badge, its label and a tile countdown to when it ends. */
function DealStrip({ option, onExpired }: { option: PlanOption; onExpired: () => void }) {
  const { colors } = useTheme();
  const left = useCountdown(option.discount?.ends_at, onExpired);
  const d = option.discount;
  if (!d) return null;
  const off = d.kind === 'percent' ? `${Math.round(d.value)}% off` : `${price({ ...option, amount_cents: d.off_cents }) ?? ''} off`;
  const cells: [number, string][] = left ? (left.d > 0 ? [[left.d, 'd'], [left.h, 'h'], [left.m, 'm'], [left.s, 's']] : [[left.h, 'h'], [left.m, 'm'], [left.s, 's']]) : [];
  return (
    <View style={{ padding: 10, gap: 8, borderRadius: 14, backgroundColor: colors.errorSoft, borderWidth: 1, borderColor: `${colors.error}33` }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 3, borderRadius: radii.full, backgroundColor: colors.error }}>
          <FontAwesome name="fire" size={11} color="#fff" />
          <Text style={{ color: '#fff', fontFamily: fonts.uiBold, fontSize: 12 }}>{off}</Text>
        </View>
        {d.label ? <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 13 }}>{d.label}</Text> : null}
      </View>
      {cells.length ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ color: colors.muted, fontFamily: fonts.uiSemi, fontSize: 12 }}>Ends in</Text>
          {cells.map(([n, u]) => (
            <View
              key={u}
              style={{ flexDirection: 'row', alignItems: 'baseline', gap: 1, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 7, backgroundColor: colors.surface, borderWidth: 1, borderColor: `${colors.error}33` }}
            >
              <Text style={{ color: colors.error, fontFamily: fonts.monoSemi, fontSize: 13 }}>{String(n).padStart(2, '0')}</Text>
              <Text style={{ color: colors.muted, fontFamily: fonts.uiBold, fontSize: 10 }}>{u}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** One tier: price for the chosen period (with any running offer), the button, then what's included. */
function TierCard({
  tier,
  limits,
  period,
  onPeriod,
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
  period: Period;
  onPeriod: (p: Period) => void;
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
  const chosen = period === 'year' ? yearly ?? monthly : monthly ?? yearly;
  const now = price(chosen);
  const was = chosen?.discount && chosen.list_cents ? price({ ...chosen, amount_cents: chosen.list_cents }) : null;
  const save = yearSaving(options);
  const featured = tier === 'pro';
  const accent = tier === 'pro' ? GOLD : tier === 'plus' ? colors.primary : colors.muted;
  const ribbon = current ? 'Your plan' : featured ? 'Most popular' : null;

  return (
    <View style={{ paddingTop: ribbon ? 10 : 0 }}>
      <View
        style={{
          padding: space.md,
          paddingTop: ribbon ? space.md + 4 : space.md,
          gap: 14,
          borderRadius: 22,
          borderWidth: featured || current ? 1.5 : 1,
          borderColor: current ? colors.text : featured ? colors.primary : colors.border,
          backgroundColor: colors.surface,
          shadowColor: featured ? colors.primary : '#000',
          shadowOpacity: featured ? 0.18 : 0.04,
          shadowRadius: featured ? 16 : 6,
          shadowOffset: { width: 0, height: featured ? 8 : 2 },
          elevation: featured ? 4 : 1,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: tier === 'free' ? colors.surfaceMuted : `${accent}22` }}>
            <FontAwesome name={ICON[tier]} size={18} color={accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 19 }}>{LABEL[tier]}</Text>
            <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>{BLURB[tier]}</Text>
          </View>
        </View>

        {chosen?.discount ? <DealStrip key={chosen.key} option={chosen} onExpired={onExpired} /> : null}

        {tier === 'free' ? (
          <View style={{ gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
              <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 34, letterSpacing: -1 }}>$0</Text>
              <Text style={{ color: colors.muted, fontFamily: fonts.uiSemi, fontSize: 14 }}>/forever</Text>
            </View>
            <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>No card needed</Text>
          </View>
        ) : chosen ? (
          <View style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
              {was ? <Text style={{ color: colors.muted, fontFamily: fonts.uiSemi, fontSize: 17, textDecorationLine: 'line-through' }}>{was}</Text> : null}
              <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 34, letterSpacing: -1 }}>{now ?? '—'}</Text>
              <Text style={{ color: colors.muted, fontFamily: fonts.uiSemi, fontSize: 14 }}>/{chosen.interval === 'year' ? 'year' : 'month'}</Text>
            </View>
            {chosen.interval === 'year' && chosen.amount_cents ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
                  <Text style={{ color: colors.text, fontFamily: fonts.uiBold }}>{price({ ...chosen, amount_cents: Math.round(chosen.amount_cents / 12) })}</Text> a month, billed yearly
                </Text>
                {save > 0 ? (
                  <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: radii.full, backgroundColor: colors.successSoft }}>
                    <Text style={{ color: colors.success, fontFamily: fonts.uiBold, fontSize: 11.5 }}>Save {save}%</Text>
                  </View>
                ) : null}
              </View>
            ) : yearly && save > 0 ? (
              <Pressable onPress={() => onPeriod('year')} accessibilityRole="button" hitSlop={8}>
                <Text style={{ color: colors.success, fontFamily: fonts.uiBold, fontSize: 13, textDecorationLine: 'underline' }}>Pay yearly and save {save}%</Text>
              </Pressable>
            ) : (
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>Billed monthly</Text>
            )}
          </View>
        ) : (
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>Not offered right now</Text>
        )}

        {tier === 'free' ? null : subscribed ? (
          current ? null : <BuyButton label="Switch in billing" onPress={onManage} busy={busy === 'portal'} disabled={busy !== null} />
        ) : chosen ? (
          <BuyButton
            primary={featured || Boolean(chosen.discount)}
            label={current && trial ? `Keep ${LABEL[tier]}` : `Upgrade to ${LABEL[tier]}`}
            onPress={() => onBuy(chosen.key)}
            busy={busy === chosen.key}
            disabled={!chosen.available || busy !== null}
          />
        ) : null}

        <View style={{ gap: 9, paddingTop: 14, borderTopWidth: 1, borderStyle: 'dashed', borderColor: colors.border }}>
          <Text style={{ color: colors.muted, fontFamily: fonts.uiBold, fontSize: 11, letterSpacing: 0.8 }}>WHAT'S INCLUDED</Text>
          {features(limits).map((f) => (
            <View key={f.text} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: !f.on ? colors.surfaceMuted : featured ? colors.primary : colors.successSoft,
                }}
              >
                <FontAwesome name={f.on ? 'check' : 'times'} size={10} color={!f.on ? colors.muted : featured ? colors.onPrimary : colors.success} />
              </View>
              <Text style={{ flex: 1, color: f.on ? colors.text : colors.muted, fontFamily: fonts.ui, fontSize: 13.5 }}>{f.text}</Text>
            </View>
          ))}
        </View>
      </View>

      {ribbon ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 18,
            paddingHorizontal: 10,
            height: 22,
            justifyContent: 'center',
            borderRadius: radii.full,
            backgroundColor: current ? colors.text : colors.primary,
          }}
        >
          <Text style={{ color: current ? colors.surface : colors.onPrimary, fontFamily: fonts.uiBold, fontSize: 11 }}>{ribbon}</Text>
        </View>
      ) : null}
    </View>
  );
}
