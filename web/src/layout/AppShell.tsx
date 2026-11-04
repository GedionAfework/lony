import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Banknote,
  Bell,
  ChevronDown,
  House,
  Landmark,
  LayoutGrid,
  LogOut,
  Menu,
  MessageCircle,
  Moon,
  Plus,
  Settings as SettingsIcon,
  Sun,
  Target,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../lib/theme';
import { api, type AppNotification } from '../lib/api';

type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean; group: string };

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Home', icon: House, end: true, group: 'Money' },
  { to: '/accounts', label: 'Accounts', icon: Wallet, group: 'Money' },
  { to: '/plan', label: 'Plan', icon: Target, group: 'Money' },
  { to: '/insights', label: 'Insights', icon: LayoutGrid, group: 'Money' },
  { to: '/loans', label: 'Loans', icon: Banknote, group: 'People' },
  { to: '/chats', label: 'Chats', icon: MessageCircle, group: 'People' },
  { to: '/banks', label: 'Banks', icon: Landmark, group: 'More' },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, group: 'More' },
];

const BOTTOM_TABS = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/accounts', label: 'Accounts', icon: Wallet },
  { to: '/loans', label: 'Loans', icon: Banknote },
  { to: '/chats', label: 'Chats', icon: MessageCircle },
  { to: '/settings', label: 'You', icon: SettingsIcon },
];

const ADD_ACTIONS = [
  { label: 'Expense', to: '/cashflow/new?kind=expense' },
  { label: 'Income', to: '/cashflow/new?kind=income' },
  { label: 'Loan', to: '/loans/new' },
];

