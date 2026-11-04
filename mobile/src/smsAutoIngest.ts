import { Alert, PermissionsAndroid, Platform } from 'react-native';
import { documentDirectory, readAsStringAsync, writeAsStringAsync } from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import { api, type MoneyAccount } from './api';
import {
  accountTypeLabel,
  extractSmsStatedBalance,
  isTransferSms,
  smsFingerprint,
  smsOccurredAt,
  summarizeSmsNote,
  type ParsedSmsTransfer,
  type SmsAccountType,
} from './smsParse';
import { classifySms, type SmsClassification } from './smsClassify';
import { accountLast4, accountsOfInstitution, canonicalInstitution, matchAccount, type AccountMatch } from './smsAccounts';
import { rememberSmsMany, type ArchivedSms } from './smsArchive';
import { notifySmsNeedsReview, notifySmsSaved, type SmsSavedNotice } from './smsTransferNotify';
import {
  answeredIds,
  loadTrustedSenders,
  queuePendingAccounts,
  queueReviews,
  resolvePendingAccount,
  resolveReview,
  type SmsPendingAccount,
  type SmsReviewItem,
} from './smsReview';

// How bank SMS become entries (see docs in smsClassify.ts):
//  1. read the inbox (Android only; nothing else is ever read),
//  2. classify each message: transaction → save, review → ask the user, ignore → skip,
//  3. save transactions to an account the user already has; accounts found in SMS are
//     only suggested, never created or archived on their own,
//  4. notify with what the server actually saved.

function mapAccountType(t: SmsAccountType): MoneyAccount['account_type'] {
  if (t === 'mobile_money') return 'mobile_money';
  if (t === 'wallet') return 'wallet';
  if (t === 'bank' || t === 'card') return 'bank';
  return 'other';
}

const PREF_KEY = 'lony.sms_auto_import';
/** Newest inbox timestamp already fully imported. Absent until the first complete scan. */
const SCAN_MARK_KEY = 'lony.sms_scanned_through_ms.v2';
const RECENT_MS = 2 * 24 * 60 * 60 * 1000;

export async function getSmsAutoImportEnabled(): Promise<boolean> {
  try {
    const v = await SecureStore.getItemAsync(PREF_KEY);
    if (v == null) return false;
    return v === '1';
  } catch {
    return false;
  }
}

export async function setSmsAutoImportEnabled(on: boolean): Promise<void> {
  await SecureStore.setItemAsync(PREF_KEY, on ? '1' : '0');
}

function scanMarkKey(userId?: string): string {
  return userId ? `${SCAN_MARK_KEY}.${userId}` : SCAN_MARK_KEY;
}

