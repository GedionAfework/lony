import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '../auth/AuthContext';
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
} from '../lib/api';
import { formatMoney } from '../lib/format';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { Money } from '../components/Money';
import { Segmented } from '../components/Segmented';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { EmptyState } from '../components/EmptyState';
import { RichText } from '../components/RichText';
import { useToast } from '../components/Toast';

type Tab = 'overview' | 'cashflow' | 'debts' | 'goals' | 'analysis' | 'reports' | 'coach';

/** Map Coach `lony://…` deep links to web routes (mirrors mobile App.tsx). */
function routeForCoachDeepLink(link: string): string | null {
  const path = link.replace(/^lony:\/\//i, '').replace(/^\//, '').toLowerCase();
  if (path === 'expenses' || path === 'expenses/') return '/';
  if (path === 'expenses/new' || path.startsWith('expenses/new')) return '/cashflow/new?kind=expense';
  if (path === 'plan' || path.startsWith('plan')) return '/plan';
  if (path === 'loans' || path.startsWith('loans')) return '/loans';
  if (path === 'insights' || path.startsWith('insights') || path === 'analytics') return '/insights';
  if (path === 'accounts' || path.startsWith('accounts')) return '/accounts';
  return null;
}

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

function Mini({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'positive' | 'negative' }) {
  return (
    <div style={{ minWidth: '28%' }}>
      <div className="muted" style={{ fontSize: 11 }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 15, color: tone === 'positive' ? 'var(--success)' : tone === 'negative' ? 'var(--warning)' : 'var(--text)' }}>{value}</div>
      {hint ? <div className="muted" style={{ fontSize: 10 }}>MoM {hint}</div> : null}
    </div>
  );
}

function CashflowChart({ series, locale }: { series: InsightsMonthPoint[]; locale?: string }) {
  const data = series.map((s) => ({ month: s.month.slice(5), income: Number(s.income) || 0, expense: Number(s.expense) || 0, net: Number(s.net) || 0 }));
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 16,
        background: 'var(--surface-muted)',
        border: '1px solid var(--border)',
      }}
    >
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} barGap={4} barCategoryGap="28%">
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={48} />
          <Tooltip
            contentStyle={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              fontSize: 12,
              boxShadow: 'var(--shadow-md)',
            }}
            formatter={(v) => formatMoney(String(Number(v) || 0), undefined, locale)}
          />
          <Bar dataKey="income" fill="var(--success)" radius={[8, 8, 0, 0]} maxBarSize={28} />
          <Bar dataKey="expense" fill="var(--warning)" radius={[8, 8, 0, 0]} maxBarSize={28} />
          <Line dataKey="net" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 3, fill: 'var(--primary)' }} />
        </ComposedChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>
        <span style={{ color: 'var(--success)' }}>● Income</span>
        <span style={{ color: 'var(--warning)' }}>● Expense</span>
        <span style={{ color: 'var(--primary)' }}>— Net</span>
      </div>
    </div>
  );
}