function timeAgo(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - d);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function AppShell() {
  const { user, token, logout } = useAuth();
  const { mode, toggle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [chatUnread, setChatUnread] = useState(0);
  const notifRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLDivElement>(null);

  const loadNotifications = useCallback(async () => {
    if (!token) return;
    try {
      const res = await api.listNotifications(token);
      setNotifications(res.notifications ?? []);
      setUnreadCount(res.unread_count ?? 0);
    } catch {
      /* ignore */
    }
    try {
      const chats = await api.listConversations(token);
      setChatUnread((chats.conversations ?? []).reduce((n, c) => n + (c.unread_count || 0), 0));
    } catch {
      /* ignore */
    }
  }, [token]);

  useEffect(() => {
    void loadNotifications();
    const t = setInterval(() => void loadNotifications(), 30000);
    return () => clearInterval(t);
  }, [loadNotifications]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (notifRef.current && !notifRef.current.contains(t)) setNotifOpen(false);
      if (userRef.current && !userRef.current.contains(t)) setUserMenuOpen(false);
      if (addRef.current && !addRef.current.contains(t)) setAddOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      setNotifOpen(false);
      setUserMenuOpen(false);
      setAddOpen(false);
      setSidebarOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  // Each new page starts at the top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  async function onMarkRead(id: string) {
    if (!token) return;
    try {
      await api.markNotificationRead(token, id);
      await loadNotifications();
    } catch {
      /* ignore */
    }
  }

  async function onMarkAllRead() {
    if (!token) return;
    try {
      await api.markAllNotificationsRead(token);
      await loadNotifications();
    } catch {
      /* ignore */
    }
  }

  async function onLogout() {
    await logout();
    navigate('/login');
  }

  const name = user?.display_name || user?.username || 'Account';
  const initial = (user?.first_name || name).trim().slice(0, 1).toUpperCase() || '?';
  const current =
    NAV_ITEMS.find((i) => (i.end ? location.pathname === i.to : location.pathname.startsWith(i.to))) ??
    (location.pathname.startsWith('/cashflow') ? NAV_ITEMS[0] : location.pathname.startsWith('/people') ? NAV_ITEMS[5] : null);

  return (
    <div className="app-shell">
      {sidebarOpen ? <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} /> : null}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <img src="/lony-logo.png" alt="" width={34} height={34} />
          <div className="name">Lony</div>
        </div>

        <nav className="nav-group">
          {NAV_ITEMS.map((item, i) => (
            <div key={item.to} className="nav-slot">
              {i === 0 || NAV_ITEMS[i - 1].group !== item.group ? <div className="nav-heading">{item.group}</div> : null}
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                onClick={() => setSidebarOpen(false)}
              >
                <item.icon size={18} strokeWidth={2} />
                <span>{item.label}</span>
                {item.to === '/chats' && chatUnread > 0 ? <span className="nav-count">{chatUnread > 9 ? '9+' : chatUnread}</span> : null}
              </NavLink>
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button type="button" className="sidebar-user" onClick={() => navigate('/settings')}>
            <div className="avatar">{user?.avatar_url ? <img src={user.avatar_url} alt="" /> : initial}</div>
            <div className="who">
              <strong>{name}</strong>
              <small>{user?.email}</small>
            </div>
          </button>
          <button type="button" className="icon-btn ghost" aria-label="Sign out" title="Sign out" onClick={onLogout}>
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <button className="icon-btn menu-toggle" aria-label="Menu" onClick={() => setSidebarOpen((v) => !v)}>
            <Menu size={18} />
          </button>
          <div className="topbar-title">{current?.label ?? ''}</div>
          <div className="spacer" />

          <div className="dropdown" ref={addRef}>
            <button className="btn btn-primary topbar-add" onClick={() => setAddOpen((v) => !v)} aria-haspopup="menu" aria-expanded={addOpen}>
              <Plus size={16} strokeWidth={2.5} />
              <span>Add</span>
            </button>
            {addOpen ? (
              <div className="dropdown-panel menu-panel" role="menu">
                {ADD_ACTIONS.map((a) => (
                  <button
                    key={a.to}
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => {
                      setAddOpen(false);
                      navigate(a.to);
                    }}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <button className="icon-btn" aria-label={mode === 'dark' ? 'Light mode' : 'Dark mode'} title={mode === 'dark' ? 'Light mode' : 'Dark mode'} onClick={toggle}>
            {mode === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>

          <div className="dropdown" ref={notifRef}>
            <button className="icon-btn" aria-label="Notifications" onClick={() => setNotifOpen((v) => !v)}>
              <Bell size={17} />
              {unreadCount > 0 ? <span className="badge">{unreadCount > 9 ? '9+' : unreadCount}</span> : null}
            </button>
            {notifOpen ? (
              <div className="dropdown-panel">
                <div className="dropdown-header">
                  <span>Notifications</span>
                  {unreadCount > 0 ? <button onClick={onMarkAllRead}>Mark all read</button> : null}
                </div>
                <div className="dropdown-list">
                  {notifications.length === 0 ? (
                    <div className="dropdown-empty">You're all caught up.</div>
                  ) : (
                    notifications.map((n) => (
                      <div
                        key={n.id}
                        className={`dropdown-item ${!n.read_at ? 'unread' : ''}`}
                        onClick={() => !n.read_at && onMarkRead(n.id)}
                      >
                        <div className="title">{n.title}</div>
                        <div className="body">{n.body}</div>
                        <div className="time">{timeAgo(n.created_at)}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <div className="dropdown topbar-user" ref={userRef}>
            <button type="button" className="user-chip" onClick={() => setUserMenuOpen((v) => !v)}>
              <div className="avatar">{user?.avatar_url ? <img src={user.avatar_url} alt="" /> : initial}</div>
              <ChevronDown size={14} />
            </button>
            {userMenuOpen ? (
              <div className="dropdown-panel menu-panel" role="menu">
                <div className="menu-who">
                  <strong>{name}</strong>
                  <small>{user?.email}</small>
                </div>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setUserMenuOpen(false);
                    navigate('/settings');
                  }}
                >
                  Settings
                </button>
                <button type="button" className="menu-item danger" onClick={onLogout}>
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <Outlet />
      </div>

      <nav className="bottom-nav">
        {BOTTOM_TABS.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            <tab.icon size={20} />
            <span>{tab.label}</span>
            {tab.to === '/chats' && chatUnread > 0 ? <span className="nav-badge">{chatUnread > 9 ? '9+' : chatUnread}</span> : null}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
