const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '';

export type PublicUser = {
  id: string;
  email: string;
  display_name: string;
  role?: string;
  status: string;
  /** Populated by /me for admin accounts once RBAC is enabled server-side. */
  admin_permissions?: string[];
  admin_role?: string;
};

export type Overview = {
  total_users: number;
  active_users: number;
  suspended_users: number;
  signups_7d: number;
  signups_30d: number;
  dau: number;
  wau: number;
  open_loans: number;
  overdue_loans: number;
  cashflow_entries_7d: number;
  ai_insights_7d: number;
  ai_runs_7d?: number;
  ai_users_7d?: number;
  ai_tokens_7d?: number;
  ai_requests_today?: number;
  jobs_failed?: number;
  jobs_pending?: number;
  fx_ok?: boolean;
  fx_base?: string;
  fx_as_of?: string;
  fx_error?: string;
};

export type DayCount = {
  day: string;
  count: number;
};

export type AdminUser = {
  id: string;
  email: string;
  display_name: string;
  username?: string | null;
  status: string;
  role: string;
  plan_tier?: string;
  admin_role_id?: string | null;
  admin_role_name?: string | null;
  country_code?: string | null;
  created_at: string;
  last_active_at?: string | null;
  phone_e164?: string | null;
  locale?: string;
  timezone?: string;
  default_currency_code?: string | null;
  email_verified?: boolean;
  loans_as_borrower?: number;
  loans_as_lender?: number;
  open_loans?: number;
  overdue_loans?: number;
  cashflow_entries_30d?: number;
  cashflow_volume_30d?: string;
  trust_grade?: string | null;
  trust_band?: string | null;
  trust_thin_history?: boolean | null;
  friends_count?: number;
};

export type AuditEntry = {
  id: string;
  actor_id: string;
  actor_email?: string;
  action: string;
  target_user_id?: string | null;
  meta?: Record<string, unknown> | null;
  created_at: string;
};

export type Permission = {
  code: string;
  label: string;
  sort_order: number;
};

export type AdminRole = {
  id: string;
  name: string;
  description?: string;
  is_system: boolean;
  permissions: string[];
  created_at: string;
  updated_at: string;
};

/** Mirrors apps/mobile/src/theme.tsx ThemeColors so admin-authored themes stay compatible. */
export type ThemeColors = {
  background: string;
  surface: string;
  surfaceRaised: string;
  surfaceMuted: string;
  text: string;
  textSecondary: string;
  muted: string;
  border: string;
  borderStrong: string;
  primary: string;
  primarySoft: string;
  onPrimary: string;
  secondary: string;
  secondarySoft: string;
  tertiary: string;
  tertiarySoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  error: string;
  errorSoft: string;
  nav: string;
  fabBorder: string;
  overlay: string;
};

/** Keys editable in the admin theme editor; the rest of ThemeColors is filled from defaults. */
export const THEME_COLOR_FIELDS: { key: keyof ThemeColors; label: string }[] = [
  { key: 'background', label: 'Background' },
  { key: 'surface', label: 'Cards / surface' },
  { key: 'surfaceMuted', label: 'Muted surface' },
  { key: 'text', label: 'Text' },
  { key: 'muted', label: 'Muted text' },
  { key: 'border', label: 'Border' },
  { key: 'primary', label: 'Primary' },
  { key: 'primarySoft', label: 'Primary soft' },
  { key: 'onPrimary', label: 'On primary' },
  { key: 'secondary', label: 'Secondary' },
  { key: 'success', label: 'Success' },
  { key: 'warning', label: 'Warning' },
  { key: 'error', label: 'Error' },
  { key: 'nav', label: 'Navigation bar' },
];