async function loadScanMark(userId?: string): Promise<number> {
  try {
    const raw = await SecureStore.getItemAsync(scanMarkKey(userId));
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

async function saveScanMark(ms: number, userId?: string): Promise<void> {
  if (!ms || ms <= 0) return;
  await SecureStore.setItemAsync(scanMarkKey(userId), String(Math.floor(ms))).catch(() => undefined);
}

export type RawSms = { body: string; date?: number; address?: string };

function savedFile(userId?: string): string | null {
  return documentDirectory ? `${documentDirectory}sms_saved_${userId || 'default'}.json` : null;
}

/** Fingerprints the server already holds. A file, because a full inbox outgrows SecureStore. */
async function loadSaved(userId?: string): Promise<Set<string>> {
  const path = savedFile(userId);
  if (!path) return new Set();
  try {
    const arr = JSON.parse(await readAsStringAsync(path)) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

async function storeSaved(saved: Set<string>, userId?: string): Promise<void> {
  const path = savedFile(userId);
  if (!path) return;
  await writeAsStringAsync(path, JSON.stringify([...saved])).catch(() => undefined);
}

function smsTime(msg: RawSms): number {
  return msg.date && Number.isFinite(msg.date) ? msg.date : 0;
}

/**
 * One id per received message: the same text received at a different minute is a
 * different transfer (two identical 50 ETB payments). `legacy` is the old text-only id,
 * still checked so messages saved before this change are not sent again.
 */
export function smsMessageId(msg: RawSms): { id: string; legacy: string } {
  const legacy = smsFingerprint(msg.body);
  const minute = Math.floor(smsTime(msg) / 60_000);
  return { id: minute ? `${legacy}@${minute}` : legacy, legacy };
}

export type SmsMoneyTotals = { currency: string; moneyIn: number; moneyOut: number; count: number };

/** Money in / out per currency, for all transfers and for the last 30 days. */
function moneyTotals(rows: { parsed: ParsedSmsTransfer; when: number }[], defaultCurrency: string) {
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const all = new Map<string, SmsMoneyTotals>();
  const recent = new Map<string, SmsMoneyTotals>();
  const add = (m: Map<string, SmsMoneyTotals>, cur: string, kind: 'income' | 'expense', amt: number) => {
    const t = m.get(cur) || { currency: cur, moneyIn: 0, moneyOut: 0, count: 0 };
    if (kind === 'income') t.moneyIn += amt;
    else t.moneyOut += amt;
    t.count++;
    m.set(cur, t);
  };
  for (const { parsed, when } of rows) {
    const amt = Number(parsed.amount);
    if (!parsed.kind || !Number.isFinite(amt) || amt <= 0) continue;
    const cur = (parsed.currency || defaultCurrency || 'USD').toUpperCase();
    add(all, cur, parsed.kind, amt);
    if (when >= since) add(recent, cur, parsed.kind, amt);
  }
  return { all: [...all.values()], last30Days: [...recent.values()] };
}

export async function ensureSmsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.READ_SMS,
      PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
    ]);
    return result[PermissionsAndroid.PERMISSIONS.READ_SMS] === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    try {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_SMS, {
        title: 'Read bank SMS',
        message: 'Lony reads transfer SMS to suggest accounts and import income/expenses.',
        buttonPositive: 'Allow',
        buttonNegative: 'Not now',
      });
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
      return false;
    }
  }
}

/** Cheap first pass so a big inbox is not fully classified. The classifier decides. */
const FINANCIAL_SMS =
  /debited|credited|transferr?ed|received|paid|sent|purchase|deposit|withdraw|balance|solde|saldo|avail(?:able)?\.?\s*bal|your\s+(?:account|a\/c)|card ending|\bbank\b|banque|banco|wallet|mobile money|m-pesa|mpesa|momo|zelle|venmo|paypal|cash app|telebirr|e-money|[\$€£₹₦¥]|KSh|Birr|Naira|Cedis|FCFA|\b[A-Z]{3}\s*[\d,]|\d[\d,.]*\s*(?:USD|EUR|GBP|CAD|AUD|KES|NGN|GHS|INR|ZAR|UGX|TZS|ETB|AED|XOF)\b|ተቀብለዋል|ከፍለዋል|ልከዋል/i;

/**
 * Reads the SMS inbox on Android. Returns nothing anywhere else: there is no fallback to
 * other text on the phone (the clipboard used to be read here, which imported anything).
 */
