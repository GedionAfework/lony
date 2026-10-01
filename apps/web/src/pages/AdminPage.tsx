import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { api, type AdminOverview } from '../lib/api';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../components/Toast';

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ minWidth: '15%' }}>
      <div className="muted" style={{ fontSize: 11 }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 20 }}>{value}</div>
    </div>
  );
}

export function AdminPage() {
  const { token } = useAuth();
  const { showError } = useToast();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [aiDisabled, setAiDisabled] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!token) return;
    try {
      const [ov, settings] = await Promise.all([api.adminOverview(token), api.adminGetSettings(token).catch(() => null)]);
      setOverview(ov.overview);
      if (settings) setAiDisabled(Boolean(settings.settings?.ai_disabled));
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Admin unavailable');
    }
  }, [token, showError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function toggleAI() {
    if (!token) return;
    setBusy(true);
    try {
      const res = await api.adminSetAI(token, !aiDisabled);
      setAiDisabled(Boolean(res.settings?.ai_disabled));
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not update AI setting');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Admin"
        subtitle="Quick KPIs and AI kill switch — full ops console for users, roles, themes, audit"
        right={
          <div className="flex-row" style={{ gap: 8 }}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => window.open('http://localhost:5174', '_blank', 'noopener,noreferrer')}
            >
              Open ops console
            </Button>
            <Button variant="secondary" size="sm" onClick={reload}>
              Refresh
            </Button>
          </div>
        }
      />
      {!overview ? (
        <Card>
          <EmptyState title="Loading…" body="Fetching platform KPIs." />
        </Card>
      ) : (
        <>
          <Card>
            <div className="section-label">Overview</div>
            <div className="flex-row" style={{ flexWrap: 'wrap', gap: 16, marginTop: 8 }}>
              <Stat label="Total users" value={overview.total_users} />
              <Stat label="Active" value={overview.active_users} />
              <Stat label="Suspended" value={overview.suspended_users} />
              <Stat label="Signups 7d" value={overview.signups_7d} />
              <Stat label="DAU" value={overview.dau} />
              <Stat label="WAU" value={overview.wau} />
              <Stat label="Open loans" value={overview.open_loans} />
              <Stat label="Overdue" value={overview.overdue_loans} />
              <Stat label="Cashflow 7d" value={overview.cashflow_entries_7d} />
              <Stat label="Jobs failed" value={overview.jobs_failed ?? 0} />
              <Stat label="Jobs pending" value={overview.jobs_pending ?? 0} />
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              FX: {overview.fx_ok ? `ok (${overview.fx_base || 'USD'}${overview.fx_as_of ? ` · ${overview.fx_as_of}` : ''})` : overview.fx_error || 'unavailable'}
            </div>
          </Card>
          <Card>
            <div className="section-label">AI usage</div>
            <div className="flex-row" style={{ flexWrap: 'wrap', gap: 16, marginTop: 8 }}>
              <Stat label="Insights 7d" value={overview.ai_insights_7d} />
              <Stat label="Runs 7d" value={overview.ai_runs_7d} />
              <Stat label="AI users 7d" value={overview.ai_users_7d} />
              <Stat label="Tokens 7d" value={overview.ai_tokens_7d} />
              <Stat label="Requests today" value={overview.ai_requests_today} />
            </div>
            <Button onClick={toggleAI} busy={busy} variant={aiDisabled ? 'primary' : 'danger'}>
              {busy ? '…' : aiDisabled ? 'Enable AI' : 'Disable AI'}
            </Button>
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              Global kill switch · currently {aiDisabled ? 'disabled' : 'enabled'}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
