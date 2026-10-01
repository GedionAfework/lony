import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Check,
  Plus,
  Search,
  ShieldCheck,
  UserCog,
  X,
} from 'lucide-react';
import { api, type AdminRole, type AdminUser, type Permission } from '../api';
import { useAuth } from '../auth';
import { Button } from '../components/Button';
import { ButtonGroup } from '../components/ButtonGroup';
import { Card } from '../components/Card';
import { IconButton } from '../components/IconButton';
import { PageHeader } from '../components/PageHeader';
import { Table, type TableColumn } from '../components/Table';

type FormState = {
  name: string;
  description: string;
  permissions: Set<string>;
};

function emptyForm(): FormState {
  return { name: '', description: '', permissions: new Set() };
}

/** Roles & permissions manager — used as a tab under User management. */
export function RolesPanel({ showHeader = true }: { showHeader?: boolean }) {
  const { token } = useAuth();
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());

  const [userQuery, setUserQuery] = useState('');
  const [userResults, setUserResults] = useState<AdminUser[]>([]);
  const [userSearchBusy, setUserSearchBusy] = useState(false);
  const [assignRoleId, setAssignRoleId] = useState('');
  const [assignBusyId, setAssignBusyId] = useState<string | null>(null);
  const [assignMessage, setAssignMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [rolesRes, permsRes] = await Promise.all([api.listRoles(token), api.listPermissions(token)]);
      setRoles(rolesRes.roles ?? []);
      setPermissions((permsRes.permissions ?? []).slice().sort((a, b) => a.sort_order - b.sort_order));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load roles');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  function startCreate() {
    setForm(emptyForm());
    setEditingId('new');
  }

  function startEdit(role: AdminRole) {
    setForm({ name: role.name, description: role.description || '', permissions: new Set(role.permissions) });
    setEditingId(role.id);
  }

  function togglePerm(code: string) {
    setForm((f) => {
      const next = new Set(f.permissions);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return { ...f, permissions: next };
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token || !form.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        permissions: Array.from(form.permissions),
      };
      if (editingId === 'new') {
        await api.createRole(token, body);
      } else if (editingId) {
        await api.updateRole(token, editingId, body);
      }
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save role');
    } finally {
      setBusy(false);
    }
  }

  async function onSearchUsers(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setUserSearchBusy(true);
    setAssignMessage(null);
    try {
      const res = await api.listUsers(token, { q: userQuery, limit: 8 });
      setUserResults(res.users ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not search users');
    } finally {
      setUserSearchBusy(false);
    }
  }

  async function assignRole(user: AdminUser) {
    if (!token) return;
    setAssignBusyId(user.id);
    setAssignMessage(null);
    try {
      const res = await api.setUserRole(token, user.id, assignRoleId || null);
      setUserResults((prev) =>
        prev.map((u) =>
          u.id === res.user.id
            ? { ...u, admin_role_id: res.user.admin_role_id, admin_role_name: res.user.admin_role_name }
            : u,
        ),
      );
      setAssignMessage(`Updated role for ${user.email}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not assign role');
    } finally {
      setAssignBusyId(null);
    }
  }

  const roleColumns: TableColumn<AdminRole>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Role',
        render: (role) => (
          <div className="cell-stack">
            <strong>{role.name}</strong>
            {role.description ? <span className="muted">{role.description}</span> : null}
          </div>
        ),
      },
      {
        key: 'perms',
        header: 'Permissions',
        render: (role) => <span className="muted">{role.permissions.length}</span>,
      },
      {
        key: 'system',
        header: 'Type',
        render: (role) =>
          role.is_system ? <span className="badge badge-primary">system</span> : <span className="badge badge-muted">custom</span>,
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        render: (role) => (
          <Button size="sm" variant="secondary" onClick={() => startEdit(role)}>
            Edit
          </Button>
        ),
      },
    ],
    [],
  );

  const assignColumns: TableColumn<AdminUser>[] = useMemo(
    () => [
      {
        key: 'user',
        header: 'User',
        render: (u) => (
          <div className="cell-stack">
            <strong>{u.display_name}</strong>
            <span className="muted mono">{u.email}</span>
          </div>
        ),
      },
      {
        key: 'role',
        header: 'Current role',
        mono: true,
        muted: true,
        render: (u) => u.admin_role_name || '—',
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        render: (u) => (
          <Button size="sm" variant="primary" busy={assignBusyId === u.id} onClick={() => void assignRole(u)}>
            Assign
          </Button>
        ),
      },
    ],
    [assignBusyId, assignRoleId],
  );

  return (
    <div className="stack-lg">
      {showHeader ? (
        <PageHeader
          icon={ShieldCheck}
          title="Roles & permissions"
          subtitle="Define what each admin role can do"
          actions={
            <Button variant="primary" icon={<Plus size={14} strokeWidth={2} />} onClick={startCreate}>
              New role
            </Button>
          }
        />
      ) : (
        <div className="page-toolbar-top" style={{ justifyContent: 'flex-end' }}>
          <Button variant="primary" icon={<Plus size={14} strokeWidth={2} />} onClick={startCreate}>
            New role
          </Button>
        </div>
      )}

      {error ? (
        <div className="alert alert-error">
          <AlertTriangle size={16} strokeWidth={2} />
          <span>{error}</span>
        </div>
      ) : null}

      <Table
        title="Roles"
        subtitle={`${roles.length} defined`}
        columns={roleColumns}
        rows={roles}
        rowKey={(r) => r.id}
        loading={loading}
        emptyIcon={ShieldCheck}
        emptyMessage="No roles yet."
        isRowActive={(r) => editingId === r.id}
        onRowClick={(r) => startEdit(r)}
      />

      {editingId ? (
        <form className="card role-editor" onSubmit={onSubmit}>
          <div className="card-title-row">
            <strong>{editingId === 'new' ? 'New role' : 'Edit role'}</strong>
            <IconButton icon={X} label="Close" size="sm" onClick={() => setEditingId(null)} />
          </div>
          <label className="field">
            <span className="field-label">Name</span>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
          </label>
          <label className="field">
            <span className="field-label">Description</span>
            <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </label>

          <div className="field-label" style={{ marginTop: 4 }}>
            Permissions
          </div>
          <div className="perm-matrix">
            {permissions.map((perm) => (
              <label key={perm.code} className="perm-checkbox">
                <input type="checkbox" checked={form.permissions.has(perm.code)} onChange={() => togglePerm(perm.code)} />
                <span>
                  <strong>{perm.label}</strong>
                  <span className="muted mono"> {perm.code}</span>
                </span>
              </label>
            ))}
          </div>

          <ButtonGroup>
            <Button type="submit" variant="primary" busy={busy} disabled={!form.name.trim()} icon={<Check size={14} strokeWidth={2} />}>
              Save role
            </Button>
            <Button type="button" variant="secondary" onClick={() => setEditingId(null)} disabled={busy}>
              Cancel
            </Button>
          </ButtonGroup>
        </form>
      ) : null}

      <Card title="Assign role to a user" subtitle="Search an account and apply the selected role.">
        <form className="inline-form" onSubmit={onSearchUsers} style={{ marginBottom: 12 }}>
          <input value={userQuery} onChange={(e) => setUserQuery(e.target.value)} placeholder="Search users by email or name…" />
          <select value={assignRoleId} onChange={(e) => setAssignRoleId(e.target.value)}>
            <option value="">No admin role</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <Button type="submit" variant="secondary" busy={userSearchBusy} icon={<Search size={14} strokeWidth={2} />}>
            Search
          </Button>
        </form>
        {assignMessage ? <p className="muted">{assignMessage}</p> : null}
        {userResults.length > 0 ? (
          <Table
            compact
            columns={assignColumns}
            rows={userResults}
            rowKey={(u) => u.id}
            emptyIcon={UserCog}
            emptyMessage="No users found."
          />
        ) : null}
      </Card>
    </div>
  );
}

/** Standalone route (redirects prefer the Users management tab). */
export function RolesPage() {
  return (
    <div className="page">
      <RolesPanel showHeader />
    </div>
  );
}
