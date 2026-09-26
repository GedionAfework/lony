import { apiBaseUrl } from './theme';

export type User = {
  id: string;
  email: string;
  username?: string | null;
  phone_e164?: string | null;
  display_name: string;
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  country_code?: string | null;
  preferred_auth_provider?: string | null;
  tos_version?: string | null;
  tos_accepted_at?: string | null;
  avatar_url?: string | null;
  timezone: string;
  locale: string;
  default_currency_code: string | null;
  email_verified: boolean;
  status: string;
  created_at: string;
  profile_complete?: boolean;
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
  const raw = await res.text();
  let data: T | ApiError | null = null;
  if (raw.trim()) {
    try {
      data = JSON.parse(raw) as T | ApiError;
    } catch {
      const snippet = raw.replace(/\s+/g, ' ').trim().slice(0, 120);
      throw new Error(
        res.ok
          ? `Unexpected response from server${snippet ? `: ${snippet}` : ''}`
          : `Request failed (${res.status})${snippet ? `: ${snippet}` : ''}`,
      );
    }
  }
  if (!res.ok) {
    const err = data as ApiError | null;
    throw new Error(err?.error?.message ?? `Request failed (${res.status})`);
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
  oauth: (body: {
    provider: 'google' | 'telegram';
    id_token?: string;
    telegram?: Record<string, string>;
    accepted_disclaimer: boolean;
  }) =>
    request<TokenResponse>('/auth/oauth', {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('oauth') },
      body: JSON.stringify(body),
    }),
  refresh: (refreshToken: string) =>
    request<TokenResponse>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    }),
  me: (token: string) => request<{ user: User }>('/me', { method: 'GET' }, token),
  patchMe: (
    token: string,
    body: {
      display_name?: string;
      username?: string;
      first_name?: string;
      middle_name?: string;
      last_name?: string;
      phone_e164?: string;
      country_code?: string;
      preferred_auth_provider?: 'email' | 'google' | 'telegram';
      timezone?: string;
      locale?: string;
      default_currency_code?: string;
    },
  ) =>
    request<{ user: User }>('/me', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }, token),
  acceptTOS: (token: string) =>
    request<{ user: User; tos_version: string }>('/me/tos', {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('tos') },
      body: '{}',
    }, token),
  exportMyData: (token: string) =>
    request<{ export: DataExport }>('/me/export?format=json', { method: 'GET' }, token),
  exportLedgerCSV: (token: string) =>
    request<{ cashflow_csv: string; transfers_csv: string; accounts_csv: string }>(
      '/me/export?format=csvtext',
      { method: 'GET' },
      token,
    ),
  deleteAccount: (token: string) =>
    request<{ ok: boolean; status: string }>('/me/delete', {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('account-delete') },
      body: JSON.stringify({ confirm: 'DELETE' }),
    }, token),
  getTOS: () =>
    request<{ version: string; disclaimer: string; document: string }>('/legal/tos', { method: 'GET' }),
  listPaymentRails: (opts?: { country?: string; scope?: 'global' | 'country' }) => {
    const params = new URLSearchParams();
    if (opts?.scope === 'country' && opts.country) {
      params.set('scope', 'country');
      params.set('country', opts.country);
    }
    const q = params.toString() ? `?${params.toString()}` : '';
    return request<{ rails: PaymentRail[]; country: string }>(`/payment-rails${q}`, { method: 'GET' });
  },
  uploadAvatar: (token: string, body: { filename: string; mime: string; attachment_base64: string }) =>
    request<{ user: User }>('/me/avatar', {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('avatar') },
      body: JSON.stringify(body),
    }, token),
  logout: (token: string) => request<void>('/auth/logout', { method: 'POST' }, token),
  searchUsers: (token: string, q: string) =>
    request<{ users: SearchHit[] }>(`/users/search?q=${encodeURIComponent(q)}`, { method: 'GET' }, token),
  lookupPhone: (token: string, phone: string) =>
    request<{
      found: boolean;
      phone: string;
      friendship_status?: string;
      user?: SearchHit;
    }>(`/users/lookup-phone?phone=${encodeURIComponent(phone)}`, { method: 'GET' }, token),
  invitePhone: (token: string, phone: string) =>
    request<{ invited: boolean; phone: string }>('/users/invite-phone', {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('invite-phone') },
      body: JSON.stringify({ phone }),
    }, token),
  listFriends: (token: string) => request<{ friends: Friendship[] }>('/friends', { method: 'GET' }, token),
  listPeers: (token: string, q = '') => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    const suffix = params.toString() ? `?${params}` : '';
    return request<{ peers: PeerHit[] }>(`/peers${suffix}`, { method: 'GET' }, token);
  },
  listIncoming: (token: string) =>
    request<{ requests: Friendship[] }>('/friend-requests', { method: 'GET' }, token),
  sendRequest: (token: string, body: { email?: string; username?: string; phone?: string; user_id?: string }) =>
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
  wealth: (token: string, currency?: string) => {
    const suffix = currency ? `?currency=${encodeURIComponent(currency)}` : '';
    return request<{ wealth: WealthSummary }>(`/wealth${suffix}`, { method: 'GET' }, token);
  },
  listAccounts: (token: string, includeArchived = false) => {
    const suffix = includeArchived ? '?include_archived=true' : '';
    return request<{ accounts: MoneyAccount[] }>(`/accounts${suffix}`, { method: 'GET' }, token);
  },
  reconcileAccounts: (token: string) =>
    request<{ reconcile: AccountReconcile[] }>('/accounts/reconcile', { method: 'GET' }, token),
  reconcileAccount: (token: string, id: string) =>
    request<{ reconcile: AccountReconcile }>(`/accounts/${id}/reconcile`, { method: 'GET' }, token),
  listCatalogTypes: (token: string, kind?: string) => {
    const params = new URLSearchParams();
    if (kind) params.set('kind', kind);
    const q = params.toString();
    return request<{
      types: Array<{ id: string; kind: string; code: string; label: string; sort_order: number; active: boolean }>;
    }>(`/catalogs/types${q ? `?${q}` : ''}`, { method: 'GET' }, token);
  },
  listCatalogInstitutions: (token: string, typeKind?: string, typeCode?: string) => {
    const params = new URLSearchParams();
    if (typeKind) params.set('type_kind', typeKind);
    if (typeCode) params.set('type_code', typeCode);
    const q = params.toString();
    return request<{
      institutions: Array<{
        id: string;
        code: string;
        label: string;
        type_kind: string;
        type_code: string;
        country_code?: string | null;
        sort_order: number;
        active: boolean;
      }>;
    }>(`/catalogs/institutions${q ? `?${q}` : ''}`, { method: 'GET' }, token);
  },
  createAccount: (token: string, body: CreateAccountBody) =>
    request<{ account: MoneyAccount }>('/accounts', {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('account-create') },
      body: JSON.stringify(body),
    }, token),
  updateAccount: (token: string, id: string, body: UpdateAccountBody) =>
    request<{ account: MoneyAccount }>(`/accounts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }, token),
  setAccountBalance: (token: string, id: string, body: { balance: string; note?: string }) =>
    request<{ account: MoneyAccount }>(`/accounts/${id}/balance`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('account-balance') },
      body: JSON.stringify(body),
    }, token),
  archiveAccount: (token: string, id: string) =>
    request<{ ok: boolean }>(`/accounts/${id}/archive`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('account-archive') },
    }, token),
  transferAccounts: (
    token: string,
    body: {
      from_account_id: string;
      to_account_id: string;
      amount: string;
      note?: string;
      occurred_at?: string;
    },
  ) =>
    request<{ transfer: AccountTransfer }>('/accounts/transfer', {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('account-transfer') },
      body: JSON.stringify(body),
    }, token),
  listGoals: (token: string, includeArchived = false) => {
    const suffix = includeArchived ? '?include_archived=true' : '';
    return request<{ goals: Goal[] }>(`/goals${suffix}`, { method: 'GET' }, token);
  },
  createGoal: (token: string, body: CreateGoalBody) =>
    request<{ goal: Goal }>('/goals', {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('goal-create') },
      body: JSON.stringify(body),
    }, token),
  updateGoal: (token: string, id: string, body: UpdateGoalBody) =>
    request<{ goal: Goal }>(`/goals/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }, token),
  contributeGoal: (
    token: string,
    id: string,
    body: { amount: string; account_id?: string; note?: string; debit_account?: boolean },
  ) =>
    request<{ goal: Goal; contribution: GoalContribution }>(`/goals/${id}/contribute`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('goal-contribute') },
      body: JSON.stringify(body),
    }, token),
  listGoalContributions: (token: string, id: string) =>
    request<{ contributions: GoalContribution[] }>(`/goals/${id}/contributions`, { method: 'GET' }, token),
  goalProjection: (token: string, id: string) =>
    request<{ projection: GoalProjection }>(`/goals/${id}/projection`, { method: 'GET' }, token),
  insightsOverview: (token: string, currency: string) =>
    request<{ overview: InsightsOverview }>(
      `/insights/overview?currency=${encodeURIComponent(currency)}`,
      { method: 'GET' },
      token,
    ),
  insightsCashflowSeries: (token: string, currency: string, months = 6) =>
    request<{ series: InsightsMonthPoint[] }>(
      `/insights/cashflow-series?currency=${encodeURIComponent(currency)}&months=${months}`,
      { method: 'GET' },
      token,
    ),
  insightsCategories: (token: string, currency: string, months = 1) =>
    request<{ categories: InsightsCategoryPoint[] }>(
      `/insights/categories?currency=${encodeURIComponent(currency)}&months=${months}`,
      { method: 'GET' },
      token,
    ),
  insightsDebts: (token: string, currency?: string) => {
    const suffix = currency ? `?currency=${encodeURIComponent(currency)}` : '';
    return request<{ debts: InsightsDebts }>(`/insights/debts${suffix}`, { method: 'GET' }, token);
  },
  insightsGoals: (token: string) =>
    request<{ goals: InsightsGoal[] }>('/insights/goals', { method: 'GET' }, token),
  getScore: (token: string, currency: string, refresh = false) => {
    const q = new URLSearchParams({ currency });
    if (refresh) q.set('refresh', '1');
    return request<{ score: LonyScore }>(`/score?${q}`, { method: 'GET' }, token);
  },
  scoreHistory: (token: string, limit = 12) =>
    request<{ scores: LonyScore[] }>(`/score/history?limit=${limit}`, { method: 'GET' }, token),
  getPeerTrust: (token: string, userId: string) =>
    request<{ trust: PeerTrust }>(`/users/${userId}/trust`, { method: 'GET' }, token),
  listAIInsights: (token: string) =>
    request<{ insights: AIInsight[]; disclaimer: string }>('/ai/insights', { method: 'GET' }, token),
  refreshAIInsights: (token: string, currency: string) =>
    request<{ insights: AIInsight[]; disclaimer: string }>(
      `/ai/insights/refresh?currency=${encodeURIComponent(currency)}`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': idemKey('ai-insights-refresh') },
        body: JSON.stringify({ currency_code: currency }),
      },
      token,
    ),
  dismissAIInsight: (token: string, id: string) =>
    request<{ ok: boolean }>(`/ai/insights/${id}/dismiss`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('ai-insight-dismiss') },
    }, token),
  clearAIInsights: (token: string) =>
    request<{ ok: boolean; dismissed: number; disclaimer: string }>('/ai/insights/clear', {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('ai-clear') },
      body: '{}',
    }, token),
  aiReport: (token: string, currency: string, months = 6) =>
    request<{ report: AIReport }>('/ai/analytics/report', {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('ai-report') },
      body: JSON.stringify({ currency_code: currency, months }),
    }, token),
  aiCoach: (token: string, currency: string, message: string) =>
    request<{ coach: CoachReply }>('/ai/coach/messages', {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('ai-coach') },
      body: JSON.stringify({ currency_code: currency, message }),
    }, token),
  cashflowSummary: (token: string, query: { from?: string; to?: string } = {}) => {
    const params = new URLSearchParams();
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return request<{ summary: CashflowSummary }>(`/cashflow/summary${suffix}`, { method: 'GET' }, token);
  },
  cashflowBreakdown: (
    token: string,
    query: { kind?: 'income' | 'expense'; from?: string; to?: string } = {},
  ) => {
    const params = new URLSearchParams();
    if (query.kind) params.set('kind', query.kind);
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return request<{ breakdown: CategorySpend[] }>(`/cashflow/breakdown${suffix}`, { method: 'GET' }, token);
  },
  listBudgets: (token: string, period?: string) => {
    const suffix = period ? `?period=${encodeURIComponent(period)}` : '';
    return request<{ budgets: Budget[] }>(`/budgets${suffix}`, { method: 'GET' }, token);
  },
  upsertBudget: (
    token: string,
    body: {
      category_id?: string;
      category_name: string;
      currency_code: string;
      limit_amount: string;
      period_month?: string;
    },
  ) =>
    request<{ budget: Budget }>('/budgets', {
      method: 'PUT',
      headers: { 'Idempotency-Key': idemKey('budget-upsert') },
      body: JSON.stringify(body),
    }, token),
  deleteBudget: (token: string, id: string) =>
    request<{ ok: boolean }>(`/budgets/${id}`, {
      method: 'DELETE',
      headers: { 'Idempotency-Key': idemKey('budget-delete') },
    }, token),
  listCashflowCategories: (token: string, kind?: 'income' | 'expense') => {
    const suffix = kind ? `?kind=${kind}` : '';
    return request<{ categories: CashflowCategory[] }>(`/cashflow/categories${suffix}`, { method: 'GET' }, token);
  },
  createCashflowCategory: (token: string, body: { kind: 'income' | 'expense'; name: string }) =>
    request<{ category: CashflowCategory }>('/cashflow/categories', {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('cashflow-cat') },
      body: JSON.stringify(body),
    }, token),
  listCashflow: (
    token: string,
    query: {
      kind?: 'income' | 'expense' | 'outcome';
      from?: string;
      to?: string;
      currency?: string;
      templates?: boolean;
      limit?: number;
    } = {},
  ) => {
    const params = new URLSearchParams();
    if (query.kind) params.set('kind', query.kind);
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    if (query.currency) params.set('currency', query.currency);
    if (query.templates != null) params.set('templates', query.templates ? 'true' : 'false');
    if (query.limit) params.set('limit', String(query.limit));
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return request<{ entries: CashflowEntry[] }>(`/cashflow${suffix}`, { method: 'GET' }, token);
  },
  createCashflow: (token: string, body: CreateCashflowBody) =>
    request<{ entry: CashflowEntry }>('/cashflow', {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('cashflow-create') },
      body: JSON.stringify(body),
    }, token),
  updateCashflow: (token: string, id: string, body: UpdateCashflowBody) =>
    request<{ entry: CashflowEntry }>(`/cashflow/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }, token),
  deleteCashflow: (token: string, id: string) =>
    request<{ ok: boolean }>(`/cashflow/${id}`, {
      method: 'DELETE',
      headers: { 'Idempotency-Key': idemKey('cashflow-delete') },
    }, token),
  receiveCashflow: (token: string, id: string, body?: { account_id?: string }) =>
    request<{ entry: CashflowEntry }>(`/cashflow/${id}/receive`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('cashflow-receive') },
      body: body ? JSON.stringify(body) : undefined,
    }, token),
  shareCashflow: (token: string, id: string, body: ShareCashflowBody) =>
    request<{ entry: CashflowEntry; loan: Loan }>(`/cashflow/${id}/share`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('cashflow-share') },
      body: JSON.stringify(body),
    }, token),
  fxRates: (base: string) =>
    request<{ base: string; as_of: string; rates: Record<string, string> }>(
      `/fx/rates?base=${encodeURIComponent(base)}`,
      { method: 'GET' },
    ),
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
  markInstallmentPaid: (token: string, loanId: string, installmentId: string) =>
    request<{ loan: Loan }>(`/loans/${loanId}/installments/${installmentId}/pay`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('installment-pay') },
    }, token),
  claimRepayment: (
    token: string,
    loanId: string,
    body: {
      amount?: string;
      note?: string;
      proof_filename?: string;
      proof_mime?: string;
      proof_base64?: string;
    } = {},
  ) =>
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
  patchBankProfile: (
    token: string,
    id: string,
    body: {
      profile_type?: string;
      label?: string;
      institution_name?: string;
      account_identifier?: string;
      currency_code?: string;
    },
  ) =>
    request<{ bank_profile: BankProfile }>(`/bank-profiles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }, token),
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
  listConversations: (token: string) =>
    request<{ conversations: Conversation[] }>('/conversations', { method: 'GET' }, token),
  openConversation: (token: string, opts: { peer_id?: string; loan_id?: string }) =>
    request<{ conversation: Conversation }>('/conversations', {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('chat-open') },
      body: JSON.stringify(opts),
    }, token),
  listMessages: (token: string, conversationId: string, after?: string) => {
    const q = after ? `?after=${encodeURIComponent(after)}` : '';
    return request<{ messages: ChatMessage[] }>(`/conversations/${conversationId}/messages${q}`, { method: 'GET' }, token);
  },
  sendMessage: (
    token: string,
    conversationId: string,
    body: {
      body?: string;
      reply_to_message_id?: string;
      attachment_kind?: string;
      attachment_name?: string;
      attachment_mime?: string;
      attachment_base64?: string;
      voice_duration_ms?: number;
    },
  ) =>
    request<{ message: ChatMessage }>(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('chat-send') },
      body: JSON.stringify(body),
    }, token),
  reactMessage: (token: string, messageId: string, emoji: string, remove = false) =>
    request<{ message: ChatMessage }>(`/messages/${messageId}/reactions`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey('chat-react') },
      body: JSON.stringify({ emoji, remove }),
    }, token),
  deleteMessage: (token: string, messageId: string) =>
    request<void>(`/messages/${messageId}`, { method: 'DELETE' }, token),
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
  interaction_count?: number;
  bond?: 'acquaintance' | 'friend' | 'close' | string;
  peer: SearchHit;
};

