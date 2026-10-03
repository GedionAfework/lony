import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { api, type InsightsMonthPoint, type MoneyAccount, type WealthSummary } from './api';
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
};

function Sparkline({ points, color }: { points: number[]; color: string; fill?: string }) {
  const h = 56;
  if (points.length < 2) return <View style={{ height: h }} />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(max - min, 1);
  const ys = points.map((p) => h - 6 - ((p - min) / span) * (h - 12));
  return (
    <View style={{ height: h, marginTop: 4, marginBottom: 4, overflow: 'hidden' }}>
      {/* Soft fill under the line */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 0, flexDirection: 'row' }}>
        {ys.map((y, i) => (
          <View key={`f-${i}`} style={{ flex: 1, justifyContent: 'flex-end' }}>
            <View
              style={{
                height: Math.max(4, h - y),
                backgroundColor: color,
                opacity: 0.08 + (i / Math.max(ys.length - 1, 1)) * 0.12,
              }}
            />
          </View>
        ))}
      </View>
      {/* Segmented polyline */}
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
        {ys.slice(0, -1).map((y, i) => {
          const y2 = ys[i + 1] ?? y;
          const midY = (y + y2) / 2;
          const dy = y2 - y;
          const angle = (Math.atan2(dy, 100 / Math.max(points.length - 1, 1)) * 180) / Math.PI;
          return (
            <View
              key={`s-${i}`}
              style={{
                position: 'absolute',
                left: `${(i / Math.max(points.length - 1, 1)) * 100}%`,
                width: `${100 / Math.max(points.length - 1, 1)}%`,
                top: midY - 1.5,
                height: 3,
                backgroundColor: color,
                borderRadius: 2,
                transform: [{ rotate: `${angle * 0.35}deg` }],
                opacity: 0.85 + (i / Math.max(points.length - 2, 1)) * 0.15,
              }}
            />
          );
        })}
        {/* End dot */}
        <View
          style={{
            position: 'absolute',
            right: 0,
            top: (ys[ys.length - 1] ?? h / 2) - 4,
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: color,
          }}
        />
      </View>
    </View>
  );
}

function MiniStat({
  label,
  value,
  onPress,
  tone,
}: {
  label: string;
  value: string;
  onPress: () => void;
  tone?: 'positive' | 'negative';
}) {
  const { colors } = useTheme();
  const fg = tone === 'positive' ? colors.success : tone === 'negative' ? colors.warning : colors.text;
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexGrow: 1,
        minWidth: '30%',
        backgroundColor: colors.surfaceMuted,
        borderRadius: radii.md,
        padding: 12,
        gap: 4,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 11 }}>{label}</Text>
      <Text style={{ color: fg, fontFamily: fonts.uiSemi, fontSize: 14 }} numberOfLines={1}>
        {value}
      </Text>
    </Pressable>
  );
}

export function NetWorthCard({ token, wealth, currency, locale, formatMoney, onOpenAccounts }: Props) {
  const { colors } = useTheme();
  const [hidden, setHidden] = useState(false);
  const [modal, setModal] = useState<ModalKind>(null);
  const [series, setSeries] = useState<InsightsMonthPoint[]>([]);

  const accounts = wealth?.accounts ?? [];
  const slice = wealth?.by_currency?.find((s) => s.currency_code.toUpperCase() === currency.toUpperCase());
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
      cur.balance += Number(a.balance) || 0;
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
          backgroundColor: colors.surface,
          borderRadius: radii.xl,
          padding: space.lg,
          gap: 12,
          borderWidth: 1,
          borderColor: colors.border,
          shadowColor: '#000',
          shadowOpacity: 0.06,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
          elevation: 3,
        }}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text
            style={{
              color: colors.muted,
              fontFamily: fonts.uiSemi,
              fontSize: 12,
              letterSpacing: 1,
              textTransform: 'uppercase',
            }}
          >
            {t(locale, 'wealth.totalBalance')}
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
              backgroundColor: colors.surfaceMuted,
            }}
          >
            <FontAwesome name={hidden ? 'eye-slash' : 'eye'} size={16} color={colors.muted} />
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <Text style={{ color: colors.success, fontFamily: fonts.uiBold, fontSize: 22 }}>
            {(currency || 'USD').toUpperCase()}
          </Text>
          <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 32 }} numberOfLines={1}>
            {hidden ? '••••••' : formatMoneyAmount(net, locale ?? 'en')}
          </Text>
        </View>

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
              backgroundColor: momPct >= 0 ? colors.successSoft : colors.warningSoft,
            }}
          >
            <FontAwesome
              name={momPct >= 0 ? 'arrow-up' : 'arrow-down'}
              size={11}
              color={momPct >= 0 ? colors.success : colors.warning}
            />
            <Text
              style={{
                color: momPct >= 0 ? colors.success : colors.warning,
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
          <Sparkline points={nets} color={colors.success} fill={colors.warning} />
        ) : (
          <View style={{ height: 24 }} />
        )}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <MiniStat label={t(locale, 'wealth.cash')} value={money(cash)} tone="positive" onPress={() => setModal('cash')} />
          <MiniStat label={t(locale, 'wealth.owedToYou')} value={money(recv)} tone="positive" onPress={() => setModal('recv')} />
          <MiniStat label={t(locale, 'wealth.youOwe')} value={money(pay)} tone="negative" onPress={() => setModal('pay')} />
        </View>

        <Pressable
          onPress={() => setModal('institutions')}
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}
        >
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
            {institutions.length} {t(locale, 'wealth.institutions')} · {accounts.length} {t(locale, 'wealth.accounts')}
          </Text>
          <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 13 }}>
            {t(locale, 'wealth.details')}
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
