import { apiBaseUrl } from './theme';

export type User = {
  id: string;
  email: string;
  display_name: string;
  timezone: string;
  locale: string;
  default_currency_code: string | null;
  email_verified: boolean;
  status: string;
  created_at: string;
};

export type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  user: User;
};

export type ApiError = {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
};

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${apiBaseUrl}${path}`, { ...init, headers });
  if (res.status === 204) {
    return undefined as T;
  }
  const data = (await res.json()) as T | ApiError;
  if (!res.ok) {
    const err = data as ApiError;
    throw new Error(err.error?.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  register: (email: string, password: string, displayName: string) =>
    request<{ user: User; verification_code?: string; verification_hint: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, display_name: displayName }),
    }),
  verify: (email: string, code: string) =>
    request<{ user: User }>('/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    }),
  login: (email: string, password: string) =>
    request<TokenResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: (token: string) => request<{ user: User }>('/me', { method: 'GET' }, token),
  logout: (token: string) => request<void>('/auth/logout', { method: 'POST' }, token),
};