async function collectInboxSms(opts?: { minDate?: number }): Promise<{ messages: RawSms[]; scanned: number }> {
  if (Platform.OS !== 'android') return { messages: [], scanned: 0 };
  try {
    const allowed = await ensureSmsPermission();
    if (!allowed) return { messages: [], scanned: 0 };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const SmsAndroid = require('react-native-get-sms-android');
    if (!SmsAndroid?.list) return { messages: [], scanned: 0 };
    const kept: RawSms[] = [];
    let scanned = 0;
    // Small pages: a huge page can fail the bridge.
    const pageSize = 80;
    let prevTail = '';
    for (let indexFrom = 0; indexFrom < 500_000; indexFrom += pageSize) {
      const filter = JSON.stringify({
        box: 'inbox',
        maxCount: pageSize,
        indexFrom,
        sortOrder: 'date DESC',
        ...(opts?.minDate ? { selection: `date >= ${Math.floor(opts.minDate)}` } : {}),
      });
      const rows: RawSms[] = await new Promise((resolve) => {
        try {
          SmsAndroid.list(
            filter,
            () => resolve([]),
            (_count: number, smsList: string) => {
              try {
                type Row = { body?: string; date?: string | number; address?: string };
                const parsed = JSON.parse(smsList) as Array<Row | null>;
                resolve(
                  (parsed || [])
                    .filter((m): m is Row => Boolean(m))
                    .map((m) => ({
                      body: String(m.body || ''),
                      date: Number(m.date) || undefined,
                      address: m.address ? String(m.address) : undefined,
                    })),
                );
              } catch {
                resolve([]);
              }
            },
          );
        } catch {
          resolve([]);
        }
      });
      if (!rows.length) break;
      scanned += rows.length;
      const withBody = rows.filter((r) => r.body.trim());
      const tailRow = withBody[withBody.length - 1];
      const tail = tailRow ? `${tailRow.date}:${tailRow.body.slice(0, 48)}` : '';
      if (tail && tail === prevTail) break; // a broken pager repeating the same page
      if (tail) prevTail = tail;
      kept.push(...withBody.filter((r) => FINANCIAL_SMS.test(r.body) || isTransferSms(r.body)));
      if (rows.length < pageSize) break;
    }
    return { messages: kept, scanned };
  } catch {
    return { messages: [], scanned: 0 };
  }
}

function accountKey(last4: string, currency: string): string {
  return `${last4}|${currency.toUpperCase()}`;
}

function walletKey(institution: string, currency: string): string {
  return `w:${canonicalInstitution(institution) || institution.toLowerCase()}|${currency.toUpperCase()}`;
}

/** The account's own last 4 digits as printed in the message, or null when they are not its own. */
function ownLast4(parsed: ParsedSmsTransfer): string | null {
  // Mobile money is one wallet; digits in those messages belong to the other person.
  if (parsed.accountType === 'mobile_money' || parsed.accountType === 'wallet') return null;
  const last4 = (parsed.accountLast4 || '').replace(/\D/g, '').slice(-4);
  if (last4.length !== 4 || !parsed.accountOwned) return null;
  if ((parsed.counterpartyLast4s || []).includes(last4)) return null;
  return last4;
}

/**
 * Newest bank-printed balance per account, only from messages that are really about your
 * money: transactions, or balance notices from a known bank/wallet sender. Airtime and
 * promotional "balance" texts never count.
 */
function newestStatedBalances(classified: { msg: RawSms; cls: SmsClassification }[], defaultCurrency: string): Map<string, string> {
  const best = new Map<string, { date: number; balance: string }>();
  const remember = (key: string, date: number, balance: string) => {
    const prev = best.get(key);
    if (!prev || date >= prev.date) best.set(key, { date, balance });
  };
  for (const { msg, cls } of classified) {
    const usable =
      cls.verdict === 'transaction' || (cls.verdict === 'ignore' && cls.reason === 'balance notice');
    if (!usable) continue;
    const parsed = cls.parsed;
    const stated = parsed.statedBalance || extractSmsStatedBalance(msg.body);
    if (!stated) continue;
    const currency = (parsed.currency || defaultCurrency || 'USD').toUpperCase();
    const last4 = ownLast4(parsed);
    const date = smsTime(msg);
    if (last4) remember(accountKey(last4, currency), date, stated);
    const inst = parsed.institutionHint;
    if (inst && !/^(bank|account|card)$/i.test(inst)) remember(walletKey(inst, currency), date, stated);
  }
  const out = new Map<string, string>();
  for (const [k, v] of best) out.set(k, v.balance);
  return out;
}

function balancesDiffer(a: string, b: string): boolean {
  return Math.abs(Number(a) - Number(b)) > 0.009;
}