/** Base palette used to fill any ThemeColors keys the admin editor doesn't expose. */
export const DEFAULT_THEME_COLORS: ThemeColors = {
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  surfaceMuted: '#F4F6F8',
  text: '#0F172A',
  textSecondary: '#334155',
  muted: '#64748B',
  border: '#E8ECF0',
  borderStrong: '#D0D7DE',
  primary: '#1FA8A8',
  primarySoft: '#E6F7F6',
  onPrimary: '#FFFFFF',
  secondary: '#D97706',
  secondarySoft: '#FFF7ED',
  tertiary: '#0284C7',
  tertiarySoft: '#EFF8FF',
  success: '#0F766E',
  successSoft: '#E6F7F5',
  warning: '#B45309',
  warningSoft: '#FFF7ED',
  error: '#DC2626',
  errorSoft: '#FEF2F2',
  nav: '#FFFFFF',
  fabBorder: '#FFFFFF',
  overlay: 'rgba(15, 23, 42, 0.4)',
};

export type SystemTheme = {
  id: string;
  slug: string;
  label: string;
  colors: ThemeColors;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type CatalogType = {
  id: string;
  kind: 'account_type' | 'institution_type' | 'goal_type' | string;
  code: string;
  label: string;
  sort_order: number;
  active: boolean;
};

export type CatalogInstitution = {
  id: string;
  code: string;
  label: string;
  type_kind: string;
  type_code: string;
  country_code?: string | null;
  sort_order: number;
  active: boolean;
};

export type SystemCategory = {
  id: string;
  kind: string;
  name: string;
  slug: string;
  is_system: boolean;
  active: boolean;
  created_at: string;
};

type ErrBody = { error?: { message?: string; code?: string } };

type TokenRefresher = () => Promise<string | null>;
let tokenRefresher: TokenRefresher | null = null;

export function setAdminTokenRefresher(fn: TokenRefresher | null) {
  tokenRefresher = fn;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  token?: string | null,
  opts?: { skipRefresh?: boolean },
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    if (
      res.status === 401 &&
      token &&
      !opts?.skipRefresh &&
      !path.includes('/auth/refresh') &&
      !path.includes('/auth/login')
    ) {
      const next = tokenRefresher ? await tokenRefresher() : null;
      if (next) return request<T>(path, init, next, { skipRefresh: true });
    }
    const msg = (data as ErrBody).error?.message || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

function idem() {
  return crypto.randomUUID();
}

function qs(params: Record<string, string | number | undefined | null>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  user: PublicUser;
};

export type MeResponse = {
  user: PublicUser;
  admin_permissions?: string[];
  admin_role?: string;
};

export type OverviewResponse = {
  overview: Overview;
  signups_by_day?: DayCount[];
};

export type ListUsersParams = {
  q?: string;
  status?: string;
  limit?: number;
  offset?: number;
};

export type ListUsersResponse = {
  users: AdminUser[];
  total: number;
  limit: number;
  offset: number;
};

export type AuditParams = {
  q?: string;
  action?: string;
  limit?: number;
  offset?: number;
};

export type AuditResponse = {
  audit: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
};

export const api = {
  login: (email: string, password: string) =>
    request<TokenResponse>('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Idempotency-Key': idem() },
      body: JSON.stringify({ email, password }),
    }),
  refresh: (refreshToken: string) =>
    request<TokenResponse>('/api/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    }),
  logout: (token: string) =>
    request<void>('/api/v1/auth/logout', { method: 'POST' }, token),
  me: (token: string) => request<MeResponse>('/api/v1/me', { method: 'GET' }, token),

  overview: (token: string) =>
    request<OverviewResponse>('/api/v1/admin/overview', { method: 'GET' }, token),

  listUsers: (token: string, params: ListUsersParams = {}) =>
    request<ListUsersResponse>(
      `/api/v1/admin/users${qs({
        q: params.q,
        status: params.status,
        limit: params.limit ?? 25,
        offset: params.offset ?? 0,
      })}`,
      { method: 'GET' },
      token,
    ),
  getUser: (token: string, id: string) =>
    request<{ user: AdminUser }>(`/api/v1/admin/users/${id}`, { method: 'GET' }, token),
  suspend: (token: string, id: string) =>
    request<{ user: AdminUser }>(
      `/api/v1/admin/users/${id}/suspend`,
      { method: 'POST', headers: { 'Idempotency-Key': idem() }, body: '{}' },
      token,
    ),
  unsuspend: (token: string, id: string) =>
    request<{ user: AdminUser }>(
      `/api/v1/admin/users/${id}/unsuspend`,
      { method: 'POST', headers: { 'Idempotency-Key': idem() }, body: '{}' },
      token,
    ),
  setPlanTier: (token: string, id: string, plan_tier: 'free' | 'premium') =>
    request<{ user: AdminUser }>(
      `/api/v1/admin/users/${id}/plan`,
      {
        method: 'PATCH',
        headers: { 'Idempotency-Key': idem() },
        body: JSON.stringify({ plan_tier }),
      },
      token,
    ),
  setUserRole: (token: string, id: string, admin_role_id: string | null) =>
    request<{ user: AdminUser }>(
      `/api/v1/admin/users/${id}/role`,
      {
        method: 'PATCH',
        headers: { 'Idempotency-Key': idem() },
        body: JSON.stringify({ admin_role_id }),
      },
      token,
    ),

  audit: (token: string, params: AuditParams = {}) =>
    request<AuditResponse>(
      `/api/v1/admin/audit${qs({
        q: params.q,
        action: params.action,
        limit: params.limit ?? 40,
        offset: params.offset ?? 0,
      })}`,
      { method: 'GET' },
      token,
    ),

  getSettings: (token: string) =>
    request<{ settings: { ai_disabled: boolean } }>('/api/v1/admin/settings', { method: 'GET' }, token),
  setAIDisabled: (token: string, disabled: boolean) =>
    request<{ settings: { ai_disabled: boolean } }>(
      '/api/v1/admin/settings/ai',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': idem() },
        body: JSON.stringify({ ai_disabled: disabled }),
      },
      token,
    ),

  listCategories: (token: string, kind = '') =>
    request<{ categories: SystemCategory[] }>(
      `/api/v1/admin/categories${qs({ kind })}`,
      { method: 'GET' },
      token,
    ),
  createCategory: (token: string, body: { kind: string; name: string }) =>
    request<{ category: SystemCategory }>(
      '/api/v1/admin/categories',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': idem() },
        body: JSON.stringify(body),
      },
      token,
    ),
  updateCategory: (token: string, id: string, body: { name?: string; active?: boolean }) =>
    request<{ category: SystemCategory }>(
      `/api/v1/admin/categories/${id}`,
      { method: 'PATCH', body: JSON.stringify(body) },
      token,
    ),

  listCatalogTypes: (token: string, kind = '') =>
    request<{ types: CatalogType[] }>(
      `/api/v1/admin/catalogs/types${qs({ kind })}`,
      { method: 'GET' },
      token,
    ),
  createCatalogType: (
    token: string,
    body: { kind: string; code?: string; label: string; sort_order?: number },
  ) =>
    request<{ type: CatalogType }>(
      '/api/v1/admin/catalogs/types',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': idem() },
        body: JSON.stringify(body),
      },
      token,
    ),
  updateCatalogType: (
    token: string,
    id: string,
    body: { label?: string; sort_order?: number; active?: boolean },
  ) =>
    request<{ type: CatalogType }>(
      `/api/v1/admin/catalogs/types/${id}`,
      { method: 'PATCH', body: JSON.stringify(body) },
      token,
    ),

  listCatalogInstitutions: (token: string, typeKind = '', typeCode = '') =>
    request<{ institutions: CatalogInstitution[] }>(
      `/api/v1/admin/catalogs/institutions${qs({ type_kind: typeKind, type_code: typeCode })}`,
      { method: 'GET' },
      token,
    ),
  createCatalogInstitution: (
    token: string,
    body: {
      code?: string;
      label: string;
      type_kind: string;
      type_code: string;
      country_code?: string;
      sort_order?: number;
    },
  ) =>
    request<{ institution: CatalogInstitution }>(
      '/api/v1/admin/catalogs/institutions',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': idem() },
        body: JSON.stringify(body),
      },
      token,
    ),
  updateCatalogInstitution: (
    token: string,
    id: string,
    body: {
      label?: string;
      type_kind?: string;
      type_code?: string;
      country_code?: string;
      sort_order?: number;
      active?: boolean;
    },
  ) =>
    request<{ institution: CatalogInstitution }>(
      `/api/v1/admin/catalogs/institutions/${id}`,
      { method: 'PATCH', body: JSON.stringify(body) },
      token,
    ),

  listThemes: (token: string) =>
    request<{ themes: SystemTheme[] }>('/api/v1/admin/themes', { method: 'GET' }, token),
  createTheme: (
    token: string,
    body: { slug: string; label: string; colors: ThemeColors; sort_order?: number },
  ) =>
    request<{ theme: SystemTheme }>(
      '/api/v1/admin/themes',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': idem() },
        body: JSON.stringify(body),
      },
      token,
    ),
  updateTheme: (
    token: string,
    id: string,
    body: { label?: string; colors?: ThemeColors; sort_order?: number; active?: boolean },
  ) =>
    request<{ theme: SystemTheme }>(
      `/api/v1/admin/themes/${id}`,
      { method: 'PATCH', body: JSON.stringify(body) },
      token,
    ),

  listPermissions: (token: string) =>
    request<{ permissions: Permission[] }>('/api/v1/admin/permissions', { method: 'GET' }, token),

  listRoles: (token: string) =>
    request<{ roles: AdminRole[] }>('/api/v1/admin/roles', { method: 'GET' }, token),
  createRole: (token: string, body: { name: string; description?: string; permissions: string[] }) =>
    request<{ role: AdminRole }>(
      '/api/v1/admin/roles',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': idem() },
        body: JSON.stringify(body),
      },
      token,
    ),
  updateRole: (
    token: string,
    id: string,
    body: { name?: string; description?: string; permissions?: string[] },
  ) =>
    request<{ role: AdminRole }>(
      `/api/v1/admin/roles/${id}`,
      { method: 'PATCH', body: JSON.stringify(body) },
      token,
    ),

  listLocalesAdmin: (token: string) =>
    request<{ locales: AppLocale[] }>('/api/v1/admin/locales', { method: 'GET' }, token),
  downloadLocaleCatalog: async (token: string) => {
    const base = API_BASE || '';
    const res = await fetch(`${base}/api/v1/admin/locales/catalog`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Could not download catalog');
    return res.json() as Promise<LocalePack>;
  },
  uploadLocale: (token: string, body: LocalePack) =>
    request<{ locale: AppLocale }>(
      '/api/v1/admin/locales',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': idem() },
        body: JSON.stringify(body),
      },
      token,
    ),
  patchLocale: (token: string, code: string, body: { enabled: boolean }) =>
    request<{ locale: AppLocale }>(
      `/api/v1/admin/locales/${encodeURIComponent(code)}`,
      { method: 'PATCH', body: JSON.stringify(body) },
      token,
    ),
  deleteLocale: async (token: string, code: string) => {
    const base = API_BASE || '';
    const res = await fetch(`${base}/api/v1/admin/locales/${encodeURIComponent(code)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 204) {
      const text = await res.text();
      throw new Error(text || 'Delete failed');
    }
  },
  listCalendarsAdmin: (token: string) =>
    request<{ calendars: AppCalendar[] }>('/api/v1/admin/calendars', { method: 'GET' }, token),
  patchCalendar: (token: string, id: string, body: { enabled: boolean }) =>
    request<{ calendar: AppCalendar }>(
      `/api/v1/admin/calendars/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(body) },
      token,
    ),
};

export type AppLocale = {
  code: string;
  name: string;
  dir: 'ltr' | 'rtl' | string;
  enabled: boolean;
  sort_order: number;
  messages?: Record<string, string>;
};

export type AppCalendar = {
  id: string;
  name: string;
  enabled: boolean;
  sort_order: number;
  config?: Record<string, unknown>;
};

export type LocalePack = {
  locale: string;
  name: string;
  dir: string;
  messages: Record<string, string>;
  enabled?: boolean;
};
