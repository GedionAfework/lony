import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { ButtonGroup } from '../components/ButtonGroup';
import { PageHeader } from '../components/PageHeader';
import { PermissionGate } from '../components/PermissionGate';
import { Table, type TableColumn } from '../components/Table';
import { RolesPanel } from './RolesPage';

const LIMIT = 20;

type Tab = 'users' | 'roles';

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
      setUsers((prev) => prev.map((u) => (u.id === res.user.id ? { ...u, status: res.user.status } : u)));
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
      setUsers((prev) => prev.map((u) => (u.id === res.user.id ? { ...u, plan_tier: res.user.plan_tier } : u)));
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
          <div className="cell-stack">
            <strong>{u.display_name}</strong>
            <span className="muted mono">{u.email}</span>
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
                  void togglePlan(u);
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
                  void toggleSuspend(u);
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
    </>
  );
}
