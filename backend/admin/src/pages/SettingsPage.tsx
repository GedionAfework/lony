import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, NotebookPen, Power, Settings as SettingsIcon } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { PageHeader } from '../components/PageHeader';
import { PermissionGate } from '../components/PermissionGate';

const NOTES_KEY = 'lony_admin_ops_notes';

export function SettingsPage() {
  const { token } = useAuth();
  const [aiDisabled, setAIDisabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState(() => localStorage.getItem(NOTES_KEY) || '');
  const [saved, setSaved] = useState(true);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getSettings(token);
      setAIDisabled(Boolean(res.settings?.ai_disabled));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleAI() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.setAIDisabled(token, !aiDisabled);
      setAIDisabled(Boolean(res.settings?.ai_disabled));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update AI setting');
    } finally {
      setBusy(false);
    }
  }

  function saveNotes() {
    localStorage.setItem(NOTES_KEY, notes);
    setSaved(true);
  }

  return (
    <div className="page">
      <PageHeader icon={SettingsIcon} title="Settings" subtitle="Platform-wide switches and ops notes" />

      {error ? (
        <div className="alert alert-error">
          <AlertTriangle size={16} strokeWidth={2} />
          <span>{error}</span>
        </div>
      ) : null}

      <PermissionGate
        perm="settings.ai"
        fallback={
          <div className="card">
            <p className="muted">You don't have permission to manage platform settings.</p>
          </div>
        }
      >
        <div className="card stack">
          <div className="card-title-row">
            <strong>AI global kill switch</strong>
            <span className={`badge badge-${aiDisabled ? 'warning' : 'success'}`}>{aiDisabled ? 'disabled' : 'enabled'}</span>
          </div>
          <p className="muted" style={{ margin: 0 }}>
            When disabled, Premium AI endpoints return <code>AI_DISABLED</code>. Plan tier still gates access when
            enabled.
          </p>
          <div>
            <button
              type="button"
              className={`btn ${aiDisabled ? 'btn-primary' : 'btn-danger'}`}
              disabled={busy || loading}
              onClick={toggleAI}
            >
              <Power size={15} strokeWidth={2} />
              {aiDisabled ? 'Enable AI' : 'Disable AI'}
            </button>
          </div>
        </div>

        <div className="card stack">
          <div className="card-title-row">
            <strong>
              <NotebookPen size={15} strokeWidth={2} style={{ verticalAlign: '-2px', marginRight: 6 }} />
              Ops notes
            </strong>
            {!saved ? <span className="muted">Unsaved</span> : null}
          </div>
          <p className="muted" style={{ margin: 0 }}>
            Private scratchpad for the on-call admin. Stored only in this browser.
          </p>
          <textarea
            className="ops-notes"
            rows={6}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setSaved(false);
            }}
            placeholder="e.g. FX provider flaky after 22:00 UTC, escalate to #payments…"
          />
          <div>
            <button type="button" className="btn btn-primary" onClick={saveNotes} disabled={saved}>
              <Check size={14} strokeWidth={2} /> Save notes
            </button>
          </div>
        </div>

        <div className="card stack">
          <strong>Billing note</strong>
          <p className="muted" style={{ margin: 0 }}>
            v1 uses admin-managed plan_tier (free / premium). Stripe checkout is out of scope.
          </p>
        </div>
      </PermissionGate>
    </div>
  );
}
