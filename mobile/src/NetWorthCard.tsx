import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { api, type DaySummary, type InsightsMonthPoint, type MoneyAccount, type WealthSummary } from './api';
import { IconClose } from './icons';
import { formatMoneyAmount } from './amountFormat';
import { t } from './i18n';
import { fonts, radii, space, useTheme } from './theme';
import { EmptyState, PrimaryButton } from './ui';
import FontAwesome from '@expo/vector-icons/FontAwesome';

type ModalKind = 'institutions' | 'accounts' | 'cash' | 'recv' | 'pay' | null;

type Props = {
  token: string;
  wealth: WealthSummary | null;
  currency: string;
  locale?: string | null;
  formatMoney: (amount: string | null | undefined, currency: string | null | undefined, locale?: string) => string;
  onOpenAccounts?: () => void;
  /** The picked calendar day (YYYY-MM-DD) and its summary: the card then shows that day. */
  dayIso?: string;
  day?: DaySummary | null;
};

/** "Fri, 11-06-2026": the weekday, then the date as month-day-year. */
export function dayLabel(iso: string, locale?: string | null): string {
  const [y, m, d] = iso.split('-');
  const weekday = new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString(locale || undefined, { weekday: 'short' });
  return `${weekday}, ${m}-${d}-${y}`;
}

function todayIso(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

/**
 * A smooth, continuous line through the points, with a soft fill under it. Drawn with plain
 * Views: the curve is sampled (Catmull-Rom), each piece is a bar exactly as long as the gap
 * between two samples, and round joints sit on every sample so neighbouring pieces meet.
 */
function Sparkline({
  points,
  color,
  describe,
}: {
  points: number[];
  color: string;
  /** Text for a tapped point, e.g. "Oct 2026 · +ETB 1,200". */
  describe?: (index: number) => string;
}) {
  const h = 56;
  const stroke = 3;
  const [w, setW] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  if (points.length < 2) return <View style={{ height: h }} />;
  const indexAt = (x: number) => Math.max(0, Math.min(points.length - 1, Math.round((x / Math.max(w, 1)) * (points.length - 1))));
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(max - min, 1);
  const pad = 6;
  const raw = points.map((p, i) => ({
    x: (i / (points.length - 1)) * w,
    y: h - pad - ((p - min) / span) * (h - pad * 2),
  }));
  // Catmull-Rom through the points, clamped so the curve never leaves the chart.
  const steps = 12;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < raw.length - 1; i++) {
    const p0 = raw[i - 1] ?? raw[i];
    const p1 = raw[i];
    const p2 = raw[i + 1];
    const p3 = raw[i + 2] ?? p2;
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      pts.push({ x, y: Math.min(h - 2, Math.max(2, y)) });
    }
  }
  pts.push(raw[raw.length - 1]);
  const last = pts[pts.length - 1];
  const sel = active != null ? raw[active] : null;
  return (
    <View style={{ gap: 6 }}>
      <Text
        numberOfLines={2}
        style={{ color, opacity: active != null ? 1 : 0.75, fontFamily: active != null ? fonts.uiSemi : fonts.ui, fontSize: 12, minHeight: 16 }}
      >
        {active != null && describe ? describe(active) : 'Net per month · tap the line'}
      </Text>
    <View
      style={{ height: h, marginVertical: 4 }}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => setActive(indexAt(e.nativeEvent.locationX))}
      onResponderMove={(e) => setActive(indexAt(e.nativeEvent.locationX))}
      accessibilityRole="adjustable"
      accessibilityLabel="Monthly net graph"
      accessibilityValue={active != null && describe ? { text: describe(active) } : undefined}
      onAccessibilityAction={(e) => {
        const cur = active ?? points.length - 1;
        if (e.nativeEvent.actionName === 'increment') setActive(Math.min(points.length - 1, cur + 1));
        if (e.nativeEvent.actionName === 'decrement') setActive(Math.max(0, cur - 1));
      }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
    >
      {w > 0 ? (
        <>
          {/* Soft fill: thin columns that follow the curve */}
          {pts.slice(0, -1).map((p, i) => {
            const next = pts[i + 1];
            return (
              <View
                key={`f-${i}`}
                style={{
                  position: 'absolute',
                  left: p.x,
                  width: Math.max(1, next.x - p.x + 0.5),
                  top: (p.y + next.y) / 2,
                  bottom: 0,
                  backgroundColor: color,
                  opacity: 0.12,
                }}
              />
            );
          })}
          {/* The line: one bar per piece, rotated about its own centre */}
          {pts.slice(0, -1).map((p, i) => {
            const next = pts[i + 1];
            const dx = next.x - p.x;
            const dy = next.y - p.y;
            const len = Math.hypot(dx, dy);
            return (
              <View
                key={`s-${i}`}
                style={{
                  position: 'absolute',
                  left: (p.x + next.x) / 2 - len / 2,
                  top: (p.y + next.y) / 2 - stroke / 2,
                  width: len + 0.5,
                  height: stroke,
                  backgroundColor: color,
                  transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
                }}
              />
            );
          })}
          {/* Round joints so the pieces read as one line */}
          {pts.map((p, i) => (
            <View
              key={`j-${i}`}
              style={{
                position: 'absolute',
                left: p.x - stroke / 2,
                top: p.y - stroke / 2,
                width: stroke,
                height: stroke,
                borderRadius: stroke / 2,
                backgroundColor: color,
              }}
            />
          ))}
          {sel ? (
            <>
              <View
                pointerEvents="none"
                style={{ position: 'absolute', left: sel.x - 0.75, top: 0, bottom: 0, width: 1.5, backgroundColor: color, opacity: 0.5 }}
              />
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: sel.x - 7,
                  top: sel.y - 7,
                  width: 14,
                  height: 14,
                  borderRadius: 7,
                  backgroundColor: color,
                  borderWidth: 3,
                  borderColor: 'rgba(255,255,255,0.35)',
                }}
              />
            </>
          ) : (
            <View
              style={{
                position: 'absolute',
                left: last.x - 5,
                top: last.y - 5,
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: color,
              }}
            />
          )}
        </>
      ) : null}
    </View>
    </View>
  );
}

