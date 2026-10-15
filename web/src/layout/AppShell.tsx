import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Banknote,
  Bell,
  Home,
  LandmarkIcon,
  LayoutGrid,
  LineChart,
  LogOut,
  Menu,
  MessageCircle,
  Moon,
  Settings as SettingsIcon,
  Sun,
  Target,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../lib/theme';
import { api, type AppNotification } from '../lib/api';
import { Button } from '../components/Button';

const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/accounts', label: 'Accounts', icon: Wallet },
  { to: '/cashflow', label: 'Cashflow', icon: LineChart },
  { to: '/loans', label: 'Loans', icon: Banknote },
  { to: '/chats', label: 'Chats', icon: MessageCircle },
  { to: '/insights', label: 'Insights', icon: LayoutGrid },
  { to: '/plan', label: 'Plan', icon: Target },
  { to: '/banks', label: 'Banks', icon: LandmarkIcon },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

const BOTTOM_TABS = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/loans', label: 'Loans', icon: Banknote },
  { to: '/chats', label: 'Chats', icon: MessageCircle },
  { to: '/insights', label: 'Insights', icon: LayoutGrid },
  { to: '/settings', label: 'You', icon: SettingsIcon },
];

function timeAgo(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - d);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export function AppShell() {
  const { user, token, logout } = useAuth();
  const { mode, toggle } = useTheme();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const notifRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  const loadNotifications = useCallback(async () => {
    if (!token) return;
    try {
      const res = await api.listNotifications(token);
      setNotifications(res.notifications ?? []);
      setUnreadCount(res.unread_count ?? 0);
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
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

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

  const initial = (user?.first_name || user?.display_name || user?.username || '?').trim().slice(0, 1).toUpperCase() || '?';

  return (
    <div className="app-shell">
      {sidebarOpen ? <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} /> : null}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="mark">L</div>
          <div className="name">Lony</div>
        </div>
        <nav className="nav-group">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              <item.icon size={18} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <Button variant="ghost" block onClick={onLogout} style={{ justifyContent: 'flex-start', gap: 10 }}>
            <LogOut size={16} />
            Sign out
          </Button>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <button className="icon-btn menu-toggle" aria-label="Menu" onClick={() => setSidebarOpen((v) => !v)}>
            <Menu size={18} />
          </button>
          <div className="spacer" />

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
                        <div className="time">{timeAgo(n.created_at)} ago</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <button className="icon-btn" aria-label="Toggle theme" onClick={toggle}>
            {mode === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>

          <div className="dropdown" ref={userRef}>
            <div className="user-chip" onClick={() => setUserMenuOpen((v) => !v)}>
              <div className="avatar">
                {user?.avatar_url ? <img src={user.avatar_url} alt="" /> : initial}
              </div>
              <span>{user?.display_name || user?.username || 'Account'}</span>
            </div>
            {userMenuOpen ? (
              <div className="dropdown-panel" style={{ minWidth: 200 }}>
                <div className="dropdown-list">
                  <div
                    className="dropdown-item"
                    onClick={() => {
                      setUserMenuOpen(false);
                      navigate('/settings');
                    }}
                  >
                    <div className="title">Settings</div>
                  </div>
                  <div className="dropdown-item" onClick={onLogout}>
                    <div className="title" style={{ color: 'var(--error)' }}>
                      Sign out
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </header>

        <Outlet />
      </div>

      <nav className="bottom-nav">
        {BOTTOM_TABS.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            <tab.icon size={19} />
            {tab.label}
            {tab.to === '/chats' && unreadCount > 0 ? (
              <span className="nav-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
            ) : null}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
