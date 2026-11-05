import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Layers,
  Palette,
  ScrollText,
  Settings,
  Languages,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Sun,
  Moon,
  Monitor,
  Menu,
  Search,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../auth';
import { useThemeMode, type ThemeMode } from '../theme';
import { BrandLogo } from './BrandLogo';
import { CommandPalette, type Command } from './CommandPalette';

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  perm?: string;
  end?: boolean;
  group: string;
  keywords?: string;
};

const NAV: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, perm: 'overview.read', end: true, group: 'Insights', keywords: 'dashboard home stats' },
  { to: '/users', label: 'Users', icon: Users, perm: 'users.read', group: 'People', keywords: 'accounts roles members' },
  { to: '/audit', label: 'Audit log', icon: ScrollText, perm: 'audit.read', group: 'People', keywords: 'history events activity' },
  { to: '/categories', label: 'Categories', icon: Layers, perm: 'categories.read', group: 'Content', keywords: 'catalog institutions banks' },
  { to: '/themes', label: 'Themes', icon: Palette, perm: 'themes.read', group: 'Content', keywords: 'colors appearance' },
  { to: '/localization', label: 'Languages', icon: Languages, perm: 'localization.manage', group: 'Content', keywords: 'translations i18n calendars' },
  { to: '/settings', label: 'Settings', icon: Settings, group: 'System', keywords: 'ai config account appearance notes' },
];

const THEME_OPTIONS: { id: ThemeMode; label: string; icon: LucideIcon }[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'Match system', icon: Monitor },
];

