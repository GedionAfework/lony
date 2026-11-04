import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Crown,
  ShieldAlert,
  ShieldCheck,
  Users as UsersIcon,
} from 'lucide-react';
import { api, type AdminRole, type AdminUser } from '../api';
import { useAuth } from '../auth';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { ButtonGroup } from '../components/ButtonGroup';
import { PageHeader } from '../components/PageHeader';
import { PermissionGate } from '../components/PermissionGate';
import { Table, type TableColumn } from '../components/Table';
import { RolesPanel } from './RolesPage';

const LIMIT = 20;

type Tab = 'users' | 'roles';

const HUES = ['#159E9E', '#E07B12', '#2F7DD3', '#8B5CF6', '#E0457B', '#0E8A6A', '#C9A227', '#5B6B82'];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** A stable colour per person, so the same user always looks the same. */
function initialsStyle(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const color = HUES[Math.abs(h) % HUES.length];
  return { color, background: `color-mix(in srgb, ${color} 15%, transparent)` };
}

export function UsersPage() {
  const { hasPerm } = useAuth();
  const canRoles = hasPerm('roles.manage');
  const [tab, setTab] = useState<Tab>('users');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'roles' && canRoles) setTab('roles');
  }, [canRoles]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (tab === 'roles') url.searchParams.set('tab', 'roles');
    else url.searchParams.delete('tab');
    window.history.replaceState({}, '', url.toString());
  }, [tab]);

  useEffect(() => {
    if (tab === 'roles' && !canRoles) setTab('users');
  }, [tab, canRoles]);

  return (
    <div className="page">
      <PageHeader icon={UsersIcon} title="User management" subtitle="Accounts, plans, and admin roles" />

      <div className="segmented" style={{ marginBottom: 16 }}>
        <button type="button" className={`segmented-btn${tab === 'users' ? ' active' : ''}`} onClick={() => setTab('users')}>
          <UsersIcon size={15} strokeWidth={2} /> Users
        </button>
        {canRoles ? (
          <button type="button" className={`segmented-btn${tab === 'roles' ? ' active' : ''}`} onClick={() => setTab('roles')}>
            <ShieldCheck size={15} strokeWidth={2} /> Roles
          </button>
        ) : null}
      </div>

      {tab === 'users' ? <UsersPanel /> : <RolesPanel showHeader={false} />}
    </div>
  );
}

