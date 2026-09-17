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

function idemKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const DISCLAIMER =
  'Lony is a shared ledger and reminder app, not a bank, wallet, escrow, or payment processor. Money moves outside the app. Records are for personal tracking only and are not legally binding contracts.';

export const api = {
  register: (email: string, password: string, displayName: string, acceptedDisclaimer: boolean) =>
    request<{ user: User; verification_code?: string; verification_hint: string }>('/auth/register', {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('register') },
      body: JSON.stringify({
        email,
        password,
        display_name: displayName,
        accepted_disclaimer: acceptedDisclaimer,
      }),
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
      headers: { 'Idempotency-Key': idemKey('friend-request') },
      body: JSON.stringify(body),
    }, token),
  acceptRequest: (token: string, id: string) =>
    request<{ friendship: Friendship }>(`/friend-requests/${id}/accept`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('friend-accept') },
    }, token),
  rejectRequest: (token: string, id: string) =>
    request<{ friendship: Friendship }>(`/friend-requests/${id}/reject`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('friend-reject') },
    }, token),
  removeFriend: (token: string, id: string) =>
    request<{ friendship: Friendship }>(`/friendships/${id}/remove`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('friend-remove') },
    }, token),
  blockUser: (token: string, userID: string) =>
    request<{ friendship: Friendship }>(`/users/${userID}/block`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('block') },
    }, token),
  listLoans: (token: string, query: { status?: string; role?: string; currency?: string; filter?: string } = {}) => {
    const params = new URLSearchParams();
    if (query.status) params.set('status', query.status);
    if (query.role) params.set('role', query.role);
    if (query.currency) params.set('currency', query.currency);
    if (query.filter) params.set('filter', query.filter);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return request<{ loans: Loan[] }>(`/loans${suffix}`, { method: 'GET' }, token);
  },
  dashboard: (token: string) => request<{ dashboard: Dashboard }>(`/dashboard`, { method: 'GET' }, token),
  getLoan: (token: string, id: string) => request<{ loan: Loan }>(`/loans/${id}`, { method: 'GET' }, token),
  createLoan: (token: string, body: CreateLoanBody) =>
    request<{ loan: Loan }>('/loans', {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('loan-create') },
      body: JSON.stringify(body),
    }, token),
  proposeTerms: (token: string, id: string, body: LoanTermsBody) =>
    request<{ loan: Loan }>(`/loans/${id}/terms`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('loan-terms') },
      body: JSON.stringify(body),
    }, token),
  acceptLoan: (token: string, id: string) =>
    request<{ loan: Loan }>(`/loans/${id}/accept`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('loan-accept') },
      body: JSON.stringify({ accepted_disclaimer: true }),
    }, token),
  rejectLoan: (token: string, id: string) =>
    request<{ loan: Loan }>(`/loans/${id}/reject`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('loan-reject') },
    }, token),
  cancelLoan: (token: string, id: string) =>
    request<{ loan: Loan }>(`/loans/${id}/cancel`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('loan-cancel') },
    }, token),
  claimRepayment: (token: string, loanId: string, body: { amount?: string; note?: string } = {}) =>
    request<{ repayment: Repayment }>(`/loans/${loanId}/repayments`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('repay-claim') },
      body: JSON.stringify(body),
    }, token),
  listRepayments: (token: string, loanId: string) =>
    request<{ repayments: Repayment[] }>(`/loans/${loanId}/repayments`, { method: 'GET' }, token),
  confirmRepayment: (token: string, id: string) =>
    request<{ repayment: Repayment }>(`/repayments/${id}/confirm`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('repay-confirm') },
    }, token),
  rejectRepayment: (token: string, id: string, reason: string) =>
    request<{ repayment: Repayment }>(`/repayments/${id}/reject`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('repay-reject') },
      body: JSON.stringify({ reason }),
    }, token),
  listBankProfiles: (token: string) =>
    request<{ bank_profiles: BankProfile[] }>('/bank-profiles', { method: 'GET' }, token),
  createBankProfile: (token: string, body: CreateBankProfileBody) =>
    request<{ bank_profile: BankProfile }>('/bank-profiles', {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('bank-create') },
      body: JSON.stringify(body),
    }, token),
  getBankProfile: (token: string, id: string, reveal = false) =>
    request<{ bank_profile: BankProfile }>(`/bank-profiles/${id}${reveal ? '?reveal=1' : ''}`, { method: 'GET' }, token),
  preferBankProfile: (token: string, id: string) =>
    request<{ bank_profile: BankProfile }>(`/bank-profiles/${id}/preferred`, { method: 'POST' }, token),
  archiveBankProfile: (token: string, id: string) =>
    request<{ bank_profile: BankProfile }>(`/bank-profiles/${id}/archive`, { method: 'POST' }, token),
  shareBankProfile: (token: string, id: string, body: { recipient_id: string; loan_id?: string }) =>
    request<{ share: BankProfileShare }>(`/bank-profiles/${id}/share`, {
      method: 'POST',
      body: JSON.stringify(body),
    }, token),
  listBankShares: (token: string, incoming = false) =>
    request<{ shares: BankProfileShare[] }>(
      `/bank-profile-shares${incoming ? '?direction=incoming' : ''}`,
      { method: 'GET' },
      token,
    ),
  revokeBankShare: (token: string, id: string) =>
    request<{ share: BankProfileShare }>(`/bank-profile-shares/${id}/revoke`, { method: 'POST' }, token),
  loanPaymentProfile: (token: string, loanId: string, reveal = false) =>
    request<{ bank_profile: BankProfile }>(
      `/loans/${loanId}/payment-profile${reveal ? '?reveal=1' : ''}`,
      { method: 'GET' },
      token,
    ),
  listNotifications: (token: string, unread = false) =>
    request<{ notifications: AppNotification[]; unread_count: number }>(
      `/notifications${unread ? '?unread=1' : ''}`,
      { method: 'GET' },
      token,
    ),
  markNotificationRead: (token: string, id: string) =>
    request<{ notification: AppNotification }>(`/notifications/${id}/read`, { method: 'POST' }, token),
  markAllNotificationsRead: (token: string) =>
    request<{ ok: boolean }>('/notifications/read-all', { method: 'POST' }, token),
  registerDeviceToken: (token: string, platform: string, deviceToken: string) =>
    request<{ device_token: DeviceToken }>('/device-tokens', {
      method: 'POST',
      body: JSON.stringify({ platform, token: deviceToken }),
    }, token),
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