export type PeerHit = {
  id: string;
  display_name: string;
  username?: string | null;
  interaction_count: number;
  bond: string;
  is_bonded: boolean;
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
  loan_kind?: 'one_time' | 'long_term';
  principal: string | null;
  currency_code: string | null;
  interest_rate_percent: string | null;
  interest_amount: string | null;
  expected_total: string | null;
  due_at: string | null;
  note: string | null;
  title?: string | null;
  interest_period_months?: number | null;
  installment_count?: number | null;
  installment_amount?: string | null;
  institution_label?: string | null;
  institution_type?: string | null;
  party_mode?: string;
  start_at?: string | null;
  can_accept: boolean;
  can_reject: boolean;
  can_cancel: boolean;
  can_propose_terms: boolean;
  co_lenders?: LoanParty[];
  events?: { id: string; event_type: string; created_at: string }[];
  installments?: LoanInstallment[];
};

export type LoanInstallment = {
  id: string;
  sequence: number;
  due_at: string;
  amount: string;
  principal_portion: string;
  interest_portion: string;
  status: string;
  paid_at?: string | null;
};

export type CreateLoanBody = {
  counterparty_id?: string;
  co_lender_ids?: string[];
  role: 'borrower' | 'lender';
  principal?: string;
  currency_code?: string;
  interest_rate_percent?: string;
  due_at?: string;
  note?: string;
  title?: string;
  loan_kind?: 'one_time' | 'long_term';
  party_mode?: 'peer' | 'alone' | 'shared';
  interest_period_months?: number;
  installment_count?: number;
  institution_label?: string;
  institution_type?: string;
  start_at?: string;
};

