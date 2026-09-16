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
  searchUsers: (token: string, q: string) =>
    request<{ users: SearchHit[] }>(`/users/search?q=${encodeURIComponent(q)}`, { method: 'GET' }, token),
  listFriends: (token: string) => request<{ friends: Friendship[] }>('/friends', { method: 'GET' }, token),
  listIncoming: (token: string) =>
    request<{ requests: Friendship[] }>('/friend-requests', { method: 'GET' }, token),
  sendRequest: (token: string, body: { email?: string; username?: string; user_id?: string }) =>
    request<{ friendship: Friendship }>('/friend-requests', {
      method: 'POST',
      body: JSON.stringify(body),
    }, token),
  acceptRequest: (token: string, id: string) =>
    request<{ friendship: Friendship }>(`/friend-requests/${id}/accept`, { method: 'POST' }, token),
  rejectRequest: (token: string, id: string) =>
    request<{ friendship: Friendship }>(`/friend-requests/${id}/reject`, { method: 'POST' }, token),
  removeFriend: (token: string, id: string) =>
    request<{ friendship: Friendship }>(`/friendships/${id}/remove`, { method: 'POST' }, token),
  blockUser: (token: string, userID: string) =>
    request<{ friendship: Friendship }>(`/users/${userID}/block`, { method: 'POST' }, token),
};

export type SearchHit = {
  id: string;
  display_name: string;
  username: string | null;
};

export type Friendship = {
  id: string;
  status: string;
  requested_at: string;
  accepted_at?: string | null;
  peer: SearchHit;
};