/** Snap matched accounts to the newest balance the bank printed. Never creates or archives. */
async function applyNewestSmsBalances(token: string, stated: Map<string, string>, accounts: MoneyAccount[]): Promise<number> {
  if (!stated.size) return 0;
  let updated = 0;
  for (const acct of accounts) {
    if (acct.account_type === 'cash') continue;
    const c = acct.currency_code.toUpperCase();
    const last4 = accountLast4(acct);
    const inst = acct.institution_label || acct.name;
    // A bank-wide balance only fits when this is the user's only account at that bank:
    // with two CBE accounts, a message without digits cannot say which one it was.
    const onlyAccountAtBank = accountsOfInstitution(accounts, inst, c).length === 1;
    const balance = last4
      ? stated.get(accountKey(last4, c)) || (onlyAccountAtBank ? stated.get(walletKey(inst, c)) : undefined)
      : onlyAccountAtBank
        ? stated.get(walletKey(inst, c))
        : undefined;
    if (!balance || !balancesDiffer(acct.balance, balance)) continue;
    try {
      await api.setAccountBalance(token, acct.id, { balance, note: 'sms stated balance' });
      acct.balance = balance;
      updated++;
    } catch {
      /* keep going — imports still succeed */
    }
  }
  return updated;
}

/** The account a transaction belongs to, among accounts the user already has. */
function resolveAccount(parsed: ParsedSmsTransfer, accounts: MoneyAccount[], defaultCurrency: string): AccountMatch<MoneyAccount> {
  const currency = (parsed.currency || defaultCurrency || 'USD').toUpperCase();
  return matchAccount(accounts, { institution: parsed.institutionHint, last4: ownLast4(parsed), currency });
}

/** An account the SMS says is yours that Lony does not have yet, to suggest to the user. */
function suggestedAccount(parsed: ParsedSmsTransfer, defaultCurrency: string, stated: Map<string, string>): SmsPendingAccount | null {
  const currency = (parsed.currency || defaultCurrency || 'USD').toUpperCase();
  const inst = parsed.institutionHint;
  if ((parsed.accountType === 'mobile_money' || parsed.accountType === 'wallet') && inst && parsed.accountOwned) {
    return {
      key: walletKey(inst, currency),
      label: inst,
      institution: inst,
      last4: null,
      currency,
      accountType: parsed.accountType === 'wallet' ? 'wallet' : 'mobile_money',
      balance: stated.get(walletKey(inst, currency)) ?? null,
    };
  }
  const last4 = ownLast4(parsed);
  if (last4) {
    const label = `${inst || accountTypeLabel(parsed.accountType)} …${last4}`;
    return {
      key: accountKey(last4, currency),
      label,
      institution: inst,
      last4,
      currency,
      accountType: 'bank',
      balance: stated.get(accountKey(last4, currency)) ?? null,
    };
  }
  if (inst) {
    return { key: walletKey(inst, currency), label: inst, institution: inst, last4: null, currency, accountType: 'bank', balance: null };
  }
  return null;
}

/**
 * One suggestion per real account: a bank message that prints "…1234" and one that does not
 * are the same account, so the bank-only suggestion is dropped when a numbered one exists.
 */
function dedupeSuggestions(list: SmsPendingAccount[]): SmsPendingAccount[] {
  const numbered = new Set(
    list.filter((x) => x.last4).map((x) => `${canonicalInstitution(x.institution)}|${x.currency.toUpperCase()}`),
  );
  return list.filter((x) => x.last4 || !numbered.has(`${canonicalInstitution(x.institution)}|${x.currency.toUpperCase()}`));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitedError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e || '');
  return /too many|rate limit|429/i.test(msg);
}

type IngestOutcome = { saved: SmsSavedNotice | null; duplicate: boolean };