export type LoanTermsBody = {
  principal: string;
  currency_code: string;
  interest_rate_percent: string;
  due_at: string;
  note?: string;
  loan_kind?: 'one_time' | 'long_term';
  interest_period_months?: number;
  installment_count?: number;
  institution_label?: string;
  start_at?: string;
};

export type CashflowEntry = {
  id: string;
  kind: 'income' | 'expense' | 'outcome';
  title: string;
  amount: string;
  currency_code: string;
  category: string;
  category_id?: string | null;
  note?: string | null;
  occurred_at: string;
  is_template?: boolean;
  recurrence?: 'weekly' | 'monthly' | 'yearly' | null;
  next_occurrence_at?: string | null;
  template_id?: string | null;
  linked_loan_id?: string | null;
  account_id?: string | null;
  status?: 'expected' | 'confirmed';
  created_at: string;
  updated_at: string;
};

export type CashflowCategory = {
  id: string;
  kind: 'income' | 'expense';
  name: string;
  slug: string;
  is_system: boolean;
};

export type CategorySpend = {
  category: string;
  category_id?: string | null;
  currency_code: string;
  amount: string;
  count: number;
};

export type Budget = {
  id: string;
  category_id?: string | null;
  category_name: string;
  currency_code: string;
  limit_amount: string;
  period_month: string;
  spent: string;
  remaining: string;
  created_at: string;
  updated_at: string;
};