function UsersPanel() {
  const { token, hasPerm } = useAuth();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  // A change that needs a second click: suspending, unsuspending, or switching plan.
  const [confirm, setConfirm] = useState<{ kind: 'suspend' | 'plan'; user: AdminUser } | null>(null);
  // The user whose details are open, loaded fresh from the server.
  const [detail, setDetail] = useState<AdminUser | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  async function openDetail(user: AdminUser) {
    if (!token) return;
    setDetail(user);
    setDetailLoading(true);
    try {
      const res = await api.getUser(token, user.id);
      setDetail((cur) => (cur && cur.id === user.id ? { ...user, ...res.user } : cur));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load user');
    } finally {
      setDetailLoading(false);
    }
  }

  function applyUser(next: Partial<AdminUser> & { id: string }) {
    setUsers((prev) => prev.map((u) => (u.id === next.id ? { ...u, ...next } : u)));
    setDetail((cur) => (cur && cur.id === next.id ? { ...cur, ...next } : cur));
  }

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.listUsers(token, { q, status, limit: LIMIT, offset });
      setUsers(res.users ?? []);
      setTotal(res.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [token, q, status, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!token || !hasPerm('roles.manage')) return;
    api
      .listRoles(token)
      .then((res) => setRoles(res.roles ?? []))
      .catch(() => setRoles([]));
  }, [token, hasPerm]);

  useEffect(() => {
    setOffset(0);
  }, [q, status]);

  async function toggleSuspend(user: AdminUser) {
    if (!token) return;
    setBusyId(user.id);
    setError(null);
    try {
      const res = user.status === 'suspended' ? await api.unsuspend(token, user.id) : await api.suspend(token, user.id);
      applyUser({ id: res.user.id, status: res.user.status });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusyId(null);
    }
  }

  async function togglePlan(user: AdminUser) {
    if (!token) return;
    const next = (user.plan_tier || 'free') === 'premium' ? 'free' : 'premium';
    setBusyId(user.id);
    setError(null);
    try {
      const res = await api.setPlanTier(token, user.id, next);
      applyUser({ id: res.user.id, plan_tier: res.user.plan_tier });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update plan');
    } finally {
      setBusyId(null);
    }
  }

  async function changeRole(user: AdminUser, roleId: string) {
    if (!token) return;
    setBusyId(user.id);
    setError(null);
    try {
      const res = await api.setUserRole(token, user.id, roleId || null);
      setUsers((prev) =>
        prev.map((u) =>
          u.id === res.user.id
            ? {
                ...u,
                admin_role_id: res.user.admin_role_id,
                admin_role_name: res.user.admin_role_name,
              }
            : u,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update role');
    } finally {
      setBusyId(null);
    }
  }

  const columns: TableColumn<AdminUser>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'User',
        render: (u) => (
          <div className="user-cell">
            <span className="user-initials" style={initialsStyle(u.display_name || u.email)}>
              {initialsOf(u.display_name || u.email)}
            </span>
            <div className="cell-stack">
              <strong>{u.display_name}</strong>
              <span className="muted">{u.email}</span>
            </div>
          </div>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (u) => <span className={`badge badge-${u.status === 'active' ? 'success' : 'warning'}`}>{u.status}</span>,
      },
      {
        key: 'plan',
        header: 'Plan',
        render: (u) => (
          <span className={`badge ${(u.plan_tier || 'free') === 'premium' ? 'badge-primary' : ''}`}>
            {(u.plan_tier || 'free') === 'premium' ? <Crown size={12} strokeWidth={2} /> : null}
            {u.plan_tier || 'free'}
          </span>
        ),
      },
      {
        key: 'role',
        header: 'Role',
        render: (u) =>
          u.role === 'admin' && hasPerm('roles.manage') && roles.length > 0 ? (
            <select
              className="inline-select"
              value={u.admin_role_id || ''}
              disabled={busyId === u.id}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => void changeRole(u, e.target.value)}
            >
              <option value="">No role</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="mono muted">{u.admin_role_name || u.role}</span>
          ),
      },
      {
        key: 'created',
        header: 'Joined',
        muted: true,
        render: (u) => new Date(u.created_at).toLocaleDateString(),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        render: (u) => (
          <PermissionGate perm="users.write">
            <ButtonGroup>
              <Button
                size="sm"
                variant="secondary"
                disabled={busyId === u.id}
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirm({ kind: 'plan', user: u });
                }}
              >
                {(u.plan_tier || 'free') === 'premium' ? 'Downgrade' : 'Upgrade'}
              </Button>
              <Button
                size="sm"
                variant={u.status === 'suspended' ? 'primary' : 'danger'}
                disabled={busyId === u.id || u.role === 'admin'}
                title={u.role === 'admin' ? 'Cannot suspend an admin' : undefined}
                icon={
                  u.status === 'suspended' ? (
                    <ShieldCheck size={13} strokeWidth={2} />
                  ) : (
                    <ShieldAlert size={13} strokeWidth={2} />
                  )
                }
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirm({ kind: 'suspend', user: u });
                }}
              >
                {u.status === 'suspended' ? 'Unsuspend' : 'Suspend'}
              </Button>
            </ButtonGroup>
          </PermissionGate>
        ),
      },
    ],
    [busyId, hasPerm, roles],
  );

  const page = Math.floor(offset / LIMIT) + 1;
  const pageCount = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <>
      {error ? (
        <div className="alert alert-error">
          <AlertTriangle size={16} strokeWidth={2} />
          <span>{error}</span>
        </div>
      ) : null}

      <Table
        title="Users"
        subtitle={`${total} accounts`}
        toolbar={
          <>
            <input
              className="toolbar-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by email, name, or username…"
            />
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="deletion_pending">Deletion pending</option>
              <option value="deleted">Deleted</option>
            </select>
          </>
        }
        columns={columns}
        rows={users}
        rowKey={(u) => u.id}
        onRowClick={(u) => void openDetail(u)}
        isRowActive={(u) => detail?.id === u.id}
        loading={loading}
        emptyIcon={UsersIcon}
        emptyMessage={loading ? 'Loading users…' : 'No users match your filters.'}
        footer={
          <div className="pagination">
            <span className="muted">
              Page {page} of {pageCount} · {total} total
            </span>
            <ButtonGroup>
              <Button
                size="sm"
                variant="secondary"
                disabled={offset === 0}
                icon={<ChevronLeft size={14} strokeWidth={2} />}
                onClick={() => setOffset((o) => Math.max(0, o - LIMIT))}
              >
                Prev
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={offset + LIMIT >= total}
                onClick={() => setOffset((o) => o + LIMIT)}
              >
                Next <ChevronRight size={14} strokeWidth={2} />
              </Button>
            </ButtonGroup>
          </div>
        }
      />

      <Modal
        open={Boolean(detail)}
        title={detail?.display_name || 'User'}
        subtitle={detail?.email}
        onClose={() => setDetail(null)}
        width={560}
        footer={
          detail && hasPerm('users.write') ? (
            <ButtonGroup>
              <Button size="sm" variant="secondary" disabled={busyId === detail.id} onClick={() => setConfirm({ kind: 'plan', user: detail })}>
                {(detail.plan_tier || 'free') === 'premium' ? 'Downgrade to Free' : 'Upgrade to Premium'}
              </Button>
              <Button
                size="sm"
                variant={detail.status === 'suspended' ? 'primary' : 'danger'}
                disabled={busyId === detail.id || detail.role === 'admin'}
                title={detail.role === 'admin' ? 'Cannot suspend an admin' : undefined}
                onClick={() => setConfirm({ kind: 'suspend', user: detail })}
              >
                {detail.status === 'suspended' ? 'Unsuspend' : 'Suspend'}
              </Button>
            </ButtonGroup>
          ) : null
        }
      >
        {detail ? <UserDetail user={detail} loading={detailLoading} /> : null}
      </Modal>

      <ConfirmModal
        confirm={confirm}
        busy={Boolean(confirm && busyId === confirm.user.id)}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return;
          if (confirm.kind === 'suspend') await toggleSuspend(confirm.user);
          else await togglePlan(confirm.user);
          setConfirm(null);
        }}
      />
    </>
  );
}

