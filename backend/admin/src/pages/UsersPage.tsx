import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDownCircle,
  ChevronLeft,
  ChevronRight,
  Copy,
  Crown,
  History,
  KeyRound,
  LogOut,
  Mail,
  Phone,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  Users as UsersIcon,
} from 'lucide-react';
import { api, type AdminUser, type AuditEntry } from '../api';
import { useAuth } from '../auth';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { ButtonGroup } from '../components/ButtonGroup';
import { PageHeader } from '../components/PageHeader';
import { Table, type TableColumn } from '../components/Table';
import { IconButton } from '../components/IconButton';
import { Drawer, DetailList } from '../components/Drawer';
import { actorName, describe, relativeTime } from '../lib/audit';

const LIMIT = 20;

type ConfirmKind = 'suspend' | 'plan' | 'sessions';

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
  return (
    <div className="page">
      <PageHeader title="Users" />
      <UsersPanel />
    </div>
  );
}

function UsersPanel() {
  const { token, hasPerm } = useAuth();
  const [q, setQ] = useState(() => new URLSearchParams(window.location.search).get('q') ?? '');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // A change that needs a second click: suspending, switching plan, or signing out.
  const [confirm, setConfirm] = useState<{ kind: ConfirmKind; user: AdminUser } | null>(null);
  const canSuspend = hasPerm('users.suspend');
  const canPlan = hasPerm('users.plan');
  const canSessions = hasPerm('users.sessions');
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

  async function signOut(user: AdminUser) {
    if (!token) return;
    setBusyId(user.id);
    setError(null);
    try {
      await api.revokeSessions(token, user.id);
      setNotice(`${user.display_name || user.email} was signed out on every device.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign them out');
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
        render: (u) => <span className={`badge badge-${statusTone(u.status)}`}>{u.status.replace('_', ' ')}</span>,
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
          u.role === 'admin' ? (
            <span className="team-role">
              <KeyRound size={12} strokeWidth={2} />
              {u.admin_role_name || 'Admin'}
            </span>
          ) : (
            <span className="muted">User</span>
          ),
      },
      {
        key: 'created',
        header: 'Joined',
        render: (u) => (
          <div className="cell-stack">
            <span style={{ fontWeight: 500 }}>{new Date(u.created_at).toLocaleDateString()}</span>
            {u.last_active_at ? (
              <span className="muted" style={{ fontSize: 12 }}>
                Active {relativeTime(u.last_active_at)}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        width: 130,
        render: (u) => (
          <div className="row-actions" onClick={(e) => e.stopPropagation()}>
            {canPlan ? (
              <IconButton
                size="sm"
                icon={(u.plan_tier || 'free') === 'premium' ? ArrowDownCircle : Crown}
                label={(u.plan_tier || 'free') === 'premium' ? 'Downgrade to Free' : 'Upgrade to Premium'}
                variant="ghost"
                disabled={busyId === u.id}
                onClick={() => setConfirm({ kind: 'plan', user: u })}
              />
            ) : null}
            {canSessions ? (
              <IconButton
                size="sm"
                icon={LogOut}
                label="Sign out everywhere"
                variant="ghost"
                disabled={busyId === u.id}
                onClick={() => setConfirm({ kind: 'sessions', user: u })}
              />
            ) : null}
            {canSuspend ? (
              <IconButton
                size="sm"
                icon={u.status === 'suspended' ? UserCheck : ShieldAlert}
                label={u.role === 'admin' ? 'Cannot suspend an admin' : u.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                variant={u.status === 'suspended' ? 'ghost' : 'danger'}
                disabled={busyId === u.id || u.role === 'admin'}
                onClick={() => setConfirm({ kind: 'suspend', user: u })}
              />
            ) : null}
          </div>
        ),
      },
    ],
    [busyId, canPlan, canSessions, canSuspend],
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
      {notice ? (
        <div className="alert banner-success" onClick={() => setNotice(null)}>
          <span>{notice}</span>
        </div>
      ) : null}

      <div className="status-chips" role="tablist" aria-label="Filter by status">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={status === f.id}
            className={`status-chip status-chip-${f.tone}${status === f.id ? ' active' : ''}`}
            onClick={() => setStatus(f.id)}
          >
            <i />
            {f.label}
          </button>
        ))}
      </div>

      <Table
        title="Users"
        subtitle={`${total.toLocaleString()} accounts`}
        toolbar={
          <>
            <input
              className="toolbar-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by email, name, or username…"
            />
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

      <UserDrawer
        user={detail}
        loading={detailLoading}
        busy={Boolean(detail && busyId === detail.id)}
        onClose={() => setDetail(null)}
        onPlan={(u) => setConfirm({ kind: 'plan', user: u })}
        onSuspend={(u) => setConfirm({ kind: 'suspend', user: u })}
        onSignOut={(u) => setConfirm({ kind: 'sessions', user: u })}
      />

      <ConfirmModal
        confirm={confirm}
        busy={Boolean(confirm && busyId === confirm.user.id)}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return;
          if (confirm.kind === 'suspend') await toggleSuspend(confirm.user);
          else if (confirm.kind === 'sessions') await signOut(confirm.user);
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
  confirm: { kind: ConfirmKind; user: AdminUser } | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  if (!confirm) return null;
  const u = confirm.user;
  if (confirm.kind === 'sessions') {
    return (
      <Modal
        open
        title={`Sign ${u.display_name} out everywhere?`}
        subtitle={u.email}
        onClose={onCancel}
        footer={
          <ButtonGroup>
            <Button size="sm" variant="secondary" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" variant="danger" onClick={() => void onConfirm()} disabled={busy}>
              {busy ? 'Working…' : 'Sign out'}
            </Button>
          </ButtonGroup>
        }
      >
        <p style={{ margin: 0 }}>Every active session on their phones and browsers ends now. They can sign in again with their password.</p>
      </Modal>
    );
  }
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

function statusTone(status: string) {
  if (status === 'active') return 'success';
  if (status === 'suspended') return 'warning';
  if (status === 'deleted' || status === 'deletion_pending') return 'error';
  return 'muted';
}

const STATUS_FILTERS: { id: string; label: string; tone: string }[] = [
  { id: '', label: 'All', tone: 'all' },
  { id: 'active', label: 'Active', tone: 'success' },
  { id: 'suspended', label: 'Suspended', tone: 'warning' },
  { id: 'deletion_pending', label: 'Deletion pending', tone: 'error' },
  { id: 'deleted', label: 'Deleted', tone: 'muted' },
];

type DrawerTab = 'profile' | 'activity' | 'history';

function UserDrawer({
  user: u,
  loading,
  busy,
  onClose,
  onPlan,
  onSuspend,
  onSignOut,
}: {
  user: AdminUser | null;
  loading: boolean;
  busy: boolean;
  onClose: () => void;
  onPlan: (u: AdminUser) => void;
  onSuspend: (u: AdminUser) => void;
  onSignOut: (u: AdminUser) => void;
}) {
  const { token, hasPerm } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<DrawerTab>('profile');
  const [history, setHistory] = useState<AuditEntry[] | null>(null);
  const [copied, setCopied] = useState(false);
  const userId = u?.id;

  useEffect(() => {
    setTab('profile');
    setHistory(null);
  }, [userId]);

  useEffect(() => {
    if (tab !== 'history' || !token || !userId || history) return;
    api
      .audit(token, { target_id: userId, limit: 25 })
      .then((res) => setHistory(res.audit ?? []))
      .catch(() => setHistory([]));
  }, [tab, token, userId, history]);

  if (!u) return null;
  const name = u.display_name || u.email;
  const premium = (u.plan_tier || 'free') === 'premium';
  const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleString() : '—');
  const canPlan = hasPerm('users.plan');
  const canSuspend = hasPerm('users.suspend');
  const canSessions = hasPerm('users.sessions');
  const canAccess = hasPerm('roles.assign');

  const profile: [ReactNode, ReactNode][] = [
    ['Username', u.username ? `@${u.username}` : '—'],
    ['Phone', u.phone_e164 || '—'],
    ['Email verified', u.email_verified == null ? '—' : u.email_verified ? 'Yes' : 'No'],
    ['Country', u.country_code || '—'],
    ['Currency', u.default_currency_code || '—'],
    ['Language', u.locale || '—'],
    ['Time zone', u.timezone || '—'],
    ['Admin role', u.admin_role_name || (u.role === 'admin' ? 'Admin (no role)' : '—')],
    ['Joined', fmtDate(u.created_at)],
    ['Last active', u.last_active_at ? `${relativeTime(u.last_active_at)} · ${fmtDate(u.last_active_at)}` : '—'],
  ];

  const tiles: { label: string; value: ReactNode; tone?: string }[] = [
    {
      label: 'Trust grade',
      value: u.trust_grade ? `${u.trust_grade}${u.trust_band ? ` · ${u.trust_band}` : ''}${u.trust_thin_history ? ' (thin)' : ''}` : '—',
    },
    { label: 'Friends', value: u.friends_count ?? '—' },
    { label: 'Loans borrowed', value: u.loans_as_borrower ?? '—' },
    { label: 'Loans lent', value: u.loans_as_lender ?? '—' },
    { label: 'Open loans', value: u.open_loans ?? '—' },
    { label: 'Overdue', value: u.overdue_loans ?? '—', tone: (u.overdue_loans ?? 0) > 0 ? 'warn' : undefined },
    { label: 'Entries · 30d', value: u.cashflow_entries_30d ?? '—' },
    { label: 'Volume · 30d', value: u.cashflow_volume_30d ?? '—' },
  ];

  return (
    <Drawer
      open
      onClose={onClose}
      width={520}
      eyebrow="User profile"
      title={name}
      icon={
        <span className="user-initials lg" style={initialsStyle(name)}>
          {initialsOf(name)}
        </span>
      }
      footer={
        canPlan || canSuspend || canSessions || canAccess ? (
          <>
            {canAccess && u.status === 'active' ? (
              <Button
                variant="ghost"
                icon={<KeyRound size={15} strokeWidth={2} />}
                style={{ marginRight: 'auto' }}
                onClick={() => navigate(u.role === 'admin' ? '/team' : `/team?add=${u.id}&label=${encodeURIComponent(name)}`)}
              >
                {u.role === 'admin' ? 'Manage access' : 'Make admin'}
              </Button>
            ) : null}
            {canSessions ? (
              <Button variant="secondary" disabled={busy} icon={<LogOut size={15} strokeWidth={2} />} onClick={() => onSignOut(u)}>
                Sign out
              </Button>
            ) : null}
            {canPlan ? (
              <Button
                variant="secondary"
                disabled={busy}
                icon={premium ? <ArrowDownCircle size={15} strokeWidth={2} /> : <Crown size={15} strokeWidth={2} />}
                onClick={() => onPlan(u)}
              >
                {premium ? 'Downgrade' : 'Upgrade'}
              </Button>
            ) : null}
            {canSuspend ? (
              <Button
                variant={u.status === 'suspended' ? 'primary' : 'danger'}
                disabled={busy || u.role === 'admin'}
                title={u.role === 'admin' ? 'Cannot suspend an admin' : undefined}
                icon={u.status === 'suspended' ? <ShieldCheck size={15} strokeWidth={2} /> : <ShieldAlert size={15} strokeWidth={2} />}
                onClick={() => onSuspend(u)}
              >
                {u.status === 'suspended' ? 'Reactivate' : 'Suspend'}
              </Button>
            ) : null}
          </>
        ) : null
      }
    >
      <div className="user-hero">
        <div className="user-hero-badges">
          <span className={`badge badge-${statusTone(u.status)}`}>{u.status.replace('_', ' ')}</span>
          <span className={`badge ${premium ? 'badge-primary' : ''}`}>
            {premium ? <Crown size={12} strokeWidth={2} /> : null}
            {u.plan_tier || 'free'}
          </span>
          {u.role === 'admin' ? <span className="badge badge-warning">admin</span> : null}
        </div>
        <div className="user-hero-contact">
          <a href={`mailto:${u.email}`}>
            <Mail size={14} strokeWidth={2} /> {u.email}
          </a>
          {u.phone_e164 ? (
            <a href={`tel:${u.phone_e164}`}>
              <Phone size={14} strokeWidth={2} /> {u.phone_e164}
            </a>
          ) : null}
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              void navigator.clipboard?.writeText(u.id).catch(() => undefined);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            }}
          >
            <Copy size={13} strokeWidth={2} /> {copied ? 'Copied' : 'Copy ID'}
          </button>
        </div>
      </div>

      <div className="seg drawer-tabs" role="tablist">
        <button type="button" className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}>
          Profile
        </button>
        <button type="button" className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>
          Activity
        </button>
        {hasPerm('audit.read') ? (
          <button type="button" className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
            Admin history
          </button>
        ) : null}
      </div>

      <div style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .2s' }}>
        {tab === 'profile' ? <DetailList rows={profile} /> : null}

        {tab === 'activity' ? (
          <div className="mini-tiles">
            {tiles.map((t) => (
              <div key={t.label} className={`mini-tile${t.tone ? ` mini-tile-${t.tone}` : ''}`}>
                <small>{t.label}</small>
                <strong>{t.value}</strong>
              </div>
            ))}
          </div>
        ) : null}

        {tab === 'history' ? (
          history === null ? (
            <p className="muted">Loading…</p>
          ) : history.length === 0 ? (
            <div className="lt-table-empty" style={{ padding: 32 }}>
              <History size={28} strokeWidth={1.4} />
              <p>No admin has acted on this account.</p>
            </div>
          ) : (
            <>
              <ul className="mini-timeline">
                {history.map((e) => (
                  <li key={e.id}>
                    <span className={`mini-dot ${e.action === 'user.suspend' ? 'bad' : 'good'}`} />
                    <span>
                      <b>{actorName(e)}</b> {describe(e)}
                    </span>
                    <time className="muted" title={new Date(e.created_at).toLocaleString()}>
                      {relativeTime(e.created_at)}
                    </time>
                  </li>
                ))}
              </ul>
              <Button size="sm" variant="ghost" onClick={() => navigate(`/audit?target=${u.id}&target_label=${encodeURIComponent(name)}`)}>
                Open in audit log
              </Button>
            </>
          )
        ) : null}
      </div>
    </Drawer>
  );
}
