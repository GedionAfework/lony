import {
  Ban,
  CalendarDays,
  Crown,
  FileJson,
  FolderTree,
  KeyRound,
  Languages,
  Layers,
  LogOut,
  RotateCcw,
  SlidersHorizontal,
  UserMinus,
  UserPlus,
  Palette,
  Power,
  PowerOff,
  ShieldCheck,
  Sparkles,
  UserCheck,
  UserCog,
  type LucideIcon,
} from 'lucide-react';
import type { AuditEntry } from '../api';

export type AuditCategory = {
  id: string;
  /** Prefix sent to the API as `action`, e.g. "user." */
  prefix: string;
  label: string;
  color: string;
};

export const AUDIT_CATEGORIES: AuditCategory[] = [
  { id: 'user', prefix: 'user.', label: 'Users', color: '#0ea5a0' },
  { id: 'role', prefix: 'role.', label: 'Roles', color: '#7c6cf6' },
  { id: 'admin', prefix: 'admin.', label: 'Admin team', color: '#7c6cf6' },
  { id: 'system', prefix: 'system.', label: 'System', color: '#64748b' },
  { id: 'settings', prefix: 'settings.', label: 'Settings', color: '#f59e0b' },
  { id: 'catalog', prefix: 'catalog.', label: 'Catalogs', color: '#0891b2' },
  { id: 'category', prefix: 'category.', label: 'Categories', color: '#2563eb' },
  { id: 'theme', prefix: 'theme.', label: 'Themes', color: '#db2777' },
  { id: 'locale', prefix: 'locale.', label: 'Languages', color: '#65a30d' },
  { id: 'calendar', prefix: 'calendar.', label: 'Calendars', color: '#ea580c' },
];

export const ACTION_LABELS: Record<string, string> = {
  'user.suspend': 'User suspended',
  'user.unsuspend': 'User reactivated',
  'user.set_plan_tier': 'Plan changed',
  'user.sessions_revoke': 'Signed out everywhere',
  'admin.grant': 'Admin access granted',
  'admin.revoke': 'Admin access removed',
  'role.delete': 'Role deleted',
  'settings.controls_update': 'Platform controls changed',
  'system.jobs_retry': 'Failed jobs retried',
  'settings.ai_disable': 'AI turned off',
  'settings.ai_enable': 'AI turned on',
  'catalog.create': 'Catalog item added',
  'catalog.update': 'Catalog item updated',
  'category.create': 'Category added',
  'category.update': 'Category updated',
  'theme.create': 'Theme created',
  'theme.update': 'Theme updated',
  'role.create': 'Role created',
  'role.update': 'Role updated',
  'role.assign': 'Role assigned',
  'locale.upload': 'Language pack uploaded',
  'locale.update': 'Language toggled',
  'locale.delete': 'Language deleted',
  'calendar.update': 'Calendar toggled',
};

const ICONS: Record<string, LucideIcon> = {
  'user.suspend': Ban,
  'user.unsuspend': UserCheck,
  'user.set_plan_tier': Crown,
  'settings.ai_disable': PowerOff,
  'settings.ai_enable': Power,
  'role.assign': UserCog,
  'locale.upload': FileJson,
  'user.sessions_revoke': LogOut,
  'admin.grant': UserPlus,
  'admin.revoke': UserMinus,
  'settings.controls_update': SlidersHorizontal,
  'system.jobs_retry': RotateCcw,
};

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  user: UserCog,
  role: ShieldCheck,
  admin: KeyRound,
  system: RotateCcw,
  settings: Sparkles,
  catalog: Layers,
  category: FolderTree,
  theme: Palette,
  locale: Languages,
  calendar: CalendarDays,
};

export type Tone = 'default' | 'success' | 'warning' | 'error';

