import { Alert, PermissionsAndroid, Platform } from 'react-native';
import { documentDirectory, readAsStringAsync, writeAsStringAsync } from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import { api, type MoneyAccount } from './api';
import {
  accountTypeLabel,
  extractSmsStatedBalance,
  isAccountHintSms,
  isTransferSms,
  parseTransferSms,
  smsFingerprint,
  smsOccurredAt,
  summarizeSmsNote,
  type ParsedSmsTransfer,
  type SmsAccountType,
} from './smsParse';
import { rememberSmsMany, type ArchivedSms } from './smsArchive';
import { notifySmsTransfer } from './smsTransferNotify';

function mapAccountType(t: SmsAccountType): MoneyAccount['account_type'] {
  if (t === 'mobile_money') return 'mobile_money';
  if (t === 'wallet') return 'wallet';
  if (t === 'bank') return 'bank';
  return 'other';
}

const PREF_KEY = 'lony.sms_auto_import';
const SEEN_KEY = 'lony.sms_seen_fps';
const ACCOUNTS_ASKED_KEY = 'lony.sms_accounts_asked';
/** Newest inbox timestamp already fully imported. Absent until the first complete scan. */
const SCAN_MARK_KEY = 'lony.sms_scanned_through_ms.v2';

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
  if (on) {
    // Force a full re-scan; server fingerprint + payment-match still prevent doubles.
    await SecureStore.deleteItemAsync(SEEN_KEY).catch(() => undefined);
  }
}

