import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
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
} from './api';
import { RichText } from './RichText';
import { fonts, radii, space, useTheme } from './theme';
import { Card, EmptyState, Field, Money, PrimaryButton, SecondaryButton } from './ui';

type Tab = 'overview' | 'cashflow' | 'debts' | 'goals' | 'analysis' | 'reports' | 'coach';

type CoachAction = { label: string; deep_link: string };

type Props = {
  user: User;
  token: string;
  dashboard: Dashboard | null;
  formatMoney: (amount: string | null | undefined, currency: string | null | undefined, locale?: string) => string;
  onError?: (message: string) => void;
  onOpenDeepLink?: (deepLink: string) => void;
};

function convert(amount: number, from: string, to: string, rates: Record<string, number>): number {
  if (from === to) return amount;
  const rf = rates[from];
  const rt = rates[to];
  if (!rf || !rt) return NaN;
  return (amount / rf) * rt;
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(0)}%`;
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ color, fontFamily: fonts.ui, fontSize: 11 }}>{label}</Text>
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
    ...series.map((s) => Math.max(Number(s.income) || 0, Number(s.expense) || 0, Math.abs(Number(s.net) || 0))),
  );
  return (
    <View
      style={{
        gap: 12,
        padding: 12,
        borderRadius: radii.lg,
        backgroundColor: colors.surfaceMuted,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      {series.map((row) => {
        const income = Number(row.income) || 0;
        const expense = Number(row.expense) || 0;
        const net = Number(row.net) || income - expense;
        const iH = Math.max(income > 0 ? 6 : 0, Math.round((income / max) * 88));
        const eH = Math.max(expense > 0 ? 6 : 0, Math.round((expense / max) * 88));
        const nH = Math.max(Math.abs(net) > 0 ? 4 : 0, Math.round((Math.abs(net) / max) * 88));
        const label = row.month.slice(5);
        return (
          <View key={row.month} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
            <Text style={{ width: 36, color: colors.muted, fontFamily: fonts.uiSemi, fontSize: 11 }}>{label}</Text>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 5, height: 92 }}>
              <View
                style={{
                  flex: 1,
                  height: iH,
                  borderTopLeftRadius: 8,
                  borderTopRightRadius: 8,
                  backgroundColor: colors.success,
                }}
              />
              <View
                style={{
                  flex: 1,
                  height: eH,
                  borderTopLeftRadius: 8,
                  borderTopRightRadius: 8,
                  backgroundColor: colors.warning,
                }}
              />
              {showNet ? (
                <View
                  style={{
                    width: 7,
                    height: nH,
                    borderTopLeftRadius: 4,
                    borderTopRightRadius: 4,
                    backgroundColor: net >= 0 ? colors.primary : colors.error,
                  }}
                />
              ) : null}
            </View>
            <View style={{ width: 92, alignItems: 'flex-end', gap: 1 }}>
              <Text style={{ color: colors.success, fontFamily: fonts.uiSemi, fontSize: 10 }} numberOfLines={1}>
                {formatMoney(row.income, currency, locale)}
              </Text>
              <Text style={{ color: colors.warning, fontFamily: fonts.uiSemi, fontSize: 10 }} numberOfLines={1}>
                {formatMoney(row.expense, currency, locale)}
              </Text>
              {showNet ? (
                <Text
                  style={{
                    color: net >= 0 ? colors.primary : colors.warning,
                    fontFamily: fonts.uiBold,
                    fontSize: 10,
                  }}
                  numberOfLines={1}
                >
                  {formatMoney(String(net), currency, locale)}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
      <View style={{ flexDirection: 'row', gap: 14, marginTop: 2, flexWrap: 'wrap' }}>
        <LegendDot color={colors.success} label="Income" />
        <LegendDot color={colors.warning} label="Expense" />
        {showNet ? <LegendDot color={colors.primary} label="Net" /> : null}
      </View>
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
  const max = Math.max(1, ...rows.map((r) => Number(r.amount) || 0));
  if (rows.length === 0) {
    return <EmptyState title="No spending yet" body="Category bars appear after confirmed expenses." />;
  }
  return (
    <View style={{ gap: 10 }}>
      {rows.slice(0, 8).map((row) => {
        const amt = Number(row.amount) || 0;
        const pct = Math.max(4, Math.round((amt / max) * 100));
        return (
          <View key={row.category} style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 13, flex: 1 }} numberOfLines={1}>
                {row.category}
              </Text>
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                {formatMoney(row.amount, row.currency_code, locale)} · {row.share_percent.toFixed(0)}%
              </Text>
            </View>
            <View style={{ height: 8, borderRadius: radii.full, backgroundColor: colors.surfaceMuted }}>
              <View
                style={{
                  height: 8,
                  width: `${pct}%`,
                  borderRadius: radii.full,
                  backgroundColor: colors.warning,
                }}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function AnalyticsScreen({ user, token, dashboard, formatMoney, onError, onOpenDeepLink }: Props) {
  const { colors } = useTheme();
  const preferred = (user.default_currency_code || '').toUpperCase();
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<InsightsOverview | null>(null);
  const [series, setSeries] = useState<InsightsMonthPoint[]>([]);
  const [categories, setCategories] = useState<InsightsCategoryPoint[]>([]);
  const [goals, setGoals] = useState<InsightsGoal[]>([]);
  const [lonyScore, setLonyScore] = useState<LonyScore | null>(null);
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [disclaimer, setDisclaimer] = useState('');
  const [coachMsg, setCoachMsg] = useState('');
  const [coachMessages, setCoachMessages] = useState<CoachMessage[]>([]);
  const [coachActions, setCoachActions] = useState<CoachAction[]>([]);
  const [coachBusy, setCoachBusy] = useState(false);
  const [report, setReport] = useState<AIReport | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [rates, setRates] = useState<Record<string, number>>(() =>
    preferred ? { [preferred]: 1 } : {},
  );

  const isPremium =
    user.role === 'admin' || (user.plan_tier || 'free').toLowerCase() === 'premium';

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
          setDisclaimer(ai.disclaimer || '');
        }
        const thread = await api.getCoachThread(token).catch(() => null);
        if (thread?.thread?.messages) {
          setCoachMessages(thread.thread.messages);
          if (thread.disclaimer) setDisclaimer(thread.disclaimer);
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
    { id: 'overview', label: 'Overview' },
    { id: 'cashflow', label: 'Cashflow' },
    { id: 'debts', label: 'Debts' },
    { id: 'goals', label: 'Goals' },
    ...(isPremium
      ? ([
          { id: 'analysis', label: 'Analysis' },
          { id: 'reports', label: 'Reports' },
          { id: 'coach', label: 'Coach' },
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
      setDisclaimer(res.report.disclaimer || disclaimer);
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
      setDisclaimer(ai.disclaimer || '');
      setLonyScore(sc.score);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : 'Could not refresh analysis');
    }
  }

  async function onAskCoach() {
    if (!coachMsg.trim() || !preferred) return;
    const question = coachMsg.trim();
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
          setDisclaimer(coach.disclaimer || disclaimer);
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

  return (
    <View style={{ gap: space.md }}>
      <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>Insights</Text>
      {!isPremium ? (
        <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
          AI Analysis, Reports, and Coach unlock with Premium.
        </Text>
      ) : null}

      {!preferred ? (
        <Card>
          <EmptyState
            title="Pick your currency"
            body="Set a default currency in Settings so insights use your unit of choice."
          />
        </Card>
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {tabs.map((t) => {
              const active = tab === t.id;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => setTab(t.id)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: radii.full,
                    backgroundColor: active ? colors.primary : colors.surfaceMuted,
                    borderWidth: 1,
                    borderColor: active ? colors.primary : colors.border,
                  }}
                >
                  <Text
                    style={{
                      color: active ? colors.onPrimary : colors.text,
                      fontFamily: fonts.uiSemi,
                      fontSize: 12,
                    }}
                  >
                    {t.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {tab === 'overview' ? (
            <>
              {lonyScore ? (
                <Card>
                  <Text
                    style={{
                      color: colors.muted,
                      fontFamily: fonts.uiSemi,
                      fontSize: 12,
                      textTransform: 'uppercase',
                    }}
                  >
                    Lony Trust
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
                    <Text style={{ color: colors.primary, fontFamily: fonts.uiBold, fontSize: 48 }}>
                      {lonyScore.grade}
                    </Text>
                    <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>
                      {lonyScore.band}
                    </Text>
                  </View>
                  <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                    Peer-lending trust grade on Lony (not a credit bureau score)
                    {lonyScore.thin_history ? ' · limited loan history' : ''}
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
                    <Mini label="Repayment" value={`${Math.round(lonyScore.repayment_score)}`} />
                    <Mini label="Debt" value={`${Math.round(lonyScore.debt_score)}`} />
                    <Mini label="Consistency" value={`${Math.round(lonyScore.consistency_score)}`} />
                    <Mini label="Liquidity" value={`${Math.round(lonyScore.liquidity_score)}`} />
                    <Mini label="Savings" value={`${Math.round(lonyScore.savings_score)}`} />
                    <Mini label="Goals" value={`${Math.round(lonyScore.goals_score)}`} />
                  </View>
                  {(lonyScore.tips ?? []).slice(0, 2).map((tip) => (
                    <Text
                      key={tip}
                      style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12, marginTop: 6 }}
                    >
                      · {tip}
                    </Text>
                  ))}
                </Card>
              ) : null}

              <Card>
                <Text
                  style={{ color: colors.muted, fontFamily: fonts.uiSemi, fontSize: 12, textTransform: 'uppercase' }}
                >
                  This month
                </Text>
                <Money
                  value={formatMoney(overview?.net ?? '0', preferred, user.locale)}
                  size="xl"
                  tone={Number(overview?.net || 0) >= 0 ? 'positive' : 'negative'}
                />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
                  <Mini
                    label="Income"
                    value={formatMoney(overview?.income ?? '0', preferred, user.locale)}
                    hint={fmtPct(overview?.income_mom_percent)}
                    tone="positive"
                  />
                  <Mini
                    label="Expense"
                    value={formatMoney(overview?.expense ?? '0', preferred, user.locale)}
                    hint={fmtPct(overview?.expense_mom_percent)}
                    tone="negative"
                  />
                  <Mini
                    label="Savings rate"
                    value={
                      overview?.savings_rate_percent != null
                        ? `${overview.savings_rate_percent.toFixed(0)}%`
                        : '—'
                    }
                  />
                </View>
              </Card>

              <Card>
                <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>Last 6 months</Text>
                {series.every((s) => Number(s.income) === 0 && Number(s.expense) === 0) ? (
                  <EmptyState title="No cashflow yet" body="Log income and expenses to see the trend." />
                ) : (
                  <View style={{ gap: 14 }}>
                    <NetSparkline series={series} />
                    <MonthBars
                      series={series}
                      formatMoney={formatMoney}
                      currency={preferred}
                      locale={user.locale}
                      showNet
                    />
                  </View>
                )}
              </Card>

              <Card>
                <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>
                  Spending this month
                </Text>
                <CategoryBars rows={categories} formatMoney={formatMoney} locale={user.locale} />
              </Card>
            </>
          ) : null}

          {tab === 'cashflow' ? (
            <>
              <Card>
                <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>
                  Income vs expense
                </Text>
                <View style={{ gap: 14 }}>
                  <NetSparkline series={series} />
                  <MonthBars
                    series={series}
                    formatMoney={formatMoney}
                    currency={preferred}
                    locale={user.locale}
                    showNet
                  />
                </View>
              </Card>
              <Card>
                <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>Categories</Text>
                <CategoryBars rows={categories} formatMoney={formatMoney} locale={user.locale} />
              </Card>
            </>
          ) : null}

          {tab === 'debts' ? (
            <>
              <Card>
                <Text
                  style={{ color: colors.muted, fontFamily: fonts.uiSemi, fontSize: 12, textTransform: 'uppercase' }}
                >
                  Loan position
                </Text>
                <Money
                  value={formatMoney(loanSummary.net.toFixed(2), preferred, user.locale)}
                  size="xl"
                  tone={loanSummary.net >= 0 ? 'positive' : 'negative'}
                />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                  <Text style={{ color: colors.success, fontFamily: fonts.uiMedium, fontSize: 12 }}>
                    Owed to you {formatMoney(loanSummary.recv.toFixed(2), preferred, user.locale)}
                  </Text>
                  <Text style={{ color: colors.warning, fontFamily: fonts.uiMedium, fontSize: 12 }}>
                    You owe {formatMoney(loanSummary.pay.toFixed(2), preferred, user.locale)}
                  </Text>
                </View>
                {overview?.debt_service_ratio != null ? (
                  <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12, marginTop: 8 }}>
                    Expense / income this month {(overview.debt_service_ratio * 100).toFixed(0)}%
                  </Text>
                ) : null}
              </Card>

              <Card>
                <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>People</Text>
                {friends.length === 0 ? (
                  <EmptyState title="No people yet" body="Friend balances appear after shared loans." />
                ) : (
                  friends.map((f) => (
                    <View
                      key={f.name}
                      style={{ gap: 6, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, flex: 1 }} numberOfLines={1}>
                          {f.name}
                        </Text>
                        <Money
                          value={formatMoney(f.net.toFixed(2), preferred, user.locale)}
                          size="sm"
                          tone={f.net >= 0 ? 'positive' : 'negative'}
                        />
                      </View>
                      <View
                        style={{
                          height: 8,
                          borderRadius: radii.full,
                          backgroundColor: colors.surfaceMuted,
                          overflow: 'hidden',
                        }}
                      >
                        <View
                          style={{
                            width: `${Math.max(6, Math.round((Math.abs(f.net) / friendMax) * 100))}%`,
                            height: '100%',
                            backgroundColor: f.net >= 0 ? colors.success : colors.warning,
                          }}
                        />
                      </View>
                    </View>
                  ))
                )}
              </Card>
            </>
          ) : null}

          {tab === 'goals' ? (
            <Card>
              <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>Goal funding</Text>
              {goals.length === 0 ? (
                <EmptyState title="No goals yet" body="Create goals under Plan to track funding here." />
              ) : (
                goals.map((g) => {
                  const pct = Math.min(100, Math.max(0, Math.round(g.progress_percent || 0)));
                  return (
                    <View
                      key={g.id}
                      style={{ gap: 6, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, flex: 1 }} numberOfLines={1}>
                          {g.title}
                        </Text>
                        <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 13 }}>{pct}%</Text>
                      </View>
                      <View style={{ height: 8, borderRadius: radii.full, backgroundColor: colors.surfaceMuted }}>
                        <View
                          style={{
                            height: 8,
                            width: `${Math.max(pct > 0 ? 4 : 0, pct)}%`,
                            borderRadius: radii.full,
                            backgroundColor: g.status === 'completed' ? colors.success : colors.primary,
                          }}
                        />
                      </View>
                      <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                        {formatMoney(g.current_amount, g.currency_code, user.locale)} /{' '}
                        {formatMoney(g.target_amount, g.currency_code, user.locale)}
                        {g.eta_months != null && g.status === 'active' ? ` · ~${g.eta_months} mo` : ''}
                      </Text>
                    </View>
                  );
                })
              )}
            </Card>
          ) : null}

          {tab === 'analysis' ? (
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>Analyst</Text>
                <View style={{ flexDirection: 'row', gap: 12 }}>
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
                  >
                    <Text style={{ color: colors.muted, fontFamily: fonts.uiSemi, fontSize: 13 }}>Clear</Text>
                  </Pressable>
                  <Pressable onPress={onRefreshInsights} hitSlop={8}>
                    <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 13 }}>Refresh</Text>
                  </Pressable>
                </View>
              </View>
              {insights.length === 0 ? (
                <EmptyState
                  title="No cards yet"
                  body="Tap Refresh to run rule-based analysis on this month's numbers."
                />
              ) : (
                insights.map((card) => (
                  <View
                    key={card.id}
                    style={{
                      gap: 6,
                      padding: 14,
                      borderRadius: radii.lg,
                      backgroundColor: colors.surfaceMuted,
                      borderWidth: 1,
                      borderColor:
                        card.severity === 'critical' || card.severity === 'warning'
                          ? colors.warning + '55'
                          : card.severity === 'positive'
                            ? colors.success + '55'
                            : colors.border,
                      borderLeftWidth: 3,
                      borderLeftColor:
                        card.severity === 'critical' || card.severity === 'warning'
                          ? colors.warning
                          : card.severity === 'positive'
                            ? colors.success
                            : colors.primary,
                    }}
                  >
                    <Text
                      style={{
                        color:
                          card.severity === 'critical' || card.severity === 'warning'
                            ? colors.warning
                            : card.severity === 'positive'
                              ? colors.success
                              : colors.muted,
                        fontFamily: fonts.uiSemi,
                        fontSize: 11,
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                      }}
                    >
                      {card.severity} · {card.theme}
                      {card.source?.includes('llm') ? ' · AI' : ''}
                    </Text>
                    <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>{card.title}</Text>
                    <RichText text={card.body} muted />
                  </View>
                ))
              )}
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 11, marginTop: 10 }}>
                {disclaimer ||
                  'Lony insights are educational estimates, not credit scores, investment advice, or guaranteed outcomes.'}
              </Text>
            </Card>
          ) : null}

          {tab === 'reports' ? (
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>Visualizer</Text>
                <Pressable onPress={onLoadReport} hitSlop={8} disabled={reportBusy}>
                  <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 13 }}>
                    {reportBusy ? 'Building…' : report ? 'Refresh' : 'Build report'}
                  </Text>
                </Pressable>
              </View>
              {!report ? (
                <EmptyState
                  title="No report yet"
                  body="Build a period pack with cashflow charts, category bars, and captions."
                />
              ) : (
                <View style={{ gap: 14, marginTop: 8 }}>
                  <Text style={{ color: colors.text, fontFamily: fonts.ui, fontSize: 14 }}>{report.summary}</Text>
                  {report.source === 'llm_visualizer' ? (
                    <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 11 }}>Captions AI-assisted</Text>
                  ) : null}
                  {report.charts.map((chart) => {
                    const seriesData = (chart.data?.series as InsightsMonthPoint[] | undefined) ?? [];
                    const catData = (chart.data?.categories as InsightsCategoryPoint[] | undefined) ?? [];
                    return (
                      <View key={chart.id} style={{ gap: 6 }}>
                        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 15 }}>{chart.title}</Text>
                        <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>{chart.caption}</Text>
                        {chart.type === 'grouped_bar' && seriesData.length > 0 ? (
                          <View style={{ gap: 12 }}>
                            <NetSparkline series={seriesData} />
                            <MonthBars
                              series={seriesData}
                              formatMoney={formatMoney}
                              currency={report.currency_code}
                              locale={user.locale}
                              showNet
                            />
                          </View>
                        ) : null}
                        {chart.type === 'bar' && catData.length > 0 ? (
                          <CategoryBars rows={catData} formatMoney={formatMoney} locale={user.locale} />
                        ) : null}
                        {chart.type === 'kpi' ? (
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                            <Mini label="Income" value={formatMoney(String(chart.data?.income ?? ''), report.currency_code, user.locale)} />
                            <Mini label="Expense" value={formatMoney(String(chart.data?.expense ?? ''), report.currency_code, user.locale)} />
                            <Mini label="Net" value={formatMoney(String(chart.data?.net ?? ''), report.currency_code, user.locale)} />
                          </View>
                        ) : null}
                        <Pressable onPress={() => explainChart(chart.id, chart.title, chart.caption)} hitSlop={8}>
                          <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 13 }}>Explain this</Text>
                        </Pressable>
                      </View>
                    );
                  })}
                  {(report.tables ?? []).map((table) => (
                    <ReportTableView key={table.id} table={table} />
                  ))}
                  <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 11 }}>
                    {report.disclaimer || disclaimer}
                  </Text>
                </View>
              )}
            </Card>
          ) : null}

          {tab === 'coach' ? (
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 12,
                    backgroundColor: colors.primarySoft,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: colors.primary, fontFamily: fonts.uiBold, fontSize: 16 }}>✦</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>Coach</Text>
                  <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                    Cut spending, debt health, score tips — never new borrowing.
                  </Text>
                </View>
              </View>
              {coachMessages.length === 0 ? (
                <View
                  style={{
                    padding: 16,
                    borderRadius: radii.lg,
                    backgroundColor: colors.surfaceMuted,
                    borderWidth: 1,
                    borderColor: colors.border,
                    gap: 10,
                    marginBottom: 12,
                  }}
                >
                  <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 14 }}>Try asking</Text>
                  {[
                    'Where can I cut spending this month?',
                    'How does my debt look?',
                    'Am I on track for my goals?',
                  ].map((q) => (
                    <Pressable
                      key={q}
                      onPress={() => {
                        setCoachMsg(q);
                      }}
                      style={{
                        paddingVertical: 10,
                        paddingHorizontal: 12,
                        borderRadius: radii.md,
                        backgroundColor: colors.surface,
                        borderWidth: 1,
                        borderColor: colors.border,
                      }}
                    >
                      <Text style={{ color: colors.primary, fontFamily: fonts.ui, fontSize: 13 }}>{q}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <View style={{ gap: 10, marginBottom: 12 }}>
                  {coachMessages.map((m) => {
                    const isUser = m.role === 'user';
                    return (
                      <View
                        key={m.id}
                        style={{
                          alignSelf: isUser ? 'flex-end' : 'flex-start',
                          maxWidth: '92%',
                          backgroundColor: isUser ? colors.primary : colors.surfaceMuted,
                          borderRadius: isUser ? 18 : 16,
                          borderBottomRightRadius: isUser ? 6 : 16,
                          borderBottomLeftRadius: isUser ? 18 : 6,
                          paddingHorizontal: 14,
                          paddingVertical: 10,
                          borderWidth: isUser ? 0 : 1,
                          borderColor: colors.border,
                        }}
                      >
                        {!isUser ? (
                          <Text
                            style={{
                              color: colors.primary,
                              fontFamily: fonts.uiSemi,
                              fontSize: 10,
                              marginBottom: 4,
                              letterSpacing: 0.4,
                              textTransform: 'uppercase',
                            }}
                          >
                            Coach
                          </Text>
                        ) : null}
                        {isUser ? (
                          <Text style={{ color: colors.onPrimary, fontFamily: fonts.ui, fontSize: 14, lineHeight: 20 }}>
                            {m.content}
                          </Text>
                        ) : m.content ? (
                          <RichText text={m.content} />
                        ) : (
                          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>Thinking…</Text>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}
              {coachActions.length > 0 && onOpenDeepLink ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                  {coachActions.map((a) => (
                    <Pressable
                      key={`${a.label}-${a.deep_link}`}
                      onPress={() => onOpenDeepLink(a.deep_link)}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderRadius: radii.full,
                        backgroundColor: colors.primarySoft,
                        borderWidth: 1,
                        borderColor: colors.primary,
                      }}
                    >
                      <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 13 }}>{a.label}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <Field
                label="Your question"
                value={coachMsg}
                onChange={setCoachMsg}
                placeholder="Where can I cut spending?"
              />
              <PrimaryButton
                label={coachBusy ? 'Thinking…' : 'Ask Coach'}
                onPress={onAskCoach}
                disabled={coachBusy}
              />
              {coachMessages.length > 0 ? (
                <SecondaryButton
                  label="Clear chat view"
                  onPress={() => {
                    setCoachMessages([]);
                    setCoachActions([]);
                  }}
                />
              ) : null}
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 11, marginTop: 10 }}>
                {disclaimer ||
                  'Lony insights are educational estimates, not credit scores, investment advice, or guaranteed outcomes.'}
              </Text>
            </Card>
          ) : null}
        </>
      )}
    </View>
  );
}

function Mini({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'positive' | 'negative';
}) {
  const { colors } = useTheme();
  const color =
    tone === 'positive' ? colors.success : tone === 'negative' ? colors.warning : colors.text;
  return (
    <View style={{ minWidth: '28%', gap: 2 }}>
      <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 11 }}>{label}</Text>
      <Text style={{ color, fontFamily: fonts.uiSemi, fontSize: 14 }}>{value}</Text>
      {hint ? <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 10 }}>MoM {hint}</Text> : null}
    </View>
  );
}