export type LoanParty = {
  id: string;
  display_name: string;
  username?: string | null;
};

export type Loan = {
  id: string;
  reference_code: string;
  status: string;
  borrower: LoanParty;
  lender: LoanParty;
  your_role: 'borrower' | 'lender';
  interest_basis: string;
  principal: string | null;
  currency_code: string | null;
  interest_rate_percent: string | null;
  interest_amount: string | null;
  expected_total: string | null;
  due_at: string | null;
  note: string | null;
  can_accept: boolean;
  can_reject: boolean;
  can_cancel: boolean;
  can_propose_terms: boolean;
  events?: { id: string; event_type: string; created_at: string }[];
};

export type CreateLoanBody = {
  counterparty_id: string;
  role: 'borrower' | 'lender';
  principal?: string;
  currency_code?: string;
  interest_rate_percent?: string;
  due_at?: string;
  note?: string;
};

export type LoanTermsBody = {
  principal: string;
  currency_code: string;
  interest_rate_percent: string;
  due_at: string;
  note?: string;
};

export type DashboardFriend = {
  peer: LoanParty;
  receivables: string;
  payables: string;
  net: string;
};

export type DashboardCurrency = {
  currency_code: string;
  receivables: string;
  payables: string;
  net: string;
  due_soon: string;
  due_soon_count: number;
  pending_requests: number;
  open_loan_count: number;
  friends: DashboardFriend[];
};

export type Dashboard = {
  pending_requests: number;
  pending_confirmations: number;
  by_currency: DashboardCurrency[];
};

export type BankProfile = {
  id: string;
  profile_type: 'bank_account' | 'mobile_wallet' | 'other' | string;
  label: string;
  institution_name?: string | null;
  account_last4: string;
  currency_code?: string | null;
  is_preferred: boolean;
  archived_at?: string | null;
  created_at: string;
  account_identifier?: string | null;
  can_reveal: boolean;
};

export type BankProfileShare = {
  id: string;
  profile: BankProfile;
  owner_id: string;
  recipient_id: string;
  loan_id?: string | null;
  created_at: string;
  revoked_at?: string | null;
};

export type CreateBankProfileBody = {
  profile_type: string;
  label: string;
  institution_name?: string;
  account_identifier: string;
  currency_code?: string;
  is_preferred?: boolean;
};

export type Repayment = {
  id: string;
  loan_id: string;
  submitted_by_user_id: string;
  amount: string;
  status: string;
  note?: string | null;
  submitted_at: string;
  confirmed_by_user_id?: string | null;
  confirmed_at?: string | null;
  rejected_at?: string | null;
  rejection_reason?: string | null;
  created_at: string;
  can_confirm: boolean;
  can_reject: boolean;
};

export type AppNotification = {
  id: string;
  type: string;
  loan_id?: string | null;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  push_status: string;
  read_at?: string | null;
  created_at: string;
};

export type DeviceToken = {
  id: string;
  platform: string;
  token: string;
  enabled: boolean;
  last_seen_at: string;
  created_at: string;
};