export type AccountTransfer = {
  id: string;
  from_account_id: string;
  to_account_id: string;
  amount: string;
  currency_code: string;
  note?: string | null;
  occurred_at: string;
};

export type Goal = {
  id: string;
  title: string;
  goal_type: 'travel' | 'purchase' | 'savings' | 'debt_payoff' | 'custom';
  currency_code: string;
  target_amount: string;
  current_amount: string;
  progress_percent: number;
  remaining: string;
  target_date?: string | null;
  linked_account_id?: string | null;
  linked_loan_id?: string | null;
  note?: string | null;
  status: 'active' | 'completed' | 'archived';
  eta_months?: number | null;
  monthly_rate?: string | null;
  created_at: string;
  updated_at: string;
};

export type GoalContribution = {
  id: string;
  goal_id: string;
  amount: string;
  currency_code: string;
  account_id?: string | null;
  note?: string | null;
  occurred_at: string;
  created_at: string;
};

export type GoalProjection = {
  goal_id: string;
  remaining: string;
  monthly_rate: string;
  eta_months?: number | null;
  on_track?: boolean | null;
  target_date?: string | null;
  contribution_count: number;
};

export type CreateGoalBody = {
  title: string;
  goal_type: Goal['goal_type'];
  currency_code: string;
  target_amount: string;
  current_amount?: string;
  target_date?: string;
  linked_account_id?: string;
  linked_loan_id?: string;
  note?: string;
};