function CategoryBars({ rows, locale }: { rows: InsightsCategoryPoint[]; locale?: string }) {
  const max = Math.max(1, ...rows.map((r) => Number(r.amount) || 0));
  if (rows.length === 0) return <EmptyState title="No spending yet" body="Category bars appear after confirmed expenses." />;
  return (
    <div
      className="flex-col"
      style={{
        gap: 12,
        padding: 12,
        borderRadius: 16,
        background: 'var(--surface-muted)',
        border: '1px solid var(--border)',
      }}
    >
      {rows.slice(0, 8).map((row) => {
        const amt = Number(row.amount) || 0;
        const pct = Math.max(4, Math.round((amt / max) * 100));
        return (
          <div key={row.category} className="flex-col" style={{ gap: 4 }}>
            <div className="card-row">
              <span style={{ fontWeight: 700, fontSize: 13 }}>{row.category}</span>
              <span className="muted" style={{ fontSize: 12 }}>
                {formatMoney(row.amount, row.currency_code, locale)} · {row.share_percent.toFixed(0)}%
              </span>
            </div>
            <div className="bar-track" style={{ height: 10, borderRadius: 8, background: 'var(--surface)' }}>
              <div className="bar-fill" style={{ width: `${pct}%`, borderRadius: 8, background: 'var(--warning)' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function InsightsPage() {
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const { showError } = useToast();
  const preferred = (user?.default_currency_code || '').toUpperCase();
  const locale = user?.locale || 'en';
  const isPremium = user?.role === 'admin' || (user?.plan_tier || 'free').toLowerCase() === 'premium';

  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<InsightsOverview | null>(null);
  const [series, setSeries] = useState<InsightsMonthPoint[]>([]);
  const [categories, setCategories] = useState<InsightsCategoryPoint[]>([]);
  const [goals, setGoals] = useState<InsightsGoal[]>([]);
  const [lonyScore, setLonyScore] = useState<LonyScore | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [rates, setRates] = useState<Record<string, number>>({});
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [disclaimer, setDisclaimer] = useState('');
  const [coachMsg, setCoachMsg] = useState('');
  const [coachMessages, setCoachMessages] = useState<CoachMessage[]>([]);
  const [coachActions, setCoachActions] = useState<{ label: string; deep_link: string }[]>([]);
  const [coachBusy, setCoachBusy] = useState(false);
  const [report, setReport] = useState<AIReport | null>(null);
  const [reportBusy, setReportBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!token || !preferred) return;
    try {
      const [ov, ser, cats, gs, sc, dash] = await Promise.all([
        api.insightsOverview(token, preferred),
        api.insightsCashflowSeries(token, preferred, 6),
        api.insightsCategories(token, preferred, 1),
        api.insightsGoals(token),
        api.getScore(token, preferred).catch(() => null),
        api.dashboard(token).catch(() => null),
      ]);
      setOverview(ov.overview);
      setSeries(ser.series ?? []);
      setCategories(cats.categories ?? []);
      setGoals(gs.goals ?? []);
      setLonyScore(sc?.score ?? null);
      setDashboard(dash?.dashboard ?? null);
      if (isPremium) {
        const ai = await api.listAIInsights(token).catch(() => null);
        if (ai) {
          setInsights(ai.insights ?? []);
          setDisclaimer(ai.disclaimer || '');
        }
        const thread = await api.getCoachThread(token).catch(() => null);
        if (thread?.thread?.messages) setCoachMessages(thread.thread.messages);
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not load insights');
    }
  }, [token, preferred, isPremium, showError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!preferred) return;
    api
      .fxRates(preferred)
      .then((res) => {
        const next: Record<string, number> = { [preferred]: 1 };
        for (const [k, v] of Object.entries(res.rates ?? {})) next[k.toUpperCase()] = Number(v);
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
    ...(isPremium ? ([{ id: 'analysis', label: 'Analysis' }, { id: 'reports', label: 'Reports' }, { id: 'coach', label: 'Coach' }] as { id: Tab; label: string }[]) : []),
  ];

  async function onRefreshInsights() {
    if (!token || !preferred) return;
    try {
      const [ai, sc] = await Promise.all([api.refreshAIInsights(token, preferred), api.getScore(token, preferred, true)]);
      setInsights(ai.insights ?? []);
      setDisclaimer(ai.disclaimer || '');
      setLonyScore(sc.score);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not refresh analysis');
    }
  }

  async function onLoadReport() {
    if (!token || !preferred) return;
    setReportBusy(true);
    try {
      const res = await api.aiReport(token, preferred, 6);
      setReport(res.report);
      setDisclaimer(res.report.disclaimer || disclaimer);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not build report');
    } finally {
      setReportBusy(false);
    }
  }

  async function onAskCoach() {
    if (!token || !preferred || !coachMsg.trim()) return;
    const question = coachMsg.trim();
    setCoachBusy(true);
    setCoachMsg('');
    setCoachActions([]);
    const userBubble: CoachMessage = { id: `local-u-${Date.now()}`, role: 'user', content: question, created_at: new Date().toISOString() };
    const assistantId = `local-a-${Date.now()}`;
    setCoachMessages((prev) => [...prev, userBubble, { id: assistantId, role: 'assistant', content: '', created_at: new Date().toISOString() }]);
    try {
      await api.aiCoachStream(token, preferred, question, {
        onToken: (text) => setCoachMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + text } : m))),
        onReplace: (text) => setCoachMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: text } : m))),
        onDone: (coach) => {
          setDisclaimer(coach.disclaimer || disclaimer);
          setCoachActions(coach.actions ?? []);
          setCoachMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: coach.reply } : m)));
        },
        onError: (message) => showError(message),
      });
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Coach unavailable');
      setCoachMessages((prev) => prev.filter((m) => m.id !== assistantId && m.id !== userBubble.id));
    } finally {
      setCoachBusy(false);
    }
  }

  if (!preferred) {
    return (
      <div className="page">
        <PageHeader title="Insights" />
        <Card>
          <EmptyState title="Pick your currency" body="Set a default currency in Settings so insights use your unit of choice." />
        </Card>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader title="Insights" subtitle={!isPremium ? 'AI Analysis, Reports, and Coach unlock with Premium' : undefined} />
      <Segmented value={tab} onChange={(v) => setTab(v as Tab)} options={tabs} />

      {tab === 'overview' ? (
        <div className="grid grid-2">
          {lonyScore ? (
            <Card>
              <div className="section-label">Lony Trust</div>
              <div className="flex-row" style={{ alignItems: 'baseline', gap: 10 }}>
                <span style={{ color: 'var(--primary)', fontWeight: 800, fontSize: 44 }}>{lonyScore.grade}</span>
                <span style={{ fontWeight: 700 }}>{lonyScore.band}</span>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                Peer-lending trust grade on Lony (not a credit bureau score){lonyScore.thin_history ? ' · limited loan history' : ''}
              </div>
              <div className="flex-row" style={{ flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
                <Mini label="Repayment" value={`${Math.round(lonyScore.repayment_score)}`} />
                <Mini label="Debt" value={`${Math.round(lonyScore.debt_score)}`} />
                <Mini label="Consistency" value={`${Math.round(lonyScore.consistency_score)}`} />
                <Mini label="Liquidity" value={`${Math.round(lonyScore.liquidity_score)}`} />
                <Mini label="Savings" value={`${Math.round(lonyScore.savings_score)}`} />
                <Mini label="Goals" value={`${Math.round(lonyScore.goals_score)}`} />
              </div>
            </Card>
          ) : null}

          <Card>
            <div className="section-label">This month</div>
            <Money value={overview?.net ?? '0'} currency={preferred} size="xl" tone={Number(overview?.net || 0) >= 0 ? 'positive' : 'negative'} locale={locale} />
            <div className="flex-row" style={{ flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
              <Mini label="Income" value={formatMoney(overview?.income ?? '0', preferred, locale)} hint={fmtPct(overview?.income_mom_percent)} tone="positive" />
              <Mini label="Expense" value={formatMoney(overview?.expense ?? '0', preferred, locale)} hint={fmtPct(overview?.expense_mom_percent)} tone="negative" />
              <Mini label="Savings rate" value={overview?.savings_rate_percent != null ? `${overview.savings_rate_percent.toFixed(0)}%` : '—'} />
            </div>
          </Card>

          <Card style={{ gridColumn: '1 / -1' }}>
            <div className="section-label">Last 6 months</div>
            {series.every((s) => Number(s.income) === 0 && Number(s.expense) === 0) ? (
              <EmptyState title="No cashflow yet" body="Log income and expenses to see the trend." />
            ) : (
              <CashflowChart series={series} locale={locale} />
            )}
          </Card>

          <Card style={{ gridColumn: '1 / -1' }}>
            <div className="section-label">Spending this month</div>
            <CategoryBars rows={categories} locale={locale} />
          </Card>
        </div>
      ) : null}

      {tab === 'cashflow' ? (
        <div className="flex-col">
          <Card>
            <div className="section-label">Income vs expense</div>
            <CashflowChart series={series} locale={locale} />
          </Card>
          <Card>
            <div className="section-label">Categories</div>
            <CategoryBars rows={categories} locale={locale} />
          </Card>
        </div>
      ) : null}

      {tab === 'debts' ? (
        <div className="flex-col">
          <Card>
            <div className="section-label">Loan position</div>
            <Money value={loanSummary.net.toFixed(2)} currency={preferred} size="xl" tone={loanSummary.net >= 0 ? 'positive' : 'negative'} locale={locale} />
            <div className="card-row" style={{ marginTop: 8 }}>
              <span style={{ color: 'var(--success)', fontSize: 12, fontWeight: 700 }}>Owed to you {formatMoney(loanSummary.recv.toFixed(2), preferred, locale)}</span>
              <span style={{ color: 'var(--warning)', fontSize: 12, fontWeight: 700 }}>You owe {formatMoney(loanSummary.pay.toFixed(2), preferred, locale)}</span>
            </div>
            {overview?.debt_service_ratio != null ? (
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Expense / income this month {(overview.debt_service_ratio * 100).toFixed(0)}%</div>
            ) : null}
          </Card>
          <Card>
            <div className="section-label">People</div>
            {friends.length === 0 ? (
              <EmptyState title="No people yet" body="Friend balances appear after shared loans." />
            ) : (
              friends.map((f) => (
                <div key={f.name} className="flex-col" style={{ gap: 6, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
                  <div className="card-row">
                    <span style={{ fontWeight: 700 }}>{f.name}</span>
                    <Money value={f.net.toFixed(2)} currency={preferred} size="sm" tone={f.net >= 0 ? 'positive' : 'negative'} locale={locale} />
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${Math.max(6, Math.round((Math.abs(f.net) / friendMax) * 100))}%`, background: f.net >= 0 ? 'var(--success)' : 'var(--warning)' }} />
                  </div>
                </div>
              ))
            )}
          </Card>
        </div>
      ) : null}

      {tab === 'goals' ? (
        <Card>
          <div className="section-label">Goal funding</div>
          {goals.length === 0 ? (
            <EmptyState title="No goals yet" body="Create goals under Plan to track funding here." />
          ) : (
            goals.map((g) => {
              const pct = Math.min(100, Math.max(0, Math.round(g.progress_percent || 0)));
              return (
                <div key={g.id} className="flex-col" style={{ gap: 6, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
                  <div className="card-row">
                    <span style={{ fontWeight: 700 }}>{g.title}</span>
                    <span style={{ color: 'var(--primary)', fontWeight: 700, fontSize: 13 }}>{pct}%</span>
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${Math.max(pct > 0 ? 4 : 0, pct)}%`, background: g.status === 'completed' ? 'var(--success)' : 'var(--primary)' }} />
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {formatMoney(g.current_amount, g.currency_code, locale)} / {formatMoney(g.target_amount, g.currency_code, locale)}
                    {g.eta_months != null && g.status === 'active' ? ` · ~${g.eta_months} mo` : ''}
                  </div>
                </div>
              );
            })
          )}
        </Card>
      ) : null}

      {tab === 'analysis' ? (
        <Card>
          <div className="card-row">
            <div className="section-label">Analyst</div>
            <div className="flex-row">
              <button
                className="link-btn"
                onClick={async () => {
                  if (!token) return;
                  try {
                    await api.clearAIInsights(token);
                    setInsights([]);
                    setCoachMessages([]);
                  } catch (e) {
                    showError(e instanceof Error ? e.message : 'Could not clear');
                  }
                }}
              >
                Clear
              </button>
              <button className="link-btn" onClick={onRefreshInsights}>
                Refresh
              </button>
            </div>
          </div>
          {insights.length === 0 ? (
            <EmptyState title="No cards yet" body="Tap Refresh to run rule-based analysis on this month's numbers." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {insights.map((card) => (
                <div
                  key={card.id}
                  style={{
                    padding: '14px 16px',
                    borderRadius: 14,
                    background: 'var(--surface-muted)',
                    border: '1px solid var(--border)',
                    borderLeft: `3px solid ${
                      card.severity === 'critical' || card.severity === 'warning'
                        ? 'var(--warning)'
                        : card.severity === 'positive'
                          ? 'var(--success)'
                          : 'var(--primary)'
                    }`,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: 0.4,
                      color:
                        card.severity === 'critical' || card.severity === 'warning'
                          ? 'var(--warning)'
                          : card.severity === 'positive'
                            ? 'var(--success)'
                            : 'var(--muted)',
                    }}
                  >
                    {card.severity} · {card.theme}
                    {card.source?.includes('llm') ? ' · AI' : ''}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 16, marginTop: 4 }}>{card.title}</div>
                  <RichText text={card.body} muted />
                </div>
              ))}
            </div>
          )}
          <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>
            {disclaimer || 'Lony insights are educational estimates, not credit scores, investment advice, or guaranteed outcomes.'}
          </div>
        </Card>
      ) : null}

      {tab === 'reports' ? (
        <Card>
          <div className="card-row">
            <div className="section-label">Visualizer</div>
            <button className="link-btn" onClick={onLoadReport} disabled={reportBusy}>
              {reportBusy ? 'Building…' : report ? 'Refresh' : 'Build report'}
            </button>
          </div>
          {!report ? (
            <EmptyState title="No report yet" body="Build a period pack with cashflow charts, category bars, and captions." />
          ) : (
            <div className="flex-col">
              <p>{report.summary}</p>
              {report.source === 'llm_visualizer' ? <div className="muted" style={{ fontSize: 11 }}>Captions AI-assisted</div> : null}
              {report.charts.map((chart) => {
                const seriesData = (chart.data?.series as InsightsMonthPoint[] | undefined) ?? [];
                const catData = (chart.data?.categories as InsightsCategoryPoint[] | undefined) ?? [];
                return (
                  <div key={chart.id} className="flex-col" style={{ gap: 6 }}>
                    <div style={{ fontWeight: 700 }}>{chart.title}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{chart.caption}</div>
                    {chart.type === 'grouped_bar' && seriesData.length > 0 ? <CashflowChart series={seriesData} locale={locale} /> : null}
                    {chart.type === 'bar' && catData.length > 0 ? <CategoryBars rows={catData} locale={locale} /> : null}
                    {chart.type === 'kpi' ? (
                      <div className="flex-row" style={{ flexWrap: 'wrap', gap: 12 }}>
                        <Mini label="Income" value={formatMoney(String(chart.data?.income ?? ''), report.currency_code, locale)} />
                        <Mini label="Expense" value={formatMoney(String(chart.data?.expense ?? ''), report.currency_code, locale)} />
                        <Mini label="Net" value={formatMoney(String(chart.data?.net ?? ''), report.currency_code, locale)} />
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {(report.tables ?? []).map((table) => (
                <div key={table.id} className="table-wrap">
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>{table.title}</div>
                  <table className="data-table">
                    <thead>
                      <tr>
                        {table.columns.map((col) => (
                          <th key={col}>{col.replace(/_/g, ' ')}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.slice(0, 8).map((row, idx) => (
                        <tr key={`${table.id}-${idx}`}>
                          {row.map((cell, ci) => (
                            <td key={`${table.id}-${idx}-${ci}`}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
              <div className="muted" style={{ fontSize: 11 }}>{report.disclaimer || disclaimer}</div>
            </div>
          )}
        </Card>
      ) : null}

      {tab === 'coach' ? (
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 14,
                background: 'var(--primary-soft)',
                color: 'var(--primary)',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 800,
                fontSize: 18,
              }}
            >
              ✦
            </div>
            <div>
              <div className="section-label" style={{ margin: 0 }}>Coach</div>
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                Cut spending, debt health, score tips — never new borrowing.
              </p>
            </div>
          </div>
          {coachMessages.length === 0 ? (
            <div
              style={{
                padding: 16,
                borderRadius: 14,
                background: 'var(--surface-muted)',
                border: '1px solid var(--border)',
                marginBottom: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 14 }}>Try asking</div>
              {[
                'Where can I cut spending this month?',
                'How does my debt look?',
                'Am I on track for my goals?',
              ].map((q) => (
                <button
                  key={q}
                  type="button"
                  className="pill pill-muted"
                  style={{ cursor: 'pointer', border: '1px solid var(--border)', textAlign: 'left' }}
                  onClick={() => setCoachMsg(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex-col" style={{ marginBottom: 12, gap: 10 }}>
              {coachMessages.map((m) => {
                const isUser = m.role === 'user';
                return (
                  <div
                    key={m.id}
                    style={{
                      alignSelf: isUser ? 'flex-end' : 'flex-start',
                      maxWidth: '85%',
                      background: isUser ? 'var(--primary)' : 'var(--surface-muted)',
                      color: isUser ? 'var(--on-primary)' : 'var(--text)',
                      borderRadius: isUser ? '18px 18px 6px 18px' : '16px 16px 16px 6px',
                      padding: '10px 14px',
                      border: isUser ? 'none' : '1px solid var(--border)',
                    }}
                  >
                    {!isUser ? (
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
                        Coach
                      </div>
                    ) : null}
                    {isUser ? (
                      <div style={{ fontSize: 14, lineHeight: 1.45 }}>{m.content}</div>
                    ) : m.content ? (
                      <RichText text={m.content} />
                    ) : (
                      <div className="muted" style={{ fontSize: 13 }}>Thinking…</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {coachActions.length > 0 ? (
            <div className="flex-row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {coachActions.map((a) => {
                const route = routeForCoachDeepLink(a.deep_link);
                return (
                  <button
                    key={`${a.label}-${a.deep_link}`}
                    type="button"
                    className="pill pill-muted"
                    style={{ cursor: route ? 'pointer' : 'default', border: 'none' }}
                    disabled={!route}
                    onClick={() => {
                      if (route) navigate(route);
                    }}
                  >
                    {a.label}
                  </button>
                );
              })}
            </div>
          ) : null}
          <Field label="Your question" value={coachMsg} onChange={setCoachMsg} placeholder="Where can I cut spending?" />
          <Button onClick={onAskCoach} disabled={coachBusy || !coachMsg.trim()} busy={coachBusy}>
            {coachBusy ? 'Thinking…' : 'Ask Coach'}
          </Button>
          <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>
            {disclaimer || 'Lony insights are educational estimates, not credit scores, investment advice, or guaranteed outcomes.'}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
