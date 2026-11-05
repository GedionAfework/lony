import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import {
  api,
  type AIInsight,
  type AIReport,
  type CoachMessage,
  type Dashboard,
  type InsightsCategoryPoint,
  type InsightsGoal,
  type InsightsMonthPoint,
  type InsightsOverview,
  type LonyScore,
  type User,
  isPremiumPlan,
} from './api';
import { RichText } from './RichText';
import { t } from './i18n';
import { TrustGradeModal } from './TrustGradeModal';
import { fonts, radii, space, useTheme } from './theme';
import { Card, EmptyState, HeroCard, PrimaryButton, SecondaryButton, Segmented } from './ui';

type Tab = 'overview' | 'cashflow' | 'debts' | 'goals' | 'analysis' | 'reports' | 'coach';

type CoachAction = { label: string; deep_link: string };

type Props = {
  user: User;
  token: string;
  dashboard: Dashboard | null;
  formatMoney: (amount: string | null | undefined, currency: string | null | undefined, locale?: string) => string;
  onError?: (message: string) => void;
  onOpenDeepLink?: (deepLink: string) => void;
  onOpenSeasonRecap?: (season: 'month' | 'year') => void;
};

function convert(amount: number, from: string, to: string, rates: Record<string, number>): number {
  if (from === to) return amount;
  const rf = rates[from];
  const rt = rates[to];
  if (!rf || !rt) return NaN;
  return (amount / rf) * rt;
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ color, fontFamily: fonts.ui, fontSize: 11 }}>{label}</Text>
    </View>
  );
}

function compactNumber(n: number, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale || 'en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  } catch {
    return n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(Math.round(n));
  }
}

function shortMonth(ym: string, locale?: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  try {
    return new Date(y, m - 1, 1).toLocaleDateString(locale || 'en', { month: 'short' });
  } catch {
    return ym.slice(5);
  }
}

/**
 * Grouped bar chart: money in and money out side by side for each month, with
 * light grid lines. Tap a month to see its numbers underneath.
 */