function ConfirmModal({
  confirm,
  busy,
  onCancel,
  onConfirm,
}: {
  confirm: { kind: 'suspend' | 'plan'; user: AdminUser } | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  if (!confirm) return null;
  const u = confirm.user;
  const suspending = confirm.kind === 'suspend' && u.status !== 'suspended';
  const toPremium = confirm.kind === 'plan' && (u.plan_tier || 'free') !== 'premium';
  const title =
    confirm.kind === 'suspend'
      ? suspending
        ? `Suspend ${u.display_name}?`
        : `Unsuspend ${u.display_name}?`
      : toPremium
        ? `Upgrade ${u.display_name} to Premium?`
        : `Downgrade ${u.display_name} to Free?`;
  const body =
    confirm.kind === 'suspend'
      ? suspending
        ? 'They are signed out and cannot use Lony until you unsuspend them. Their data stays.'
        : 'They can sign in and use Lony again.'
      : toPremium
        ? 'They get Premium features (AI, voice, receipt scan, reports) right away.'
        : 'They lose Premium features right away. Their data stays.';
  return (
    <Modal
      open
      title={title}
      subtitle={u.email}
      onClose={onCancel}
      footer={
        <ButtonGroup>
          <Button size="sm" variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" variant={suspending ? 'danger' : 'primary'} onClick={() => void onConfirm()} disabled={busy}>
            {busy ? 'Working…' : confirm.kind === 'suspend' ? (suspending ? 'Suspend' : 'Unsuspend') : toPremium ? 'Upgrade' : 'Downgrade'}
          </Button>
        </ButtonGroup>
      }
    >
      <p style={{ margin: 0 }}>{body}</p>
    </Modal>
  );
}

function UserDetail({ user: u, loading }: { user: AdminUser; loading: boolean }) {
  const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleString() : '—');
  const rows: [string, ReactNode][] = [
    ['Status', <span className={`badge badge-${u.status === 'active' ? 'success' : 'warning'}`}>{u.status}</span>],
    ['Plan', u.plan_tier || 'free'],
    ['Role', u.admin_role_name || u.role],
    ['Username', u.username ? `@${u.username}` : '—'],
    ['Phone', u.phone_e164 || '—'],
    ['Email verified', u.email_verified == null ? '—' : u.email_verified ? 'Yes' : 'No'],
    ['Country', u.country_code || '—'],
    ['Currency', u.default_currency_code || '—'],
    ['Language / timezone', [u.locale, u.timezone].filter(Boolean).join(' · ') || '—'],
    ['Joined', fmtDate(u.created_at)],
    ['Last active', fmtDate(u.last_active_at)],
  ];
  const stats: [string, ReactNode][] = [
    ['Trust grade', u.trust_grade ? `${u.trust_grade}${u.trust_band ? ` · ${u.trust_band}` : ''}${u.trust_thin_history ? ' (thin history)' : ''}` : '—'],
    ['Loans as borrower', u.loans_as_borrower ?? '—'],
    ['Loans as lender', u.loans_as_lender ?? '—'],
    ['Open loans', u.open_loans ?? '—'],
    ['Overdue loans', u.overdue_loans ?? '—'],
    ['Entries (30 days)', u.cashflow_entries_30d ?? '—'],
    ['Money moved (30 days)', u.cashflow_volume_30d ?? '—'],
    ['Friends', u.friends_count ?? '—'],
  ];
  const grid = (items: [string, ReactNode][]) => (
    <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '8px 16px', alignItems: 'center' }}>
      {items.map(([k, v]) => (
        <Fragment key={k}>
          <span className="muted">{k}</span>
          <span>{v}</span>
        </Fragment>
      ))}
    </div>
  );
  return (
    <div style={{ display: 'grid', gap: 18, opacity: loading ? 0.6 : 1 }}>
      <section>
        <h4 style={{ margin: '0 0 8px' }}>Account</h4>
        {grid(rows)}
      </section>
      <section>
        <h4 style={{ margin: '0 0 8px' }}>Activity{loading ? ' · loading…' : ''}</h4>
        {grid(stats)}
      </section>
    </div>
  );
}