/** Sends one message to the server and reports what it actually saved. */
async function ingestSms(
  token: string,
  msg: RawSms,
  parsed: ParsedSmsTransfer,
  account: MoneyAccount,
  confirmed: boolean,
): Promise<IngestOutcome> {
  const payload = {
    text: msg.body,
    account_id: account.id,
    create: true as const,
    kind: parsed.kind || undefined,
    amount: parsed.amount || undefined,
    // Unknown currency: the account's own, never a guess.
    currency_code: (parsed.currency || account.currency_code).toUpperCase(),
    account_last4: parsed.accountLast4 || undefined,
    counterparty: parsed.counterparty || undefined,
    title: parsed.summaryTitle || (parsed.kind === 'income' ? 'Money received' : 'Money sent'),
    note: summarizeSmsNote(parsed),
    stated_balance: parsed.statedBalance || undefined,
    occurred_at: smsOccurredAt(msg.body, smsTime(msg)),
    sms_date: smsTime(msg) || undefined,
    confirmed,
  };
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      if (attempt > 0) await sleep(1500 * attempt);
      const res = await api.ingestCashflowSms(token, payload);
      if (res.duplicate || res.matched_existing_id) return { saved: null, duplicate: true };
      const e = res.entry;
      if (!e) return { saved: null, duplicate: false };
      return {
        duplicate: false,
        saved: {
          kind: e.kind === 'income' ? 'income' : 'expense',
          amount: e.amount,
          currency: e.currency_code,
          title: e.title,
          accountId: account.id,
          accountName: account.name,
          when: smsTime(msg) || Date.now(),
        },
      };
    } catch (e) {
      lastErr = e;
      if (!isRateLimitedError(e)) throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Too many requests');
}

function reviewItem(msg: RawSms, cls: SmsClassification, id: string, reason: string): SmsReviewItem {
  const p = cls.parsed;
  return {
    id,
    body: msg.body,
    sender: msg.address,
    date: smsTime(msg) || Date.now(),
    reason,
    kind: p.kind,
    amount: p.amount,
    currency: p.currency,
    institution: p.institutionHint,
    accountLast4: p.accountLast4,
    counterparty: p.counterparty,
  };
}

export type SmsAutoSyncResult = {
  imported: number;
  skipped: number;
  accountsAdded: number;
  duplicates: number;
  balancesUpdated?: number;
  /** Inbox rows actually read (0 means the inbox could not be opened). */
  scanned?: number;
  permissionDenied?: boolean;
  /** True when saving paused (rate limit). Tap refresh again to continue. */
  paused?: boolean;
  /** Messages that looked like bank or wallet alerts. */
  moneyMessages?: number;
  /** Alerts read as money in or out. */
  transfersFound?: number;
  /** Transfers the server already had from an earlier pass. */
  alreadySaved?: number;
  /** Messages waiting for the user to say whether they are real transfers. */
  needsReview?: number;
  /** Accounts found in SMS that the user has not added yet. */
  accountsSuggested?: number;
  /** Transfers waiting for their account to be added. */
  unlinked?: number;
  /** Money in / out read from the messages (all of them, and the last 30 days). */
  totals?: { all: SmsMoneyTotals[]; last30Days: SmsMoneyTotals[] };
};

export type SyncBankSmsOptions = {
  /** Bypass the Settings toggle and read the whole inbox (the refresh button). */
  force?: boolean;
  defaultCurrency?: string;
  /** Stage updates so the UI can show progress instead of a silent spinner. */
  onProgress?: (stage: SmsSyncStage, detail?: string) => void;
  /** Fired once balances are snapped to the newest bank-printed figure. */
  onBalancesReady?: (updated: number) => void;
  /** Keeps each login's scan progress separate on a shared phone. */
  userId?: string;
  /** Messages handed over directly (e.g. by the incoming-SMS listener) before they reach the inbox. */
  extraMessages?: RawSms[];
  /** Show notifications for what was saved / needs review (default true). */
  notify?: boolean;
};

export type SmsSyncStage = 'reading' | 'balances' | 'importing' | 'done';

// One sync at a time: the incoming-SMS listener and the open app can both trigger one.
let running: Promise<SmsAutoSyncResult> | null = null;

export async function syncBankSms(token: string, _accountId?: string, opts?: SyncBankSmsOptions): Promise<SmsAutoSyncResult> {
  if (running) {
    await running.catch(() => undefined);
  }
  running = runSync(token, opts);
  try {
    return await running;
  } finally {
    running = null;
  }
}