export type UpdateGoalBody = {
  title?: string;
  goal_type?: Goal['goal_type'];
  currency_code?: string;
  target_amount?: string;
  target_date?: string;
  clear_target_date?: boolean;
  linked_account_id?: string;
  clear_account?: boolean;
  linked_loan_id?: string;
  clear_loan?: boolean;
  note?: string;
  status?: Goal['status'];
};

export type InsightsOverview = {
  currency_code: string;
  period_from: string;
  period_to: string;
  income: string;
  expense: string;
  net: string;
  savings_rate_percent?: number | null;
  prev_income: string;
  prev_expense: string;
  income_mom_percent?: number | null;
  expense_mom_percent?: number | null;
  open_receivables: string;
  open_payables: string;
  debt_service_ratio?: number | null;
  active_goals: number;
  goals_progress_avg?: number | null;
  goals_funded: string;
  goals_target: string;
};

export type InsightsMonthPoint = {
  month: string;
  currency_code: string;
  income: string;
  expense: string;
  net: string;
};

export type InsightsCategoryPoint = {
  category: string;
  currency_code: string;
  amount: string;
  count: number;
  share_percent: number;
};

export type InsightsDebtSlice = {
  currency_code: string;
  receivables: string;
  payables: string;
  net: string;
  open_count: number;
};