/** "2026-10" or "2026-10-01" → "Oct 2026". */
function monthLabel(raw: string, locale?: string | null): string {
  const m = /^(\d{4})-(\d{2})/.exec(raw || '');
  if (!m) return raw;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  try {
    return d.toLocaleDateString(locale || undefined, { month: 'short', year: 'numeric' });
  } catch {
    return `${m[2]}/${m[1]}`;
  }
}

/** A tappable figure on the hero card: label over value, on a translucent tile. */
function MiniStat({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        backgroundColor: HERO_TILE,
        borderRadius: radii.md,
        paddingVertical: 10,
        paddingHorizontal: 10,
        gap: 3,
      }}
    >
      <Text style={{ color: colors.onPrimary, opacity: 0.8, fontFamily: fonts.ui, fontSize: 11 }} numberOfLines={1}>
        {label}
      </Text>
      <Text style={{ color: colors.onPrimary, fontFamily: fonts.uiSemi, fontSize: 13 }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </Pressable>
  );
}

const HERO_TILE = 'rgba(255,255,255,0.16)';

export function NetWorthCard({ token, wealth, currency: walletCurrency, locale, formatMoney, onOpenAccounts, dayIso, day }: Props) {
  // A picked day is summed in its own currency (the server converts every account into it).
  const currency = (day?.currency_code || walletCurrency || 'USD').toUpperCase();
  const { colors } = useTheme();
  const [hidden, setHidden] = useState(false);
  const [modal, setModal] = useState<ModalKind>(null);
  const [series, setSeries] = useState<InsightsMonthPoint[]>([]);

  const accounts = wealth?.accounts ?? [];
  // With several currencies the server adds them all up in the preferred currency; use that
  // total rather than the slice of one currency.
  const useTotal = Boolean(wealth?.converted) && (wealth?.preferred_currency || '').toUpperCase() === currency.toUpperCase();
  const slice = useTotal ? undefined : wealth?.by_currency?.find((s) => s.currency_code.toUpperCase() === currency.toUpperCase());
  const net = slice?.net_worth ?? wealth?.live_net_worth ?? wealth?.net_worth ?? '0';
  const cash = slice?.cash_on_hand ?? wealth?.cash_on_hand ?? '0';
  const recv = slice?.receivables ?? wealth?.receivables ?? '0';
  const pay = slice?.payables ?? wealth?.payables ?? '0';

  const institutions = useMemo(() => {
    const map = new Map<string, { name: string; count: number; balance: number; types: Set<string> }>();
    for (const a of accounts) {
      const name = (a.institution_label || a.name || 'Other').trim() || 'Other';
      const key = name.toLowerCase();
      const cur = map.get(key) || { name, count: 0, balance: 0, types: new Set<string>() };
      cur.count += 1;
      const signed = a.account_type === 'credit_card' ? -(Number(a.balance) || 0) : Number(a.balance) || 0;
      cur.balance += signed;
      cur.types.add(a.account_type);
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  }, [accounts]);

  useEffect(() => {
    let cancelled = false;
    if (!token || !currency) return;
    api
      .insightsCashflowSeries(token, currency, 6)
      .then((res) => {
        if (!cancelled) setSeries(res.series ?? []);
      })
      .catch(() => {
        if (!cancelled) setSeries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [token, currency]);

  const nets = series.map((s) => Number(s.net) || Number(s.income) - Number(s.expense) || 0);
  const momPct = useMemo(() => {
    if (nets.length < 2) return null;
    const prev = nets[nets.length - 2] ?? 0;
    const cur = nets[nets.length - 1] ?? 0;
    if (Math.abs(prev) < 0.0001) return cur === 0 ? 0 : null;
    return ((cur - prev) / Math.abs(prev)) * 100;
  }, [nets]);

  const mask = (v: string) => (hidden ? '••••••' : v);
  const money = (amount: string) => mask(formatMoney(amount, currency, locale ?? undefined));

  return (
    <>
      <View
        style={{
          backgroundColor: colors.primary,
          borderRadius: 24,
          padding: space.lg,
          gap: 12,
          overflow: 'hidden',
          shadowColor: colors.primary,
          shadowOpacity: 0.3,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
          elevation: 6,
        }}
      >
        {/* Soft decorative circles */}
        <View
          pointerEvents="none"
          style={{ position: 'absolute', width: 220, height: 220, borderRadius: 110, right: -70, top: -90, backgroundColor: 'rgba(255,255,255,0.10)' }}
        />
        <View
          pointerEvents="none"
          style={{ position: 'absolute', width: 140, height: 140, borderRadius: 70, left: -50, bottom: -60, backgroundColor: 'rgba(255,255,255,0.07)' }}
        />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: colors.onPrimary, opacity: 0.85, fontFamily: fonts.uiSemi, fontSize: 14 }}>
            {dayIso ? dayLabel(dayIso, locale) : t(locale, 'wealth.totalBalance')}
          </Text>
          <Pressable
            onPress={() => setHidden((h) => !h)}
            hitSlop={8}
            accessibilityLabel={hidden ? t(locale, 'wealth.showBalance') : t(locale, 'wealth.hideBalance')}
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: HERO_TILE,
            }}
          >
            <FontAwesome name={hidden ? 'eye-slash' : 'eye'} size={16} color={colors.onPrimary} />
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <Text style={{ color: colors.onPrimary, opacity: 0.8, fontFamily: fonts.uiSemi, fontSize: 18 }}>
            {(currency || 'USD').toUpperCase()}
          </Text>
          <Text
            style={{ color: colors.onPrimary, fontFamily: fonts.uiBold, fontSize: 36, letterSpacing: -0.5, flexShrink: 1 }}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {hidden ? '••••••' : formatMoneyAmount(dayIso && day ? day.balance : net, locale ?? 'en')}
          </Text>
        </View>
        {dayIso ? (
          <Text style={{ color: colors.onPrimary, opacity: 0.75, fontFamily: fonts.ui, fontSize: 12 }}>
            {dayIso === todayIso() ? t(locale, 'wealth.balanceNow') : t(locale, 'wealth.balanceEndOfDay')}
            {day?.missing_rates?.length ? ` · not included (no rate): ${day.missing_rates.join(', ')}` : ''}
          </Text>
        ) : null}
        {useTotal && !dayIso ? (
          <Text style={{ color: colors.onPrimary, opacity: 0.75, fontFamily: fonts.ui, fontSize: 12 }}>
            All currencies at today's rate
            {wealth?.missing_rates?.length ? ` · not included (no rate): ${wealth.missing_rates.join(', ')}` : ''}
          </Text>
        ) : null}

        {momPct != null && Number.isFinite(momPct) ? (
          <View
            style={{
              alignSelf: 'flex-start',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: radii.full,
              backgroundColor: HERO_TILE,
            }}
          >
            <FontAwesome name={momPct >= 0 ? 'arrow-up' : 'arrow-down'} size={11} color={colors.onPrimary} />
            <Text
              style={{
                color: colors.onPrimary,
                fontFamily: fonts.uiSemi,
                fontSize: 12,
              }}
            >
              {momPct >= 0 ? '+' : ''}
              {momPct.toFixed(1)}% {t(locale, 'wealth.vsLastMonth')}
            </Text>
          </View>
        ) : null}

        {nets.length > 1 ? (
          <Sparkline
            points={nets}
            color={colors.onPrimary}
            describe={(i) => {
              const pt = series[i];
              if (!pt) return '';
              const net = nets[i] ?? 0;
              const fmt = (v: string | number) => mask(formatMoney(String(v), currency, locale ?? undefined));
              return `${monthLabel(pt.month, locale)} · ${net >= 0 ? '+' : ''}${fmt(net.toFixed(2))} · in ${fmt(pt.income)} · out ${fmt(pt.expense)}`;
            }}
          />
        ) : null}

        {dayIso ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <MiniStat label={t(locale, 'wealth.moneyIn')} value={`+${money(day?.income ?? '0')}`} onPress={() => setModal('cash')} />
            <MiniStat label={t(locale, 'wealth.moneyOut')} value={`−${money(day?.expense ?? '0')}`} onPress={() => setModal('pay')} />
            <MiniStat
              label={t(locale, 'wealth.dayTotal')}
              value={`${Number(day?.net ?? 0) < 0 ? '−' : '+'}${money(Math.abs(Number(day?.net ?? 0)).toFixed(2))}`}
              onPress={() => setModal('institutions')}
            />
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <MiniStat label={t(locale, 'wealth.cash')} value={money(cash)} onPress={() => setModal('cash')} />
            <MiniStat label={t(locale, 'wealth.owedToYou')} value={money(recv)} onPress={() => setModal('recv')} />
            <MiniStat label={t(locale, 'wealth.youOwe')} value={money(pay)} onPress={() => setModal('pay')} />
          </View>
        )}

        <Pressable
          onPress={() => setModal('institutions')}
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}
        >
          <Text style={{ color: colors.onPrimary, opacity: 0.8, fontFamily: fonts.ui, fontSize: 13 }}>
            {institutions.length} {t(locale, 'wealth.institutions')} · {accounts.length} {t(locale, 'wealth.accounts')}
          </Text>
          <Text style={{ color: colors.onPrimary, fontFamily: fonts.uiSemi, fontSize: 13 }}>
            {t(locale, 'wealth.details')} ›
          </Text>
        </Pressable>
      </View>

      <DetailModal
        visible={modal != null}
        onClose={() => setModal(null)}
        title={
          modal === 'institutions'
            ? t(locale, 'wealth.institutions')
            : modal === 'accounts'
              ? t(locale, 'wealth.accounts')
              : modal === 'cash'
                ? t(locale, 'wealth.cashOnHand')
                : modal === 'recv'
                  ? t(locale, 'wealth.owedToYou')
                  : modal === 'pay'
                    ? t(locale, 'wealth.youOwe')
                    : ''
        }
      >
        {modal === 'cash' ? (
          <DetailBody
            lead={t(locale, 'wealth.cashLead')}
            value={money(cash)}
            rows={accounts.map((a) => ({
              title: a.name,
              subtitle: `${a.account_type.replace(/_/g, ' ')}${a.institution_label ? ` · ${a.institution_label}` : ''}`,
              trailing: money(a.balance),
            }))}
            empty={t(locale, 'wealth.noAccountsCash')}
            actionLabel={onOpenAccounts ? t(locale, 'wealth.manageAccounts') : undefined}
            onAction={onOpenAccounts}
          />
        ) : null}
        {modal === 'recv' ? (
          <DetailBody
            lead={t(locale, 'wealth.recvLead')}
            value={money(recv)}
            rows={[]}
            empty={t(locale, 'wealth.noReceivables')}
          />
        ) : null}
        {modal === 'pay' ? (
          <DetailBody
            lead={t(locale, 'wealth.payLead')}
            value={money(pay)}
            rows={[]}
            empty={t(locale, 'wealth.noPayables')}
          />
        ) : null}
        {modal === 'institutions' || modal === 'accounts' ? (
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                onPress={() => setModal('institutions')}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: radii.full,
                  backgroundColor: modal === 'institutions' ? colors.primarySoft : colors.surfaceMuted,
                  borderWidth: 1,
                  borderColor: modal === 'institutions' ? colors.primary : colors.border,
                }}
              >
                <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 13 }}>
                  {t(locale, 'wealth.institutions')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setModal('accounts')}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: radii.full,
                  backgroundColor: modal === 'accounts' ? colors.primarySoft : colors.surfaceMuted,
                  borderWidth: 1,
                  borderColor: modal === 'accounts' ? colors.primary : colors.border,
                }}
              >
                <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 13 }}>
                  {t(locale, 'wealth.accounts')}
                </Text>
              </Pressable>
            </View>
            {modal === 'institutions' ? (
              <DetailBody
                lead={t(locale, 'wealth.institutionsLead')}
                rows={institutions.map((i) => ({
                  title: i.name,
                  subtitle: `${i.count} account${i.count === 1 ? '' : 's'} · ${[...i.types].join(', ').replace(/_/g, ' ')}`,
                  trailing: hidden ? '••••' : formatMoney(String(i.balance.toFixed(2)), currency, locale ?? undefined),
                }))}
                empty={t(locale, 'wealth.noInstitutions')}
                actionLabel={onOpenAccounts ? t(locale, 'wealth.openAccounts') : undefined}
                onAction={onOpenAccounts}
              />
            ) : (
              <DetailBody
                lead={t(locale, 'wealth.accountsLead')}
                rows={accounts.map((a: MoneyAccount) => ({
                  title: a.name,
                  subtitle: `${a.account_type.replace(/_/g, ' ')}${
                    a.institution_label ? ` · ${a.institution_label}` : ''
                  }${a.bank_profile_id ? ' · ready for loans' : ''}`,
                  trailing: money(a.balance),
                }))}
                empty={t(locale, 'wealth.noAccounts')}
                actionLabel={onOpenAccounts ? t(locale, 'wealth.openAccounts') : undefined}
                onAction={onOpenAccounts}
              />
            )}
          </View>
        ) : null}
      </DetailModal>
    </>
  );
}

function DetailModal({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: radii.xl,
            borderTopRightRadius: radii.xl,
            padding: space.lg,
            maxHeight: '80%',
            gap: space.md,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 20 }}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={8} style={{ padding: 6 }}>
              <IconClose size={18} color={colors.muted} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 12 }}>{children}</ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function DetailBody({
  lead,
  value,
  rows,
  empty,
  actionLabel,
  onAction,
}: {
  lead: string;
  value?: string;
  rows: { title: string; subtitle: string; trailing: string }[];
  empty: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>{lead}</Text>
      {value ? (
        <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 24 }}>{value}</Text>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState title={empty} body="" />
      ) : (
        rows.map((r) => (
          <View
            key={`${r.title}-${r.subtitle}`}
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              gap: 10,
              paddingVertical: 10,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 14 }}>{r.title}</Text>
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>{r.subtitle}</Text>
            </View>
            <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 14 }}>{r.trailing}</Text>
          </View>
        ))
      )}
      {actionLabel && onAction ? <PrimaryButton label={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}
