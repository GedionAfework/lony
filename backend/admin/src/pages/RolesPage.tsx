import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Check,
  History,
  Loader2,
  Lock,
  LogOut,
  Plus,
  Search,
  Trash2,
  UserMinus,
  UserPlus,
  X,
} from 'lucide-react';
import { api, type AdminMember, type AdminRole, type AdminUser, type Permission } from '../api';
import { useAuth } from '../auth';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { relativeTime } from '../lib/audit';

/* ================================================================ model */

const SUPER = 'Super Admin';

const AREAS: { id: string; label: string; hint: string }[] = [
  { id: 'insights', label: 'Insights', hint: 'Dashboards and metrics' },
  { id: 'users', label: 'Users', hint: 'Accounts, plans and sessions' },
  { id: 'access', label: 'Admin access', hint: 'The admin team and its roles' },
  { id: 'system', label: 'System & controls', hint: 'Health, jobs and platform switches' },
  { id: 'audit', label: 'Audit', hint: 'The record of admin actions' },
  { id: 'content', label: 'Content', hint: 'Catalogs, themes and languages' },
];

const TEMPLATES: { id: string; label: string; hint: string; perms: string[] }[] = [
  {
    id: 'viewer',
    label: 'Read-only',
    hint: 'Can look at everything, change nothing',
    perms: ['overview.read', 'system.read', 'users.read', 'roles.read', 'audit.read', 'categories.read', 'themes.read', 'localization.read'],
  },
  {
    id: 'support',
    label: 'Support',
    hint: 'Help users: suspend, sign out, change plans',
    perms: ['overview.read', 'users.read', 'users.suspend', 'users.sessions', 'users.plan', 'audit.read'],
  },
  {
    id: 'content',
    label: 'Content editor',
    hint: 'Catalogs, themes and languages',
    perms: ['overview.read', 'categories.read', 'categories.write', 'themes.read', 'themes.write', 'localization.read', 'localization.manage'],
  },
  {
    id: 'ops',
    label: 'Operations',
    hint: 'System health and platform controls',
    perms: ['overview.read', 'system.read', 'system.jobs', 'settings.platform', 'settings.ai', 'audit.read'],
  },
  {
    id: 'auditor',
    label: 'Auditor',
    hint: 'Review and export the audit trail',
    perms: ['overview.read', 'audit.read', 'audit.export', 'roles.read', 'users.read'],
  },
];

const isLocked = (r: AdminRole) => r.is_system && r.name === SUPER;

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Adds everything a set of permissions depends on. */
function withRequires(codes: Set<string>, perms: Permission[]) {
  const req = new Map(perms.map((p) => [p.code, p.requires ?? []]));
  const out = new Set(codes);
  const stack = [...codes];
  while (stack.length) {
    for (const dep of req.get(stack.pop()!) ?? []) {
      if (!out.has(dep)) {
        out.add(dep);
        stack.push(dep);
      }
    }
  }
  return out;
}

/** Removes a permission and everything that needs it. */
function withoutDependents(codes: Set<string>, code: string, perms: Permission[]) {
  const out = new Set(codes);
  const drop = [code];
  while (drop.length) {
    const c = drop.pop()!;
    out.delete(c);
    for (const p of perms) if (out.has(p.code) && (p.requires ?? []).includes(c)) drop.push(p.code);
  }
  return out;
}

function groupByArea(perms: Permission[]) {
  const map = new Map<string, Permission[]>();
  for (const p of perms) map.set(p.area || 'other', [...(map.get(p.area || 'other') ?? []), p]);
  const known = AREAS.filter((a) => map.has(a.id)).map((a) => ({ ...a, perms: map.get(a.id)! }));
  const extra = [...map.keys()].filter((k) => !AREAS.some((a) => a.id === k)).map((k) => ({ id: k, label: k, hint: '', perms: map.get(k)! }));
  return [...known, ...extra];
}

/* ================================================================ page */

type Tab = 'team' | 'roles' | 'matrix';