function MonthChart({
  series,
  formatMoney,
  currency,
  locale,
}: {
  series: InsightsMonthPoint[];
  formatMoney: Props['formatMoney'];
  currency: string;
  locale?: string;
}) {
  const { colors } = useTheme();
  const [picked, setPicked] = useState<number>(Math.max(0, series.length - 1));
  const height = 170;
  const max = Math.max(1, ...series.map((s) => Math.max(Number(s.income) || 0, Number(s.expense) || 0)));
  // Round the top of the scale to a friendly number.
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / pow) * pow;
  const grid = [1, 0.5, 0];
  const sel = series[Math.min(picked, series.length - 1)];
  const selIn = Number(sel?.income) || 0;
  const selOut = Number(sel?.expense) || 0;
  const selNet = Number(sel?.net) || selIn - selOut;

  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', gap: 16 }}>
        <LegendDot color={colors.success} label={t(locale, 'insights.moneyIn')} />
        <LegendDot color={colors.secondary} label={t(locale, 'insights.moneyOut')} />
      </View>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ height, justifyContent: 'space-between', paddingBottom: 0 }}>
          {grid.map((g) => (
            <Text key={g} style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 10, lineHeight: 12, marginTop: g === 1 ? -6 : 0, marginBottom: g === 0 ? -6 : 0 }}>
              {compactNumber(top * g, locale)}
            </Text>
          ))}
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ height, justifyContent: 'space-between', position: 'absolute', left: 0, right: 0, top: 0 }}>
            {grid.map((g) => (
              <View key={g} style={{ height: 1, backgroundColor: colors.border, opacity: g === 0 ? 1 : 0.6 }} />
            ))}
          </View>
          <View style={{ height, flexDirection: 'row', alignItems: 'flex-end' }}>
            {series.map((row, i) => {
              const inc = Number(row.income) || 0;
              const out = Number(row.expense) || 0;
              const active = i === picked;
              return (
                <Pressable
                  key={row.month}
                  onPress={() => setPicked(i)}
                  accessibilityRole="button"
                  accessibilityLabel={`${shortMonth(row.month, locale)}: in ${formatMoney(row.income, currency, locale)}, out ${formatMoney(row.expense, currency, locale)}`}
                  style={{
                    flex: 1,
                    height,
                    flexDirection: 'row',
                    alignItems: 'flex-end',
                    justifyContent: 'center',
                    gap: 3,
                    borderRadius: 10,
                    backgroundColor: active ? colors.primary + '12' : 'transparent',
                  }}
                >
                  <View style={{ width: 10, height: Math.max(inc > 0 ? 4 : 0, (inc / top) * (height - 6)), borderRadius: 5, backgroundColor: colors.success, opacity: active ? 1 : 0.75 }} />
                  <View style={{ width: 10, height: Math.max(out > 0 ? 4 : 0, (out / top) * (height - 6)), borderRadius: 5, backgroundColor: colors.secondary, opacity: active ? 1 : 0.75 }} />
                </Pressable>
              );
            })}
          </View>
          <View style={{ flexDirection: 'row', marginTop: 6 }}>
            {series.map((row, i) => (
              <Text
                key={row.month}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  color: i === picked ? colors.text : colors.muted,
                  fontFamily: i === picked ? fonts.uiBold : fonts.ui,
                  fontSize: 11.5,
                }}
              >
                {shortMonth(row.month, locale)}
              </Text>
            ))}
          </View>
        </View>
      </View>

      {sel ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[
            { label: t(locale, 'insights.moneyIn'), value: formatMoney(String(selIn), currency, locale), color: colors.success },
            { label: t(locale, 'insights.moneyOut'), value: formatMoney(String(selOut), currency, locale), color: colors.secondary },
            { label: t(locale, 'insights.leftOverShort'), value: formatMoney(String(selNet), currency, locale), color: selNet >= 0 ? colors.primary : colors.error },
          ].map((k) => (
            <View key={k.label} style={{ flex: 1, padding: 10, borderRadius: 14, backgroundColor: colors.surfaceMuted, gap: 3 }}>
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 11 }} numberOfLines={1}>
                {k.label}
              </Text>
              <Text style={{ color: k.color, fontFamily: fonts.uiBold, fontSize: 13.5 }} numberOfLines={1} adjustsFontSizeToFit>
                {k.value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Three quick numbers under the summary card. */
function KpiStrip({ items }: { items: { label: string; value: string; icon: FAName; color: string }[] }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {items.map((k) => (
        <View key={k.label} style={{ flex: 1, padding: 12, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 8 }}>
          <View style={{ width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: k.color + '1F' }}>
            <FontAwesome name={k.icon} size={13} color={k.color} />
          </View>
          <View style={{ gap: 2 }}>
            <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 11 }} numberOfLines={1}>
              {k.label}
            </Text>
            <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 14 }} numberOfLines={1} adjustsFontSizeToFit>
              {k.value}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function MonthBars({
  series,
  formatMoney,
  currency,
  locale,
  showNet = false,
}: {
  series: InsightsMonthPoint[];
  formatMoney: Props['formatMoney'];
  currency: string;
  locale?: string;
  showNet?: boolean;
}) {
  const { colors } = useTheme();
  const max = Math.max(
    1,
    ...series.map((s) => Math.max(Number(s.income) || 0, Number(s.expense) || 0)),
  );

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', gap: 14, flexWrap: 'wrap', marginBottom: 2 }}>
        <LegendDot color={colors.success} label={t(locale, 'insights.moneyIn')} />
        <LegendDot color={colors.warning} label={t(locale, 'insights.moneyOut')} />
        {showNet ? <LegendDot color={colors.primary} label={t(locale, 'insights.leftOverShort')} /> : null}
      </View>
      {series.map((row) => {
        const income = Number(row.income) || 0;
        const expense = Number(row.expense) || 0;
        const net = Number(row.net) || income - expense;
        const iPct = Math.max(income > 0 ? 4 : 0, Math.round((income / max) * 100));
        const ePct = Math.max(expense > 0 ? 4 : 0, Math.round((expense / max) * 100));
        const label = row.month.slice(5);
        return (
          <View
            key={row.month}
            style={{
              gap: 8,
              padding: 12,
              borderRadius: radii.lg,
              backgroundColor: colors.surfaceMuted,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 14 }}>{label}</Text>
              {showNet ? (
                <Text
                  style={{
                    color: net >= 0 ? colors.success : colors.warning,
                    fontFamily: fonts.uiBold,
                    fontSize: 13,
                  }}
                >
                  Net {formatMoney(String(net), currency, locale)}
                </Text>
              ) : null}
            </View>
            <View style={{ gap: 6 }}>
              <View style={{ gap: 3 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.success, fontFamily: fonts.ui, fontSize: 11 }}>{t(locale, 'cashflow.income')}</Text>
                  <Text style={{ color: colors.success, fontFamily: fonts.uiSemi, fontSize: 11 }}>
                    {formatMoney(row.income, currency, locale)}
                  </Text>
                </View>
                <View style={{ height: 10, borderRadius: radii.full, backgroundColor: colors.surface }}>
                  <View
                    style={{
                      height: 10,
                      width: `${iPct}%`,
                      borderRadius: radii.full,
                      backgroundColor: colors.success,
                    }}
                  />
                </View>
              </View>
              <View style={{ gap: 3 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.warning, fontFamily: fonts.ui, fontSize: 11 }}>{t(locale, 'cashflow.expense')}</Text>
                  <Text style={{ color: colors.warning, fontFamily: fonts.uiSemi, fontSize: 11 }}>
                    {formatMoney(row.expense, currency, locale)}
                  </Text>
                </View>
                <View style={{ height: 10, borderRadius: radii.full, backgroundColor: colors.surface }}>
                  <View
                    style={{
                      height: 10,
                      width: `${ePct}%`,
                      borderRadius: radii.full,
                      backgroundColor: colors.warning,
                    }}
                  />
                </View>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function NetSparkline({ series }: { series: InsightsMonthPoint[] }) {
  const { colors } = useTheme();
  if (series.length === 0) return null;
  const nets = series.map((s) => Number(s.net) || Number(s.income) - Number(s.expense) || 0);
  const maxAbs = Math.max(1, ...nets.map((n) => Math.abs(n)));
  const last = nets[nets.length - 1] ?? 0;
  return (
    <View
      style={{
        gap: 8,
        padding: 12,
        borderRadius: radii.lg,
        backgroundColor: colors.surfaceMuted,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: colors.muted, fontFamily: fonts.uiSemi, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6 }}>
          Net trend
        </Text>
        <Text
          style={{
            color: last >= 0 ? colors.success : colors.warning,
            fontFamily: fonts.uiBold,
            fontSize: 12,
          }}
        >
          {last >= 0 ? '▲' : '▼'} latest
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 5, height: 56 }}>
        {nets.map((n, i) => {
          const h = Math.max(6, Math.round((Math.abs(n) / maxAbs) * 50));
          return (
            <View
              key={series[i]?.month ?? i}
              style={{
                flex: 1,
                height: h,
                borderTopLeftRadius: 6,
                borderTopRightRadius: 6,
                backgroundColor: n >= 0 ? colors.success : colors.warning,
                opacity: i === nets.length - 1 ? 1 : 0.72,
              }}
            />
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 10 }}>
          {series[0]?.month?.slice(5) ?? ''}
        </Text>
        <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 10 }}>
          {series[series.length - 1]?.month?.slice(5) ?? ''}
        </Text>
      </View>
    </View>
  );
}

function ReportTableView({
  table,
}: {
  table: { id: string; title: string; columns: string[]; rows: string[][] };
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 14 }}>{table.title}</Text>
      <View
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radii.md,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            backgroundColor: colors.surfaceMuted,
            paddingHorizontal: 8,
            paddingVertical: 6,
            gap: 6,
          }}
        >
          {table.columns.map((col) => (
            <Text
              key={col}
              style={{ flex: 1, color: colors.muted, fontFamily: fonts.uiSemi, fontSize: 10, textTransform: 'uppercase' }}
              numberOfLines={1}
            >
              {col.replace(/_/g, ' ')}
            </Text>
          ))}
        </View>
        {table.rows.slice(0, 8).map((row, idx) => (
          <View
            key={`${table.id}-${idx}`}
            style={{
              flexDirection: 'row',
              paddingHorizontal: 8,
              paddingVertical: 7,
              gap: 6,
              borderTopWidth: 1,
              borderTopColor: colors.border,
            }}
          >
            {row.map((cell, ci) => (
              <Text
                key={`${table.id}-${idx}-${ci}`}
                style={{ flex: 1, color: colors.text, fontFamily: fonts.ui, fontSize: 12 }}
                numberOfLines={1}
              >
                {cell}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

const HUES = ['#159E9E', '#E07B12', '#2F7DD3', '#8B5CF6', '#E0457B', '#0E8A6A', '#C9A227', '#5B6B82'];

function hueFor(name: string): string {
  let h = 0;
  const s = name.toLowerCase();
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return HUES[Math.abs(h) % HUES.length];
}

type FAName = React.ComponentProps<typeof FontAwesome>['name'];

function categoryIcon(category: string): FAName {
  const c = category.toLowerCase();
  if (/food|grocer|restaurant|lunch|dinner|cafe|coffee|meal/.test(c)) return 'cutlery';
  if (/transport|taxi|ride|fuel|car|bus/.test(c)) return 'car';
  if (/hous|rent|home/.test(c)) return 'home';
  if (/util|electric|water|power|internet/.test(c)) return 'bolt';
  if (/phone|mobile|airtime|telecom/.test(c)) return 'mobile';
  if (/salary|work|business|freelance/.test(c)) return 'briefcase';
  if (/subscri|netflix|tv|music/.test(c)) return 'television';
  if (/shop|cloth/.test(c)) return 'shopping-bag';
  if (/health|medic|pharm|doctor/.test(c)) return 'heartbeat';
  if (/school|educat|tuition|book/.test(c)) return 'graduation-cap';
  if (/travel|trip|flight|hotel/.test(c)) return 'plane';
  if (/gift|church|charity/.test(c)) return 'gift';
  return 'tag';
}

/** Card heading: a title and one short line saying what the card shows. */
function SectionHead({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 16 }}>{title}</Text>
        {/* Headings only: no description lines under them. */}
        {sub && false ? <Text>{sub}</Text> : null}
      </View>
      {right}
    </View>
  );
}

/** Thin rounded bar used for categories, factors, people and plans. */
function Bar({ pct, color }: { pct: number; color: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ height: 7, borderRadius: radii.full, backgroundColor: colors.surfaceMuted, overflow: 'hidden' }}>
      <View style={{ height: '100%', width: `${Math.max(3, Math.min(100, pct))}%`, borderRadius: radii.full, backgroundColor: color }} />
    </View>
  );
}

function CategoryBars({
  rows,
  formatMoney,
  locale,
}: {
  rows: InsightsCategoryPoint[];
  formatMoney: Props['formatMoney'];
  locale?: string;
}) {
  const { colors } = useTheme();
  if (rows.length === 0) {
    return <EmptyState title={t(locale, 'expenses.noExpenses')} body={t(locale, 'expenses.categoryBarsBody')} />;
  }
  const top = rows.slice(0, 7);
  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', height: 10, borderRadius: radii.full, overflow: 'hidden', gap: 3 }}>
        {top.map((r) => (
          <View key={r.category} style={{ flex: Math.max(0.02, Number(r.amount) || 0), backgroundColor: hueFor(r.category), borderRadius: radii.full }} />
        ))}
      </View>
      {top.map((row) => {
        const color = hueFor(row.category);
        return (
          <View key={row.category} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: color + '22' }}>
              <FontAwesome name={categoryIcon(row.category)} size={14} color={color} />
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 13.5, flex: 1 }} numberOfLines={1}>
                  {row.category}
                </Text>
                <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 13 }}>{formatMoney(row.amount, row.currency_code, locale)}</Text>
              </View>
              <Bar pct={row.share_percent} color={color} />
            </View>
            <Text style={{ width: 34, textAlign: 'right', color: colors.muted, fontFamily: fonts.uiSemi, fontSize: 12 }}>{row.share_percent.toFixed(0)}%</Text>
          </View>
        );
      })}
    </View>
  );
}

