import { documentDirectory, readAsStringAsync, writeAsStringAsync } from 'expo-file-system/legacy';
import { normalizeSender } from './smsClassify';

/**
 * What the user still has to decide about bank SMS, kept on the phone per login:
 *  - messages that look like money but need a yes/no ("review"),
 *  - accounts found in SMS that are not in Lony yet (never added without asking),
 *  - senders the user has said are their bank or wallet,
 *  - messages and accounts the user already answered, so they are never asked again.
 */

export type SmsReviewItem = {
  /** Message fingerprint. */
  id: string;
  body: string;
  sender?: string;
  date: number;
  reason: string;
  kind: 'income' | 'expense' | null;
  amount: string | null;
  currency: string | null;
  institution: string | null;
  accountLast4: string | null;
  counterparty: string | null;
};

export type SmsPendingAccount = {
  /** last4 or wallet key + currency. */
  key: string;
  label: string;
  institution: string | null;
  last4: string | null;
  currency: string;
  accountType: 'bank' | 'mobile_money' | 'wallet' | 'other';
  balance: string | null;
};

type SmsReviewState = {
  reviews: SmsReviewItem[];
  pendingAccounts: SmsPendingAccount[];
  trustedSenders: string[];
  /** Message ids and account keys already answered. */
  answered: string[];
};

const EMPTY: SmsReviewState = { reviews: [], pendingAccounts: [], trustedSenders: [], answered: [] };
const MAX_REVIEWS = 200;

function stateFile(userId?: string): string | null {
  return documentDirectory ? `${documentDirectory}sms_review_${userId || 'default'}.json` : null;
}

export async function loadReviewState(userId?: string): Promise<SmsReviewState> {
  const path = stateFile(userId);
  if (!path) return { ...EMPTY };
  try {
    const parsed = JSON.parse(await readAsStringAsync(path)) as Partial<SmsReviewState>;
    return {
      reviews: Array.isArray(parsed.reviews) ? parsed.reviews : [],
      pendingAccounts: Array.isArray(parsed.pendingAccounts) ? parsed.pendingAccounts : [],
      trustedSenders: Array.isArray(parsed.trustedSenders) ? parsed.trustedSenders : [],
      answered: Array.isArray(parsed.answered) ? parsed.answered : [],
    };
  } catch {
    return { ...EMPTY };
  }
}

async function saveReviewState(state: SmsReviewState, userId?: string): Promise<void> {
  const path = stateFile(userId);
  if (!path) return;
  await writeAsStringAsync(path, JSON.stringify(state)).catch(() => undefined);
}

/** Adds messages to review (skipping ones already queued or answered). Returns how many are new. */
export async function queueReviews(items: SmsReviewItem[], userId?: string): Promise<number> {
  if (!items.length) return 0;
  const state = await loadReviewState(userId);
  const known = new Set([...state.reviews.map((r) => r.id), ...state.answered]);
  const fresh = items.filter((i) => !known.has(i.id));
  if (!fresh.length) return 0;
  state.reviews = [...state.reviews, ...fresh].sort((a, b) => b.date - a.date).slice(0, MAX_REVIEWS);
  await saveReviewState(state, userId);
  return fresh.length;
}

/** Remembers the answer for a reviewed message (saved or "not a transaction"). */
export async function resolveReview(id: string, userId?: string): Promise<void> {
  const state = await loadReviewState(userId);
  state.reviews = state.reviews.filter((r) => r.id !== id);
  if (!state.answered.includes(id)) state.answered.push(id);
  await saveReviewState(state, userId);
}

export async function queuePendingAccounts(accounts: SmsPendingAccount[], userId?: string): Promise<number> {
  if (!accounts.length) return 0;
  const state = await loadReviewState(userId);
  const known = new Set([...state.pendingAccounts.map((a) => a.key), ...state.answered]);
  const fresh = accounts.filter((a) => !known.has(a.key));
  if (!fresh.length) return 0;
  state.pendingAccounts = [...state.pendingAccounts, ...fresh];
  await saveReviewState(state, userId);
  return fresh.length;
}

/** The user added the account or said it is not theirs; never ask again. */
export async function resolvePendingAccount(key: string, userId?: string): Promise<void> {
  const state = await loadReviewState(userId);
  state.pendingAccounts = state.pendingAccounts.filter((a) => a.key !== key);
  if (!state.answered.includes(key)) state.answered.push(key);
  await saveReviewState(state, userId);
}

export async function trustSender(sender: string, userId?: string): Promise<void> {
  const key = normalizeSender(sender);
  if (!key) return;
  const state = await loadReviewState(userId);
  if (!state.trustedSenders.includes(key)) state.trustedSenders.push(key);
  await saveReviewState(state, userId);
}

export async function loadTrustedSenders(userId?: string): Promise<Set<string>> {
  return new Set((await loadReviewState(userId)).trustedSenders);
}

export async function answeredIds(userId?: string): Promise<Set<string>> {
  return new Set((await loadReviewState(userId)).answered);
}
