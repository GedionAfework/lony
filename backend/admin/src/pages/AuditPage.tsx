import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Inbox, ScrollText } from 'lucide-react';
import { api, type AuditEntry } from '../api';
import { useAuth } from '../auth';
import { Button } from '../components/Button';
import { ButtonGroup } from '../components/ButtonGroup';
import { PageHeader } from '../components/PageHeader';
import { Table, type TableColumn } from '../components/Table';

const LIMIT = 25;

const ACTIONS = [
  'user.suspend',
  'user.unsuspend',
  'user.set_plan_tier',
  'settings.ai_disable',
  'settings.ai_enable',
  'catalog.create',
  'catalog.update',
  'category.create',
  'category.update',
  'theme.create',
  'theme.update',
  'role.create',
  'role.update',
  'role.assign',
  'locale.upload',
  'locale.update',
  'locale.delete',
  'calendar.update',
];

export function AuditPage() {
  const { token } = useAuth();
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');
  const [offset, setOffset] = useState(0);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.audit(token, { q, action, limit: LIMIT, offset });
      setEntries(res.audit ?? []);
      setTotal(res.total ?? (res.audit ?? []).length);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, [token, q, action, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setOffset(0);
  }, [q, action]);

  const page = Math.floor(offset / LIMIT) + 1;
  const pageCount = Math.max(1, Math.ceil(total / LIMIT));

  const columns: TableColumn<AuditEntry>[] = useMemo(
    () => [
      {
        key: 'expand',
        header: '',
        width: 36,
        render: (entry) =>
          expanded === entry.id ? <ChevronUp size={14} strokeWidth={2} /> : <ChevronDown size={14} strokeWidth={2} />,
      },
      {
        key: 'when',
        header: 'When',
        muted: true,
        render: (entry) => new Date(entry.created_at).toLocaleString(),
      },
      {
        key: 'actor',
        header: 'Actor',
        mono: true,
        render: (entry) => entry.actor_email || entry.actor_id,
      },
      {
        key: 'action',
        header: 'Action',
        render: (entry) => entry.action,
      },
      {
        key: 'target',
        header: 'Target',
        mono: true,
        muted: true,
        render: (entry) => entry.target_user_id || '—',
      },
    ],
    [expanded],
  );

  return (
    <div className="page">
      <PageHeader icon={ScrollText} title="Audit log" subtitle="Every administrative action, traceable" />

      {error ? (
        <div className="alert alert-error">
          <AlertTriangle size={16} strokeWidth={2} />
          <span>{error}</span>
        </div>
      ) : null}

      <Table
        title="Activity"
        subtitle={`${total} events`}
        toolbar={
          <>
            <input
              className="toolbar-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search actor email or action…"
            />
            <select value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">All actions</option>
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </>
        }
        columns={columns}
        rows={entries}
        rowKey={(e) => e.id}
        loading={loading}
        emptyIcon={Inbox}
        emptyMessage="No audit entries match your filters."
        onRowClick={(entry) => setExpanded((cur) => (cur === entry.id ? null : entry.id))}
        isExpanded={(entry) => expanded === entry.id}
        renderExpanded={(entry) => <pre className="audit-meta">{JSON.stringify(entry.meta ?? {}, null, 2)}</pre>}
        footer={
          <div className="pagination">
            <span className="muted">
              Page {page} of {pageCount} · {total} total
            </span>
            <ButtonGroup>
              <Button
                variant="secondary"
                size="sm"
                disabled={offset === 0}
                icon={<ChevronLeft size={14} strokeWidth={2} />}
                onClick={() => setOffset((o) => Math.max(0, o - LIMIT))}
              >
                Prev
              </Button>
              <Button variant="secondary" size="sm" disabled={offset + LIMIT >= total} onClick={() => setOffset((o) => o + LIMIT)}>
                Next <ChevronRight size={14} strokeWidth={2} />
              </Button>
            </ButtonGroup>
          </div>
        }
      />
    </div>
  );
}
