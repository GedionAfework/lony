import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Banknote,
  Bell,
  House,
  Landmark,
  LayoutGrid,
  LogOut,
  Menu,
  MessageCircle,
  Moon,
  Plus,
  Settings as SettingsIcon,
  Sparkles,
  Sun,
  User as UserIcon,
  Target,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../lib/theme';
import { api, type AppNotification } from '../lib/api';
import { Avatar } from '../components/Avatar';
import { TIER_LABEL, tierOf } from '../lib/plans';

type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean; group: string };

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Home', icon: House, end: true, group: 'Money' },
  { to: '/accounts', label: 'Accounts', icon: Wallet, group: 'Money' },
  { to: '/plan', label: 'Plan', icon: Target, group: 'Money' },
  { to: '/insights', label: 'Insights', icon: LayoutGrid, group: 'Money' },
  { to: '/loans', label: 'Loans', icon: Banknote, group: 'People' },
  { to: '/chats', label: 'Chats', icon: MessageCircle, group: 'People' },
  { to: '/banks', label: 'Banks', icon: Landmark, group: 'More' },
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

  // The top bar turns to frosted glass once the page scrolls under it.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
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
  const tier = tierOf(user);
  const current =
    NAV_ITEMS.find((i) => (i.end ? location.pathname === i.to : location.pathname.startsWith(i.to))) ??
    (location.pathname.startsWith('/cashflow')
      ? NAV_ITEMS[0]
      : location.pathname.startsWith('/people')
        ? NAV_ITEMS[5]
        : location.pathname.startsWith('/settings') || location.pathname.startsWith('/themes')
          ? { label: 'Settings' }
          : null);

  return (
    <div className="app-shell">
      {sidebarOpen ? <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} /> : null}
      <aside className={`rail ${sidebarOpen ? 'open' : ''}`}>
        <NavLink to="/" className="rail-brand" title="Lony" onClick={() => setSidebarOpen(false)}>
          <img src="/lony-logo.png" alt="Lony" width={34} height={34} />
          <span className="rail-brand-name">Lony</span>
        </NavLink>

        <nav className="rail-nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={item.label}
              className={({ isActive }) => `rail-link ${isActive ? 'active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="rail-icon">
                <item.icon size={20} strokeWidth={2} />
                {item.to === '/chats' && chatUnread > 0 ? <span className="rail-badge">{chatUnread > 9 ? '9+' : chatUnread}</span> : null}
              </span>
              <span className="rail-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="rail-foot">
          <button type="button" className="rail-link" title={mode === 'dark' ? 'Light mode' : 'Dark mode'} onClick={toggle}>
            <span className="rail-icon">{mode === 'dark' ? <Sun size={20} /> : <Moon size={20} />}</span>
            <span className="rail-label">{mode === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
          <NavLink
            to="/settings"
            title="Settings"
            className={({ isActive }) => `rail-link ${isActive ? 'active' : ''}`}
            onClick={() => setSidebarOpen(false)}
          >
            <span className="rail-icon">
              <SettingsIcon size={20} />
            </span>
            <span className="rail-label">Settings</span>
          </NavLink>
        </div>
      </aside>

      <div className={`app-main ${location.pathname.startsWith('/settings') ? 'flush' : ''}`}>
        <header className={`topbar ${scrolled ? 'scrolled' : ''}`}>
          <button className="icon-btn menu-toggle" aria-label="Menu" onClick={() => setSidebarOpen((v) => !v)}>
            <Menu size={18} />
          </button>
          {/* Settings has its own pane headers, like a messenger's settings. */}
          <div className="topbar-title">{location.pathname.startsWith('/settings') ? '' : current?.label ?? ''}</div>
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
            <button
              type="button"
              className="avatar-btn"
              aria-label="Account menu"
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
              onClick={() => setUserMenuOpen((v) => !v)}
            >
              <Avatar src={user?.avatar_url} token={token} letter={name} />
            </button>
            {userMenuOpen ? (
              <div className="dropdown-panel menu-panel account-menu" role="menu">
                <div className="menu-who">
                  <Avatar src={user?.avatar_url} token={token} letter={name} size={40} />
                  <div className="menu-who-text">
                    <strong>{name}</strong>
                    <small>{user?.email}</small>
                  </div>
                  <span className={`tier-chip tier-${tier}`}>{TIER_LABEL[tier]}</span>
                </div>
                {[
                  { label: 'Profile', icon: UserIcon, to: '/settings/profile' },
                  { label: tier === 'free' ? 'Upgrade plan' : 'Plan & billing', icon: Sparkles, to: '/settings/plan', accent: tier === 'free' },
                  { label: 'Settings', icon: SettingsIcon, to: '/settings' },
                ].map((m) => (
                  <button
                    key={m.to}
                    type="button"
                    role="menuitem"
                    className={`menu-item ${m.accent ? 'accent' : ''}`}
                    onClick={() => {
                      setUserMenuOpen(false);
                      navigate(m.to);
                    }}
                  >
                    <m.icon size={16} />
                    {m.label}
                  </button>
                ))}
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    toggle();
                  }}
                >
                  {mode === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                  {mode === 'dark' ? 'Light mode' : 'Dark mode'}
                </button>
                <div className="menu-sep" />
                <button type="button" role="menuitem" className="menu-item danger" onClick={onLogout}>
                  <LogOut size={16} />
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
