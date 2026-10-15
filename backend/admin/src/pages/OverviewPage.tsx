import { useCallback, useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  ArrowLeftRight,
  Bot,
  CalendarClock,
  Coins,
  LayoutDashboard,
  Power,
  ServerCrash,
  Sparkles,
  UserCheck,
  UserPlus,
  UserX,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { api, type DayCount, type Overview } from '../api';
import { useAuth } from '../auth';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { ChartCard } from '../components/ChartCard';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { PermissionGate } from '../components/PermissionGate';

const TEAL = '#1FA8A8';
const LIME = '#A3E635';
const AMBER = '#D97706';
const ROSE = '#DC2626';
const SLATE = '#94A3B8';

export function OverviewPage() {
  const { token } = useAuth();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [signups, setSignups] = useState<DayCount[]>([]);
  const [aiDisabled, setAIDisabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiBusy, setAIBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [ov, settings] = await Promise.all([
        api.overview(token),
        api.getSettings(token).catch(() => null),
      ]);
      setOverview(ov.overview);
      setSignups(ov.signups_by_day ?? []);
      if (settings) setAIDisabled(Boolean(settings.settings?.ai_disabled));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load overview');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleAI() {
    if (!token) return;
    setAIBusy(true);
    try {
      const res = await api.setAIDisabled(token, !aiDisabled);
      setAIDisabled(Boolean(res.settings?.ai_disabled));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update AI setting');
    } finally {
      setAIBusy(false);
    }
  }

  if (loading && !overview) {
    return (
      <div className="page">
        <PageHeader icon={LayoutDashboard} title="Overview" subtitle="Platform health at a glance" />
        <div className="skeleton-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton skeleton-card" />
          ))}
        </div>
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="page">
        <PageHeader icon={LayoutDashboard} title="Overview" subtitle="Platform health at a glance" />
        <div className="state-panel state-panel-error">
          <AlertTriangle size={30} strokeWidth={1.5} />
          <p>{error}</p>
          <Button onClick={() => void load()}>Retry</Button>
        </div>
      </div>
    );
  }

  if (!overview) return null;

  const hasSignupSeries = signups.some((d) => d.count > 0);
  const signupSeries = hasSignupSeries
    ? signups.map((d) => ({ label: d.day.slice(5), full: d.day, count: d.count }))
    : [
        { label: '7d', full: '7d', count: overview.signups_7d },
        { label: '30d', full: '30d', count: overview.signups_30d },
      ];
  const signupEmpty = !hasSignupSeries && overview.signups_7d === 0 && overview.signups_30d === 0;

  const accountMix = [
    { name: 'Active', value: overview.active_users, color: TEAL },
    { name: 'Suspended', value: Math.max(overview.suspended_users, 0), color: AMBER },
  ].filter((d) => d.value > 0);

  const engagement = [
    { name: 'DAU', value: overview.dau, fill: TEAL },
    { name: 'WAU', value: overview.wau, fill: LIME },
  ];

  const aiBars = [
    { name: 'Insights', value: overview.ai_insights_7d },
    { name: 'Runs', value: overview.ai_runs_7d ?? 0 },
    { name: 'Users', value: overview.ai_users_7d ?? 0 },
    { name: 'Today', value: overview.ai_requests_today ?? 0 },
  ];

  const loanHealth = [
    {
      name: 'Loans',
      open: overview.open_loans,
      overdue: overview.overdue_loans,
      fill: overview.open_loans ? Math.round(((overview.open_loans - overview.overdue_loans) / overview.open_loans) * 100) : 100,
    },
  ];

  const jobsTotal = (overview.jobs_failed ?? 0) + (overview.jobs_pending ?? 0);
  const jobsMix = [
    { name: 'Failed', value: overview.jobs_failed ?? 0, color: ROSE },
    { name: 'Pending', value: overview.jobs_pending ?? 0, color: SLATE },
  ].filter((d) => d.value > 0);

  return (
    <div className="page">
      <PageHeader
        icon={LayoutDashboard}
        title="Overview"
        subtitle="Platform health at a glance"
        actions={
          <PermissionGate perm="settings.ai">
            <Button
              variant={aiDisabled ? 'primary' : 'danger'}
              busy={aiBusy}
              icon={<Power size={15} strokeWidth={2} />}
              onClick={toggleAI}
            >
              {aiDisabled ? 'Enable AI' : 'Disable AI'}
            </Button>
          </PermissionGate>
        }
      />

      {error ? (
        <div className="alert alert-error">
          <AlertTriangle size={16} strokeWidth={2} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="overview-hero">
        <Card className="overview-users">
          <div className="overview-users-head">
            <div className="muted overview-users-label">Total users</div>
            <div className="overview-users-value">{overview.total_users.toLocaleString()}</div>
            <div className="overview-users-meta">
              <span>{overview.active_users} active</span>
              <span>{overview.suspended_users} suspended</span>
              <span>{overview.signups_7d} · 7d</span>
            </div>
          </div>

          <div className="overview-users-chart">
            {signupEmpty ? (
              <div className="overview-users-chart-empty muted">No signups yet</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={signupSeries} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="signupFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={TEAL} stopOpacity={0.4} />
                      <stop offset="100%" stopColor={TEAL} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Tooltip
                    cursor={{ stroke: TEAL, strokeWidth: 1, strokeDasharray: '4 4' }}
                    contentStyle={{
                      background: 'var(--surface)',
                      border: '1px solid var(--line)',
                      borderRadius: 10,
                      fontSize: 12,
                    }}
                    labelFormatter={(_, payload) => String(payload?.[0]?.payload?.full ?? '')}
                    formatter={(value) => [value as number, 'Signups']}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke={TEAL}
                    strokeWidth={2.5}
                    fill="url(#signupFill)"
                    activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }}
                    isAnimationActive
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <div className="overview-side-a">
          <StatCard icon={UserCheck} label="Active users" value={overview.active_users} tone="success" />
        </div>
        <div className="overview-side-b">
          <StatCard
            icon={UserX}
            label="Suspended"
            value={overview.suspended_users}
            tone={overview.suspended_users > 0 ? 'warning' : 'default'}
          />
        </div>
        <div className="overview-side-c">
          <StatCard icon={CalendarClock} label="DAU / WAU" value={`${overview.dau} / ${overview.wau}`} />
        </div>
        <div className="overview-side-d">
          <StatCard icon={UserPlus} label="Signups 30d" value={overview.signups_30d} />
        </div>
        <div className="overview-side-e">
          <StatCard icon={Sparkles} label="AI insights (7d)" value={overview.ai_insights_7d} />
        </div>
        <div className="overview-side-f">
          <StatCard
            icon={overview.fx_ok ? Wifi : WifiOff}
            label="FX rates"
            value={overview.fx_ok ? `OK · ${overview.fx_base || 'USD'}` : 'Down'}
            tone={overview.fx_ok ? 'success' : 'error'}
            hint={overview.fx_ok ? overview.fx_as_of : overview.fx_error || 'Provider unreachable'}
          />
        </div>

        <div className="overview-secondary">
          <StatCard
            icon={Bot}
            label="AI runs (7d)"
            value={overview.ai_runs_7d ?? 0}
            hint={`${overview.ai_users_7d ?? 0} active AI users`}
          />
          <StatCard
            icon={Coins}
            label="AI tokens (7d)"
            value={(overview.ai_tokens_7d ?? 0).toLocaleString()}
            hint={`${overview.ai_requests_today ?? 0} requests today`}
          />
          <StatCard
            icon={ArrowLeftRight}
            label="Cashflow (7d)"
            value={overview.cashflow_entries_7d}
          />
          <StatCard
            icon={AlertTriangle}
            label="Loan health"
            value={`${overview.open_loans} open`}
            hint={`${overview.overdue_loans} overdue`}
            tone={overview.overdue_loans > 0 ? 'warning' : 'default'}
          />
          <StatCard
            icon={ServerCrash}
            label="Jobs failed"
            value={overview.jobs_failed ?? 0}
            tone={(overview.jobs_failed ?? 0) > 0 ? 'error' : 'default'}
            hint={`${overview.jobs_pending ?? 0} pending`}
          />
        </div>
      </div>

      <div className="overview-charts">
        <ChartCard title="Account mix" subtitle="Active vs suspended" height={220}>
          {accountMix.length === 0 ? (
            <div className="chart-state chart-state-empty">
              <p>No accounts yet</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={accountMix}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={52}
                  outerRadius={78}
                  paddingAngle={3}
                  stroke="none"
                >
                  {accountMix.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: 'var(--surface)',
                    border: '1px solid var(--line)',
                    borderRadius: 10,
                    fontSize: 12,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Engagement" subtitle="Daily vs weekly active" height={220}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={engagement} barSize={36} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
              <YAxis hide allowDecimals={false} />
              <Tooltip
                cursor={{ fill: 'var(--surface-muted)' }}
                contentStyle={{
                  background: 'var(--surface)',
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="value" radius={[10, 10, 4, 4]}>
                {engagement.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="AI activity" subtitle="Last 7 days + today" height={220}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={aiBars} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="aiFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={LIME} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={LIME} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
              <YAxis hide allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  background: 'var(--surface)',
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  fontSize: 12,
                }}
              />
              <Area type="monotone" dataKey="value" stroke={TEAL} strokeWidth={2} fill="url(#aiFill)" activeDot={{ r: 5 }} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Loan health" subtitle="Open vs overdue share" height={220}>
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              data={loanHealth}
              innerRadius="48%"
              outerRadius="100%"
              startAngle={90}
              endAngle={-270}
            >
              <RadialBar
                dataKey="fill"
                background={{ fill: 'var(--surface-muted)' }}
                cornerRadius={10}
                fill={overview.overdue_loans > 0 ? AMBER : TEAL}
              />
              <Tooltip
                formatter={(value) => [`${value as number}% healthy`, 'Share']}
                contentStyle={{
                  background: 'var(--surface)',
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  fontSize: 12,
                }}
              />
            </RadialBarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          className="overview-jobs-chart"
          title="Background jobs"
          subtitle={jobsTotal === 0 ? 'Queue clear' : `${jobsTotal} in flight`}
          height={220}
        >
          {jobsMix.length === 0 ? (
            <div className="chart-state chart-state-empty">
              <p>No failed or pending jobs</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={jobsMix} dataKey="value" nameKey="name" innerRadius={48} outerRadius={74} paddingAngle={4} stroke="none">
                  {jobsMix.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: 'var(--surface)',
                    border: '1px solid var(--line)',
                    borderRadius: 10,
                    fontSize: 12,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