async function runSync(token: string, opts?: SyncBankSmsOptions): Promise<SmsAutoSyncResult> {
  const empty: SmsAutoSyncResult = { imported: 0, skipped: 0, accountsAdded: 0, duplicates: 0 };
  try {
    const enabled = await getSmsAutoImportEnabled();
    if (!enabled && !opts?.force) return empty;
    if (opts?.force && Platform.OS === 'android') {
      const ok = await ensureSmsPermission();
      if (!ok) return { ...empty, permissionDenied: true };
    }

    const scanMark = await loadScanMark(opts?.userId);
    const fullScan = Boolean(opts?.force) || scanMark === 0;
    opts?.onProgress?.('reading', fullScan ? 'Reading your inbox once. After this, only new messages are checked.' : 'Reading new messages.');
    const collected = await collectInboxSms(fullScan ? undefined : { minDate: Math.max(0, scanMark - 60_000) });
    const messages = [...collected.messages];
    for (const extra of opts?.extraMessages ?? []) {
      if (!messages.some((m) => m.body === extra.body && Math.abs(smsTime(m) - smsTime(extra)) < 60_000)) messages.push(extra);
    }
    if (!messages.length) {
      opts?.onProgress?.('done');
      return { ...empty, scanned: collected.scanned };
    }
    messages.sort((a, b) => smsTime(a) - smsTime(b));

    const trusted = await loadTrustedSenders(opts?.userId);
    const classified = messages.map((msg) => ({ msg, cls: classifySms(msg.body, msg.address, trusted) }));
    let accounts = (await api.listAccounts(token).catch(() => ({ accounts: [] as MoneyAccount[] }))).accounts ?? [];
    const defaultCurrency = opts?.defaultCurrency || accounts.find((a) => a.currency_code)?.currency_code || 'USD';
    const stated = newestStatedBalances(classified, defaultCurrency);

    opts?.onProgress?.('balances');
    let balancesUpdated = await applyNewestSmsBalances(token, stated, accounts);
    opts?.onBalancesReady?.(balancesUpdated);

    opts?.onProgress?.('importing', fullScan ? 'Saving transfers, oldest first.' : 'Saving new transfers.');
    const saved = await loadSaved(opts?.userId);
    const answered = await answeredIds(opts?.userId);
    const reviews: SmsReviewItem[] = [];
    const suggestions = new Map<string, SmsPendingAccount>();
    const savedNotices: SmsSavedNotice[] = [];
    const transfers: { parsed: ParsedSmsTransfer; when: number }[] = [];
    const archiveBuf: ArchivedSms[] = [];
    let imported = 0;
    let skipped = 0;
    let duplicates = 0;
    let alreadySaved = 0;
    let unlinked = 0;
    let lastSavedMs = scanMark;
    let paused = false;

    for (const { msg, cls } of classified) {
      const { id, legacy } = smsMessageId(msg);
      if (saved.has(id) || saved.has(legacy)) {
        alreadySaved++;
        continue;
      }
      if (cls.verdict === 'ignore') {
        skipped++;
        continue;
      }
      if (answered.has(id)) {
        skipped++;
        continue;
      }
      if (cls.verdict === 'review') {
        reviews.push(reviewItem(msg, cls, id, cls.reason));
        continue;
      }
      const parsed = cls.parsed;
      transfers.push({ parsed, when: smsTime(msg) });
      const match = resolveAccount(parsed, accounts, defaultCurrency);
      if (match.kind === 'ambiguous') {
        // Two or more accounts could be it: never guess, ask once.
        const bank = parsed.institutionHint || 'this bank';
        reviews.push(reviewItem(msg, cls, id, `you have ${match.candidates.length} ${bank} accounts, pick the right one`));
        unlinked++;
        continue;
      }
      if (match.kind === 'none') {
        // Never create an account on our own: suggest it, and keep the transfer until it exists.
        const suggestion = suggestedAccount(parsed, defaultCurrency, stated);
        if (suggestion) suggestions.set(suggestion.key, suggestion);
        reviews.push(reviewItem(msg, cls, id, suggestion ? `add ${suggestion.label} to save this` : 'no matching account'));
        unlinked++;
        continue;
      }
      const account = match.account;
      archiveBuf.push({
        id: `${id}:${smsTime(msg) || 0}`,
        accountId: account.id,
        title: parsed.summaryTitle || (parsed.kind === 'income' ? 'Money received' : 'Money sent'),
        body: msg.body,
        date: smsTime(msg) || Date.now(),
        amount: parsed.amount || undefined,
        currency: (parsed.currency || account.currency_code).toUpperCase(),
        kind: parsed.kind || undefined,
      });
      try {
        const out = await ingestSms(token, msg, parsed, account, false);
        saved.add(id);
        lastSavedMs = Math.max(lastSavedMs, smsTime(msg));
        if (out.duplicate) duplicates++;
        else if (out.saved) {
          imported++;
          if (out.saved.when > Date.now() - RECENT_MS) savedNotices.push(out.saved);
        } else skipped++;
        if ((imported + duplicates) % 15 === 0) await storeSaved(saved, opts?.userId);
      } catch (e) {
        if (isRateLimitedError(e)) {
          paused = true;
          break;
        }
        skipped++;
      }
    }

    await storeSaved(saved, opts?.userId);
    await rememberSmsMany(archiveBuf, opts?.userId);
    const newReviews = await queueReviews(reviews, opts?.userId);
    const newSuggestions = await queuePendingAccounts(dedupeSuggestions([...suggestions.values()]), opts?.userId);
    // A paused pass only records what was actually saved, so the next pass continues.
    const ceiling = paused ? lastSavedMs : messages.reduce((max, m) => Math.max(max, smsTime(m)), lastSavedMs);
    if (ceiling > scanMark) await saveScanMark(ceiling, opts?.userId);
    if (imported > 0) {
      accounts = (await api.listAccounts(token).catch(() => ({ accounts }))).accounts ?? accounts;
      balancesUpdated += await applyNewestSmsBalances(token, stated, accounts);
    }
    if (opts?.notify !== false) {
      await notifySmsSaved(savedNotices);
      await notifySmsNeedsReview(newReviews, newSuggestions);
    }
    opts?.onProgress?.('done');
    return {
      imported,
      skipped,
      accountsAdded: 0,
      duplicates,
      balancesUpdated,
      scanned: collected.scanned,
      paused,
      moneyMessages: classified.filter((c) => c.cls.verdict !== 'ignore').length,
      transfersFound: transfers.length,
      alreadySaved,
      needsReview: reviews.length,
      accountsSuggested: suggestions.size,
      unlinked,
      totals: moneyTotals(transfers, defaultCurrency),
    };
  } catch {
    opts?.onProgress?.('done');
    return empty;
  }
}