export type InsightsDebts = {
  preferred_currency?: string;
  receivables: string;
  payables: string;
  net: string;
  debt_service_ratio?: number | null;
  by_currency: InsightsDebtSlice[];
};

export type InsightsGoal = {
  id: string;
  title: string;
  goal_type: string;
  currency_code: string;
  target_amount: string;
  current_amount: string;
  progress_percent: number;
  status: string;
  eta_months?: number | null;
};

export type LonyScore = {
  id?: string;
  grade: 'A' | 'B' | 'C' | 'D' | 'E';
  band: string;
  points: number;
  currency_code: string;
  liquidity_score: number;
  savings_score: number;
  debt_score: number;
  consistency_score: number;
  goals_score: number;
  repayment_score: number;
  components?: Record<string, unknown>;
  tips?: string[];
  thin_history?: boolean;
  loan_sample_size?: number;
  computed_at: string;
};

export type PeerTrust = {
  grade: string;
  band: string;
  thin_history: boolean;
  loan_sample_size: number;
  repayment_score: number;
  available: boolean;
  computed_at?: string;
};

export type DataExport = {
  exported_at: string;
  profile: Record<string, unknown>;
  accounts: Record<string, unknown>[];
  cashflow: Record<string, unknown>[];
  transfers: Record<string, unknown>[];
  budgets: Record<string, unknown>[];
  goals: Record<string, unknown>[];
  loans: Record<string, unknown>[];
  repayments: Record<string, unknown>[];
  ai_insights: Record<string, unknown>[];
  trust?: Record<string, unknown>;
};