/** Round grade badge with a coloured ring. */
function GradeBadge({ grade, points }: { grade: string; points: number }) {
  const { colors } = useTheme();
  const color = points >= 70 ? colors.success : points >= 45 ? colors.primary : colors.secondary;
  return (
    <View
      style={{
        width: 84,
        height: 84,
        borderRadius: 42,
        borderWidth: 7,
        borderColor: color,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: color + '14',
      }}
    >
      <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 28, lineHeight: 32 }}>{grade}</Text>
      <Text style={{ color: colors.muted, fontFamily: fonts.uiSemi, fontSize: 10 }}>{Math.round(points)}/100</Text>
    </View>
  );
}

/** One plain sentence about the month, with a small icon for its mood. */
function Takeaway({ tone, text }: { tone: 'good' | 'bad' | 'info'; text: string }) {
  const { colors } = useTheme();
  const fg = tone === 'good' ? colors.success : tone === 'bad' ? colors.secondary : colors.primary;
  const bg = tone === 'good' ? colors.successSoft : tone === 'bad' ? colors.secondarySoft : colors.primarySoft;
  const icon: FAName = tone === 'good' ? 'line-chart' : tone === 'bad' ? 'exclamation' : 'lightbulb-o';
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 12,
        alignItems: 'center',
        padding: 14,
        borderRadius: 16,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <View style={{ width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: bg }}>
        <FontAwesome name={icon} size={15} color={fg} />
      </View>
      <Text style={{ flex: 1, color: colors.textSecondary, fontFamily: fonts.ui, fontSize: 13.5, lineHeight: 19 }}>{text}</Text>
    </View>
  );
}