/**
 * Turning SMS import on: read the inbox once, ask about each account found (the user is
 * here, so ask now), then import.
 */
export async function activateAndSyncSms(token: string, defaultCurrency: string, userId?: string): Promise<SmsAutoSyncResult> {
  const empty: SmsAutoSyncResult = { imported: 0, skipped: 0, accountsAdded: 0, duplicates: 0 };
  await setSmsAutoImportEnabled(true);
  const ok = await ensureSmsPermission();
  if (!ok) {
    Alert.alert('SMS permission', Platform.OS === 'android' ? 'Allow SMS access in system settings to import bank messages.' : 'Bank SMS import works on Android only.');
    return empty;
  }
  // First pass finds accounts without saving anything that has no account yet.
  const first = await syncBankSms(token, undefined, { force: true, defaultCurrency, userId, notify: false });
  const { loadReviewState } = await import('./smsReview');
  const state = await loadReviewState(userId);
  let accountsAdded = 0;
  for (const acct of state.pendingAccounts) {
    const yes = await askAddAccount(acct.label, acct.currency);
    if (yes) {
      try {
        await api.createAccount(token, {
          name: acct.label,
          account_type: mapAccountType(acct.accountType === 'mobile_money' ? 'mobile_money' : acct.accountType === 'wallet' ? 'wallet' : 'bank'),
          currency_code: acct.currency,
          balance: acct.balance || '0',
          institution_label: acct.institution || acct.label,
        });
        accountsAdded++;
      } catch {
        /* leave it in the list to add later */
        continue;
      }
    }
    await resolvePendingAccount(acct.key, userId);
  }
  // Transfers held for those accounts can now be saved.
  const second = accountsAdded ? await retryHeldTransfers(token, userId) : 0;
  const imported = first.imported + second;
  const parts = [
    accountsAdded ? `${accountsAdded} account(s) added` : null,
    imported ? `${imported} transfer(s) saved` : null,
    first.duplicates ? `${first.duplicates} already recorded` : null,
    first.needsReview ? `${first.needsReview} message(s) to check on Home` : null,
  ].filter(Boolean);
  Alert.alert('SMS import', parts.length ? parts.join('\n') : 'No new transfers found.');
  return { ...first, imported, accountsAdded };
}