export type AIInsight = {
  id: string;
  theme: string;
  severity: 'info' | 'positive' | 'warning' | 'critical';
  title: string;
  body: string;
  evidence?: unknown;
  source: string;
  period_from?: string | null;
  period_to?: string | null;
  created_at: string;
};

export type AIReport = {
  currency_code: string;
  period_months: number;
  disclaimer: string;
  charts: { id: string; type: string; title: string; caption: string; data: Record<string, unknown> }[];
  summary: string;
};

export type CoachReply = {
  reply: string;
  disclaimer: string;
  actions?: { label: string; deep_link: string }[];
};

export type CashflowSummarySlice = {
  currency_code: string;
  income: string;
  expense?: string;
  outcome: string;
  net: string;
  income_count: number;
  expense_count?: number;
  outcome_count: number;
};

export type CashflowSummary = {
  from?: string | null;
  to?: string | null;
  by_currency: CashflowSummarySlice[];
};

export type CreateCashflowBody = {
  kind: 'income' | 'expense';
  title: string;
  amount: string;
  currency_code: string;
  account_id: string;
  category?: string;
  category_id?: string;
  note?: string;
  occurred_at?: string;
  recurrence?: 'weekly' | 'monthly' | 'yearly' | 'none';
  is_template?: boolean;
};

export type UpdateCashflowBody = {
  title?: string;
  amount?: string;
  currency_code?: string;
  category?: string;
  category_id?: string;
  account_id?: string;
  note?: string;
  occurred_at?: string;
  recurrence?: 'weekly' | 'monthly' | 'yearly' | 'none';
};

