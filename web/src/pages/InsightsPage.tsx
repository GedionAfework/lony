import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Leaf, Lightbulb, RefreshCw, Send, Sparkles, Tag, Trash2, TrendingUp, Users } from 'lucide-react';
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
  isPremiumPlan,
} from '../lib/api';
import { formatMoney } from '../lib/format';
import { Card } from '../components/Card';
import { Segmented } from '../components/Segmented';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { RichText } from '../components/RichText';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { CategoryIcon, Hero, HeroStat, Initials, SectionHead, hueFor } from '../components/Visuals';
import { BrandLoader } from '../components/BrandLoader';

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

/** Month-over-month change as a small coloured chip. `goodWhenUp` flips the colour for spending. */
function Change({ value, goodWhenUp }: { value: number | null | undefined; goodWhenUp: boolean }) {
  if (value == null || !Number.isFinite(value) || Math.round(value) === 0) return <span className="chg flat">same as last month</span>;
  const up = value > 0;
  const good = up === goodWhenUp;
  return (
    <span className={`chg ${good ? 'good' : 'bad'}`}>
      {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
      {Math.abs(Math.round(value))}% vs last month
    </span>
  );
}

function monthName(ym: string, locale?: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleDateString(locale || 'en', { month: 'short' });
}

function CashflowChart({ series, locale, currency }: { series: InsightsMonthPoint[]; locale?: string; currency?: string }) {
  const data = series.map((s) => ({ month: monthName(s.month, locale), income: Number(s.income) || 0, expense: Number(s.expense) || 0, net: Number(s.net) || 0 }));
  const compact = (v: number) => new Intl.NumberFormat(locale || 'en', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
  return (
    <div className="chart-box">
      <div className="chart-legend">
        <span>
          <i style={{ background: 'var(--success)' }} /> Money in
        </span>
        <span>
          <i style={{ background: 'var(--secondary)' }} /> Money out
        </span>
        <span>
          <i className="line" style={{ background: 'var(--primary)' }} /> Left over
        </span>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} barGap={6} barCategoryGap="30%" margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--success)" stopOpacity={0.95} />
              <stop offset="100%" stopColor="var(--success)" stopOpacity={0.55} />
            </linearGradient>
            <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--secondary)" stopOpacity={0.95} />
              <stop offset="100%" stopColor="var(--secondary)" stopOpacity={0.55} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 12, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={44} tickFormatter={compact} />
          <Tooltip
            cursor={{ fill: 'color-mix(in srgb, var(--text) 5%, transparent)', radius: 10 }}
            contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, fontSize: 12.5, boxShadow: 'var(--shadow-lg)', padding: '10px 12px' }}
            labelStyle={{ fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}
            formatter={(v, name) => [formatMoney(String(Number(v) || 0), currency, locale), name === 'income' ? 'Money in' : name === 'expense' ? 'Money out' : 'Left over']}
          />
          <Bar dataKey="income" fill="url(#gIn)" radius={[8, 8, 3, 3]} maxBarSize={30} />
          <Bar dataKey="expense" fill="url(#gOut)" radius={[8, 8, 3, 3]} maxBarSize={30} />
          <Line dataKey="net" type="monotone" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 3.5, fill: 'var(--surface)', stroke: 'var(--primary)', strokeWidth: 2 }} activeDot={{ r: 5 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** A ring with the categories as coloured slices, total in the middle. */
function Donut({ rows, total, label }: { rows: { key: string; value: number; color: string }[]; total: string; label: string }) {
  const sum = rows.reduce((n, r) => n + r.value, 0) || 1;
  const r = 52;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="donut">
      <svg viewBox="0 0 140 140" aria-hidden="true">
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--surface-muted)" strokeWidth="16" />
        {rows.map((row) => {
          const len = (row.value / sum) * c;
          const gap = rows.length > 1 ? Math.min(3, len / 3) : 0;
          const el = (
            <circle
              key={row.key}
              cx="70"
              cy="70"
              r={r}
              fill="none"
              stroke={row.color}
              strokeWidth="16"
              strokeLinecap="butt"
              strokeDasharray={`${Math.max(0, len - gap)} ${c}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 70 70)"
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="donut-center">
        <small>{label}</small>
        <strong>{total}</strong>
      </div>
    </div>
  );
}

function CategoryBreakdown({ rows, locale, currency }: { rows: InsightsCategoryPoint[]; locale?: string; currency: string }) {
  if (rows.length === 0) return <EmptyState title="No spending yet" body="Your categories appear here once you add expenses." />;
  const top = rows.slice(0, 7);
  const total = rows.reduce((n, r) => n + (Number(r.amount) || 0), 0);
  return (
    <div className="breakdown">
      <Donut
        rows={top.map((r) => ({ key: r.category, value: Number(r.amount) || 0, color: hueFor(r.category) }))}
        total={formatMoney(total.toFixed(2), currency, locale)}
        label="Spent"
      />
      <div className="cat-list">
        {top.map((row) => (
          <div key={row.category} className="cat-row">
            <CategoryIcon category={row.category} kind="expense" size={36} />
            <div className="cat-main">
              <div className="cat-top">
                <span>{row.category}</span>
                <strong>{formatMoney(row.amount, row.currency_code, locale)}</strong>
              </div>
              <div className="cat-track">
                <div style={{ width: `${Math.max(3, Math.round(row.share_percent))}%`, background: hueFor(row.category) }} />
              </div>
            </div>
            <span className="cat-pct">{row.share_percent.toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const FACTORS: { key: keyof LonyScore; label: string; help: string }[] = [
  { key: 'repayment_score', label: 'Repayment', help: 'Paying people back on time' },
  { key: 'debt_score', label: 'Debt', help: 'How much you owe vs. earn' },
  { key: 'consistency_score', label: 'Consistency', help: 'Steady income and spending' },
  { key: 'liquidity_score', label: 'Cushion', help: 'Cash you could reach quickly' },
  { key: 'savings_score', label: 'Savings', help: 'Share of income you keep' },
  { key: 'goals_score', label: 'Goals', help: 'Progress on your plans' },
];

function ScoreRing({ points, grade }: { points: number; grade: string }) {
  const pct = Math.max(0, Math.min(100, points));
  const r = 54;
  const c = 2 * Math.PI * r;
  const arc = c * 0.75;
  return (
    <div className="score-ring">
      <svg viewBox="0 0 140 140" aria-hidden="true">
        <defs>
          <linearGradient id="gScore" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--secondary)" />
            <stop offset="55%" stopColor="var(--primary)" />
            <stop offset="100%" stopColor="var(--success)" />
          </linearGradient>
        </defs>
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--surface-muted)" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${arc} ${c}`} transform="rotate(135 70 70)" />
        <circle cx="70" cy="70" r={r} fill="none" stroke="url(#gScore)" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${(arc * pct) / 100} ${c}`} transform="rotate(135 70 70)" />
      </svg>
      <div className="score-center">
        <strong>{grade}</strong>
        <small>{Math.round(pct)} / 100</small>
      </div>
    </div>
  );
}

const SEVERITY: Record<string, { icon: typeof Lightbulb; cls: string; label: string }> = {
  critical: { icon: AlertTriangle, cls: 'bad', label: 'Needs attention' },
  warning: { icon: AlertTriangle, cls: 'warn', label: 'Heads up' },
  positive: { icon: TrendingUp, cls: 'good', label: 'Going well' },
  info: { icon: Lightbulb, cls: 'info', label: 'Tip' },
};

export function InsightsPage() {
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const { showError } = useToast();
  const confirm = useConfirm();
  const preferred = (user?.default_currency_code || '').toUpperCase();
  const locale = user?.locale || 'en';
  const isPremium = isPremiumPlan(user);

  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<InsightsOverview | null>(null);
  const [series, setSeries] = useState<InsightsMonthPoint[]>([]);
  const [categories, setCategories] = useState<InsightsCategoryPoint[]>([]);
  const [goals, setGoals] = useState<InsightsGoal[]>([]);
  const [lonyScore, setLonyScore] = useState<LonyScore | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [rates, setRates] = useState<Record<string, number>>({});
  const [insights, setInsights] = useState<AIInsight[]>([]);
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
        }
        const thread = await api.getCoachThread(token).catch(() => null);
        if (thread?.thread?.messages) setCoachMessages(thread.thread.messages);
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not load insights');
    }
  }, [token, preferred, isPremium, showError]);

  const [booted, setBooted] = useState(false);
  useEffect(() => {
    void reload().finally(() => setBooted(true));
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
    { id: 'cashflow', label: 'Spending' },
    { id: 'debts', label: 'Loans' },
    { id: 'goals', label: 'Plans' },
    ...(isPremium
      ? ([
          { id: 'analysis', label: 'Tips' },
          { id: 'coach', label: 'Ask Lony' },
          { id: 'reports', label: 'Reports' },
        ] as { id: Tab; label: string }[])
      : []),
  ];

  async function onRefreshInsights() {
    if (!token || !preferred) return;
    try {
      const [ai, sc] = await Promise.all([api.refreshAIInsights(token, preferred), api.getScore(token, preferred, true)]);
      setInsights(ai.insights ?? []);
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
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not build report');
    } finally {
      setReportBusy(false);
    }
  }

  async function onAskCoach(asked?: string) {
    const question = (asked ?? coachMsg).trim();
    if (!token || !preferred || !question || coachBusy) return;
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

  const incomeNum = Number(overview?.income || 0);
  const spentNum = Number(overview?.expense || 0);
  const netNum = Number(overview?.net || 0);
  const savingsRate = overview?.savings_rate_percent;
  const spentMonths = series.map((m) => Number(m.expense) || 0).filter((v) => v > 0);
  const avgSpend = spentMonths.length ? spentMonths.reduce((a, b) => a + b, 0) / spentMonths.length : 0;

  // Plain-language takeaways built from the numbers on this page.
  const takeaways = useMemo(() => {
    const out: { tone: 'good' | 'bad' | 'info'; text: string }[] = [];
    if (incomeNum > 0) {
      const share = Math.round((spentNum / incomeNum) * 100);
      out.push(
        share <= 80
          ? { tone: 'good', text: `You spent ${share}% of what you earned this month, so you kept the rest.` }
          : share <= 100
            ? { tone: 'info', text: `You spent ${share}% of what you earned. Not much left to save this month.` }
            : { tone: 'bad', text: `You spent ${share - 100}% more than you earned this month.` },
      );
    } else if (spentNum > 0) {
      out.push({ tone: 'info', text: `You've spent ${formatMoney(spentNum.toFixed(2), preferred, locale)} and no income is recorded yet this month.` });
    }
    const top = categories[0];
    if (top && top.share_percent >= 1) {
      out.push({ tone: 'info', text: `${top.category} is your biggest cost: ${top.share_percent.toFixed(0)}% of your spending.` });
    }
    const mom = overview?.expense_mom_percent;
    if (mom != null && Number.isFinite(mom) && Math.abs(mom) >= 10) {
      out.push(mom > 0 ? { tone: 'bad', text: `Spending is up ${Math.round(mom)}% on last month.` } : { tone: 'good', text: `Spending is down ${Math.round(-mom)}% on last month. Nice.` });
    }
    if (loanSummary.recv > 0) {
      out.push({ tone: 'info', text: `People owe you ${formatMoney(loanSummary.recv.toFixed(2), preferred, locale)} in open loans.` });
    }
    if ((overview?.active_goals ?? 0) > 0 && overview?.goals_progress_avg != null) {
      out.push({ tone: 'good', text: `Your ${overview.active_goals} plan${overview.active_goals === 1 ? ' is' : 's are'} ${Math.round(overview.goals_progress_avg)}% funded on average.` });
    }
    return out.slice(0, 4);
  }, [incomeNum, spentNum, categories, overview, loanSummary.recv, preferred, locale]);

  const coachEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    coachEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [coachMessages]);

  // Lony's loading screen until the first load lands, instead of a page of zeros.
  if (!booted) return <BrandLoader />;

  if (!preferred) {
    return (
      <div className="page">
        <div className="page-head">
          <h1 className="page-title">Insights</h1>
        </div>
        <Card>
          <EmptyState title="Pick your currency" body="Choose a default currency in Settings so your insights add up in one money." />
        </Card>
      </div>
    );
  }

  const monthLabel = new Date().toLocaleDateString(locale, { month: 'long' });
  const heroSentence =
    incomeNum === 0 && spentNum === 0
      ? 'Add income and expenses to see how your month is going.'
      : netNum >= 0
        ? `You kept ${savingsRate != null ? `${Math.round(savingsRate)}%` : 'some'} of your income in ${monthLabel}.`
        : `You spent more than you earned in ${monthLabel}.`;

  return (
    <div className="page insights">
      <div className="page-head">
        <div>
          <h1 className="page-title">Insights</h1>
          <div className="page-subtitle muted">How your money is doing, in plain words.</div>
        </div>
        {!isPremium ? (
          <button type="button" className="premium-chip" onClick={() => navigate('/settings/plan')}>
            <Sparkles size={13} /> Unlock AI tips & chat with Plus
          </button>
        ) : null}
      </div>

      <Hero
        label={`Left over in ${monthLabel}`}
        value={`${netNum < 0 ? '−' : ''}${formatMoney(Math.abs(netNum).toFixed(2), preferred, locale)}`}
        sub={heroSentence}
        aside={
          <>
            <div className="hero-stat stacked">
              <small>Money in</small>
              <strong>{formatMoney(overview?.income ?? '0', preferred, locale)}</strong>
              <Change value={overview?.income_mom_percent} goodWhenUp />
            </div>
            <div className="hero-stat stacked">
              <small>Money out</small>
              <strong>{formatMoney(overview?.expense ?? '0', preferred, locale)}</strong>
              <Change value={overview?.expense_mom_percent} goodWhenUp={false} />
            </div>
          </>
        }
      />

      <div className="tabs-row">
        <Segmented value={tab} onChange={(v) => setTab(v as Tab)} options={tabs} />
      </div>

      {tab === 'overview' ? (
        <>

          <div className="kpi-strip">
            <div className="kpi-tile">
              <span className="kpi-ico good"><Leaf size={16} /></span>
              <small>Saved</small>
              <strong>{savingsRate != null ? `${Math.round(savingsRate)}%` : '—'}</strong>
            </div>
            <div className="kpi-tile">
              <span className="kpi-ico warn"><TrendingUp size={16} /></span>
              <small>Avg. monthly spend</small>
              <strong>{avgSpend > 0 ? formatMoney(avgSpend.toFixed(0), preferred, locale) : '—'}</strong>
            </div>
            <div className="kpi-tile">
              <span className="kpi-ico"><Tag size={16} /></span>
              <small>Top category</small>
              <strong>{categories[0]?.category || '—'}</strong>
            </div>
            <div className="kpi-tile">
              <span className="kpi-ico info"><Users size={16} /></span>
              <small>Owed to you</small>
              <strong>{formatMoney(loanSummary.recv.toFixed(2), preferred, locale)}</strong>
            </div>
          </div>

          {takeaways.length > 0 ? (
            <div className="takeaways">
              {takeaways.map((t) => (
                <div key={t.text} className={`takeaway ${t.tone}`}>
                  <span className="takeaway-icon">
                    {t.tone === 'good' ? <TrendingUp size={16} /> : t.tone === 'bad' ? <AlertTriangle size={16} /> : <Lightbulb size={16} />}
                  </span>
                  <p>{t.text}</p>
                </div>
              ))}
            </div>
          ) : null}

          <div className="grid grid-main-side">
            <Card>
              <SectionHead title="Last 6 months" sub="What came in, what went out, and what was left." />
              {series.every((s) => Number(s.income) === 0 && Number(s.expense) === 0) ? (
                <EmptyState title="No history yet" body="Your trend appears once you've added a few months of income and expenses." />
              ) : (
                <CashflowChart series={series} locale={locale} currency={preferred} />
              )}
            </Card>

            {lonyScore ? (
              <Card className="score-card">
                <SectionHead title="Lony Trust" sub="How reliable you look to people who lend to you." />
                <div className="score-top">
                  <ScoreRing points={Number(lonyScore.points) || 0} grade={lonyScore.grade} />
                  <div>
                    <div className="score-band">{lonyScore.band}</div>
                    <div className="muted" style={{ fontSize: 12.5 }}>
                      {lonyScore.thin_history ? 'Based on a short loan history so far.' : 'Built from your loans, spending and savings.'}
                    </div>
                  </div>
                </div>
                <div className="factors">
                  {FACTORS.map((f) => {
                    const v = Math.round(Number(lonyScore[f.key]) || 0);
                    return (
                      <div key={f.key} className="factor" title={f.help}>
                        <div className="factor-top">
                          <span>{f.label}</span>
                          <strong>{v}</strong>
                        </div>
                        <div className="cat-track">
                          <div style={{ width: `${Math.max(3, v)}%`, background: v >= 70 ? 'var(--success)' : v >= 40 ? 'var(--primary)' : 'var(--secondary)' }} />
                        </div>
                        <small>{f.help}</small>
                      </div>
                    );
                  })}
                </div>
              </Card>
            ) : (
              <Card>
                <SectionHead title="Savings rate" sub="The share of your income you didn't spend." />
                <div className="big-stat">{savingsRate != null ? `${Math.round(savingsRate)}%` : '—'}</div>
              </Card>
            )}
          </div>

          <Card>
            <SectionHead title={`Where your money went in ${monthLabel}`} sub="Your spending by category." />
            <CategoryBreakdown rows={categories} locale={locale} currency={preferred} />
          </Card>
        </>
      ) : null}

      {tab === 'cashflow' ? (
        <div className="flex-col gap-lg">
          <Card>
            <SectionHead title="Money in vs. money out" sub="Six months side by side. The line shows what was left each month." />
            <CashflowChart series={series} locale={locale} currency={preferred} />
          </Card>
          <Card>
            <SectionHead title="Spending by category" sub={`This month, ${monthLabel}.`} />
            <CategoryBreakdown rows={categories} locale={locale} currency={preferred} />
          </Card>
        </div>
      ) : null}

      {tab === 'debts' ? (
        <div className="flex-col gap-lg">
          <Hero
            label="Your loan balance"
            value={`${loanSummary.net < 0 ? '−' : ''}${formatMoney(Math.abs(loanSummary.net).toFixed(2), preferred, locale)}`}
            sub={
              loanSummary.recv === 0 && loanSummary.pay === 0
                ? 'No open loans right now.'
                : loanSummary.net >= 0
                  ? 'Overall, people owe you more than you owe them.'
                  : 'Overall, you owe more than people owe you.'
            }
            aside={
              <>
                <HeroStat label="Owed to you" value={formatMoney(loanSummary.recv.toFixed(2), preferred, locale)} tone="up" />
                <HeroStat label="You owe" value={formatMoney(loanSummary.pay.toFixed(2), preferred, locale)} tone="down" />
              </>
            }
          />
          <Card>
            <SectionHead title="By person" sub="Green: they owe you. Orange: you owe them." />
            {friends.length === 0 ? (
              <EmptyState title="No one yet" body="Balances with friends show up after you share a loan or split a bill." />
            ) : (
              friends.map((f) => (
                <div key={f.name} className="person-row">
                  <Initials name={f.name} size={40} />
                  <div className="cat-main">
                    <div className="cat-top">
                      <span>{f.name}</span>
                      <strong style={{ color: f.net >= 0 ? 'var(--success)' : 'var(--secondary)' }}>
                        {f.net >= 0 ? 'Owes you ' : 'You owe '}
                        {formatMoney(Math.abs(f.net).toFixed(2), preferred, locale)}
                      </strong>
                    </div>
                    <div className="cat-track">
                      <div style={{ width: `${Math.max(4, Math.round((Math.abs(f.net) / friendMax) * 100))}%`, background: f.net >= 0 ? 'var(--success)' : 'var(--secondary)' }} />
                    </div>
                  </div>
                </div>
              ))
            )}
          </Card>
        </div>
      ) : null}

      {tab === 'goals' ? (
        goals.length === 0 ? (
          <Card>
            <EmptyState
              title="No plans yet"
              body="Make a plan for a trip, a purchase or savings and watch it fill up here."
              action={
                <Button onClick={() => navigate('/plan')} style={{ marginTop: 8 }}>
                  Make a plan
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="goal-grid">
            {goals.map((g) => {
              const pct = Math.min(100, Math.max(0, Math.round(g.progress_percent || 0)));
              const done = g.status === 'completed' || pct >= 100;
              return (
                <button key={g.id} type="button" className="goal-tile" onClick={() => navigate('/plan')}>
                  <ScoreRing points={pct} grade={`${pct}%`} />
                  <div className="goal-tile-text">
                    <strong>{g.title}</strong>
                    <span>
                      {formatMoney(g.current_amount, g.currency_code, locale)} of {formatMoney(g.target_amount, g.currency_code, locale)}
                    </span>
                    <small className={done ? 'good' : ''}>
                      {done ? 'Fully funded' : g.eta_months != null && g.status === 'active' ? `About ${g.eta_months} month${g.eta_months === 1 ? '' : 's'} to go at your pace` : 'Keep adding to it'}
                    </small>
                  </div>
                </button>
              );
            })}
          </div>
        )
      ) : null}

      {tab === 'analysis' ? (
        <Card>
          <SectionHead
            title="Tips for you"
            sub="Lony looks at this month's numbers and points out what matters."
            action={
              <div className="flex-row" style={{ gap: 6 }}>
                {insights.length > 0 ? (
                  <button
                    className="icon-btn sm ghost"
                    title="Clear tips"
                    aria-label="Clear tips"
                    onClick={async () => {
                      if (!token) return;
                      const ok = await confirm({ title: 'Clear AI insights?', body: 'Your saved tips and chat are removed.', confirmLabel: 'Clear', tone: 'danger' });
                      if (!ok) return;
                      try {
                        await api.clearAIInsights(token);
                        setInsights([]);
                        setCoachMessages([]);
                      } catch (e) {
                        showError(e instanceof Error ? e.message : 'Could not clear');
                      }
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                ) : null}
                <Button size="sm" variant="secondary" onClick={onRefreshInsights}>
                  <RefreshCw size={14} /> Refresh
                </Button>
              </div>
            }
          />
          {insights.length === 0 ? (
            <EmptyState icon={<Lightbulb size={24} />} title="No tips yet" body="Tap Refresh and Lony will look over this month for you." />
          ) : (
            <div className="tip-list">
              {insights.map((card) => {
                const sev = SEVERITY[card.severity] ?? SEVERITY.info;
                const Icon = sev.icon;
                return (
                  <div key={card.id} className={`tip ${sev.cls}`}>
                    <span className="tip-icon">
                      <Icon size={18} />
                    </span>
                    <div className="tip-body">
                      <div className="tip-kicker">
                        {sev.label}
                        {card.theme ? ` · ${card.theme.replace(/_/g, ' ')}` : ''}
                        {card.source?.includes('llm') ? ' · AI' : ''}
                      </div>
                      <div className="tip-title">{card.title}</div>
                      <RichText text={card.body} muted />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      ) : null}

      {tab === 'reports' ? (
        <Card>
          <SectionHead
            title="Your 6-month report"
            sub="Charts and short notes you can read in a minute."
            action={
              <Button size="sm" variant={report ? 'secondary' : 'primary'} onClick={onLoadReport} busy={reportBusy}>
                {reportBusy ? 'Building…' : report ? 'Rebuild' : 'Build report'}
              </Button>
            }
          />
          {!report ? (
            <EmptyState title="No report yet" body="Build one to get a summary of the last six months." />
          ) : (
            <div className="flex-col gap-lg">
              <p className="report-summary">{report.summary}</p>
              {report.charts.map((chart) => {
                const seriesData = (chart.data?.series as InsightsMonthPoint[] | undefined) ?? [];
                const catData = (chart.data?.categories as InsightsCategoryPoint[] | undefined) ?? [];
                return (
                  <div key={chart.id} className="report-block">
                    <div className="report-title">{chart.title}</div>
                    {chart.caption ? <div className="muted" style={{ fontSize: 13 }}>{chart.caption}</div> : null}
                    {chart.type === 'grouped_bar' && seriesData.length > 0 ? <CashflowChart series={seriesData} locale={locale} currency={report.currency_code} /> : null}
                    {chart.type === 'bar' && catData.length > 0 ? <CategoryBreakdown rows={catData} locale={locale} currency={report.currency_code} /> : null}
                    {chart.type === 'kpi' ? (
                      <div className="kpi-row">
                        {(['income', 'expense', 'net'] as const).map((k) => (
                          <div key={k} className="kpi">
                            <small>{k === 'income' ? 'Money in' : k === 'expense' ? 'Money out' : 'Left over'}</small>
                            <strong>{formatMoney(String(chart.data?.[k] ?? ''), report.currency_code, locale)}</strong>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {(report.tables ?? []).map((table) => (
                <div key={table.id} className="report-block">
                  <div className="report-title">{table.title}</div>
                  <div className="table-wrap">
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
                </div>
              ))}
              {report.source === 'llm_visualizer' ? <div className="muted" style={{ fontSize: 12 }}>Notes written with AI help.</div> : null}
            </div>
          )}
        </Card>
      ) : null}

      {tab === 'coach' ? (
        <Card className="coach">
          <SectionHead title="Ask Lony" sub="Questions about your money, answered from your own numbers." />
          <div className="coach-thread">
            {coachMessages.length === 0 ? (
              <div className="coach-empty">
                <span className="coach-orb">
                  <Sparkles size={22} />
                </span>
                <strong>What would you like to know?</strong>
                <div className="coach-suggestions">
                  {['Where can I cut spending this month?', 'How does my debt look?', 'Am I on track for my goals?', 'How much can I save next month?'].map((q) => (
                    <button key={q} type="button" onClick={() => void onAskCoach(q)}>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              coachMessages.map((m) => {
                const isUser = m.role === 'user';
                return (
                  <div key={m.id} className={`coach-msg ${isUser ? 'me' : 'ai'}`}>
                    {!isUser ? (
                      <span className="coach-avatar">
                        <Sparkles size={13} />
                      </span>
                    ) : null}
                    <div className="coach-bubble">
                      {isUser ? m.content : m.content ? <RichText text={m.content} /> : <span className="typing"><i /><i /><i /></span>}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={coachEnd} />
          </div>
          {coachActions.length > 0 ? (
            <div className="coach-actions">
              {coachActions.map((a) => {
                const route = routeForCoachDeepLink(a.deep_link);
                return (
                  <button key={`${a.label}-${a.deep_link}`} type="button" disabled={!route} onClick={() => route && navigate(route)}>
                    {a.label} <ArrowUpRight size={13} />
                  </button>
                );
              })}
            </div>
          ) : null}
          <form
            className="coach-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void onAskCoach();
            }}
          >
            <input value={coachMsg} onChange={(e) => setCoachMsg(e.target.value)} placeholder="Ask about your spending, loans or plans…" aria-label="Your question" />
            <button type="submit" className="coach-send" disabled={coachBusy || !coachMsg.trim()} aria-label="Send">
              {coachBusy ? <span className="spinner" /> : <Send size={17} />}
            </button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