export function actionTone(action: string): Tone {
  if (action === 'user.suspend' || action === 'settings.ai_disable' || action === 'admin.revoke' || action.endsWith('.delete')) return 'error';
  if (action === 'admin.grant') return 'success';
  if (action === 'user.sessions_revoke' || action === 'settings.controls_update') return 'warning';
  if (action === 'user.unsuspend' || action === 'settings.ai_enable' || action.endsWith('.create') || action.endsWith('.upload'))
    return 'success';
  if (action === 'user.set_plan_tier' || action === 'role.assign') return 'warning';
  return 'default';
}

export function categoryOf(action: string): AuditCategory {
  const prefix = action.split('.')[0] + '.';
  return AUDIT_CATEGORIES.find((c) => c.prefix === prefix) ?? { id: 'other', prefix, label: 'Other', color: '#64748b' };
}

export function actionIcon(action: string): LucideIcon {
  return ICONS[action] ?? CATEGORY_ICONS[categoryOf(action).id] ?? Layers;
}

export function actionLabel(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  const s = action.replace(/[._]/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function actorName(e: Pick<AuditEntry, 'actor_name' | 'actor_email' | 'actor_id'>): string {
  return e.actor_name?.trim() || e.actor_email || `${e.actor_id.slice(0, 8)}…`;
}

export function targetName(e: AuditEntry): string | null {
  if (!e.target_user_id) return null;
  return e.target_name?.trim() || e.target_email || `${e.target_user_id.slice(0, 8)}…`;
}

function str(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  return String(v);
}

const CONTROL_LABELS: Record<string, string> = {
  maintenance_mode: 'maintenance mode',
  signups_disabled: 'the sign-up pause',
  'pause.loans': 'the loans pause',
  'pause.friends': 'the friend requests pause',
  'pause.chat': 'the chat pause',
  'pause.bank_links': 'the bank linking pause',
  'pause.imports': 'the imports pause',
  'pause.goal_prices': 'the goal price lookups pause',
};

/** Plain-English summary of what happened, without the actor. */
export function describe(e: AuditEntry): string {
  const m = (e.meta ?? {}) as Record<string, unknown>;
  const t = targetName(e) ?? 'a user';
  switch (e.action) {
    case 'user.suspend':
      return `suspended ${t}`;
    case 'user.unsuspend':
      return `reactivated ${t}`;
    case 'user.set_plan_tier':
      return `moved ${t} to the ${str(m.plan_tier) || 'new'} plan`;
    case 'settings.ai_disable':
      return 'turned AI off for everyone';
    case 'settings.ai_enable':
      return 'turned AI back on';
    case 'role.assign':
      return m.admin_role_name ? `gave ${t} the ${str(m.admin_role_name)} role` : `removed the admin role from ${t}`;
    case 'role.create':
      return `created the ${str(m.name) || 'new'} role`;
    case 'role.update': {
      const add = Array.isArray(m.added) ? m.added.length : 0;
      const del = Array.isArray(m.removed) ? m.removed.length : 0;
      const who = str(m.name) ? `the ${str(m.name)} role` : 'a role';
      if (m.renamed_from) return `renamed ${str(m.renamed_from)} to ${str(m.name)}`;
      if (add || del) return `changed ${who} (+${add} / −${del} permissions)`;
      return `edited ${who}`;
    }
    case 'role.delete':
      return `deleted the ${str(m.name) || ''} role`.replace('  ', ' ');
    case 'admin.grant':
      return `made ${t} an admin${m.admin_role_name ? ` (${str(m.admin_role_name)})` : ''}`;
    case 'admin.revoke':
      return `removed ${t} from the admin team`;
    case 'user.sessions_revoke':
      return `signed ${t} out everywhere`;
    case 'system.jobs_retry':
      return `retried ${str(m.jobs) || 'failed'} reminder jobs`;
    case 'settings.controls_update': {
      const ch = (m.changes ?? {}) as Record<string, { to?: string }>;
      const keys = Object.keys(ch);
      if (keys.length === 1) {
        const k = keys[0];
        const to = ch[k]?.to;
        const label = CONTROL_LABELS[k] ?? k;
        if (k === 'maintenance_message') return 'updated the maintenance message';
        return `${to === 'true' ? 'turned on' : 'turned off'} ${label}`;
      }
      return `changed ${keys.length} platform controls`;
    }
    case 'theme.create':
      return `created the ${str(m.slug) || 'new'} theme`;
    case 'theme.update':
      return 'updated a theme';
    case 'catalog.create':
      return `added ${str(m.entity) === 'institution' ? 'institution' : 'catalog type'} ${str(m.code)}`.trim();
    case 'catalog.update':
      return `updated a catalog ${str(m.entity) || 'item'}`;
    case 'category.create':
      return `added a ${str(m.kind) || ''} category`.replace('  ', ' ');
    case 'category.update':
      return 'updated a category';
    case 'locale.upload':
      return `uploaded the ${str(m.name) || str(m.code)} language pack${m.keys ? ` (${str(m.keys)} keys)` : ''}`;
    case 'locale.update':
      return `${m.enabled ? 'enabled' : 'disabled'} the ${str(m.code)} language`;
    case 'locale.delete':
      return `deleted the ${str(m.code)} language`;
    case 'calendar.update':
      return `${m.enabled ? 'enabled' : 'disabled'} the ${str(m.id)} calendar`;
    default:
      return actionLabel(e.action).toLowerCase();
  }
}

/** Before → after pairs worth highlighting, derived from known meta keys. */
export function changes(e: AuditEntry): { field: string; from?: string; to: string }[] {
  const m = (e.meta ?? {}) as Record<string, unknown>;
  const out: { field: string; from?: string; to: string }[] = [];
  if (e.action === 'user.set_plan_tier') out.push({ field: 'Plan', from: str(m.previous) || 'free', to: str(m.plan_tier) });
  if (e.action === 'user.suspend') out.push({ field: 'Status', from: str(m.previous_status) || 'active', to: 'suspended' });
  if (e.action === 'user.unsuspend') out.push({ field: 'Status', from: str(m.previous_status) || 'suspended', to: 'active' });
  if (e.action.startsWith('settings.ai_')) out.push({ field: 'AI', from: m.ai_disabled ? 'on' : 'off', to: m.ai_disabled ? 'off' : 'on' });
  if (e.action === 'role.assign') out.push({ field: 'Admin role', from: str(m.previous_role) || undefined, to: str(m.admin_role_name) || 'none' });
  if (e.action === 'admin.grant') out.push({ field: 'Admin role', from: 'none', to: str(m.admin_role_name) });
  if (e.action === 'admin.revoke') out.push({ field: 'Admin role', from: str(m.previous_role) || 'admin', to: 'none' });
  if (e.action === 'role.update') {
    if (Array.isArray(m.added) && m.added.length) out.push({ field: 'Added', to: (m.added as string[]).join(', ') });
    if (Array.isArray(m.removed) && m.removed.length) out.push({ field: 'Removed', to: (m.removed as string[]).join(', ') });
  }
  if (e.action === 'settings.controls_update') {
    const ch = (m.changes ?? {}) as Record<string, { from?: string; to?: string }>;
    for (const [k, v] of Object.entries(ch)) out.push({ field: CONTROL_LABELS[k] ?? k, from: v.from || 'unset', to: v.to ?? '' });
  }
  if (e.action === 'locale.update' || e.action === 'calendar.update')
    out.push({ field: 'Enabled', from: m.enabled ? 'no' : 'yes', to: m.enabled ? 'yes' : 'no' });
  return out;
}

/** Rough "Chrome on Windows" from a user-agent string. */
export function describeUserAgent(ua?: string): string {
  if (!ua) return '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : /curl|Go-http|python|axios|node/i.test(ua)
              ? 'API client'
              : 'Browser';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} on ${os}` : browser;
}

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = Math.round((now - new Date(iso).getTime()) / 1000);
  if (diff < 45) return 'just now';
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute');
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour');
  if (diff < 86400 * 7) return rtf.format(-Math.round(diff / 86400), 'day');
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