export type ShareCashflowBody = {
  friend_id: string;
  share_percent?: number;
  share_amount?: string;
  due_at?: string;
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

export type MoneyAccount = {
  id: string;
  name: string;
  account_type: 'cash' | 'bank' | 'mobile_money' | 'wallet' | 'other';
  currency_code: string;
  balance: string;
  balance_as_of: string;
  interest_rate_percent?: string | null;
  compounding?: 'none' | 'monthly' | 'yearly' | null;
  institution_label?: string | null;
  bank_profile_id?: string | null;
  projected_balance_12m?: string | null;
  created_at: string;
  updated_at: string;
};

export type AccountReconcile = {
  account_id: string;
  account_name: string;
  currency_code: string;
  stated_balance: string;
  expected_balance: string;
  difference: string;
  in_sync: boolean;
  baseline_balance: string;
  baseline_at: string;
  income_since: string;
  expense_since: string;
  transfers_in_since: string;
  transfers_out_since: string;
  unassigned_confirmed: string;
};

export type CreateAccountBody = {
  name: string;
  account_type: MoneyAccount['account_type'];
  currency_code: string;
  balance?: string;
  interest_rate_percent?: string;
  compounding?: 'none' | 'monthly' | 'yearly';
  institution_label?: string;
  bank_profile_id?: string;
};

export type UpdateAccountBody = {
  name?: string;
  account_type?: MoneyAccount['account_type'];
  currency_code?: string;
  interest_rate_percent?: string;
  compounding?: 'none' | 'monthly' | 'yearly';
  institution_label?: string;
  clear_interest?: boolean;
};

export type WealthCurrencySlice = {
  currency_code: string;
  cash_on_hand: string;
  receivables: string;
  payables: string;
  net_worth: string;
  account_count: number;
};

export type WealthSummary = {
  preferred_currency?: string;
  cash_on_hand: string;
  receivables: string;
  payables: string;
  net_worth: string;
  by_currency: WealthCurrencySlice[];
  accounts: MoneyAccount[];
};

export type BankProfile = {
  id: string;
  profile_type: string;
  label: string;
  institution_name?: string | null;
  account_last4: string;
  currency_code?: string | null;
  country_code?: string | null;
  rail_code?: string | null;
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

export type PaymentRail = {
  code: string;
  label: string;
  profile_type: string;
  category: string;
  countries?: string[];
  identifier_hint: string;
  currency_hint?: string;
};

export type CreateBankProfileBody = {
  profile_type: string;
  label: string;
  institution_name?: string;
  account_identifier: string;
  currency_code?: string;
  country_code?: string;
  rail_code?: string;
  is_preferred?: boolean;
};

export type Repayment = {
  id: string;
  loan_id: string;
  submitted_by_user_id: string;
  amount: string;
  status: string;
  note?: string | null;
  proof_url?: string | null;
  proof_name?: string | null;
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

export type ConversationMoney = {
  loan_id: string;
  role: 'lent' | 'borrowed';
  amount?: string | null;
  currency?: string | null;
  due_at?: string | null;
  ref?: string;
};

export type Conversation = {
  id: string;
  peer: { id: string; display_name: string };
  loan_id?: string | null;
  active_loan_id?: string | null;
  money_role?: 'lent' | 'borrowed' | null;
  money_amount?: string | null;
  money_currency?: string | null;
  money_due_at?: string | null;
  money_ref?: string | null;
  money?: ConversationMoney[];
  last_message_preview?: string;
  last_message_at?: string | null;
  last_message_mine?: boolean;
  last_message_read?: boolean;
  unread_count: number;
  created_at: string;
};

export type ChatReaction = {
  emoji: string;
  count: number;
  mine: boolean;
};

export type ChatMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  mine: boolean;
  read?: boolean;
  body?: string | null;
  reply_to?: ChatMessage | null;
  attachment_kind: string;
  attachment_name?: string | null;
  attachment_mime?: string | null;
  attachment_size?: number | null;
  attachment_url?: string | null;
  voice_duration_ms?: number | null;
  reactions: ChatReaction[];
  created_at: string;
};
