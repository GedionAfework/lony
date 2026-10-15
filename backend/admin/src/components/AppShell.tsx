import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
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
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../auth';
import { BrandLogo } from './BrandLogo';

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  perm?: string;
  end?: boolean;
};

const NAV: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, perm: 'overview.read', end: true },
  { to: '/users', label: 'User management', icon: Users, perm: 'users.read' },
  { to: '/categories', label: 'Categories', icon: Layers, perm: 'categories.read' },
  { to: '/themes', label: 'Themes', icon: Palette, perm: 'themes.read' },
  { to: '/localization', label: 'Localization', icon: Languages, perm: 'localization.manage' },
  { to: '/audit', label: 'Audit log', icon: ScrollText, perm: 'audit.read' },
  { to: '/settings', label: 'Settings', icon: Settings, perm: 'settings.ai' },
];

const COLLAPSE_KEY = 'lony_admin_sidebar_collapsed';

function initials(name: string, email: string) {
  const source = name?.trim() || email;
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export function AppShell() {
  const { me, hasPerm, logout } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

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
  const roleName = me?.admin_role || (me?.role === 'admin' ? 'Admin' : '');

  return (
    <div className={`shell${collapsed ? ' shell-collapsed' : ''}`}>
      <aside className="shell-sidebar">
        <div className="shell-brand-row">
          <div className="shell-brand">
            <BrandLogo size={collapsed ? 28 : 34} className="shell-brand-logo" />
            {!collapsed ? (
              <span className="shell-brand-text">
                Lony<span>Admin</span>
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className="shell-collapse-btn"
            onClick={() => setCollapsed((v) => !v)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-pressed={collapsed}
          >
            {collapsed ? <ChevronRight size={18} strokeWidth={2} /> : <ChevronLeft size={18} strokeWidth={2} />}
          </button>
        </div>

        <nav className="shell-nav">
          {visibleNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={item.label}
              className={({ isActive }) => `shell-nav-link${isActive ? ' active' : ''}`}
            >
              <item.icon size={18} strokeWidth={2} />
              <span className="shell-nav-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="shell-main">
        <header className="shell-topbar">
          <div className="shell-topbar-spacer" />
          <div className="shell-account" ref={menuRef}>
            <button
              type="button"
              className={`shell-account-btn${menuOpen ? ' open' : ''}`}
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <span className="shell-user-avatar">{me ? initials(me.display_name, me.email) : '—'}</span>
              <span className="shell-account-meta">
                <span className="shell-account-name">{me?.display_name || me?.email}</span>
                {roleName ? <span className="shell-user-role">{roleName}</span> : null}
              </span>
              <ChevronDown size={14} strokeWidth={2} className="shell-account-caret" />
            </button>
            {menuOpen ? (
              <div className="shell-account-menu" role="menu">
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
                <button type="button" role="menuitem" className="shell-account-item danger" onClick={() => void onLogout()}>
                  <LogOut size={15} strokeWidth={2} />
                  Log out
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <main className="shell-canvas">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
