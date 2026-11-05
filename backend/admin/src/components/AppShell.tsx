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
  ShieldCheck,
  Search,
  Activity,
  SlidersHorizontal,
  KeyRound,
  CreditCard,
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
  /** Visible when the admin holds any one of these. */
  anyPerm?: string[];
  end?: boolean;
  group: string;
  keywords?: string;
};

const NAV: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, perm: 'overview.read', end: true, group: 'Monitor', keywords: 'dashboard home stats' },
  { to: '/system', label: 'System', icon: Activity, perm: 'system.read', group: 'Monitor', keywords: 'health database jobs runtime uptime' },
  { to: '/audit', label: 'Audit log', icon: ScrollText, perm: 'audit.read', group: 'Monitor', keywords: 'history events activity' },
  { to: '/users', label: 'Users', icon: Users, perm: 'users.read', group: 'Manage', keywords: 'accounts members suspend plan' },
  { to: '/team', label: 'Admins & roles', icon: KeyRound, perm: 'roles.read', group: 'Manage', keywords: 'rbac permissions team access roles' },
  { to: '/billing', label: 'Billing', icon: CreditCard, perm: 'billing.read', group: 'Manage', keywords: 'plans subscriptions revenue mrr polar payments limits trial' },
  { to: '/controls', label: 'Controls', icon: SlidersHorizontal, anyPerm: ['settings.platform', 'settings.ai'], group: 'Manage', keywords: 'maintenance signups features kill switch ai' },
  { to: '/categories', label: 'Categories', icon: Layers, perm: 'categories.read', group: 'Content', keywords: 'catalog institutions banks' },
  { to: '/themes', label: 'Themes', icon: Palette, perm: 'themes.read', group: 'Content', keywords: 'colors appearance' },
  { to: '/localization', label: 'Languages', icon: Languages, perm: 'localization.read', group: 'Content', keywords: 'translations i18n calendars' },
  { to: '/settings', label: 'Settings', icon: Settings, group: 'Account', keywords: 'account appearance notes preferences' },
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
  const [, setThemeMode, isDark] = useThemeMode();

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

  const visibleNav = NAV.filter(
    (item) => (!item.perm || hasPerm(item.perm)) && (!item.anyPerm || item.anyPerm.some((p) => hasPerm(p))),
  );
  const current =
    visibleNav.find((item) => (item.end ? location.pathname === item.to : item.to !== '/' && location.pathname.startsWith(item.to))) ??
    null;
  const roleName = me?.admin_role || (me?.role === 'admin' ? 'Admin' : '');
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
                  <span>{current.group}</span>
                  <ChevronRight size={13} strokeWidth={2} />
                  <b>{current.label}</b>
                </>
              ) : (
                <b>{today}</b>
              )}
            </div>
          </div>

          <button type="button" className="shell-topbar-search" onClick={() => setPaletteOpen(true)} aria-label="Search">
            <Search size={15} strokeWidth={2} />
            <span>Jump to…</span>
            <kbd>{IS_MAC ? '⌘' : 'Ctrl'} K</kbd>
          </button>

          <button
            type="button"
            className="shell-icon-btn"
            onClick={() => setThemeMode(isDark ? 'light' : 'dark')}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? <Sun size={16} strokeWidth={2} /> : <Moon size={16} strokeWidth={2} />}
          </button>

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
