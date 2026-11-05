import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Check,
  Grid3x3,
  LayoutGrid,
  Loader2,
  Lock,
  Plus,
  Save,
  Search,
  ShieldCheck,
  UserCog,
} from 'lucide-react';
import { api, type AdminRole, type AdminUser, type Permission } from '../api';
import { useAuth } from '../auth';
import { Button } from '../components/Button';
import { Drawer } from '../components/Drawer';
import { PageHeader } from '../components/PageHeader';

const AREA_LABEL: Record<string, string> = {
  overview: 'Insights',
  users: 'People',
  roles: 'People',
  audit: 'People',
  categories: 'Content',
  themes: 'Content',
  localization: 'Content',
  settings: 'System',
};
const AREA_ORDER = ['Insights', 'People', 'Content', 'System', 'Other'];
const AREA_COLOR: Record<string, string> = {
  Insights: '#0ea5a0',
  People: '#7c6cf6',
  Content: '#0891b2',
  System: '#f59e0b',
  Other: '#64748b',
};

function areaOf(code: string) {
  return AREA_LABEL[code.split('.')[0]] ?? 'Other';
}

function isLocked(role: AdminRole) {
  return role.is_system && role.name === 'Super Admin';
}

type FormState = { name: string; description: string; permissions: Set<string> };

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Roles & permissions manager — used as a tab under User management. */
export function RolesPanel({ showHeader = true }: { showHeader?: boolean }) {
  const { token } = useAuth();
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'cards' | 'matrix'>('cards');
  const [editing, setEditing] = useState<AdminRole | 'new' | null>(null);
  const [form, setForm] = useState<FormState>({ name: '', description: '', permissions: new Set() });
  const [permSearch, setPermSearch] = useState('');
  const [cellBusy, setCellBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [rolesRes, permsRes] = await Promise.all([api.listRoles(token), api.listPermissions(token)]);
      setRoles(
        (rolesRes.roles ?? []).slice().sort((a, b) => Number(b.is_system) - Number(a.is_system) || b.permissions.length - a.permissions.length),
      );
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

  const byArea = useMemo(() => {
    const groups = new Map<string, Permission[]>();
    for (const p of permissions) {
      const a = areaOf(p.code);
      groups.set(a, [...(groups.get(a) ?? []), p]);
    }
    return AREA_ORDER.filter((a) => groups.has(a)).map((a) => ({ area: a, perms: groups.get(a)! }));
  }, [permissions]);

  function openNew() {
    setForm({ name: '', description: '', permissions: new Set() });
    setPermSearch('');
    setEditing('new');
  }
  function openEdit(role: AdminRole) {
    setForm({ name: role.name, description: role.description || '', permissions: new Set(role.permissions) });
    setPermSearch('');
    setEditing(role);
  }

  function togglePerm(code: string) {
    setForm((f) => {
      const next = new Set(f.permissions);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return { ...f, permissions: next };
    });
  }
  function setArea(perms: Permission[], on: boolean) {
    setForm((f) => {
      const next = new Set(f.permissions);
      for (const p of perms) {
        if (on) next.add(p.code);
        else next.delete(p.code);
      }
      return { ...f, permissions: next };
    });
  }

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (!token || !form.name.trim() || !editing) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        permissions: Array.from(form.permissions),
      };
      if (editing === 'new') await api.createRole(token, body);
      else await api.updateRole(token, editing.id, isLocked(editing) ? { description: body.description } : body);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save role');
    } finally {
      setBusy(false);
    }
  }

  // Matrix: flip one permission on one role and save straight away.
  async function toggleCell(role: AdminRole, code: string) {
    if (!token || isLocked(role)) return;
    const key = `${role.id}:${code}`;
    setCellBusy(key);
    setError(null);
    const has = role.permissions.includes(code);
    const next = has ? role.permissions.filter((c) => c !== code) : [...role.permissions, code];
    setRoles((rs) => rs.map((r) => (r.id === role.id ? { ...r, permissions: next } : r)));
    try {
      await api.updateRole(token, role.id, { permissions: next });
    } catch (err) {
      setRoles((rs) => rs.map((r) => (r.id === role.id ? { ...r, permissions: role.permissions } : r)));
      setError(err instanceof Error ? err.message : 'Could not update role');
    } finally {
      setCellBusy(null);
    }
  }

  const total = permissions.length;
  const editingRole = editing && editing !== 'new' ? editing : null;
  const locked = editingRole ? isLocked(editingRole) : false;
  const q = permSearch.trim().toLowerCase();

  return (
    <div className="stack-lg">
      {showHeader ? <PageHeader icon={ShieldCheck} title="Roles & permissions" /> : null}

      {error ? (
        <div className="alert alert-error">
          <AlertTriangle size={16} strokeWidth={2} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="catalog-bar">
        <div className="catalog-bar-row">
          <div className="roles-summary">
            <strong>{roles.length}</strong> roles · <strong>{total}</strong> permissions
          </div>
          <div className="seg" role="tablist" aria-label="View">
            <button type="button" className={view === 'cards' ? 'active' : ''} onClick={() => setView('cards')}>
              <LayoutGrid size={14} strokeWidth={2} /> Roles
            </button>
            <button type="button" className={view === 'matrix' ? 'active' : ''} onClick={() => setView('matrix')}>
              <Grid3x3 size={14} strokeWidth={2} /> Access matrix
            </button>
          </div>
          <div className="catalog-bar-actions">
            <Button variant="primary" icon={<Plus size={15} strokeWidth={2} />} onClick={openNew}>
              New role
            </Button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="skeleton-grid">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton skeleton-card" />
          ))}
        </div>
      ) : view === 'cards' ? (
        <div className="role-grid">
          {roles.map((role) => {
            const share = total ? Math.round((role.permissions.length / total) * 100) : 0;
            return (
              <button key={role.id} type="button" className="card role-card" onClick={() => openEdit(role)}>
                <div className="role-card-head">
                  <span className="role-card-icon">{isLocked(role) ? <Lock size={18} /> : <ShieldCheck size={18} />}</span>
                  <div className="cell-stack" style={{ flex: 1 }}>
                    <strong>{role.name}</strong>
                    <span className="muted" style={{ fontSize: 12.5 }}>
                      {role.description || (role.is_system ? 'Built-in role' : 'Custom role')}
                    </span>
                  </div>
                  <span className={`badge ${role.is_system ? 'badge-primary' : 'badge-muted'}`}>{role.is_system ? 'system' : 'custom'}</span>
                </div>
                <div className="role-card-meter">
                  <div className="lang-progress-top">
                    <span>Access</span>
                    <b>
                      {role.permissions.length}/{total}
                    </b>
                  </div>
                  <div className="lang-bar lang-bar-good">
                    <span style={{ width: `${share}%` }} />
                  </div>
                </div>
                <div className="role-card-areas">
                  {byArea.map(({ area, perms }) => {
                    const n = perms.filter((p) => role.permissions.includes(p.code)).length;
                    return (
                      <span key={area} className={`area-pill${n ? '' : ' off'}`} style={{ ['--area' as string]: AREA_COLOR[area] }}>
                        {area} {n}/{perms.length}
                      </span>
                    );
                  })}
                </div>
              </button>
            );
          })}
          <button type="button" className="lang-add" onClick={openNew}>
            <Plus size={22} strokeWidth={2} />
            <strong>New role</strong>
            <span className="muted">Pick exactly what it can do</span>
          </button>
        </div>
      ) : (
        <div className="lt-table-card">
          <div className="lt-table-scroll">
            <table className="lt-table matrix">
              <thead>
                <tr>
                  <th>Permission</th>
                  {roles.map((r) => (
                    <th key={r.id} className="matrix-role">
                      <button type="button" onClick={() => openEdit(r)} title={`Edit ${r.name}`}>
                        {isLocked(r) ? <Lock size={11} /> : null} {r.name}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byArea.map(({ area, perms }) => [
                  <tr key={`h-${area}`} className="matrix-area">
                    <td colSpan={roles.length + 1}>
                      <i style={{ background: AREA_COLOR[area] }} /> {area}
                    </td>
                  </tr>,
                  ...perms.map((p) => (
                    <tr key={p.code}>
                      <td>
                        <div className="cell-stack">
                          <span>{p.label}</span>
                          <span className="muted mono" style={{ fontSize: 11.5 }}>
                            {p.code}
                          </span>
                        </div>
                      </td>
                      {roles.map((r) => {
                        const on = r.permissions.includes(p.code);
                        const key = `${r.id}:${p.code}`;
                        return (
                          <td key={r.id} className="matrix-cell">
                            <button
                              type="button"
                              className={`matrix-toggle${on ? ' on' : ''}`}
                              disabled={isLocked(r) || cellBusy !== null}
                              title={isLocked(r) ? 'Super Admin always has every permission' : on ? 'Click to remove' : 'Click to grant'}
                              aria-pressed={on}
                              aria-label={`${p.label} for ${r.name}`}
                              onClick={() => void toggleCell(r, p.code)}
                            >
                              {cellBusy === key ? <Loader2 size={13} className="spin" /> : on ? <Check size={14} strokeWidth={3} /> : null}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          </div>
          <div className="lt-table-footer muted" style={{ fontSize: 12.5 }}>
            Click a cell to grant or remove that permission. Changes save immediately and are recorded in the audit log.
          </div>
        </div>
      )}

      <AssignRole roles={roles} />

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        width={620}
        eyebrow={editing === 'new' ? 'New role' : editingRole?.is_system ? 'System role' : 'Custom role'}
        title={form.name.trim() || 'Untitled role'}
        icon={
          <span className="role-card-icon lg">{locked ? <Lock size={20} /> : <ShieldCheck size={20} />}</span>
        }
        footer={
          <>
            <span className="muted" style={{ marginRight: 'auto', fontSize: 13 }}>
              {form.permissions.size} of {total} permissions
            </span>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" busy={busy} disabled={!form.name.trim()} icon={<Save size={15} />} onClick={() => void save()}>
              Save role
            </Button>
          </>
        }
      >
        <form className="stack" onSubmit={save}>
          <label className="field">
            <span className="field-label">Name</span>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              disabled={Boolean(editingRole?.is_system)}
              required
              autoFocus={editing === 'new'}
            />
            {editingRole?.is_system ? <span className="muted" style={{ fontSize: 12 }}>Built-in roles keep their name.</span> : null}
          </label>
          <label className="field">
            <span className="field-label">Description</span>
            <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="What is this role for?" />
          </label>
        </form>

        {locked ? (
          <div className="banner" style={{ background: 'var(--surface-muted)' }}>
            <Lock size={16} /> Super Admin always has every permission, so its access can’t be edited.
          </div>
        ) : (
          <>
            <label className="catalog-search">
              <Search size={16} strokeWidth={2} />
              <input value={permSearch} onChange={(e) => setPermSearch(e.target.value)} placeholder="Filter permissions…" aria-label="Filter permissions" />
            </label>
            {byArea.map(({ area, perms }) => {
              const shown = perms.filter((p) => !q || p.label.toLowerCase().includes(q) || p.code.includes(q));
              if (!shown.length) return null;
              const on = perms.filter((p) => form.permissions.has(p.code)).length;
              return (
                <section key={area} className="perm-area">
                  <header>
                    <i style={{ background: AREA_COLOR[area] }} />
                    <strong>{area}</strong>
                    <span className="muted">
                      {on}/{perms.length}
                    </span>
                    <button type="button" className="link-btn" onClick={() => setArea(perms, on < perms.length)}>
                      {on < perms.length ? 'Select all' : 'Clear'}
                    </button>
                  </header>
                  {shown.map((p) => {
                    const checked = form.permissions.has(p.code);
                    return (
                      <label key={p.code} className={`perm-toggle${checked ? ' on' : ''}`}>
                        <span className="cell-stack">
                          <span>{p.label}</span>
                          <span className="muted mono" style={{ fontSize: 11.5 }}>
                            {p.code}
                          </span>
                        </span>
                        <input type="checkbox" checked={checked} onChange={() => togglePerm(p.code)} />
                        <span className={`switch${checked ? ' on' : ''}`} aria-hidden>
                          <span />
                        </span>
                      </label>
                    );
                  })}
                </section>
              );
            })}
          </>
        )}
      </Drawer>
    </div>
  );
}

/* ------------------------------------------------------- assign a role */

function AssignRole({ roles }: { roles: AdminRole[] }) {
  const { token } = useAuth();
  const [query, setQuery] = useState('');
  const q = useDebounced(query);
  const [results, setResults] = useState<AdminUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!token || q.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    api
      .listUsers(token, { q: q.trim(), limit: 8 })
      .then((res) => !cancelled && setResults(res.users ?? []))
      .catch(() => !cancelled && setResults([]))
      .finally(() => !cancelled && setSearching(false));
    return () => {
      cancelled = true;
    };
  }, [token, q]);

  async function assign(user: AdminUser, roleId: string) {
    if (!token) return;
    setBusyId(user.id);
    setMessage(null);
    try {
      const res = await api.setUserRole(token, user.id, roleId || null);
      setResults((prev) =>
        prev.map((u) => (u.id === res.user.id ? { ...u, admin_role_id: res.user.admin_role_id, admin_role_name: res.user.admin_role_name } : u)),
      );
      setMessage(`${user.display_name || user.email} is now ${res.user.admin_role_name || 'without an admin role'}.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not assign role');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="card settings-panel">
      <header className="settings-panel-head">
        <span className="settings-panel-icon">
          <UserCog size={18} strokeWidth={2} />
        </span>
        <div className="settings-panel-title">
          <h3>Give someone a role</h3>
          <p>Only admin accounts can hold a role. Changes apply on their next request.</p>
        </div>
      </header>
      <div className="settings-panel-body stack">
        <label className="catalog-search">
          {searching ? <Loader2 size={16} className="spin" /> : <Search size={16} strokeWidth={2} />}
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type a name or email…" aria-label="Find a user" />
        </label>
        {message ? <p className="muted" style={{ margin: 0, fontSize: 13 }}>{message}</p> : null}
        {results.length ? (
          <ul className="assign-list">
            {results.map((u) => {
              const admin = u.role === 'admin';
              return (
                <li key={u.id}>
                  <span className="audit-avatar">{(u.display_name || u.email).slice(0, 2).toUpperCase()}</span>
                  <span className="cell-stack" style={{ flex: 1 }}>
                    <span>{u.display_name || u.email}</span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {u.email}
                    </span>
                  </span>
                  {admin ? (
                    <select
                      className="inline-select"
                      value={u.admin_role_id || ''}
                      disabled={busyId === u.id}
                      onChange={(e) => void assign(u, e.target.value)}
                      aria-label={`Role for ${u.email}`}
                    >
                      <option value="">No role</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="badge badge-muted" title="Only admin accounts can hold a role">
                      not an admin
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : q.trim().length >= 2 && !searching ? (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            No accounts match “{q}”.
          </p>
        ) : null}
      </div>
    </section>
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