function askAddAccount(label: string, currency: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert('Add account from SMS?', `${label} (${currency})\n\nYour bank messages mention this account. Add it to track its money in Lony?`, [
      { text: 'Not mine', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Add', onPress: () => resolve(true) },
    ]);
  });
}

/** Saves review items that were only waiting for an account that now exists. */
export async function retryHeldTransfers(token: string, userId?: string): Promise<number> {
  const { loadReviewState } = await import('./smsReview');
  const state = await loadReviewState(userId);
  const accounts = (await api.listAccounts(token).catch(() => ({ accounts: [] as MoneyAccount[] }))).accounts ?? [];
  const trusted = await loadTrustedSenders(userId);
  const saved = await loadSaved(userId);
  let count = 0;
  for (const item of state.reviews) {
    const msg: RawSms = { body: item.body, date: item.date, address: item.sender };
    const cls = classifySms(item.body, item.sender, trusted);
    if (cls.verdict !== 'transaction') continue;
    const match = resolveAccount(cls.parsed, accounts, accounts[0]?.currency_code || 'USD');
    if (match.kind !== 'found') continue;
    const account = match.account;
    try {
      const out = await ingestSms(token, msg, cls.parsed, account, false);
      saved.add(item.id);
      await resolveReview(item.id, userId);
      if (out.saved) count++;
    } catch {
      /* stays in review */
    }
  }
  await storeSaved(saved, userId);
  return count;
}

/** The user said a review item is a real transfer, into this account. */
export async function saveReviewedSms(token: string, item: SmsReviewItem, account: MoneyAccount, userId?: string): Promise<boolean> {
  const msg: RawSms = { body: item.body, date: item.date, address: item.sender };
  const cls = classifySms(item.body, item.sender);
  const parsed = { ...cls.parsed, kind: item.kind ?? cls.parsed.kind, amount: item.amount ?? cls.parsed.amount };
  if (!parsed.kind || !parsed.amount) return false;
  const out = await ingestSms(token, msg, parsed, account, true);
  const saved = await loadSaved(userId);
  saved.add(item.id);
  await storeSaved(saved, userId);
  await resolveReview(item.id, userId);
  return Boolean(out.saved) || out.duplicate;
}

/** The user added a suggested account; transfers held for it are saved right away. */
export async function addSuggestedAccount(token: string, acct: SmsPendingAccount, userId?: string): Promise<number> {
  await api.createAccount(token, {
    name: acct.label,
    account_type: mapAccountType(acct.accountType === 'mobile_money' ? 'mobile_money' : acct.accountType === 'wallet' ? 'wallet' : 'bank'),
    currency_code: acct.currency,
    balance: acct.balance || '0',
    institution_label: acct.institution || acct.label,
  });
  await resolvePendingAccount(acct.key, userId);
  return retryHeldTransfers(token, userId);
}
