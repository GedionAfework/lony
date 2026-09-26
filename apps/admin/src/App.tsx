import { FormEvent, useEffect, useState } from 'react';
import { api, type AdminUser, type AuditEntry, type Overview, type PublicUser } from './api';
import { CatalogsPanel } from './CatalogsPanel';
import { CategoriesPanel } from './CategoriesPanel';

type Tab = 'overview' | 'users' | 'categories' | 'catalogs' | 'settings' | 'audit';

const TOKEN_KEY = 'lony_admin_token';

const NAV: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'users', label: 'Users' },
  { id: 'categories', label: 'Categories' },
  { id: 'catalogs', label: 'Catalogs' },
  { id: 'settings', label: 'Settings' },
  { id: 'audit', label: 'Audit' },
];

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [me, setMe] = useState<PublicUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [aiDisabled, setAIDisabled] = useState(false);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api
      .me(token)
      .then((res) => {
        if (cancelled) return;
        if (res.user.role !== 'admin') {
          throw new Error('This account is not an admin');
        }
        setMe(res.user);
      })
      .catch((e) => {
        if (cancelled) return;
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setMe(null);
        setError(e instanceof Error ? e.message : 'Session expired');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!token || !me) return;
    let cancelled = false;
    setError(null);
    if (tab === 'overview' || tab === 'settings') {
      Promise.all([api.overview(token), api.getSettings(token)])
        .then(([ov, settings]) => {
          if (cancelled) return;
          setOverview(ov.overview);
          setAIDisabled(Boolean(settings.settings?.ai_disabled));
        })
        .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Failed to load'));
    } else if (tab === 'users') {
      api
        .listUsers(token, q, status)
        .then((res) => {
          if (cancelled) return;
          setUsers(res.users ?? []);
          setTotal(res.total);
        })
        .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Failed to load'));
    } else if (tab === 'audit') {
      api
        .audit(token)
        .then((res) => {
          if (!cancelled) setAudit(res.audit ?? []);
        })
        .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Failed to load'));
    }
    return () => {
      cancelled = true;
    };
  }, [token, me, tab, q, status]);

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(email.trim(), password);
      if (res.user.role !== 'admin') {
        throw new Error('Signed in, but this account is not an admin. Set ADMIN_EMAILS or role=admin.');
      }
      localStorage.setItem(TOKEN_KEY, res.access_token);
      setToken(res.access_token);
      setMe(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setMe(null);
    setSelected(null);
  }

  async function openUser(id: string) {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.getUser(token, id);
      setSelected(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load user');
    } finally {
      setBusy(false);
    }
  }

  async function toggleSuspend() {
    if (!token || !selected) return;
    setBusy(true);
    setError(null);
    try {
      const res =
        selected.status === 'suspended'
          ? await api.unsuspend(token, selected.id)
          : await api.suspend(token, selected.id);
      setSelected(res.user);
      setUsers((prev) => prev.map((u) => (u.id === res.user.id ? { ...u, status: res.user.status } : u)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  async function setPlan(tier: 'free' | 'premium') {
    if (!token || !selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.setPlanTier(token, selected.id, tier);
      setSelected(res.user);
      setUsers((prev) =>
        prev.map((u) => (u.id === res.user.id ? { ...u, plan_tier: res.user.plan_tier } : u)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update plan');
    } finally {
      setBusy(false);
    }
  }

  if (!token || !me) {
    return (
      <div className="login-wrap">
        <form className="card login-card stack" onSubmit={onLogin}>
          <div>
            <h1 className="brand">
              Lony <span>Admin</span>
            </h1>
            <p className="muted">SaaS control panel — admin role required</p>
          </div>
          <label>
            Email
            <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="saas-shell">
      <aside className="saas-sidebar">
        <div className="saas-brand">
          <h1 className="brand">
            Lony <span>Admin</span>
          </h1>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
            {me.email}
          </p>
        </div>
        <nav className="saas-nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className="saas-nav-btn"
              aria-current={tab === item.id ? 'page' : undefined}
              onClick={() => {
                setTab(item.id);
                setSelected(null);
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <button className="btn" type="button" onClick={logout} style={{ marginTop: 'auto' }}>
          Sign out
        </button>
      </aside>

      <main className="saas-main">
        <header className="saas-header">
          <h2>{NAV.find((n) => n.id === tab)?.label}</h2>
        </header>

        {error ? <p className="error">{error}</p> : null}

        {tab === 'overview' && overview ? (
          <div className="grid" style={{ gap: 18 }}>
            <div className="grid kpi-grid">
              {(
                [
                  ['Users', overview.total_users],
                  ['Active', overview.active_users],
                  ['Suspended', overview.suspended_users],
                  ['Signups 7d', overview.signups_7d],
                  ['Signups 30d', overview.signups_30d],
                  ['DAU', overview.dau],
                  ['WAU', overview.wau],
                  ['Open loans', overview.open_loans],
                  ['Overdue', overview.overdue_loans],
                  ['Cashflow 7d', overview.cashflow_entries_7d],
                  ['AI insights 7d', overview.ai_insights_7d],
                  ['AI runs 7d', overview.ai_runs_7d ?? 0],
                  ['AI users 7d', overview.ai_users_7d ?? 0],
                  ['AI tokens 7d', overview.ai_tokens_7d ?? 0],
                  ['AI req today', overview.ai_requests_today ?? 0],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="card kpi">
                  <span className="muted">{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <div className="card row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong>AI features</strong>
                <p className="muted" style={{ margin: '4px 0 0' }}>
                  {aiDisabled ? 'Globally disabled' : 'Enabled (Premium users)'}
                </p>
              </div>
              <button
                type="button"
                className={`btn ${aiDisabled ? 'primary' : 'danger'}`}
                disabled={busy}
                onClick={async () => {
                  if (!token) return;
                  setBusy(true);
                  try {
                    const res = await api.setAIDisabled(token, !aiDisabled);
                    setAIDisabled(Boolean(res.settings?.ai_disabled));
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Could not update AI setting');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {aiDisabled ? 'Enable AI' : 'Disable AI'}
              </button>
            </div>
          </div>
        ) : null}

        {tab === 'users' ? (
          <div className="grid" style={{ gap: 18 }}>
            <div className="card row">
              <label style={{ flex: 1, minWidth: 180 }}>
                Search
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="email, name, username"
                />
              </label>
              <label>
                Status
                <select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">All</option>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                </select>
              </label>
              <span className="muted">{total} users</span>
            </div>

            <div className="card" style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Status</th>
                    <th>Plan</th>
                    <th>Role</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="clickable" onClick={() => openUser(u.id)}>
                      <td>{u.display_name}</td>
                      <td className="mono">{u.email}</td>
                      <td>
                        <span className={`badge ${u.status}`}>{u.status}</span>
                      </td>
                      <td>
                        <span className={`badge ${(u.plan_tier || 'free') === 'premium' ? 'active' : ''}`}>
                          {u.plan_tier || 'free'}
                        </span>
                      </td>
                      <td>{u.role}</td>
                      <td className="muted">{new Date(u.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selected ? (
              <div className="card stack">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <h2 style={{ margin: 0 }}>{selected.display_name}</h2>
                    <p className="muted mono" style={{ margin: '4px 0 0' }}>
                      {selected.email}
                    </p>
                  </div>
                  <div className="row">
                    <button
                      className={`btn ${(selected.plan_tier || 'free') === 'premium' ? '' : 'primary'}`}
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setPlan((selected.plan_tier || 'free') === 'premium' ? 'free' : 'premium')
                      }
                    >
                      {(selected.plan_tier || 'free') === 'premium' ? 'Downgrade to Free' : 'Grant Premium'}
                    </button>
                    <button
                      className={`btn ${selected.status === 'suspended' ? 'primary' : 'danger'}`}
                      type="button"
                      disabled={busy || selected.role === 'admin'}
                      onClick={toggleSuspend}
                    >
                      {selected.status === 'suspended' ? 'Unsuspend' : 'Suspend'}
                    </button>
                  </div>
                </div>
                <div className="grid kpi-grid">
                  <div>
                    <span className="muted">Plan</span>
                    <div className="mono">{selected.plan_tier || 'free'}</div>
                  </div>
                  <div>
                    <span className="muted">Trust</span>
                    <div>
                      <strong className="mono">{selected.trust_grade ?? '—'}</strong>{' '}
                      <span className="muted">{selected.trust_band ?? ''}</span>
                    </div>
                  </div>
                  <div>
                    <span className="muted">Open / overdue loans</span>
                    <div className="mono">
                      {selected.open_loans ?? 0} / {selected.overdue_loans ?? 0}
                    </div>
                  </div>
                  <div>
                    <span className="muted">Cashflow 30d</span>
                    <div className="mono">
                      {selected.cashflow_entries_30d ?? 0} · {selected.cashflow_volume_30d ?? '0'}
                    </div>
                  </div>
                  <div>
                    <span className="muted">Friends</span>
                    <div className="mono">{selected.friends_count ?? 0}</div>
                  </div>
                  <div>
                    <span className="muted">Last active</span>
                    <div>
                      {selected.last_active_at
                        ? new Date(selected.last_active_at).toLocaleString()
                        : '—'}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === 'categories' ? (
          <CategoriesPanel token={token} onError={(message) => setError(message)} />
        ) : null}

        {tab === 'catalogs' ? (
          <CatalogsPanel token={token} onError={(message) => setError(message)} />
        ) : null}

        {tab === 'settings' ? (
          <div className="grid" style={{ gap: 18 }}>
            <div className="card stack">
              <strong>AI global kill switch</strong>
              <p className="muted" style={{ margin: 0 }}>
                When disabled, Premium AI endpoints return AI_DISABLED. Plan tier still gates access when enabled.
              </p>
              <div className="row">
                <span className={`badge ${aiDisabled ? 'suspended' : 'active'}`}>
                  {aiDisabled ? 'disabled' : 'enabled'}
                </span>
                <button
                  type="button"
                  className={`btn ${aiDisabled ? 'primary' : 'danger'}`}
                  disabled={busy}
                  onClick={async () => {
                    if (!token) return;
                    setBusy(true);
                    try {
                      const res = await api.setAIDisabled(token, !aiDisabled);
                      setAIDisabled(Boolean(res.settings?.ai_disabled));
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'Could not update AI setting');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {aiDisabled ? 'Enable AI' : 'Disable AI'}
                </button>
              </div>
            </div>
            <div className="card stack">
              <strong>Billing note</strong>
              <p className="muted" style={{ margin: 0 }}>
                v1 uses admin-managed plan_tier (free / premium). Stripe checkout is out of scope.
              </p>
            </div>
          </div>
        ) : null}

        {tab === 'audit' ? (
          <div className="card" style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Target</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td className="muted">{new Date(a.created_at).toLocaleString()}</td>
                    <td className="mono">{a.actor_email || a.actor_id}</td>
                    <td>{a.action}</td>
                    <td className="mono">{a.target_user_id || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </main>
    </div>
  );
}
