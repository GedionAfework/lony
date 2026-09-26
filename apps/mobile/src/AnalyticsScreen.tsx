import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  api,
  type AIInsight,
  type Dashboard,
  type InsightsCategoryPoint,
  type InsightsGoal,
  type InsightsMonthPoint,
  type InsightsOverview,
  type LonyScore,
  type User,
} from './api';
import { fonts, radii, space, useTheme } from './theme';
import { Card, EmptyState, Field, Money, PrimaryButton } from './ui';

type Tab = 'overview' | 'cashflow' | 'debts' | 'goals' | 'analysis' | 'coach';

type Props = {
  user: User;
  token: string;
  dashboard: Dashboard | null;
  formatMoney: (amount: string | null | undefined, currency: string | null | undefined, locale?: string) => string;
  onError?: (message: string) => void;
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

function MonthBars({
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
  const max = Math.max(
    1,
    ...series.map((s) => Math.max(Number(s.income) || 0, Number(s.expense) || 0)),
  );
  return (
    <View style={{ gap: 10 }}>
      {series.map((row) => {
        const income = Number(row.income) || 0;
        const expense = Number(row.expense) || 0;
        const iH = Math.max(income > 0 ? 4 : 0, Math.round((income / max) * 72));
        const eH = Math.max(expense > 0 ? 4 : 0, Math.round((expense / max) * 72));
        const label = row.month.slice(5);
        return (
          <View key={row.month} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
            <Text style={{ width: 36, color: colors.muted, fontFamily: fonts.ui, fontSize: 11 }}>{label}</Text>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 76 }}>
              <View
                style={{
                  flex: 1,
                  height: iH,
                  borderRadius: 4,
                  backgroundColor: colors.success,
                  opacity: 0.85,
                }}
              />
              <View
                style={{
                  flex: 1,
                  height: eH,
                  borderRadius: 4,
                  backgroundColor: colors.warning,
                  opacity: 0.85,
                }}
              />
            </View>
            <View style={{ width: 88, alignItems: 'flex-end' }}>
              <Text style={{ color: colors.success, fontFamily: fonts.ui, fontSize: 10 }} numberOfLines={1}>
                {formatMoney(row.income, currency, locale)}
              </Text>
              <Text style={{ color: colors.warning, fontFamily: fonts.ui, fontSize: 10 }} numberOfLines={1}>
                {formatMoney(row.expense, currency, locale)}
              </Text>
            </View>
          </View>
        );
      })}
      <View style={{ flexDirection: 'row', gap: 16, marginTop: 4 }}>
        <Text style={{ color: colors.success, fontFamily: fonts.ui, fontSize: 11 }}>Income</Text>
        <Text style={{ color: colors.warning, fontFamily: fonts.ui, fontSize: 11 }}>Expense</Text>
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

export function AnalyticsScreen({ user, token, dashboard, formatMoney, onError }: Props) {
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
  const [coachReply, setCoachReply] = useState<string | null>(null);
  const [coachBusy, setCoachBusy] = useState(false);
  const [rates, setRates] = useState<Record<string, number>>(() =>
    preferred ? { [preferred]: 1 } : {},
  );

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
      const ai = await api.listAIInsights(token).catch(() => null);
      if (ai) {
        setInsights(ai.insights ?? []);
        setDisclaimer(ai.disclaimer || '');
      }
    } catch (e) {
      onError?.(e instanceof Error ? e.message : 'Could not load insights');
    }
  }, [preferred, token, onError]);

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
    { id: 'analysis', label: 'Analysis' },
    { id: 'coach', label: 'Coach' },
  ];

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
    setCoachBusy(true);
    try {
      const res = await api.aiCoach(token, preferred, coachMsg.trim());
      setCoachReply(res.coach.reply);
      setDisclaimer(res.coach.disclaimer || disclaimer);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : 'Coach unavailable');
    } finally {
      setCoachBusy(false);
    }
  }

  return (
    <View style={{ gap: space.md }}>
      <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>Insights</Text>

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
                  <MonthBars
                    series={series}
                    formatMoney={formatMoney}
                    currency={preferred}
                    locale={user.locale}
                  />
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
                <MonthBars
                  series={series}
                  formatMoney={formatMoney}
                  currency={preferred}
                  locale={user.locale}
                />
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
                      gap: 4,
                      paddingVertical: 12,
                      borderBottomWidth: 1,
                      borderBottomColor: colors.border,
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
                      }}
                    >
                      {card.severity} · {card.theme}
                    </Text>
                    <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 15 }}>{card.title}</Text>
                    <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>{card.body}</Text>
                  </View>
                ))
              )}
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 11, marginTop: 10 }}>
                {disclaimer ||
                  'Lony insights are educational estimates, not credit scores, investment advice, or guaranteed outcomes.'}
              </Text>
            </Card>
          ) : null}

          {tab === 'coach' ? (
            <Card>
              <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>Coach</Text>
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13, marginBottom: 8 }}>
                Ask where to cut spending, how debt looks, or how to improve your score.
              </Text>
              <Field
                label="Your question"
                value={coachMsg}
                onChange={setCoachMsg}
                placeholder="Where can I cut spending?"
              />
              <PrimaryButton
                label={coachBusy ? 'Thinking…' : 'Ask'}
                onPress={onAskCoach}
                disabled={coachBusy}
              />
              {coachReply ? (
                <Text style={{ color: colors.text, fontFamily: fonts.ui, fontSize: 14, marginTop: 12 }}>
                  {coachReply}
                </Text>
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