const COLLAPSE_KEY = 'lony_admin_sidebar_collapsed';
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function initials(name: string, email: string) {
  const source = name?.trim() || email;
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

export function AppShell() {
  const { me, hasPerm, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [themeMode, setThemeMode] = useThemeMode();

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* private window */
    }
  }, [collapsed]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Global shortcut: Ctrl/⌘ K opens the command palette.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointer(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  async function onLogout() {
    setMenuOpen(false);
    await logout();
    navigate('/login', { replace: true });
  }

  const visibleNav = NAV.filter((item) => !item.perm || hasPerm(item.perm));
  const current =
    visibleNav.find((item) => (item.end ? location.pathname === item.to : item.to !== '/' && location.pathname.startsWith(item.to))) ??
    null;
  const roleName = me?.admin_role || (me?.role === 'admin' ? 'Admin' : '');
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = (me?.display_name || '').trim().split(/\s+/)[0] || '';
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const commands = useMemo<Command[]>(
    () => [
      ...visibleNav.map((item) => ({
        id: `nav:${item.to}`,
        label: item.label,
        group: 'Go to',
        icon: item.icon,
        hint: item.group,
        keywords: item.keywords,
        run: () => navigate(item.to),
      })),
      ...THEME_OPTIONS.map((opt) => ({
        id: `theme:${opt.id}`,
        label: `Theme: ${opt.label}`,
        group: 'Appearance',
        icon: opt.icon,
        keywords: 'dark light mode appearance',
        run: () => setThemeMode(opt.id),
      })),
      {
        id: 'sidebar',
        label: collapsed ? 'Expand sidebar' : 'Collapse sidebar',
        group: 'Appearance',
        icon: collapsed ? ChevronRight : ChevronLeft,
        run: () => setCollapsed((v) => !v),
      },
      { id: 'logout', label: 'Log out', group: 'Account', icon: LogOut, run: () => void onLogout() },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleNav.map((n) => n.to).join(','), collapsed],
  );

  const avatar = me ? initials(me.display_name, me.email) : '—';

  return (
    <div className={`shell${collapsed ? ' shell-collapsed' : ''}${mobileOpen ? ' shell-mobile-open' : ''}`}>
      <div className="shell-scrim" onClick={() => setMobileOpen(false)} aria-hidden />

      <aside className="shell-sidebar">
        <div className="shell-brand-row">
          <div className="shell-brand">
            <BrandLogo size={collapsed ? 30 : 34} className="shell-brand-logo" />
            <span className="shell-brand-text">
              Lony<span>Admin</span>
            </span>
          </div>
          <button
            type="button"
            className="shell-collapse-btn"
            onClick={() => setCollapsed((v) => !v)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-pressed={collapsed}
          >
            {collapsed ? <ChevronRight size={17} strokeWidth={2} /> : <ChevronLeft size={17} strokeWidth={2} />}
          </button>
        </div>

        <button type="button" className="shell-search-btn" onClick={() => setPaletteOpen(true)} title="Search (Ctrl K)">
          <Search size={16} strokeWidth={2} />
          <span>Search…</span>
          <kbd>{IS_MAC ? '⌘' : 'Ctrl'} K</kbd>
        </button>

        <nav className="shell-nav">
          {visibleNav.map((item, i) => (
            <div key={item.to} style={{ display: 'contents' }}>
              {i === 0 || visibleNav[i - 1].group !== item.group ? <div className="shell-nav-group">{item.group}</div> : null}
              <NavLink
                to={item.to}
                end={item.end}
                title={item.label}
                className={({ isActive }) => `shell-nav-link${isActive ? ' active' : ''}`}
              >
                <item.icon size={18} strokeWidth={2} />
                <span className="shell-nav-label">{item.label}</span>
              </NavLink>
            </div>
          ))}
        </nav>

        <div className="shell-sidebar-user">
          <span className="shell-user-avatar">{avatar}</span>
          <span className="shell-sidebar-user-meta">
            <strong>{me?.display_name || me?.email}</strong>
            {roleName ? <small>{roleName}</small> : null}
          </span>
          <button type="button" className="shell-sidebar-logout" onClick={() => void onLogout()} title="Log out" aria-label="Log out">
            <LogOut size={16} strokeWidth={2} />
          </button>
        </div>
      </aside>

      <div className="shell-main">
        <header className={`shell-topbar${scrolled ? ' scrolled' : ''}`}>
          <button type="button" className="shell-menu-btn" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu size={18} strokeWidth={2} />
          </button>

          <div className="shell-topbar-title">
            <div className="shell-crumbs">
              {current ? (
                <>
                  {current.group}
                  <ChevronRight size={12} strokeWidth={2.5} />
                  <b>{current.label}</b>
                </>
              ) : (
                today
              )}
            </div>
            <strong>
              {greeting}
              {firstName ? `, ${firstName}` : ''} 👋
            </strong>
          </div>

          <button type="button" className="shell-topbar-search" onClick={() => setPaletteOpen(true)} aria-label="Search">
            <Search size={16} strokeWidth={2} />
            <span>Search or jump to…</span>
            <kbd>{IS_MAC ? '⌘' : 'Ctrl'} K</kbd>
          </button>

          <span className="shell-status" title="Admin session active">
            <span className="status-dot" />
            Live
          </span>

          <div className="theme-toggle" role="radiogroup" aria-label="Appearance">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={themeMode === opt.id}
                title={opt.label}
                aria-label={opt.label}
                className={themeMode === opt.id ? 'active' : ''}
                onClick={() => setThemeMode(opt.id)}
              >
                <opt.icon size={15} strokeWidth={2} />
              </button>
            ))}
          </div>

          <div className="shell-account" ref={menuRef}>
            <button
              type="button"
              className={`shell-account-btn${menuOpen ? ' open' : ''}`}
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <span className="shell-user-avatar">{avatar}</span>
              <span className="shell-account-meta">
                <span className="shell-account-name">{me?.display_name || me?.email}</span>
                {roleName ? <span className="shell-user-role">{roleName}</span> : null}
              </span>
              <ChevronDown size={14} strokeWidth={2} className="shell-account-caret" />
            </button>
            {menuOpen ? (
              <div className="shell-account-menu" role="menu">
                <div className="shell-account-menu-head">
                  <strong>{me?.display_name || 'Admin'}</strong>
                  <small>{me?.email}</small>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  className="shell-account-item"
                  onClick={() => {
                    setMenuOpen(false);
                    navigate('/settings');
                  }}
                >
                  <Settings size={15} strokeWidth={2} />
                  Settings
                </button>
                {roleName ? (
                  <div className="shell-account-item" style={{ cursor: 'default', color: 'var(--muted)' }}>
                    <ShieldCheck size={15} strokeWidth={2} />
                    {roleName}
                  </div>
                ) : null}
                <button type="button" role="menuitem" className="shell-account-item danger" onClick={() => void onLogout()}>
                  <LogOut size={15} strokeWidth={2} />
                  Log out
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <main className="shell-canvas" key={location.pathname}>
          <Outlet />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
    </div>
  );
}
