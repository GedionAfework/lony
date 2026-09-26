const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '';

export type PublicUser = {
  id: string;
  email: string;
  display_name: string;
  role?: string;
  status: string;
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
};

export type AdminUser = {
  id: string;
  email: string;
  display_name: string;
  username?: string | null;
  status: string;
  role: string;
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
  created_at: string;
};

export type CatalogType = {
  id: string;
  kind: 'account_type' | 'institution_type' | string;
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

type ErrBody = { error?: { message?: string; code?: string } };

async function request<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const msg = (data as ErrBody).error?.message || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

function idem() {
  return crypto.randomUUID();
}

export const api = {
  login: (email: string, password: string) =>
    request<{ access_token: string; user: PublicUser }>('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Idempotency-Key': idem() },
      body: JSON.stringify({ email, password }),
    }),
  me: (token: string) => request<{ user: PublicUser }>('/api/v1/me', { method: 'GET' }, token),
  overview: (token: string) =>
    request<{ overview: Overview }>('/api/v1/admin/overview', { method: 'GET' }, token),
  listUsers: (token: string, q: string, status: string) => {
    const params = new URLSearchParams({ limit: '50' });
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    return request<{ users: AdminUser[]; total: number }>(
      `/api/v1/admin/users?${params}`,
      { method: 'GET' },
      token,
    );
  },
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
  audit: (token: string) =>
    request<{ audit: AuditEntry[] }>('/api/v1/admin/audit?limit=40', { method: 'GET' }, token),
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
  listCatalogTypes: (token: string, kind = '') => {
    const params = new URLSearchParams();
    if (kind) params.set('kind', kind);
    const q = params.toString();
    return request<{ types: CatalogType[] }>(
      `/api/v1/admin/catalogs/types${q ? `?${q}` : ''}`,
      { method: 'GET' },
      token,
    );
  },
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
  listCatalogInstitutions: (token: string, typeKind = '', typeCode = '') => {
    const params = new URLSearchParams();
    if (typeKind) params.set('type_kind', typeKind);
    if (typeCode) params.set('type_code', typeCode);
    const q = params.toString();
    return request<{ institutions: CatalogInstitution[] }>(
      `/api/v1/admin/catalogs/institutions${q ? `?${q}` : ''}`,
      { method: 'GET' },
      token,
    );
  },
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
};