async function loadSeen(): Promise<Set<string>> {
  try {
    const raw = await SecureStore.getItemAsync(SEEN_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

async function saveSeen(seen: Set<string>): Promise<void> {
  const arr = [...seen].slice(-800);
  await SecureStore.setItemAsync(SEEN_KEY, JSON.stringify(arr));
}

async function loadAskedAccounts(): Promise<Set<string>> {
  try {
    const raw = await SecureStore.getItemAsync(ACCOUNTS_ASKED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

async function saveAskedAccounts(asked: Set<string>): Promise<void> {
  await SecureStore.setItemAsync(ACCOUNTS_ASKED_KEY, JSON.stringify([...asked].slice(-100)));
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

type RawSms = { body: string; date?: number; address?: string };

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

/** Alphabetic SMS sender ("CBE", "Dashen Bank"); phone numbers and short codes say nothing. */
function senderInstitution(address?: string): string | null {
  const a = (address || '').trim();
  if (!a || a.length > 24 || /^\+?[\d\s-]+$/.test(a)) return null;
  const name = a.replace(/[^A-Za-z0-9 &.-]/g, '').trim();
  return /[A-Za-z]{2,}/.test(name) ? name : null;
}

/** Parse, then fall back to the sender for which bank or wallet the message is about. */
function parseSms(msg: RawSms): ParsedSmsTransfer {
  const parsed = parseTransferSms(msg.body);
  if (!parsed.institutionHint) {
    const inst = senderInstitution(msg.address);
    if (inst) {
      parsed.institutionHint = inst;
      if (parsed.accountType === 'other') parsed.accountType = 'bank';
      parsed.fromSender = true;
    }
  }
  return parsed;
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

const FINANCIAL_SMS =
  /debited|credited|transferr?ed|received|paid|sent|purchase|deposit|withdraw|balance|solde|saldo|avail(?:able)?\.?\s*bal|your\s+(?:account|a\/c)|card ending|\bbank\b|banque|banco|wallet|mobile money|m-pesa|mpesa|momo|zelle|venmo|paypal|cash app|telebirr|e-money|[\$€£₹₦¥]|KSh|Birr|Naira|Cedis|FCFA|\b[A-Z]{3}\s*[\d,]|\d[\d,.]*\s*(?:USD|EUR|GBP|CAD|AUD|KES|NGN|GHS|INR|ZAR|UGX|TZS|ETB|AED|XOF)\b/i;

/**
 * Collect inbox SMS. `financialOnly` pages deep into the inbox (older bank alerts sit under
 * years of chatty wallet SMS) and keeps only money messages.
 */
async function collectCandidateSms(
  maxCount = 500,
  opts?: { financialOnly?: boolean; scanCap?: number; minDate?: number; all?: boolean },
): Promise<{ messages: RawSms[]; scanned: number }> {
  if (Platform.OS === 'android') {
    try {
      const allowed = await ensureSmsPermission();
      if (!allowed) return { messages: [], scanned: 0 };
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const SmsAndroid = require('react-native-get-sms-android');
      if (SmsAndroid?.list) {
      const pages: RawSms[] = [];
      let scanned = 0;
      // Small pages: one blank text used to look like the end of the inbox, and a huge page can fail the bridge.
      const pageSize = 80;
      // `all` walks the inbox until it runs out. The cap only stops a broken pager from looping forever.
      const scanCap = opts?.all ? 500_000 : opts?.financialOnly ? opts.scanCap ?? 4000 : maxCount;
      const keepMax = opts?.all ? 500_000 : maxCount;
      let prevTail = '';
      for (let indexFrom = 0; indexFrom < scanCap && pages.length < keepMax; indexFrom += pageSize) {
          const filter = JSON.stringify({
            box: 'inbox',
            maxCount: pageSize,
            indexFrom,
            sortOrder: 'date DESC',
            // selection hits the SMS date column, so later syncs don't reread the whole inbox.
            ...(opts?.minDate ? { selection: `date >= ${Math.floor(opts.minDate)}` } : {}),
          });
          const batch: { rows: RawSms[]; rawCount: number } = await new Promise((resolve) => {
            try {
              SmsAndroid.list(
                filter,
                () => resolve({ rows: [], rawCount: 0 }),
                (_count: number, smsList: string) => {
                  try {
                    type Row = { body?: string; date?: string | number; address?: string };
                    const parsed = JSON.parse(smsList) as Array<Row | null>;
                    const rows = (parsed || [])
                      .filter((m): m is Row => Boolean(m))
                      .map((m) => ({
                        body: String(m.body || ''),
                        date: Number(m.date) || undefined,
                        address: m.address ? String(m.address) : undefined,
                      }));
                    resolve({ rows, rawCount: rows.length });
                  } catch {
                    resolve({ rows: [], rawCount: 0 });
                  }
                },
              );
            } catch {
              resolve({ rows: [], rawCount: 0 });
            }
          });
          if (!batch.rawCount) break;
          scanned += batch.rawCount;
          const withBody = batch.rows.filter((r) => r.body.trim());
          const tailRow = withBody[withBody.length - 1];
          const tail = tailRow ? `${tailRow.date}:${tailRow.body.slice(0, 48)}` : '';
          if (tail && tail === prevTail) break;
          if (tail) prevTail = tail;
          // Unknown banks still count when the text reads like money moving.
          const keep =
            opts?.financialOnly || opts?.all
              ? withBody.filter((r) => FINANCIAL_SMS.test(r.body) || isTransferSms(r.body))
              : withBody;
          pages.push(...keep);
          // Stop only when the provider itself returned a short page — not when a blank body was dropped.
          if (batch.rawCount < pageSize) break;
        }
        if (pages.length || scanned > 0) {
          // maxCount 0 with `all` means "keep everything". slice(0, 0) would drop the whole inbox.
          const limit = opts?.all || maxCount <= 0 ? pages.length : maxCount;
          return { messages: pages.slice(0, limit), scanned };
        }
      }
    } catch {
      /* Expo Go / missing native module */
    }
  }

  try {
    const Clipboard = await import('expo-clipboard');
    const text = (await Clipboard.getStringAsync())?.trim() || '';
    if (text.length > 20) return { messages: [{ body: text }], scanned: 1 };
  } catch {
    /* ignore */
  }
  return { messages: [], scanned: 0 };
}

function accountKey(last4: string, currency: string): string {
  return `${currency.toUpperCase()}:${last4}`;
}

function walletKey(institution: string, currency: string): string {
  return `${currency.toUpperCase()}:wallet:${institution.toLowerCase()}`;
}

function smsTime(msg: RawSms): number {
  return msg.date && Number.isFinite(msg.date) ? msg.date : 0;
}

/** Newest bank-printed remaining balance per last4 / wallet (SMS is the source of truth). */
function newestStatedBalances(
  messages: RawSms[],
  defaultCurrency: string,
): Map<string, string> {
  const best = new Map<string, { date: number; balance: string }>();
  const remember = (key: string, date: number, balance: string) => {
    const prev = best.get(key);
    if (!prev || date >= prev.date) best.set(key, { date, balance });
  };
  for (const msg of messages) {
    const parsed = parseTransferSms(msg.body);
    const stated = parsed.statedBalance || extractSmsStatedBalance(msg.body);
    if (!stated) continue;
    const currency = (parsed.currency || defaultCurrency || 'USD').toUpperCase();
    const last4 = (parsed.accountLast4 || '').replace(/\D/g, '').slice(-4);
    const date = smsTime(msg);
    if (last4.length === 4) {
      remember(accountKey(last4, currency), date, stated);
      remember(`l4:${last4}`, date, stated);
    }
    const inst = parsed.institutionHint;
    if (inst && !/^(bank|account|card)$/i.test(inst)) remember(walletKey(inst, currency), date, stated);
  }
  const out = new Map<string, string>();
  for (const [k, v] of best) out.set(k, v.balance);
  return out;
}

function seedBalance(
  stated: Map<string, string>,
  last4: string | null,
  institution: string | null,
  currency: string,
): string {
  const c = currency.toUpperCase();
  if (last4 && last4.length === 4) {
    const hit = stated.get(accountKey(last4, c));
    if (hit) return hit;
  }
  if (institution) {
    const hit = stated.get(walletKey(institution, c));
    if (hit) return hit;
  }
  return '0';
}

function balancesDiffer(a: string, b: string): boolean {
  return Math.abs(Number(a) - Number(b)) > 0.009;
}

/** Snap each matched account to the newest SMS "balance is …" figure. */
async function applyNewestSmsBalances(
  token: string,
  messages: RawSms[],
  accounts: MoneyAccount[],
  defaultCurrency: string,
): Promise<number> {
  const stated = newestStatedBalances(messages, defaultCurrency);
  if (!stated.size) return 0;
  let updated = 0;
  for (const acct of accounts) {
    if (acct.account_type === 'cash') continue;
    const c = acct.currency_code.toUpperCase();
    const digits = `${acct.name} ${acct.institution_label || ''}`.replace(/\D/g, '');
    const last4 = digits.length >= 4 ? digits.slice(-4) : '';
    const balance =
      (last4 ? stated.get(accountKey(last4, c)) : undefined) ||
      (last4 ? stated.get(`l4:${last4}`) : undefined) ||
      (acct.institution_label ? stated.get(walletKey(acct.institution_label, c)) : undefined) ||
      stated.get(walletKey(acct.name, c));
    if (!balance || !balancesDiffer(acct.balance, balance)) continue;
    try {
      await api.setAccountBalance(token, acct.id, {
        balance,
        note: 'sms stated balance',
      });
      acct.balance = balance;
      updated++;
    } catch {
      /* keep going — cashflow import still succeeded */
    }
  }
  return updated;
}

/** Collapse two rows that are the same last4 (e.g. USD copy + ETB copy). */
async function mergeDuplicateLast4Accounts(
  token: string,
  accounts: MoneyAccount[],
  messages: RawSms[],
  defaultCurrency: string,
): Promise<MoneyAccount[]> {
  const stated = newestStatedBalances(messages, defaultCurrency);
  const groups = new Map<string, MoneyAccount[]>();
  for (const a of accounts) {
    if (a.account_type === 'cash') continue;
    const l4 = accountLast4(a);
    if (!l4) continue;
    const g = groups.get(l4) || [];
    g.push(a);
    groups.set(l4, g);
  }
  const kept: MoneyAccount[] = [];
  const archived = new Set<string>();
  for (const [l4, group] of groups) {
    if (group.length < 2) continue;
    const named = group.find((a) => /…|\.\.\.|\d{4}/.test(a.name)) || group[0];
    const currency = named.currency_code.toUpperCase();
    const balance = stated.get(accountKey(l4, currency)) || stated.get(`l4:${l4}`) || named.balance;
    try {
      if (balancesDiffer(named.balance, balance)) {
        await api.setAccountBalance(token, named.id, { balance, note: 'sms stated balance' });
        named.balance = balance;
      }
      for (const extra of group) {
        if (extra.id === named.id) continue;
        await api.archiveAccount(token, extra.id);
        archived.add(extra.id);
      }
    } catch {
      /* keep both if archive fails */
    }
  }
  for (const a of accounts) {
    if (!archived.has(a.id)) kept.push(a);
  }
  return kept;
}

function accountLast4(a: MoneyAccount): string | null {
  const digits = `${a.name} ${a.institution_label || ''}`.replace(/\D/g, '');
  if (digits.length >= 4) return digits.slice(-4);
  return null;
}

function accountAlreadyExists(accounts: MoneyAccount[], last4: string, currency: string): MoneyAccount | undefined {
  const c = currency.toUpperCase();
  const want = last4.slice(-4);
  const hits = accounts.filter((a) => {
    if (a.account_type === 'cash') return false;
    return accountLast4(a) === want;
  });
  if (!hits.length) return undefined;
  return hits.find((a) => a.currency_code.toUpperCase() === c) || hits[0];
}

function findWalletAccount(
  accounts: MoneyAccount[],
  institution: string,
  currency: string,
): MoneyAccount | undefined {
  const needle = institution.toLowerCase().trim();
  if (!needle || needle === 'bank' || needle === 'account' || needle === 'card') return undefined;
  const c = currency.toUpperCase();
  const matches = accounts.filter((a) => {
    if (a.currency_code.toUpperCase() !== c) return false;
    if (a.account_type === 'cash') return false;
    const hay = `${a.name} ${a.institution_label || ''}`.toLowerCase();
    return hay.includes(needle);
  });
  // "Telebirr …5678" is a person you paid, not your wallet. Prefer the plain "Telebirr" row.
  return matches.find((a) => !/[…]\s*\d{4}\s*$/.test(a.name) && !/\.{2,}\s*\d{4}\s*$/.test(a.name)) || undefined;
}

function askAddAccount(label: string, currency: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Add account from SMS?',
      `${label} (${currency})\n\nWe’ll track income and expenses for this account in Lony.`,
      [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Add', onPress: () => resolve(true) },
      ],
    );
  });
}

export type SmsAutoSyncResult = {
  imported: number;
  skipped: number;
  accountsAdded: number;
  duplicates: number;
  balancesUpdated?: number;
  accountsRemoved?: number;
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
  /** Money alerts whose amount or direction could not be read. */
  unreadable?: number;
  /** Transfers with no matching account to save them to. */
  unlinked?: number;
  /** Money in / out read from the messages (all of them, and the last 30 days). */
  totals?: { all: SmsMoneyTotals[]; last30Days: SmsMoneyTotals[] };
};

/** Resolve / create the right account for a parsed SMS (currency + own last4 / wallet). */
async function resolveAccountForSms(
  token: string,
  parsed: ParsedSmsTransfer,
  defaultCurrency: string,
  accounts: MoneyAccount[],
  opts?: { autoCreate?: boolean },
): Promise<{ accountId?: string; accounts: MoneyAccount[]; added: number }> {
  const currency = (parsed.currency || defaultCurrency || 'USD').toUpperCase();
  const last4 = (parsed.accountLast4 || '').replace(/\D/g, '').slice(-4);
  const inst = parsed.institutionHint || '';
  let list = accounts;
  let added = 0;

  // Mobile money is one wallet. Digits in those SMS belong to the other person.
  if (
    (parsed.accountType === 'mobile_money' || parsed.accountType === 'wallet') &&
    inst &&
    !/^(bank|account|card)$/i.test(inst)
  ) {
    const wallet = findWalletAccount(list, inst, currency);
    if (wallet) return { accountId: wallet.id, accounts: list, added };
    if (opts?.autoCreate && parsed.accountOwned) {
      try {
        const created = await api.createAccount(token, {
          name: inst,
          account_type: mapAccountType(parsed.accountType),
          currency_code: currency,
          balance: parsed.statedBalance || '0',
          institution_label: inst,
        });
        list = [...list, created.account];
        added = 1;
        return { accountId: created.account.id, accounts: list, added };
      } catch {
        /* fall through */
      }
    }
    return { accountId: undefined, accounts: list, added };
  }

  // Bank / card: only an account the SMS calls yours ("your account 1***9388").
  if (last4.length === 4 && parsed.accountOwned && !(parsed.counterpartyLast4s || []).includes(last4)) {
    const existing = accountAlreadyExists(list, last4, currency);
    if (existing) return { accountId: existing.id, accounts: list, added };
    if (opts?.autoCreate) {
      try {
        const labelInst = inst || accountTypeLabel(parsed.accountType);
        const created = await api.createAccount(token, {
          name: `${labelInst} …${last4}`,
          account_type: mapAccountType(parsed.accountType === 'other' ? 'bank' : parsed.accountType),
          currency_code: currency,
          balance: parsed.statedBalance || '0',
          institution_label: labelInst,
        });
        list = [...list, created.account];
        added = 1;
        return { accountId: created.account.id, accounts: list, added };
      } catch {
        /* fall through */
      }
    }
  }

  // No account number in the text, but the bank itself sent it: one account per bank.
  if (inst && parsed.fromSender && !(last4.length === 4 && !parsed.accountOwned)) {
    const existing = findWalletAccount(list, inst, currency);
    if (existing) return { accountId: existing.id, accounts: list, added };
    if (opts?.autoCreate) {
      try {
        const created = await api.createAccount(token, {
          name: inst,
          account_type: mapAccountType(parsed.accountType),
          currency_code: currency,
          balance: parsed.statedBalance || '0',
          institution_label: inst,
        });
        list = [...list, created.account];
        added = 1;
        return { accountId: created.account.id, accounts: list, added };
      } catch {
        /* fall through */
      }
    }
  }

  return { accountId: undefined, accounts: list, added };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitedError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as Error & { api?: { error?: { code?: string; message?: string } } };
  const code = err.api?.error?.code || '';
  const msg = `${err.message || ''} ${err.api?.error?.message || ''}`.toLowerCase();
  return code === 'RATE_LIMITED' || msg.includes('too many requests') || msg.includes('rate limit');
}

async function ingestParsedSms(
  token: string,
  body: string,
  parsed: ParsedSmsTransfer,
  accountId: string,
  smsDateMs?: number,
): Promise<{ imported: boolean; duplicate: boolean }> {
  const title = parsed.summaryTitle || (parsed.kind === 'income' ? 'Money received' : 'Money sent');
  const note = summarizeSmsNote(parsed);
  const payload = {
    text: body,
    account_id: accountId,
    create: true as const,
    kind: parsed.kind || undefined,
    amount: parsed.amount || undefined,
    currency_code: parsed.currency || undefined,
    account_last4: parsed.accountLast4 || undefined,
    counterparty: parsed.counterparty || undefined,
    title,
    note,
    stated_balance: parsed.statedBalance || undefined,
    occurred_at: smsOccurredAt(body, smsDateMs),
  };

  // Back off if the API rate limiter trips mid-inbox sync.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      if (attempt > 0) await sleep(1500 * attempt);
      const res = await api.ingestCashflowSms(token, payload);
      if (res.duplicate || res.matched_existing_id) return { imported: false, duplicate: true };
      if (res.entry) return { imported: true, duplicate: false };
      return { imported: false, duplicate: false };
    } catch (e) {
      lastErr = e;
      if (!isRateLimitedError(e)) throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Too many requests');
}

type DiscoveredBank = {
  last4: string;
  currency: string;
  label: string;
  accountType: SmsAccountType;
  institution: string | null;
};
type DiscoveredWallet = {
  currency: string;
  label: string;
  accountType: SmsAccountType;
  institution: string;
};

function discoverAccounts(messages: RawSms[], defaultCurrency: string): {
  banks: Map<string, DiscoveredBank>;
  wallets: Map<string, DiscoveredWallet>;
  ownedLast4: Set<string>;
  counterpartyLast4: Set<string>;
} {
  const banks = new Map<string, DiscoveredBank>();
  const wallets = new Map<string, DiscoveredWallet>();
  const ownedLast4 = new Set<string>();
  const counterpartyLast4 = new Set<string>();
  for (const msg of messages) {
    if (!isAccountHintSms(msg.body)) continue;
    const parsed = parseTransferSms(msg.body);
    for (const l4 of parsed.counterpartyLast4s || []) counterpartyLast4.add(l4);
    const currency = (parsed.currency || defaultCurrency || 'USD').toUpperCase();
    if (
      (parsed.accountType === 'mobile_money' || parsed.accountType === 'wallet') &&
      parsed.accountOwned &&
      parsed.institutionHint
    ) {
      const key = walletKey(parsed.institutionHint, currency);
      if (!wallets.has(key)) {
        wallets.set(key, {
          currency,
          accountType: parsed.accountType,
          institution: parsed.institutionHint,
          label: parsed.institutionHint,
        });
      }
      continue;
    }
    const last4 = (parsed.accountLast4 || '').replace(/\D/g, '').slice(-4);
    if (parsed.accountOwned && last4.length === 4) {
      ownedLast4.add(last4);
      if (!banks.has(last4)) {
        const inst = parsed.institutionHint || accountTypeLabel(parsed.accountType);
        banks.set(last4, {
          last4,
          currency,
          accountType: parsed.accountType === 'other' ? 'bank' : parsed.accountType,
          institution: inst,
          label: `${inst} …${last4}`,
        });
      }
    }
  }
  return { banks, wallets, ownedLast4, counterpartyLast4 };
}

function looksLikeRecipientRow(name: string): boolean {
  return /[…]\s*\d{4}\s*$/.test(name) || /\.{2,}\s*\d{4}\s*$/.test(name);
}

/** Archive rows we created from someone else's Telebirr number or beneficiary account. */
async function retireForeignAccounts(
  token: string,
  accounts: MoneyAccount[],
  ownedLast4: Set<string>,
  counterpartyLast4: Set<string>,
): Promise<{ accounts: MoneyAccount[]; removed: number }> {
  const archived = new Set<string>();
  for (const a of accounts) {
    if (a.account_type === 'cash' || archived.has(a.id)) continue;
    const name = a.name || '';
    const l4 = accountLast4(a);
    const walletJunk =
      looksLikeRecipientRow(name) &&
      /telebirr|m-pesa|mpesa|cbe birr|mobile money/i.test(`${name} ${a.institution_label || ''}`);
    const bankJunk =
      Boolean(l4) &&
      looksLikeRecipientRow(name) &&
      counterpartyLast4.has(l4!) &&
      !ownedLast4.has(l4!);
    if (!walletJunk && !bankJunk) continue;
    try {
      await api.archiveAccount(token, a.id);
      archived.add(a.id);
    } catch {
      /* leave it if archive fails */
    }
  }
  return { accounts: accounts.filter((a) => !archived.has(a.id)), removed: archived.size };
}

async function ensureOwnedAccounts(
  token: string,
  accounts: MoneyAccount[],
  found: ReturnType<typeof discoverAccounts>,
  stated: Map<string, string>,
): Promise<{ accounts: MoneyAccount[]; added: number }> {
  let list = accounts;
  let added = 0;
  for (const disc of found.banks.values()) {
    if (accountAlreadyExists(list, disc.last4, disc.currency)) continue;
    try {
      const created = await api.createAccount(token, {
        name: disc.label,
        account_type: mapAccountType(disc.accountType),
        currency_code: disc.currency,
        balance: seedBalance(stated, disc.last4, disc.institution, disc.currency),
        institution_label: disc.institution || disc.label,
      });
      list = [...list, created.account];
      added++;
    } catch {
      /* skip */
    }
  }
  for (const disc of found.wallets.values()) {
    if (findWalletAccount(list, disc.institution, disc.currency)) continue;
    try {
      const created = await api.createAccount(token, {
        name: disc.label,
        account_type: mapAccountType(disc.accountType),
        currency_code: disc.currency,
        balance: seedBalance(stated, null, disc.institution, disc.currency),
        institution_label: disc.institution,
      });
      list = [...list, created.account];
      added++;
    } catch {
      /* skip */
    }
  }
  return { accounts: list, added };
}

/**
 * Full onboarding when SMS auto-import is turned on:
 * scan inbox → ask to add each discovered account → import transfers
 * (skipping payments already saved via receipt / cashflow).
 */
export async function activateAndSyncSms(
  token: string,
  defaultCurrency: string,
  userId?: string,
): Promise<SmsAutoSyncResult> {
  const empty: SmsAutoSyncResult = { imported: 0, skipped: 0, accountsAdded: 0, duplicates: 0 };
  try {
    await setSmsAutoImportEnabled(true);
    const ok = await ensureSmsPermission();
    if (!ok && Platform.OS === 'android') {
      Alert.alert('SMS permission', 'Allow SMS access in system settings to import bank messages.');
      return empty;
    }

    const collected = await collectCandidateSms(0, { all: true });
    const messages = collected.messages;
    if (!messages.length) {
      Alert.alert('No SMS found', 'No inbox messages to scan yet. New bank SMS will import when you open Home.');
      return empty;
    }

    type Cand = { msg: RawSms; parsed: ParsedSmsTransfer; fp: string };
    const candidates: Cand[] = [];
    for (const msg of messages) {
      const parsed = parseSms(msg);
      if (parsed.amount && parsed.kind && parsed.confidence >= 0.45 && isTransferSms(msg.body)) {
        candidates.push({ msg, parsed, fp: smsFingerprint(msg.body) });
      }
    }

    let accounts = (await api.listAccounts(token).catch(() => ({ accounts: [] as MoneyAccount[] }))).accounts ?? [];
    const found = discoverAccounts(messages, defaultCurrency);
    const retired = await retireForeignAccounts(token, accounts, found.ownedLast4, found.counterpartyLast4);
    accounts = retired.accounts;
    const stated = newestStatedBalances(messages, defaultCurrency);
    const ensured = await ensureOwnedAccounts(token, accounts, found, stated);
    accounts = ensured.accounts;
    let accountsAdded = ensured.added;

    const seen = await loadSeen();
    const saved = await loadSaved(userId);
    let imported = 0;
    let skipped = 0;
    let duplicates = 0;
    let processed = 0;
    let importAborted = false;
    let lastSavedMs = 0;
    candidates.sort((a, b) => smsTime(a.msg) - smsTime(b.msg));

    for (const { msg, parsed, fp } of candidates) {
      if (saved.has(fp)) continue;
      const resolved = await resolveAccountForSms(token, parsed, defaultCurrency, accounts, {
        autoCreate: Boolean(parsed.fromSender),
      });
      accounts = resolved.accounts;
      accountsAdded += resolved.added;
      if (!resolved.accountId) {
        skipped++;
        continue;
      }
      try {
        const result = await ingestParsedSms(token, msg.body, parsed, resolved.accountId, smsTime(msg));
        lastSavedMs = Math.max(lastSavedMs, smsTime(msg));
        processed++;
        seen.add(fp);
        saved.add(fp);
        if (processed % 25 === 0) await storeSaved(saved, userId);
        if (result.duplicate) {
          duplicates++;
        } else if (result.imported) {
          imported++;
          if (smsTime(msg) > Date.now() - 2 * 24 * 60 * 60 * 1000) {
            const last4 = (parsed.accountLast4 || '').replace(/\D/g, '').slice(-4);
            await notifySmsTransfer({
              kind: parsed.kind!,
              amount: parsed.amount!,
              currency: (parsed.currency || defaultCurrency).toUpperCase(),
              counterparty: parsed.counterparty,
              accountLast4: last4.length === 4 ? last4 : parsed.accountLast4,
              accountId: resolved.accountId,
            });
          }
        } else {
          skipped++;
        }
      } catch (e) {
        if (isRateLimitedError(e)) {
          importAborted = true;
          break;
        }
        skipped++;
      }
    }

    await saveSeen(seen);
    await storeSaved(saved, userId);
    const newest = importAborted
      ? lastSavedMs
      : messages.reduce((max, msg) => Math.max(max, smsTime(msg)), lastSavedMs);
    if (newest) await saveScanMark(newest, userId);
    accounts = await mergeDuplicateLast4Accounts(token, accounts, messages, defaultCurrency);
    const balancesUpdated = await applyNewestSmsBalances(token, messages, accounts, defaultCurrency);

    const parts = [
      accountsAdded ? `${accountsAdded} account(s) added` : null,
      retired.removed ? `${retired.removed} other people’s account(s) removed` : null,
      imported ? `${imported} transfer(s) imported` : null,
      duplicates ? `${duplicates} already recorded (e.g. receipt)` : null,
    ].filter(Boolean);
    if (parts.length) {
      Alert.alert('SMS import', parts.join('\n'));
    } else if (!accountsAdded && !imported) {
      Alert.alert('SMS import', 'No new transfers to import. Receipts already saved won’t be counted twice.');
    }

    return { imported, skipped, accountsAdded, duplicates, balancesUpdated, accountsRemoved: retired.removed };
  } catch {
    return empty;
  }
}

export type SyncBankSmsOptions = {
  /** Bypass the Settings toggle (used by the Home refresh button). */
  force?: boolean;
  /** How many inbox messages to scan (default 80; refresh uses more). */
  maxCount?: number;
  defaultCurrency?: string;
  /** Stage updates so the UI can show progress instead of a silent spinner. */
  onProgress?: (stage: SmsSyncStage, detail?: string) => void;
  /**
   * Fired as soon as account balances have been snapped to the newest "balance is …" SMS —
   * before the (slow) transfer import — so Home can repaint Total Balance immediately.
   */
  onBalancesReady?: (updated: number) => void;
  /** Keeps each login's scan progress separate on a shared phone. */
  userId?: string;
};

export type SmsSyncStage = 'reading' | 'balances' | 'importing' | 'done';

/** Incremental sync when opening Home (no account prompts). */
export async function syncBankSms(
  token: string,
  _accountId?: string,
  opts?: SyncBankSmsOptions,
): Promise<SmsAutoSyncResult> {
  const empty: SmsAutoSyncResult = { imported: 0, skipped: 0, accountsAdded: 0, duplicates: 0 };
  try {
    const enabled = await getSmsAutoImportEnabled();
    if (!enabled && !opts?.force) return empty;

    if (opts?.force && Platform.OS === 'android') {
      const ok = await ensureSmsPermission();
      if (!ok) return { ...empty, permissionDenied: true };
    }

    const scanMark = await loadScanMark(opts?.userId);
    // The refresh button always reads the whole inbox. Opening Home only checks messages since the last full pass.
    const fullScan = Boolean(opts?.force) || scanMark === 0;
    opts?.onProgress?.(
      'reading',
      fullScan
        ? 'Reading your whole inbox once. After this, only new messages are checked.'
        : 'Reading new messages.',
    );
    const collected = fullScan
      ? await collectCandidateSms(0, { all: true })
      : scanMark > 0
        ? await collectCandidateSms(0, { all: true, minDate: Math.max(0, scanMark - 60_000) })
        : await collectCandidateSms(opts?.maxCount ?? 180);
    const messages = collected.messages;
    if (!messages.length) {
      opts?.onProgress?.('done');
      return { ...empty, scanned: collected.scanned };
    }
    messages.sort((a, b) => smsTime(a) - smsTime(b));

    let accounts = (await api.listAccounts(token).catch(() => ({ accounts: [] as MoneyAccount[] }))).accounts ?? [];
    const defaultCurrency =
      opts?.defaultCurrency ||
      accounts.find((a) => a.currency_code)?.currency_code ||
      'USD';

    const found = discoverAccounts(messages, defaultCurrency);
    const retired = await retireForeignAccounts(token, accounts, found.ownedLast4, found.counterpartyLast4);
    accounts = retired.accounts;
    const stated = newestStatedBalances(messages, defaultCurrency);
    const ensured = await ensureOwnedAccounts(token, accounts, found, stated);
    accounts = ensured.accounts;
    let accountsAdded = ensured.added;

    // Balances first: this is what Total Balance reads, and it only needs a few PATCHes.
    opts?.onProgress?.('balances');
    accounts = await mergeDuplicateLast4Accounts(token, accounts, messages, defaultCurrency);
    let balancesUpdated = await applyNewestSmsBalances(token, messages, accounts, defaultCurrency);
    opts?.onBalancesReady?.(balancesUpdated);

    opts?.onProgress?.('importing', fullScan ? 'Saving every transfer, oldest first.' : 'Saving new transfers.');
    const seen = await loadSeen();
    const saved = await loadSaved(opts?.userId);
    let imported = 0;
    let skipped = 0;
    let duplicates = 0;
    let processed = 0;
    let alreadySaved = 0;
    let unreadable = 0;
    let unlinked = 0;
    let lastSavedMs = scanMark;
    let importAborted = false;
    const transfers: { parsed: ParsedSmsTransfer; when: number }[] = [];
    const archiveBuf: ArchivedSms[] = [];

    for (const msg of messages) {
      if (!isTransferSms(msg.body)) {
        skipped++;
        continue;
      }
      const local = parseSms(msg);
      if (!local.amount || !local.kind || local.confidence < 0.45) {
        unreadable++;
        skipped++;
        continue;
      }
      const fp = smsFingerprint(msg.body);
      transfers.push({ parsed: local, when: smsTime(msg) });
      try {
        // Auto-create missing bank/wallet accounts during sync (Odit-style).
        const resolved = await resolveAccountForSms(token, local, defaultCurrency, accounts, {
          autoCreate: !saved.has(fp),
        });
        accounts = resolved.accounts;
        accountsAdded += resolved.added;
        if (resolved.accountId) {
          archiveBuf.push({
            id: `${fp}:${smsTime(msg) || 0}`,
            accountId: resolved.accountId,
            title: local.summaryTitle || (local.kind === 'income' ? 'Money received' : 'Money sent'),
            body: msg.body,
            date: smsTime(msg) || Date.now(),
            amount: local.amount || undefined,
            currency: (local.currency || defaultCurrency).toUpperCase(),
            kind: local.kind,
          });
        }
        // Only messages the server confirmed are skipped. Anything that failed or had no
        // account last time is tried again.
        if (saved.has(fp)) {
          alreadySaved++;
          continue;
        }
        if (!resolved.accountId) {
          unlinked++;
          skipped++;
          continue;
        }

        const result = await ingestParsedSms(token, msg.body, local, resolved.accountId, smsTime(msg));
        lastSavedMs = Math.max(lastSavedMs, smsTime(msg));
        if (processed % 15 === 0) {
          opts?.onProgress?.('importing', `Saving transfers… ${processed} so far`);
          if (processed > 0) {
            await storeSaved(saved, opts?.userId);
            await rememberSmsMany(archiveBuf, opts?.userId);
          }
        }
        processed++;
        seen.add(fp);
        saved.add(fp);
        if (result.duplicate) {
          duplicates++;
        } else if (result.imported) {
          imported++;
          const recent = smsTime(msg) > Date.now() - 2 * 24 * 60 * 60 * 1000;
          if (recent) {
            const last4 = (local.accountLast4 || '').replace(/\D/g, '').slice(-4);
            await notifySmsTransfer({
              kind: local.kind,
              amount: local.amount,
              currency: (local.currency || defaultCurrency).toUpperCase(),
              counterparty: local.counterparty,
              accountLast4: last4.length === 4 ? last4 : local.accountLast4,
              accountId: resolved.accountId,
            });
          }
        } else {
          skipped++;
        }
      } catch (e) {
        if (isRateLimitedError(e)) {
          importAborted = true;
          break;
        }
        skipped++;
      }
    }

    await saveSeen(seen);
    await storeSaved(saved, opts?.userId);
    await rememberSmsMany(archiveBuf, opts?.userId);
    // A paused pass only records what was actually saved, so the next tap continues.
    const ceiling = importAborted
      ? lastSavedMs
      : messages.reduce((max, m) => Math.max(max, smsTime(m)), lastSavedMs);
    if ((fullScan || scanMark > 0) && ceiling > scanMark) await saveScanMark(ceiling, opts?.userId);
    // Re-snap after import: new accounts may have appeared and server-side deltas may
    // have nudged balances away from the SMS-stated truth.
    if (imported > 0 || accountsAdded > 0) {
      accounts = await mergeDuplicateLast4Accounts(token, accounts, messages, defaultCurrency);
      balancesUpdated += await applyNewestSmsBalances(token, messages, accounts, defaultCurrency);
    }
    opts?.onProgress?.('done');
    return {
      imported,
      skipped,
      accountsAdded,
      duplicates,
      balancesUpdated,
      accountsRemoved: retired.removed,
      scanned: collected.scanned,
      paused: importAborted,
      moneyMessages: messages.length,
      transfersFound: transfers.length,
      alreadySaved,
      unreadable,
      unlinked,
      totals: moneyTotals(transfers, defaultCurrency),
    };
  } catch {
    opts?.onProgress?.('done');
    return empty;
  }
}