export function TeamPage() {
  const { token, me, hasPerm } = useAuth();
  const canAssign = hasPerm('roles.assign');
  const canManage = hasPerm('roles.manage');
  const myPerms = useMemo(() => new Set(me?.admin_permissions ?? []), [me]);
  const amSuper = !me?.admin_role || me.admin_role === SUPER;

  const [tab, setTab] = useState<Tab>(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    return t === 'roles' || t === 'matrix' ? t : 'team';
  });
  const [admins, setAdmins] = useState<AdminMember[]>([]);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [perms, setPerms] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ id: string; label: string } | true | null>(() => {
    const p = new URLSearchParams(window.location.search);
    const id = p.get('add');
    return id ? { id, label: p.get('label') ?? '' } : null;
  });
  const [selectedRole, setSelectedRole] = useState<string | 'new' | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('add');
    url.searchParams.delete('label');
    if (tab === 'team') url.searchParams.delete('tab');
    else url.searchParams.set('tab', tab);
    window.history.replaceState({}, '', url.toString());
  }, [tab]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [a, r, p] = await Promise.all([api.listAdmins(token), api.listRoles(token), api.listPermissions(token)]);
      setAdmins(a.admins ?? []);
      setRoles(r.roles ?? []);
      setPerms((p.permissions ?? []).slice().sort((x, y) => x.sort_order - y.sort_order));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load admin access');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Can the current admin hand out this role? Mirrors the server rule. */
  const grantable = useCallback(
    (r: AdminRole) => amSuper || (r.name !== SUPER && r.permissions.every((p) => myPerms.has(p))),
    [amSuper, myPerms],
  );

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice((cur) => (cur === msg ? null : cur)), 3000);
  };

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-header-title">
          <h1>Admins &amp; roles</h1>
        </div>
        <div className="page-header-actions">
          {canManage ? (
            <Button
              variant="secondary"
              icon={<Plus size={15} strokeWidth={2} />}
              onClick={() => {
                setTab('roles');
                setSelectedRole('new');
              }}
            >
              New role
            </Button>
          ) : null}
          {canAssign ? (
            <Button icon={<UserPlus size={15} strokeWidth={2} />} onClick={() => setAdding(true)}>
              Add admin
            </Button>
          ) : null}
        </div>
      </div>

      <div className="cat-tabs" role="tablist">
        {(
          [
            ['team', 'Team', admins.length],
            ['roles', 'Roles', roles.length],
            ['matrix', 'Access matrix', null],
          ] as const
        ).map(([id, label, count]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`cat-tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
            <span className="cat-tab-text">
              <b>{label}</b>
            </span>
            {count != null && !loading ? <span className="seg-count">{count}</span> : null}
          </button>
        ))}
      </div>

      {error ? (
        <div className="alert alert-error">
          <AlertTriangle size={16} strokeWidth={2} />
          <span>{error}</span>
          <button type="button" className="link-btn" style={{ marginLeft: 'auto' }} onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {notice ? <div className="alert banner-success">{notice}</div> : null}

      {loading && !perms.length ? (
        <div className="skeleton" style={{ height: 360 }} />
      ) : tab === 'team' ? (
        <TeamTab admins={admins} roles={roles} grantable={grantable} amSuper={amSuper} onChanged={load} onError={setError} onNotice={flash} />
      ) : tab === 'roles' ? (
        <RolesTab
          roles={roles}
          perms={perms}
          myPerms={myPerms}
          amSuper={amSuper}
          canManage={canManage}
          selected={selectedRole}
          onSelect={setSelectedRole}
          onChanged={load}
          onNotice={flash}
        />
      ) : (
        <MatrixTab roles={roles} perms={perms} canManage={canManage} myPerms={myPerms} amSuper={amSuper} onRoles={setRoles} onError={setError} />
      )}

      {adding ? (
        <AddAdminModal
          roles={roles}
          perms={perms}
          grantable={grantable}
          preset={adding === true ? null : adding}
          onClose={() => setAdding(null)}
          onDone={async (msg) => {
            setAdding(null);
            flash(msg);
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

/* ================================================================ team */

type TeamAction = { kind: 'remove' | 'signout'; member: AdminMember };

function TeamTab({
  admins,
  roles,
  grantable,
  amSuper,
  onChanged,
  onError,
  onNotice,
}: {
  admins: AdminMember[];
  roles: AdminRole[];
  grantable: (r: AdminRole) => boolean;
  amSuper: boolean;
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}) {
  const { token, me, hasPerm } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [action, setAction] = useState<TeamAction | null>(null);
  const canAssign = hasPerm('roles.assign');
  const canSessions = hasPerm('users.sessions');

  const shown = admins.filter((a) => {
    const s = q.trim().toLowerCase();
    return !s || a.display_name.toLowerCase().includes(s) || a.email.toLowerCase().includes(s) || (a.admin_role_name ?? '').toLowerCase().includes(s);
  });

  async function changeRole(m: AdminMember, roleId: string) {
    if (!token) return;
    setBusyId(m.id);
    try {
      const res = await api.setUserRole(token, m.id, roleId || null);
      onNotice(`${m.display_name || m.email} is now ${res.user.admin_role_name || 'without a role'}.`);
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not change role');
    } finally {
      setBusyId(null);
    }
  }

  async function runAction() {
    if (!token || !action) return;
    const m = action.member;
    setBusyId(m.id);
    try {
      if (action.kind === 'remove') {
        await api.setAdminAccess(token, m.id, false);
        onNotice(`${m.display_name || m.email} is no longer an admin.`);
      } else {
        await api.revokeSessions(token, m.id);
        onNotice(`${m.display_name || m.email} was signed out everywhere.`);
      }
      setAction(null);
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Action failed');
      setAction(null);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="card team-card">
      <div className="team-toolbar">
        <label className="catalog-search">
          <Search size={15} strokeWidth={2} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search admins…" aria-label="Search admins" />
        </label>
        <span className="muted team-count">
          {shown.length} of {admins.length}
        </span>
      </div>
      <div className="lt-table-scroll">
        <table className="lt-table team-table">
          <thead>
            <tr>
              <th>Admin</th>
              <th>Role</th>
              <th>Last active</th>
              <th className="num">Sessions</th>
              <th className="num">Actions · 30d</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => {
              const self = m.id === me?.id;
              const isSuper = m.admin_role_name === SUPER;
              const roleEditable = canAssign && !self && (!isSuper || amSuper);
              const name = m.display_name || m.email;
              return (
                <tr key={m.id}>
                  <td>
                    <div className="user-cell">
                      <span className="ov-avatar">{initials(name)}</span>
                      <div className="cell-stack">
                        <strong>
                          {name}
                          {self ? <span className="badge badge-muted team-you">You</span> : null}
                        </strong>
                        <span className="muted">{m.email}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    {roleEditable ? (
                      <select
                        className="inline-select"
                        value={m.admin_role_id ?? ''}
                        disabled={busyId === m.id}
                        onChange={(e) => void changeRole(m, e.target.value)}
                        aria-label={`Role for ${name}`}
                      >
                        {!m.admin_role_id ? <option value="">Full access (legacy)</option> : null}
                        {roles.map((r) => (
                          <option key={r.id} value={r.id} disabled={!grantable(r) && r.id !== m.admin_role_id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="team-role">
                        {isSuper ? <Lock size={12} strokeWidth={2} /> : null}
                        {m.admin_role_name || 'Full access (legacy)'}
                      </span>
                    )}
                    {m.status !== 'active' ? <span className="badge badge-warning" style={{ marginLeft: 6 }}>{m.status}</span> : null}
                  </td>
                  <td>
                    {m.last_active_at ? (
                      <span title={new Date(m.last_active_at).toLocaleString()}>{relativeTime(m.last_active_at)}</span>
                    ) : (
                      <span className="muted">Never</span>
                    )}
                  </td>
                  <td className="num">{m.active_sessions}</td>
                  <td className="num">{m.actions_30d}</td>
                  <td className="num">
                    <div className="row-actions">
                      <button
                        type="button"
                        className="shell-icon-btn"
                        title="View their actions"
                        aria-label="View their actions"
                        onClick={() => navigate(`/audit?actor=${m.id}&actor_label=${encodeURIComponent(name)}`)}
                      >
                        <History size={15} strokeWidth={2} />
                      </button>
                      {canSessions && !self && (!isSuper || amSuper) ? (
                        <button
                          type="button"
                          className="shell-icon-btn"
                          title="Sign out everywhere"
                          aria-label="Sign out everywhere"
                          disabled={busyId === m.id || m.active_sessions === 0}
                          onClick={() => setAction({ kind: 'signout', member: m })}
                        >
                          <LogOut size={15} strokeWidth={2} />
                        </button>
                      ) : null}
                      {canAssign && !self && (!isSuper || amSuper) ? (
                        <button
                          type="button"
                          className="shell-icon-btn danger"
                          title="Remove admin access"
                          aria-label="Remove admin access"
                          disabled={busyId === m.id}
                          onClick={() => setAction({ kind: 'remove', member: m })}
                        >
                          <UserMinus size={15} strokeWidth={2} />
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!shown.length ? (
              <tr>
                <td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 32 }}>
                  No admins match “{q}”.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {action ? (
        <Modal
          open
          title={
            action.kind === 'remove'
              ? `Remove ${action.member.display_name || action.member.email} from the admin team?`
              : `Sign ${action.member.display_name || action.member.email} out everywhere?`
          }
          subtitle={action.member.email}
          onClose={() => setAction(null)}
          footer={
            <>
              <Button size="sm" variant="secondary" onClick={() => setAction(null)} disabled={busyId !== null}>
                Cancel
              </Button>
              <Button size="sm" variant="danger" busy={busyId === action.member.id} onClick={() => void runAction()}>
                {action.kind === 'remove' ? 'Remove access' : 'Sign out'}
              </Button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            {action.kind === 'remove'
              ? 'They lose access to this console immediately. Their user account stays as it is.'
              : `All ${action.member.active_sessions} active session${action.member.active_sessions === 1 ? '' : 's'} end now. They can sign in again.`}
          </p>
        </Modal>
      ) : null}
    </section>
  );
}

/* ================================================================ add admin */

function AddAdminModal({
  roles,
  perms,
  grantable,
  preset,
  onClose,
  onDone,
}: {
  roles: AdminRole[];
  perms: Permission[];
  grantable: (r: AdminRole) => boolean;
  preset: { id: string; label: string } | null;
  onClose: () => void;
  onDone: (msg: string) => Promise<void>;
}) {
  const { token } = useAuth();
  const [query, setQuery] = useState('');
  const q = useDebounced(query);
  const [results, setResults] = useState<AdminUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [user, setUser] = useState<{ id: string; label: string; email?: string; isAdmin?: boolean } | null>(preset);
  const [roleId, setRoleId] = useState<string>(() => roles.find((r) => grantable(r) && !isLocked(r))?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token || user || q.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    api
      .listUsers(token, { q: q.trim(), limit: 6, status: 'active' })
      .then((res) => !cancelled && setResults(res.users ?? []))
      .catch(() => !cancelled && setResults([]))
      .finally(() => !cancelled && setSearching(false));
    return () => {
      cancelled = true;
    };
  }, [token, q, user]);

  const role = roles.find((r) => r.id === roleId);
  const areas = useMemo(() => groupByArea(perms), [perms]);

  async function submit() {
    if (!token || !user || !role) return;
    setBusy(true);
    setErr(null);
    try {
      await api.setAdminAccess(token, user.id, true, role.id);
      await onDone(`${user.label || user.email} is now ${role.name}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not grant access');
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      width={560}
      title="Add an admin"
      subtitle="Give an existing account access to this console."
      onClose={onClose}
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" busy={busy} disabled={!user || !role || !grantable(role)} onClick={() => void submit()}>
            Grant access
          </Button>
        </>
      }
    >
      <div className="stack">
        {err ? (
          <div className="alert alert-error">
            <AlertTriangle size={16} strokeWidth={2} />
            <span>{err}</span>
          </div>
        ) : null}

        <div className="field">
          <span className="field-label">Person</span>
          {user ? (
            <div className="add-picked">
              <span className="ov-avatar">{initials(user.label || user.email || '?')}</span>
              <span className="cell-stack" style={{ flex: 1 }}>
                <span>{user.label || user.email}</span>
                {user.email && user.label ? <small className="muted">{user.email}</small> : null}
              </span>
              {user.isAdmin ? <span className="badge badge-muted">already admin</span> : null}
              <button type="button" className="shell-icon-btn" aria-label="Choose someone else" onClick={() => setUser(null)}>
                <X size={15} strokeWidth={2} />
              </button>
            </div>
          ) : (
            <>
              <label className="catalog-search">
                {searching ? <Loader2 size={15} className="spin" /> : <Search size={15} strokeWidth={2} />}
                <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or email…" aria-label="Find a user" />
              </label>
              {results.length ? (
                <ul className="add-results">
                  {results.map((u) => (
                    <li key={u.id}>
                      <button
                        type="button"
                        onClick={() => setUser({ id: u.id, label: u.display_name, email: u.email, isAdmin: u.role === 'admin' })}
                      >
                        <span className="ov-avatar">{initials(u.display_name || u.email)}</span>
                        <span className="cell-stack" style={{ flex: 1 }}>
                          <span>{u.display_name || u.email}</span>
                          <small className="muted">{u.email}</small>
                        </span>
                        {u.role === 'admin' ? <span className="badge badge-muted">{u.admin_role_name || 'admin'}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : q.trim().length >= 2 && !searching ? (
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  No active accounts match “{q}”.
                </p>
              ) : null}
            </>
          )}
        </div>

        <div className="field">
          <span className="field-label">Role</span>
          <div className="role-pick">
            {roles.map((r) => {
              const ok = grantable(r);
              return (
                <label key={r.id} className={`role-pick-item${roleId === r.id ? ' on' : ''}${ok ? '' : ' disabled'}`} title={ok ? undefined : 'You can’t grant access you don’t have'}>
                  <input type="radio" name="role" value={r.id} checked={roleId === r.id} disabled={!ok} onChange={() => setRoleId(r.id)} />
                  <span className="cell-stack" style={{ flex: 1 }}>
                    <span>
                      {r.name} {!ok ? <Lock size={11} strokeWidth={2} /> : null}
                    </span>
                    <small className="muted">{r.description || `${r.permissions.length} permissions`}</small>
                  </span>
                  <span className="muted role-pick-count">
                    {r.permissions.length}/{perms.length}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {role ? (
          <div className="role-preview">
            <span className="field-label">They will be able to</span>
            <ul>
              {areas.map((a) => {
                const on = a.perms.filter((p) => role.permissions.includes(p.code));
                if (!on.length) return null;
                return (
                  <li key={a.id}>
                    <b>{a.label}:</b> {on.map((p) => p.label.toLowerCase()).join(', ')}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/* ================================================================ roles */

function RolesTab({
  roles,
  perms,
  myPerms,
  amSuper,
  canManage,
  selected,
  onSelect,
  onChanged,
  onNotice,
}: {
  roles: AdminRole[];
  perms: Permission[];
  myPerms: Set<string>;
  amSuper: boolean;
  canManage: boolean;
  selected: string | 'new' | null;
  onSelect: (id: string | 'new' | null) => void;
  onChanged: () => Promise<void>;
  onNotice: (msg: string) => void;
}) {
  const current = selected === 'new' ? null : roles.find((r) => r.id === selected) ?? roles[0] ?? null;
  const isNew = selected === 'new';

  return (
    <div className="roles-layout">
      <aside className="card roles-list">
        {roles.map((r) => {
          const active = !isNew && current?.id === r.id;
          return (
            <button key={r.id} type="button" className={`roles-list-item${active ? ' active' : ''}`} onClick={() => onSelect(r.id)}>
              <span className="cell-stack" style={{ flex: 1, minWidth: 0 }}>
                <span className="roles-list-name">
                  {r.name}
                  {isLocked(r) ? <Lock size={11} strokeWidth={2} /> : null}
                </span>
                <small className="muted">
                  {r.member_count ?? 0} {r.member_count === 1 ? 'admin' : 'admins'} · {r.permissions.length} permissions
                </small>
              </span>
            </button>
          );
        })}
        {canManage ? (
          <button type="button" className={`roles-list-item roles-list-new${isNew ? ' active' : ''}`} onClick={() => onSelect('new')}>
            <Plus size={14} strokeWidth={2} /> New role
          </button>
        ) : null}
      </aside>

      <RoleEditor
        key={isNew ? 'new' : current?.id ?? 'none'}
        role={isNew ? null : current}
        perms={perms}
        myPerms={myPerms}
        amSuper={amSuper}
        canManage={canManage}
        onSaved={async (role, msg) => {
          await onChanged();
          if (role) onSelect(role.id);
          onNotice(msg);
        }}
        onDeleted={async (msg) => {
          onSelect(null);
          await onChanged();
          onNotice(msg);
        }}
      />
    </div>
  );
}

function RoleEditor({
  role,
  perms,
  myPerms,
  amSuper,
  canManage,
  onSaved,
  onDeleted,
}: {
  role: AdminRole | null;
  perms: Permission[];
  myPerms: Set<string>;
  amSuper: boolean;
  canManage: boolean;
  onSaved: (role: AdminRole | null, msg: string) => Promise<void>;
  onDeleted: (msg: string) => Promise<void>;
}) {
  const { token } = useAuth();
  const locked = role ? isLocked(role) : false;
  const readOnly = !canManage || locked;
  const initial = useMemo(() => new Set(role?.permissions ?? []), [role]);
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [selected, setSelected] = useState<Set<string>>(() => (locked ? new Set(perms.map((p) => p.code)) : new Set(initial)));
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const areas = useMemo(() => groupByArea(perms), [perms]);
  const byCode = useMemo(() => new Map(perms.map((p) => [p.code, p])), [perms]);
  const canTouch = (code: string) => !readOnly && (amSuper || myPerms.has(code));

  const added = [...selected].filter((c) => !initial.has(c));
  const removed = [...initial].filter((c) => !selected.has(c));
  const dirty =
    !locked &&
    (role === null
      ? name.trim() !== '' || selected.size > 0
      : added.length > 0 || removed.length > 0 || name.trim() !== role.name || description.trim() !== (role.description ?? ''));

  function toggle(code: string) {
    if (!canTouch(code)) return;
    setSelected((cur) => (cur.has(code) ? withoutDependents(cur, code, perms) : withRequires(new Set([...cur, code]), perms)));
  }

  function setAreaLevel(areaPerms: Permission[], level: 'none' | 'view' | 'all') {
    setSelected((cur) => {
      let next = new Set(cur);
      for (const p of areaPerms) {
        if (!canTouch(p.code)) continue;
        const want = level === 'all' || (level === 'view' && p.level === 'read');
        if (want) next.add(p.code);
        else next = withoutDependents(next, p.code, perms);
      }
      return withRequires(next, perms);
    });
  }

  function applyTemplate(codes: string[]) {
    setSelected(withRequires(new Set(codes.filter((c) => byCode.has(c) && (amSuper || myPerms.has(c)))), perms));
  }

  async function save() {
    if (!token || !name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const body = { name: name.trim(), description: description.trim(), permissions: [...selected] };
      if (role === null) {
        const res = await api.createRole(token, body);
        await onSaved(res.role, `Role “${res.role.name}” created.`);
      } else {
        const res = await api.updateRole(token, role.id, role.is_system ? { description: body.description, permissions: body.permissions } : body);
        await onSaved(res.role, `“${res.role.name}” saved.`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save role');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!token || !role) return;
    setBusy(true);
    try {
      await api.deleteRole(token, role.id);
      await onDeleted(`Role “${role.name}” deleted.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not delete role');
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  }

  function discard() {
    setName(role?.name ?? '');
    setDescription(role?.description ?? '');
    setSelected(new Set(initial));
  }

  if (!role && !canManage) {
    return <section className="card role-editor muted">Pick a role to see what it can do.</section>;
  }

  const f = filter.trim().toLowerCase();

  return (
    <section className="card role-editor">
      <header className="role-editor-head">
        <div className="role-editor-fields">
          <input
            className="role-name-input"
            value={name}
            placeholder="Role name"
            disabled={readOnly || Boolean(role?.is_system)}
            onChange={(e) => setName(e.target.value)}
            aria-label="Role name"
            autoFocus={role === null}
          />
          <input
            className="role-desc-input"
            value={description}
            placeholder="What is this role for?"
            disabled={readOnly}
            onChange={(e) => setDescription(e.target.value)}
            aria-label="Description"
          />
        </div>
        <div className="role-editor-meta">
          {role ? (
            <span className="muted">
              {role.member_count ?? 0} {role.member_count === 1 ? 'admin' : 'admins'}
            </span>
          ) : null}
          <span className="badge">
            {selected.size}/{perms.length}
          </span>
        </div>
      </header>

      {err ? (
        <div className="alert alert-error" style={{ margin: '0 18px 12px' }}>
          <AlertTriangle size={16} strokeWidth={2} />
          <span>{err}</span>
        </div>
      ) : null}

      {locked ? (
        <div className="role-locked">
          <Lock size={14} strokeWidth={2} /> Super Admin always holds every permission. It can’t be narrowed or deleted.
        </div>
      ) : !canManage ? (
        <div className="role-locked">
          <Lock size={14} strokeWidth={2} /> You can view roles but need “Edit roles” to change them.
        </div>
      ) : (
        <div className="role-templates">
          <span className="muted">Start from</span>
          {TEMPLATES.map((t) => (
            <button key={t.id} type="button" className="chip-btn" title={t.hint} onClick={() => applyTemplate(t.perms)}>
              {t.label}
            </button>
          ))}
          <button type="button" className="chip-btn" onClick={() => setSelected(new Set())}>
            Clear all
          </button>
          <label className="catalog-search role-filter">
            <Search size={14} strokeWidth={2} />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter…" aria-label="Filter permissions" />
          </label>
        </div>
      )}

      <div className="perm-areas">
        {areas.map((a) => {
          const list = a.perms.filter((p) => !f || p.label.toLowerCase().includes(f) || p.code.includes(f) || p.description.toLowerCase().includes(f));
          if (!list.length) return null;
          const onCount = a.perms.filter((p) => selected.has(p.code)).length;
          const readCodes = a.perms.filter((p) => p.level === 'read').map((p) => p.code);
          const level =
            onCount === 0
              ? 'none'
              : onCount === a.perms.length
                ? 'all'
                : onCount === readCodes.length && readCodes.every((c) => selected.has(c))
                  ? 'view'
                  : 'custom';
          const hasWrite = a.perms.some((p) => p.level !== 'read');
          return (
            <section key={a.id} className="perm-block">
              <header className="perm-block-head">
                <div className="cell-stack">
                  <strong>{a.label}</strong>
                  <small className="muted">{a.hint}</small>
                </div>
                <div className="level-seg" role="radiogroup" aria-label={`${a.label} access`}>
                  <button type="button" role="radio" aria-checked={level === 'none'} className={level === 'none' ? 'active' : ''} disabled={readOnly} onClick={() => setAreaLevel(a.perms, 'none')}>
                    None
                  </button>
                  {hasWrite ? (
                    <button type="button" role="radio" aria-checked={level === 'view'} className={level === 'view' ? 'active' : ''} disabled={readOnly} onClick={() => setAreaLevel(a.perms, 'view')}>
                      View
                    </button>
                  ) : null}
                  {level === 'custom' ? (
                    <span className="level-custom" aria-current="true">
                      Custom
                    </span>
                  ) : null}
                  <button type="button" role="radio" aria-checked={level === 'all'} className={level === 'all' ? 'active' : ''} disabled={readOnly} onClick={() => setAreaLevel(a.perms, 'all')}>
                    {hasWrite ? 'Full' : 'View'}
                  </button>
                </div>
              </header>
              <ul className="perm-rows">
                {list.map((p) => {
                  const on = selected.has(p.code);
                  const touchable = canTouch(p.code);
                  const needs = (p.requires ?? []).map((c) => byCode.get(c)?.label).filter(Boolean);
                  return (
                    <li key={p.code} className={`perm-row${on ? ' on' : ''}`}>
                      <div className="cell-stack" style={{ flex: 1, minWidth: 0 }}>
                        <span className="perm-row-title">
                          {p.label}
                          {p.level === 'danger' ? <span className="badge badge-warning">Sensitive</span> : null}
                          {!touchable && !readOnly ? (
                            <span className="perm-lock" title="You don’t hold this permission, so you can’t grant it">
                              <Lock size={11} strokeWidth={2} />
                            </span>
                          ) : null}
                        </span>
                        <small className="muted">
                          {p.description}
                          {needs.length ? <span className="perm-needs"> · Needs {needs.join(', ')}</span> : null}
                        </small>
                      </div>
                      <code className="perm-code">{p.code}</code>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        aria-label={p.label}
                        className={`switch${on ? ' on' : ''}`}
                        disabled={!touchable}
                        onClick={() => toggle(p.code)}
                      >
                        <span />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      {!readOnly ? (
        <footer className={`role-editor-foot${dirty ? ' dirty' : ''}`}>
          {role && !role.is_system ? (
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 size={14} strokeWidth={2} />}
              disabled={busy || (role.member_count ?? 0) > 0}
              title={(role.member_count ?? 0) > 0 ? 'Move its admins to another role first' : undefined}
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </Button>
          ) : null}
          <span className="role-diff">
            {dirty ? (
              <>
                {added.length ? <span className="diff-add">+{added.length}</span> : null}
                {removed.length ? <span className="diff-del">−{removed.length}</span> : null}
                <span className="muted">{role ? 'unsaved changes' : 'new role'}</span>
              </>
            ) : (
              <span className="muted">
                <Check size={13} strokeWidth={2} /> Saved
              </span>
            )}
          </span>
          {dirty && role ? (
            <Button size="sm" variant="secondary" onClick={discard} disabled={busy}>
              Discard
            </Button>
          ) : null}
          <Button size="sm" busy={busy} disabled={!dirty || !name.trim()} onClick={() => void save()}>
            {role ? 'Save changes' : 'Create role'}
          </Button>
        </footer>
      ) : null}

      {confirmDelete && role ? (
        <Modal
          open
          title={`Delete “${role.name}”?`}
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <Button size="sm" variant="secondary" onClick={() => setConfirmDelete(false)} disabled={busy}>
                Cancel
              </Button>
              <Button size="sm" variant="danger" busy={busy} onClick={() => void remove()}>
                Delete role
              </Button>
            </>
          }
        >
          <p style={{ margin: 0 }}>Nobody holds this role, so nothing else changes. This can’t be undone.</p>
        </Modal>
      ) : null}
    </section>
  );
}

/* ================================================================ matrix */

function MatrixTab({
  roles,
  perms,
  canManage,
  myPerms,
  amSuper,
  onRoles,
  onError,
}: {
  roles: AdminRole[];
  perms: Permission[];
  canManage: boolean;
  myPerms: Set<string>;
  amSuper: boolean;
  onRoles: (fn: (rs: AdminRole[]) => AdminRole[]) => void;
  onError: (msg: string) => void;
}) {
  const { token } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const areas = useMemo(() => groupByArea(perms), [perms]);

  async function flip(role: AdminRole, code: string) {
    if (!token || isLocked(role) || !canManage) return;
    const cur = new Set(role.permissions);
    const next = cur.has(code) ? withoutDependents(cur, code, perms) : withRequires(new Set([...cur, code]), perms);
    const list = [...next];
    setBusy(`${role.id}:${code}`);
    onRoles((rs) => rs.map((r) => (r.id === role.id ? { ...r, permissions: list } : r)));
    try {
      const res = await api.updateRole(token, role.id, { permissions: list });
      onRoles((rs) => rs.map((r) => (r.id === role.id ? { ...r, ...res.role } : r)));
    } catch (e) {
      onRoles((rs) => rs.map((r) => (r.id === role.id ? role : r)));
      onError(e instanceof Error ? e.message : 'Could not update role');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card matrix-card">
      <div className="lt-table-scroll">
        <table className="lt-table matrix">
          <thead>
            <tr>
              <th>Permission</th>
              {roles.map((r) => (
                <th key={r.id} className="matrix-role">
                  <span>
                    {isLocked(r) ? <Lock size={11} strokeWidth={2} /> : null} {r.name}
                  </span>
                  <small className="muted">{r.member_count ?? 0}</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {areas.map((a) => [
              <tr key={`h-${a.id}`} className="matrix-area">
                <td colSpan={roles.length + 1}>{a.label}</td>
              </tr>,
              ...a.perms.map((p) => (
                <tr key={p.code}>
                  <td>
                    <span className="cell-stack">
                      <span>
                        {p.label} {p.level === 'danger' ? <span className="badge badge-warning">Sensitive</span> : null}
                      </span>
                      <small className="muted mono">{p.code}</small>
                    </span>
                  </td>
                  {roles.map((r) => {
                    const on = isLocked(r) || r.permissions.includes(p.code);
                    const key = `${r.id}:${p.code}`;
                    const disabled = isLocked(r) || !canManage || busy !== null || !(amSuper || myPerms.has(p.code));
                    return (
                      <td key={r.id} className="matrix-cell">
                        <button
                          type="button"
                          className={`matrix-toggle${on ? ' on' : ''}`}
                          disabled={disabled}
                          aria-pressed={on}
                          aria-label={`${p.label} for ${r.name}`}
                          title={isLocked(r) ? 'Super Admin always has every permission' : on ? 'Remove' : 'Grant'}
                          onClick={() => void flip(r, p.code)}
                        >
                          {busy === key ? <Loader2 size={12} className="spin" /> : on ? <Check size={13} strokeWidth={2.5} /> : null}
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
      <div className="lt-table-footer muted matrix-foot">
        {canManage
          ? 'Click a cell to grant or remove. Dependencies are added or removed with it, changes save at once and are recorded in the audit log.'
          : 'You can view the matrix but need “Edit roles” to change it.'}
      </div>
    </section>
  );
}