/** Same tab track as Home, Accounts and Loans. With more tabs than fit, the track scrolls. */
function TabBar({ tabs, value, onChange }: { tabs: { id: Tab; label: string }[]; value: Tab; onChange: (t: Tab) => void }) {
  const { colors } = useTheme();
  if (tabs.length <= 4) {
    return <Segmented options={tabs} value={value} onChange={(id) => onChange(id as Tab)} />;
  }
  return (
    <View style={{ padding: 4, borderRadius: radii.full, backgroundColor: colors.surfaceMuted }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }}>
        {tabs.map((tb) => {
          const active = tb.id === value;
          return (
            <Pressable
              key={tb.id}
              onPress={() => onChange(tb.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={{
                minHeight: 38,
                paddingHorizontal: 16,
                borderRadius: radii.full,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: active ? colors.surface : 'transparent',
                shadowColor: '#0F172A',
                shadowOpacity: active ? 0.08 : 0,
                shadowRadius: 6,
                shadowOffset: { width: 0, height: 2 },
                elevation: active ? 2 : 0,
              }}
            >
              <Text style={{ color: active ? colors.text : colors.muted, fontFamily: active ? fonts.uiSemi : fonts.ui, fontSize: 13 }} numberOfLines={1}>
                {tb.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function AnalyticsScreen({
  user,
  token,
  dashboard,
  formatMoney,
  onError,
  onOpenDeepLink,
  onOpenSeasonRecap,
}: Props) {
  const { colors } = useTheme();
  const preferred = (user.default_currency_code || '').toUpperCase();
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<InsightsOverview | null>(null);
  const [series, setSeries] = useState<InsightsMonthPoint[]>([]);
  const [categories, setCategories] = useState<InsightsCategoryPoint[]>([]);
  const [goals, setGoals] = useState<InsightsGoal[]>([]);
  const [lonyScore, setLonyScore] = useState<LonyScore | null>(null);
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [coachMsg, setCoachMsg] = useState('');
  const [coachMessages, setCoachMessages] = useState<CoachMessage[]>([]);
  const [coachActions, setCoachActions] = useState<CoachAction[]>([]);
  const [coachBusy, setCoachBusy] = useState(false);
  const [report, setReport] = useState<AIReport | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [rates, setRates] = useState<Record<string, number>>(() =>
    preferred ? { [preferred]: 1 } : {},
  );
  const [gradeModalOpen, setGradeModalOpen] = useState(false);

  const isPremium = isPremiumPlan(user);

  const reload = useCallback(async () => {
    if (!preferred || !token) return;
    try {
      const [ov, ser, cats, gs, sc] = await Promise.all([
        api.insightsOverview(token, preferred),
        api.insightsCashflowSeries(token, preferred, 6),
        api.insightsCategories(token, preferred, 1),
        api.insightsGoals(token),
        api.getScore(token, preferred).catch(() => null),
      ]);
      setOverview(ov.overview);
      setSeries(ser.series ?? []);
      setCategories(cats.categories ?? []);
      setGoals(gs.goals ?? []);
      setLonyScore(sc?.score ?? null);
      if (isPremium) {
        const ai = await api.listAIInsights(token).catch(() => null);
        if (ai) {
          setInsights(ai.insights ?? []);
        }
        const thread = await api.getCoachThread(token).catch(() => null);
        if (thread?.thread?.messages) {
          setCoachMessages(thread.thread.messages);
        }
      } else {
        setInsights([]);
        setCoachMessages([]);
      }
    } catch (e) {
      onError?.(e instanceof Error ? e.message : 'Could not load insights');
    }
  }, [preferred, token, onError, isPremium]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!preferred) return;
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

  const loanSummary = useMemo(() => {
    let recv = 0;
    let pay = 0;
    for (const slice of dashboard?.by_currency ?? []) {
      const code = (slice.currency_code || preferred).toUpperCase();
      const r = convert(Number(slice.receivables || 0), code, preferred, rates);
      const p = convert(Number(slice.payables || 0), code, preferred, rates);
      if (Number.isFinite(r)) recv += r;
      if (Number.isFinite(p)) pay += p;
    }
    return { recv, pay, net: recv - pay };
  }, [dashboard, preferred, rates]);

  const friends = useMemo(() => {
    const map = new Map<string, { name: string; net: number }>();
    for (const slice of dashboard?.by_currency ?? []) {
      const code = (slice.currency_code || preferred).toUpperCase();
      for (const fb of slice.friends ?? []) {
        const id = fb.peer.id;
        const prev = map.get(id) ?? { name: fb.peer.display_name, net: 0 };
        const n = convert(Number(fb.net || 0), code, preferred, rates);
        if (Number.isFinite(n)) prev.net += n;
        map.set(id, prev);
      }
    }
    return [...map.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net)).slice(0, 6);
  }, [dashboard, preferred, rates]);

  const friendMax = Math.max(...friends.map((f) => Math.abs(f.net)), 1);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: t(user.locale, 'insights.tabOverview') },
    // Chat sits next to Overview so it stays on screen. A wrapping row inside the page
    // scroll used to push Coach off the right edge.
    ...(isPremium ? ([{ id: 'coach', label: t(user.locale, 'insights.tabCoach') }] as { id: Tab; label: string }[]) : []),
    { id: 'cashflow', label: t(user.locale, 'insights.tabCashflow') },
    { id: 'debts', label: t(user.locale, 'insights.tabDebts') },
    { id: 'goals', label: t(user.locale, 'insights.tabGoals') },
    ...(isPremium
      ? ([
          { id: 'analysis', label: t(user.locale, 'insights.tabAnalysis') },
          { id: 'reports', label: t(user.locale, 'insights.tabReports') },
        ] as { id: Tab; label: string }[])
      : []),
  ];

  useEffect(() => {
    if (!isPremium && (tab === 'analysis' || tab === 'reports' || tab === 'coach')) {
      setTab('overview');
    }
  }, [isPremium, tab]);

  async function onLoadReport() {
    if (!preferred) return;
    setReportBusy(true);
    try {
      const res = await api.aiReport(token, preferred, 6);
      setReport(res.report);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : 'Could not build report');
    } finally {
      setReportBusy(false);
    }
  }

  function explainChart(chartId: string, title: string, caption: string) {
    const months = report?.period_months ?? 6;
    const prompt = `Explain the "${title}" chart (${chartId}) for the last ${months} months. Caption: ${caption}. What should I do next?`;
    setCoachMsg(prompt);
    setTab('coach');
  }

  async function onRefreshInsights() {
    if (!preferred) return;
    try {
      const [ai, sc] = await Promise.all([
        api.refreshAIInsights(token, preferred),
        api.getScore(token, preferred, true),
      ]);
      setInsights(ai.insights ?? []);
      setLonyScore(sc.score);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : 'Could not refresh analysis');
    }
  }

  async function onAskCoach(asked?: string) {
    const question = (asked ?? coachMsg).trim();
    if (!question || !preferred || coachBusy) return;
    setCoachBusy(true);
    setCoachMsg('');
    setCoachActions([]);
    const userBubble: CoachMessage = {
      id: `local-u-${Date.now()}`,
      role: 'user',
      content: question,
      created_at: new Date().toISOString(),
    };
    const assistantId = `local-a-${Date.now()}`;
    setCoachMessages((prev) => [
      ...prev,
      userBubble,
      { id: assistantId, role: 'assistant', content: '', created_at: new Date().toISOString() },
    ]);
    try {
      await api.aiCoachStream(token, preferred, question, {
        onToken: (text) => {
          setCoachMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + text } : m)),
          );
        },
        onReplace: (text) => {
          setCoachMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: text } : m)),
          );
        },
        onDone: (coach) => {
          setCoachActions(coach.actions ?? []);
          setCoachMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: coach.reply } : m)),
          );
        },
        onError: (message) => {
          onError?.(message);
        },
      });
      const thread = await api.getCoachThread(token).catch(() => null);
      if (thread?.thread?.messages?.length) {
        setCoachMessages(thread.thread.messages);
      }
    } catch (e) {
      onError?.(e instanceof Error ? e.message : 'Coach unavailable');
      setCoachMessages((prev) => prev.filter((m) => m.id !== assistantId && m.id !== userBubble.id));
    } finally {
      setCoachBusy(false);
    }
  }

  const L = user.locale;
  const monthLabel = new Date().toLocaleDateString(L || 'en', { month: 'long' });
  const incomeNum = Number(overview?.income || 0);
  const spentNum = Number(overview?.expense || 0);
  const netNum = Number(overview?.net || 0);
  const savingsRate = overview?.savings_rate_percent;
  const spentMonths = series.map((m) => Number(m.expense) || 0).filter((v) => v > 0);
  const avgSpend = spentMonths.length ? spentMonths.reduce((a, b) => a + b, 0) / spentMonths.length : 0;

  const changeNote = (v: number | null | undefined) => {
    if (v == null || !Number.isFinite(v) || Math.round(v) === 0) return undefined;
    return t(L, v > 0 ? 'insights.upVsLast' : 'insights.downVsLast').replace('{percent}', String(Math.abs(Math.round(v))));
  };

  const takeaways = useMemo(() => {
    const out: { tone: 'good' | 'bad' | 'info'; text: string }[] = [];
    if (incomeNum > 0) {
      const share = Math.round((spentNum / incomeNum) * 100);
      if (share <= 80) out.push({ tone: 'good', text: t(L, 'insights.tkKept').replace('{percent}', String(share)) });
      else if (share <= 100) out.push({ tone: 'info', text: t(L, 'insights.tkTight').replace('{percent}', String(share)) });
      else out.push({ tone: 'bad', text: t(L, 'insights.tkOver').replace('{percent}', String(share - 100)) });
    } else if (spentNum > 0) {
      out.push({ tone: 'info', text: t(L, 'insights.tkNoIncome').replace('{amount}', formatMoney(spentNum.toFixed(2), preferred, L)) });
    }
    const top = categories[0];
    if (top && top.share_percent >= 1) {
      out.push({ tone: 'info', text: t(L, 'insights.tkTopCat').replace('{category}', top.category).replace('{percent}', top.share_percent.toFixed(0)) });
    }
    const mom = overview?.expense_mom_percent;
    if (mom != null && Number.isFinite(mom) && Math.abs(mom) >= 10) {
      out.push(
        mom > 0
          ? { tone: 'bad', text: t(L, 'insights.tkSpendUp').replace('{percent}', String(Math.round(mom))) }
          : { tone: 'good', text: t(L, 'insights.tkSpendDown').replace('{percent}', String(Math.round(-mom))) },
      );
    }
    if (loanSummary.recv > 0) {
      out.push({ tone: 'info', text: t(L, 'insights.tkOwed').replace('{amount}', formatMoney(loanSummary.recv.toFixed(2), preferred, L)) });
    }
    if ((overview?.active_goals ?? 0) > 0 && overview?.goals_progress_avg != null) {
      out.push({ tone: 'good', text: t(L, 'insights.tkGoals').replace('{percent}', String(Math.round(overview.goals_progress_avg))) });
    }
    return out.slice(0, 4);
  }, [incomeNum, spentNum, categories, overview, loanSummary.recv, preferred, L, formatMoney]);

  const factors: { key: keyof LonyScore; label: string; help: string }[] = [
    { key: 'repayment_score', label: t(L, 'insights.factorRepayment'), help: t(L, 'insights.factorRepaymentHelp') },
    { key: 'debt_score', label: t(L, 'insights.factorDebt'), help: t(L, 'insights.factorDebtHelp') },
    { key: 'consistency_score', label: t(L, 'insights.factorConsistency'), help: t(L, 'insights.factorConsistencyHelp') },
    { key: 'liquidity_score', label: t(L, 'insights.factorCushion'), help: t(L, 'insights.factorCushionHelp') },
    { key: 'savings_score', label: t(L, 'insights.factorSavings'), help: t(L, 'insights.factorSavingsHelp') },
    { key: 'goals_score', label: t(L, 'insights.factorGoals'), help: t(L, 'insights.factorGoalsHelp') },
  ];

  const severity = (s: string) =>
    s === 'critical'
      ? { icon: 'exclamation-triangle' as FAName, fg: colors.error, bg: colors.errorSoft, label: t(L, 'insights.sevCritical') }
      : s === 'warning'
        ? { icon: 'exclamation-circle' as FAName, fg: colors.secondary, bg: colors.secondarySoft, label: t(L, 'insights.sevWarning') }
        : s === 'positive'
          ? { icon: 'line-chart' as FAName, fg: colors.success, bg: colors.successSoft, label: t(L, 'insights.sevPositive') }
          : { icon: 'lightbulb-o' as FAName, fg: colors.primary, bg: colors.primarySoft, label: t(L, 'insights.sevInfo') };

  return (
    <View style={{ gap: space.md }}>
      <View style={{ gap: 2 }}>
        <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 26, letterSpacing: -0.5 }}>{t(L, 'insights.title')}</Text>
      </View>
      {!isPremium ? (
        <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radii.full, backgroundColor: colors.secondarySoft }}>
          <FontAwesome name="star" size={11} color={colors.secondary} />
          <Text style={{ color: colors.secondary, fontFamily: fonts.uiSemi, fontSize: 12 }}>{t(L, 'insights.premiumHint')}</Text>
        </View>
      ) : null}

      {!preferred ? (
        <Card>
          <EmptyState title={t(L, 'insights.pickCurrencyTitle')} body={t(L, 'insights.pickCurrencyBody')} />
        </Card>
      ) : (
        <>
          <TabBar tabs={tabs} value={tab} onChange={setTab} />

          {tab === 'overview' ? (
            <>
              <HeroCard
                label={t(L, 'insights.leftOver').replace('{month}', monthLabel)}
                value={`${netNum < 0 ? '−' : ''}${formatMoney(Math.abs(netNum).toFixed(2), preferred, L)}`}
                sub={
                  incomeNum === 0 && spentNum === 0
                    ? t(L, 'insights.addToSee')
                    : netNum >= 0
                      ? t(L, 'insights.keptShare').replace('{percent}', savingsRate != null ? `${Math.round(savingsRate)}%` : '—').replace('{month}', monthLabel)
                      : t(L, 'insights.spentMore').replace('{month}', monthLabel)
                }
                tiles={[
                  { label: t(L, 'insights.moneyIn'), value: formatMoney(overview?.income ?? '0', preferred, L), note: changeNote(overview?.income_mom_percent) },
                  { label: t(L, 'insights.moneyOut'), value: formatMoney(overview?.expense ?? '0', preferred, L), note: changeNote(overview?.expense_mom_percent) },
                ]}
              />

              <KpiStrip
                items={[
                  { label: t(L, 'insights.kpiSaved'), value: savingsRate != null ? `${Math.round(savingsRate)}%` : '—', icon: 'leaf', color: colors.success },
                  { label: t(L, 'insights.kpiAvgSpend'), value: avgSpend > 0 ? formatMoney(avgSpend.toFixed(0), preferred, L) : '—', icon: 'line-chart', color: colors.secondary },
                  { label: t(L, 'insights.kpiTop'), value: categories[0]?.category || '—', icon: 'tag', color: colors.primary },
                ]}
              />

              {takeaways.length ? (
                <View style={{ gap: 8 }}>
                  {takeaways.map((tk) => (
                    <Takeaway key={tk.text} tone={tk.tone} text={tk.text} />
                  ))}
                </View>
              ) : null}

              <Card>
                <SectionHead title={t(L, 'insights.last6Months')} sub={t(L, 'insights.last6Sub')} />
                {series.every((s) => Number(s.income) === 0 && Number(s.expense) === 0) ? (
                  <EmptyState title={t(L, 'insights.noCashflowTitle')} body={t(L, 'insights.noCashflowBody')} />
                ) : (
                  <MonthChart series={series} formatMoney={formatMoney} currency={preferred} locale={L} />
                )}
              </Card>

              <Card>
                <SectionHead title={t(L, 'insights.whereMoneyWent').replace('{month}', monthLabel)} sub={t(L, 'insights.whereMoneyWentSub')} />
                <CategoryBars rows={categories} formatMoney={formatMoney} locale={L} />
              </Card>

              {lonyScore ? (
                <Pressable onPress={() => setGradeModalOpen(true)}>
                  <Card>
                    <SectionHead title={t(L, 'trust.title') || 'Lony Trust'} sub={t(L, 'insights.trustSub')} />
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 4 }}>
                      <GradeBadge grade={lonyScore.grade} points={Number(lonyScore.points) || 0} />
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 20 }}>{lonyScore.band}</Text>
                        <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 17 }}>
                          {lonyScore.thin_history ? t(L, 'insights.trustThin') : t(L, 'insights.trustBuilt')}
                        </Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 14, columnGap: 14, marginTop: 8 }}>
                      {factors.map((f) => {
                        const v = Math.round(Number(lonyScore[f.key]) || 0);
                        return (
                          <View key={f.key} style={{ width: '46%', flexGrow: 1, gap: 5 }}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                              <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 13 }}>{f.label}</Text>
                              <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 13 }}>{v}</Text>
                            </View>
                            <Bar pct={v} color={v >= 70 ? colors.success : v >= 40 ? colors.primary : colors.secondary} />
                            <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 11 }} numberOfLines={1}>
                              {f.help}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                    {(lonyScore.tips ?? []).slice(0, 2).map((tip) => (
                      <Text key={tip} style={{ color: colors.textSecondary, fontFamily: fonts.ui, fontSize: 12.5, marginTop: 6 }}>
                        • {tip}
                      </Text>
                    ))}
                  </Card>
                </Pressable>
              ) : null}

              {onOpenSeasonRecap ? (
                <Card>
                  <SectionHead title={t(L, 'insights.seasonRecapTitle')} sub={t(L, 'insights.seasonRecapBody')} />
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                    <View style={{ flex: 1 }}>
                      <PrimaryButton label={t(L, 'common.thisMonth')} onPress={() => onOpenSeasonRecap('month')} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <SecondaryButton label={t(L, 'common.thisYear')} onPress={() => onOpenSeasonRecap('year')} />
                    </View>
                  </View>
                </Card>
              ) : null}
            </>
          ) : null}

          {tab === 'cashflow' ? (
            <>
              <Card>
                <SectionHead title={t(L, 'insights.incomeVsExpense')} sub={t(L, 'insights.incomeVsExpenseSub')} />
                <MonthChart series={series} formatMoney={formatMoney} currency={preferred} locale={L} />
              </Card>
              <Card>
                <SectionHead title={t(L, 'insights.categories')} sub={t(L, 'insights.whereMoneyWentSub')} />
                <CategoryBars rows={categories} formatMoney={formatMoney} locale={L} />
              </Card>
            </>
          ) : null}

          {tab === 'debts' ? (
            <>
              <HeroCard
                label={t(L, 'insights.loanBalance')}
                value={`${loanSummary.net < 0 ? '−' : ''}${formatMoney(Math.abs(loanSummary.net).toFixed(2), preferred, L)}`}
                sub={
                  loanSummary.recv === 0 && loanSummary.pay === 0
                    ? t(L, 'insights.noOpenLoans')
                    : loanSummary.net >= 0
                      ? t(L, 'insights.loanTheyOweMore')
                      : t(L, 'insights.loanYouOweMore')
                }
                tiles={[
                  { label: t(L, 'wealth.owedToYou'), value: formatMoney(loanSummary.recv.toFixed(2), preferred, L) },
                  { label: t(L, 'wealth.youOwe'), value: formatMoney(loanSummary.pay.toFixed(2), preferred, L) },
                ]}
              />
              <Card>
                <SectionHead title={t(L, 'insights.people')} sub={t(L, 'insights.peopleSub')} />
                {friends.length === 0 ? (
                  <EmptyState title={t(L, 'insights.noPeopleTitle')} body={t(L, 'insights.noPeopleBody')} />
                ) : (
                  friends.map((f) => {
                    const color = hueFor(f.name);
                    const initials = f.name
                      .trim()
                      .split(/\s+/)
                      .map((p) => p[0])
                      .slice(0, 2)
                      .join('')
                      .toUpperCase();
                    const theyOwe = f.net >= 0;
                    return (
                      <View key={f.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 }}>
                        <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: color + '22' }}>
                          <Text style={{ color, fontFamily: fonts.uiBold, fontSize: 14 }}>{initials}</Text>
                        </View>
                        <View style={{ flex: 1, gap: 6 }}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                            <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 14, flex: 1 }} numberOfLines={1}>
                              {f.name}
                            </Text>
                            <Text style={{ color: theyOwe ? colors.success : colors.secondary, fontFamily: fonts.uiSemi, fontSize: 13 }}>
                              {formatMoney(Math.abs(f.net).toFixed(2), preferred, L)}
                            </Text>
                          </View>
                          <Bar pct={Math.round((Math.abs(f.net) / friendMax) * 100)} color={theyOwe ? colors.success : colors.secondary} />
                          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 11.5 }}>
                            {theyOwe ? t(L, 'insights.owesYou') : t(L, 'wealth.youOwe')}
                          </Text>
                        </View>
                      </View>
                    );
                  })
                )}
              </Card>
            </>
          ) : null}

          {tab === 'goals' ? (
            <Card>
              <SectionHead title={t(L, 'insights.goalFunding')} sub={t(L, 'insights.goalFundingSub')} />
              {goals.length === 0 ? (
                <EmptyState title={t(L, 'insights.noGoalsTitle')} body={t(L, 'insights.noGoalsBody')} />
              ) : (
                goals.map((g) => {
                  const pct = Math.min(100, Math.max(0, Math.round(g.progress_percent || 0)));
                  const done = g.status === 'completed' || pct >= 100;
                  return (
                    <View key={g.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8 }}>
                      <View
                        style={{
                          width: 58,
                          height: 58,
                          borderRadius: 29,
                          borderWidth: 5,
                          borderColor: done ? colors.success : colors.primary,
                          backgroundColor: (done ? colors.success : colors.primary) + '14',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 14 }}>{pct}%</Text>
                      </View>
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 15 }} numberOfLines={1}>
                          {g.title}
                        </Text>
                        <Bar pct={pct} color={done ? colors.success : colors.primary} />
                        <Text style={{ color: colors.textSecondary, fontFamily: fonts.ui, fontSize: 12.5 }}>
                          {formatMoney(g.current_amount, g.currency_code, L)} / {formatMoney(g.target_amount, g.currency_code, L)}
                        </Text>
                        <Text style={{ color: done ? colors.success : colors.muted, fontFamily: done ? fonts.uiSemi : fonts.ui, fontSize: 12 }}>
                          {done
                            ? t(L, 'insights.fullyFunded')
                            : g.eta_months != null && g.status === 'active'
                              ? t(L, 'insights.monthsToGo').replace('{n}', String(g.eta_months))
                              : t(L, 'insights.keepAdding')}
                        </Text>
                      </View>
                    </View>
                  );
                })
              )}
            </Card>
          ) : null}

          {tab === 'analysis' ? (
            <Card>
              <SectionHead
                title={t(L, 'insights.analyst')}
                sub={t(L, 'insights.analystSub')}
                right={
                  <Pressable
                    onPress={onRefreshInsights}
                    hitSlop={8}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 34, borderRadius: radii.full, borderWidth: 1, borderColor: colors.border }}
                  >
                    <FontAwesome name="refresh" size={12} color={colors.primary} />
                    <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 13 }}>{t(L, 'common.refresh')}</Text>
                  </Pressable>
                }
              />
              {insights.length === 0 ? (
                <EmptyState title={t(L, 'insights.noCardsTitle')} body={t(L, 'insights.noCardsBody')} />
              ) : (
                <View style={{ gap: 10 }}>
                  {insights.map((card) => {
                    const sev = severity(card.severity);
                    return (
                      <View key={card.id} style={{ flexDirection: 'row', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
                        <View style={{ width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: sev.bg }}>
                          <FontAwesome name={sev.icon} size={15} color={sev.fg} />
                        </View>
                        <View style={{ flex: 1, gap: 3 }}>
                          <Text style={{ color: colors.muted, fontFamily: fonts.uiSemi, fontSize: 11.5 }}>
                            {sev.label}
                            {card.theme ? ` · ${card.theme.replace(/_/g, ' ')}` : ''}
                            {card.source?.includes('llm') ? ' · AI' : ''}
                          </Text>
                          <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 15 }}>{card.title}</Text>
                          <RichText text={card.body} muted />
                        </View>
                      </View>
                    );
                  })}
                  <Pressable
                    onPress={async () => {
                      try {
                        await api.clearAIInsights(token);
                        setInsights([]);
                        setCoachMessages([]);
                      } catch (e) {
                        onError?.(e instanceof Error ? e.message : 'Could not clear');
                      }
                    }}
                    hitSlop={8}
                    style={{ alignSelf: 'center', paddingVertical: 6 }}
                  >
                    <Text style={{ color: colors.muted, fontFamily: fonts.uiSemi, fontSize: 13 }}>{t(L, 'common.clear')}</Text>
                  </Pressable>
                </View>
              )}
            </Card>
          ) : null}

          {tab === 'reports' ? (
            <Card>
              <SectionHead
                title={t(L, 'insights.visualizer')}
                sub={t(L, 'insights.visualizerSub')}
                right={
                  <Pressable
                    onPress={onLoadReport}
                    disabled={reportBusy}
                    hitSlop={8}
                    style={{ paddingHorizontal: 14, height: 34, justifyContent: 'center', borderRadius: radii.full, backgroundColor: report ? 'transparent' : colors.primary, borderWidth: 1, borderColor: report ? colors.border : colors.primary }}
                  >
                    <Text style={{ color: report ? colors.primary : colors.onPrimary, fontFamily: fonts.uiSemi, fontSize: 13 }}>
                      {reportBusy ? t(L, 'common.building') : report ? t(L, 'common.refresh') : t(L, 'insights.buildReport')}
                    </Text>
                  </Pressable>
                }
              />
              {!report ? (
                <EmptyState title={t(L, 'insights.noReportTitle')} body={t(L, 'insights.noReportBody')} />
              ) : (
                <View style={{ gap: 16, marginTop: 4 }}>
                  <Text style={{ color: colors.textSecondary, fontFamily: fonts.ui, fontSize: 14.5, lineHeight: 21 }}>{report.summary}</Text>
                  {report.charts.map((chart) => {
                    const seriesData = (chart.data?.series as InsightsMonthPoint[] | undefined) ?? [];
                    const catData = (chart.data?.categories as InsightsCategoryPoint[] | undefined) ?? [];
                    return (
                      <View key={chart.id} style={{ gap: 8, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.border }}>
                        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 15 }}>{chart.title}</Text>
                        {chart.caption ? <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12.5 }}>{chart.caption}</Text> : null}
                        {chart.type === 'grouped_bar' && seriesData.length > 0 ? (
                          <MonthChart series={seriesData} formatMoney={formatMoney} currency={report.currency_code} locale={L} />
                        ) : null}
                        {chart.type === 'bar' && catData.length > 0 ? <CategoryBars rows={catData} formatMoney={formatMoney} locale={L} /> : null}
                        {chart.type === 'kpi' ? (
                          <View style={{ flexDirection: 'row', gap: 8 }}>
                            {(['income', 'expense', 'net'] as const).map((k) => (
                              <View key={k} style={{ flex: 1, padding: 12, borderRadius: 14, backgroundColor: colors.surfaceMuted, gap: 3 }}>
                                <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 11 }}>
                                  {k === 'income' ? t(L, 'insights.moneyIn') : k === 'expense' ? t(L, 'insights.moneyOut') : t(L, 'insights.leftOverShort')}
                                </Text>
                                <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 13 }} numberOfLines={1} adjustsFontSizeToFit>
                                  {formatMoney(String(chart.data?.[k] ?? ''), report.currency_code, L)}
                                </Text>
                              </View>
                            ))}
                          </View>
                        ) : null}
                        {isPremium ? (
                          <Pressable onPress={() => explainChart(chart.id, chart.title, chart.caption)} hitSlop={8}>
                            <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 13 }}>{t(L, 'insights.explainThis')} →</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    );
                  })}
                  {(report.tables ?? []).map((table) => (
                    <ReportTableView key={table.id} table={table} />
                  ))}
                  {report.source === 'llm_visualizer' ? (
                    <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 11.5 }}>{t(L, 'insights.captionsAiAssisted')}</Text>
                  ) : null}
                </View>
              )}
            </Card>
          ) : null}

          {tab === 'coach' ? (
            <Card>
              <SectionHead
                title={t(L, 'insights.askTitle')}
                sub={t(L, 'insights.coachSubtitle')}
                right={
                  coachMessages.length > 0 ? (
                    <Pressable
                      onPress={() => {
                        setCoachMessages([]);
                        setCoachActions([]);
                      }}
                      hitSlop={8}
                    >
                      <Text style={{ color: colors.muted, fontFamily: fonts.uiSemi, fontSize: 13 }}>{t(L, 'common.clear')}</Text>
                    </Pressable>
                  ) : undefined
                }
              />
              {coachMessages.length === 0 ? (
                <View style={{ alignItems: 'center', gap: 12, paddingVertical: 14 }}>
                  <View style={{ width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary }}>
                    <FontAwesome name="magic" size={22} color={colors.onPrimary} />
                  </View>
                  <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 16 }}>{t(L, 'insights.askEmpty')}</Text>
                  <View style={{ gap: 8, alignSelf: 'stretch' }}>
                    {(['insights.q1', 'insights.q2', 'insights.q3', 'insights.q4'] as const).map((k) => (
                      <Pressable
                        key={k}
                        onPress={() => void onAskCoach(t(L, k))}
                        style={({ pressed }) => ({
                          paddingVertical: 12,
                          paddingHorizontal: 14,
                          borderRadius: 14,
                          backgroundColor: pressed ? colors.primarySoft : colors.surface,
                          borderWidth: 1,
                          borderColor: pressed ? colors.primary : colors.border,
                        })}
                      >
                        <Text style={{ color: colors.textSecondary, fontFamily: fonts.uiSemi, fontSize: 13.5 }}>{t(L, k)}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : (
                <View style={{ gap: 10 }}>
                  {coachMessages.map((m) => {
                    const isUser = m.role === 'user';
                    return (
                      <View key={m.id} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, alignSelf: isUser ? 'flex-end' : 'flex-start', maxWidth: '92%' }}>
                        {!isUser ? (
                          <View style={{ width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary }}>
                            <FontAwesome name="magic" size={11} color={colors.onPrimary} />
                          </View>
                        ) : null}
                        <View
                          style={{
                            flexShrink: 1,
                            backgroundColor: isUser ? colors.primary : colors.surfaceMuted,
                            borderRadius: 18,
                            borderBottomRightRadius: isUser ? 6 : 18,
                            borderBottomLeftRadius: isUser ? 18 : 6,
                            paddingHorizontal: 14,
                            paddingVertical: 10,
                          }}
                        >
                          {isUser ? (
                            <Text style={{ color: colors.onPrimary, fontFamily: fonts.ui, fontSize: 14, lineHeight: 20 }}>{m.content}</Text>
                          ) : m.content ? (
                            <RichText text={m.content} />
                          ) : (
                            <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>{t(L, 'insights.thinking')}</Text>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
              {coachActions.length > 0 && onOpenDeepLink ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {coachActions.map((a) => (
                    <Pressable
                      key={`${a.label}-${a.deep_link}`}
                      onPress={() => onOpenDeepLink(a.deep_link)}
                      style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.full, backgroundColor: colors.primarySoft }}
                    >
                      <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 13 }}>{a.label} →</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  paddingLeft: 16,
                  paddingRight: 5,
                  paddingVertical: 5,
                  borderRadius: radii.full,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.surface,
                  marginTop: 4,
                }}
              >
                <TextInput
                  value={coachMsg}
                  onChangeText={setCoachMsg}
                  placeholder={t(L, 'insights.askPlaceholder')}
                  placeholderTextColor={colors.muted}
                  style={{ flex: 1, color: colors.text, fontFamily: fonts.ui, fontSize: 14.5, paddingVertical: 8 }}
                  returnKeyType="send"
                  onSubmitEditing={() => void onAskCoach()}
                  multiline={false}
                />
                <Pressable
                  onPress={() => void onAskCoach()}
                  disabled={coachBusy || !coachMsg.trim()}
                  accessibilityLabel={t(L, 'common.send')}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.primary,
                    opacity: coachBusy || !coachMsg.trim() ? 0.45 : 1,
                  }}
                >
                  {coachBusy ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <FontAwesome name="send" size={14} color={colors.onPrimary} />}
                </Pressable>
              </View>
            </Card>
          ) : null}
        </>
      )}
      <TrustGradeModal visible={gradeModalOpen} grade={lonyScore?.grade} onClose={() => setGradeModalOpen(false)} locale={L} />
    </View>
  );
}
