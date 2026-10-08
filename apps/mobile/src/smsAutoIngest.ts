import { Alert, PermissionsAndroid, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { api, type MoneyAccount } from './api';
import {
  accountTypeLabel,
  extractSmsStatedBalance,
  isAccountHintSms,
  isTransferSms,
  parseTransferSms,
  smsFingerprint,
  summarizeSmsNote,
  type ParsedSmsTransfer,
  type SmsAccountType,
} from './smsParse';
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

type RawSms = { body: string; date?: number };

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

/**
 * Collect inbox SMS. On activate we pull a large window; ongoing sync uses the same helper.
 */
async function collectCandidateSms(maxCount = 500): Promise<RawSms[]> {
  if (Platform.OS === 'android') {
    try {
      const allowed = await ensureSmsPermission();
      if (!allowed) return [];
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const SmsAndroid = require('react-native-get-sms-android');
      if (SmsAndroid?.list) {
        const pages: RawSms[] = [];
        const pageSize = Math.min(maxCount, 400);
        for (let indexFrom = 0; indexFrom < maxCount && pages.length < maxCount; indexFrom += pageSize) {
          const filter = JSON.stringify({
            box: 'inbox',
            maxCount: pageSize,
            indexFrom,
          });
          const rows: RawSms[] = await new Promise((resolve) => {
            try {
              SmsAndroid.list(
                filter,
                () => resolve([]),
                (_count: number, smsList: string) => {
                  try {
                    const parsed = JSON.parse(smsList) as Array<{ body?: string; date?: string | number }>;
                    resolve(
                      (parsed || [])
                        .map((m) => ({ body: String(m.body || ''), date: Number(m.date) || undefined }))
                        .filter((m) => m.body.trim()),
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
          pages.push(...rows);
          if (rows.length < pageSize) break;
        }
        if (pages.length) return pages.slice(0, maxCount);
      }
    } catch {
      /* Expo Go / missing native module */
    }
  }

  try {
    const Clipboard = await import('expo-clipboard');
    const text = (await Clipboard.getStringAsync())?.trim() || '';
    if (text.length > 20) return [{ body: text }];
  } catch {
    /* ignore */
  }
  return [];
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
    const currency = (parsed.currency || defaultCurrency || 'ETB').toUpperCase();
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
  return accounts.find((a) => {
    if (a.currency_code.toUpperCase() !== c) return false;
    if (a.account_type === 'cash') return false;
    const hay = `${a.name} ${a.institution_label || ''}`.toLowerCase();
    return hay.includes(needle);
  });
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
  permissionDenied?: boolean;
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
  const inst = parsed.institutionHint || accountTypeLabel(parsed.accountType);
  let list = accounts;
  let added = 0;

  // Never create/match accounts from counterparty digits.
  if (
    last4.length === 4 &&
    !(parsed.otherAccountLast4 && parsed.otherAccountLast4 === last4)
  ) {
    const existing = accountAlreadyExists(list, last4, currency);
    if (existing) return { accountId: existing.id, accounts: list, added };
    if (opts?.autoCreate) {
      try {
        const label = `${inst} …${last4}`;
        const created = await api.createAccount(token, {
          name: label,
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

  // Telebirr / wallets often have no account digits — never a generic “Bank” row.
  const namedInst = parsed.institutionHint && !/^(bank|account|card)$/i.test(parsed.institutionHint);
  if (parsed.accountType === 'mobile_money' || parsed.accountType === 'wallet' || namedInst) {
    const wallet = findWalletAccount(list, inst, currency);
    if (wallet) return { accountId: wallet.id, accounts: list, added };
    if (opts?.autoCreate && parsed.accountType !== 'bank') {
      try {
        const created = await api.createAccount(token, {
          name: inst,
          account_type: mapAccountType(parsed.accountType === 'other' ? 'bank' : parsed.accountType),
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

/**
 * Full onboarding when SMS auto-import is turned on:
 * scan inbox → ask to add each discovered account → import transfers
 * (skipping payments already saved via receipt / cashflow).
 */
export async function activateAndSyncSms(
  token: string,
  defaultCurrency: string,
): Promise<SmsAutoSyncResult> {
  const empty: SmsAutoSyncResult = { imported: 0, skipped: 0, accountsAdded: 0, duplicates: 0 };
  try {
    await setSmsAutoImportEnabled(true);
    const ok = await ensureSmsPermission();
    if (!ok && Platform.OS === 'android') {
      Alert.alert('SMS permission', 'Allow SMS access in system settings to import bank messages.');
      return empty;
    }

    const messages = await collectCandidateSms(500);
    if (!messages.length) {
      Alert.alert('No SMS found', 'No inbox messages to scan yet. New bank SMS will import when you open Home.');
      return empty;
    }

    type Cand = { msg: RawSms; parsed: ParsedSmsTransfer; fp: string };
    const candidates: Cand[] = [];
    const discovered = new Map<
      string,
      { last4: string; currency: string; label: string; accountType: SmsAccountType; institution: string | null }
    >();
    const discoveredWallets = new Map<
      string,
      { currency: string; label: string; accountType: SmsAccountType; institution: string }
    >();

    for (const msg of messages) {
      if (!isAccountHintSms(msg.body)) continue;
      const parsed = parseTransferSms(msg.body);
      const last4 = (parsed.accountLast4 || '').replace(/\D/g, '').slice(-4);
      const currency = (parsed.currency || defaultCurrency || 'USD').toUpperCase();
      if (last4.length === 4 && !(parsed.otherAccountLast4 && parsed.otherAccountLast4 === last4)) {
        const key = last4;
        if (!discovered.has(key)) {
          const kindLabel = accountTypeLabel(parsed.accountType);
          const inst = parsed.institutionHint || kindLabel;
          discovered.set(key, {
            last4,
            currency,
            accountType: parsed.accountType,
            institution: inst,
            label: `${inst} …${last4}`,
          });
        }
      } else if (
        (parsed.accountType === 'mobile_money' || parsed.accountType === 'wallet') &&
        parsed.institutionHint &&
        !/^(bank|account)$/i.test(parsed.institutionHint)
      ) {
        const inst = parsed.institutionHint;
        const key = walletKey(inst, currency);
        if (!discoveredWallets.has(key)) {
          discoveredWallets.set(key, {
            currency,
            accountType: parsed.accountType,
            institution: inst,
            label: inst,
          });
        }
      }
      if (parsed.amount && parsed.kind && parsed.confidence >= 0.45 && isTransferSms(msg.body)) {
        candidates.push({ msg, parsed, fp: smsFingerprint(msg.body) });
      }
    }

    let accounts = (await api.listAccounts(token).catch(() => ({ accounts: [] as MoneyAccount[] }))).accounts ?? [];
    const asked = await loadAskedAccounts();
    let accountsAdded = 0;
    const stated = newestStatedBalances(messages, defaultCurrency);

    for (const disc of discovered.values()) {
      const key = `last4:${disc.last4}`;
      if (accountAlreadyExists(accounts, disc.last4, disc.currency)) continue;
      if (asked.has(key)) continue;
      asked.add(key);
      const yes = await askAddAccount(disc.label, disc.currency);
      if (!yes) continue;
      try {
        const created = await api.createAccount(token, {
          name: disc.label,
          account_type: mapAccountType(disc.accountType),
          currency_code: disc.currency,
          balance: seedBalance(stated, disc.last4, disc.institution, disc.currency),
          institution_label: disc.institution || disc.label,
        });
        accounts = [...accounts, created.account];
        accountsAdded++;
      } catch {
        /* skip create failure */
      }
    }

    for (const disc of discoveredWallets.values()) {
      const key = walletKey(disc.institution, disc.currency);
      if (findWalletAccount(accounts, disc.institution, disc.currency)) continue;
      if (asked.has(key)) continue;
      asked.add(key);
      const yes = await askAddAccount(disc.label, disc.currency);
      if (!yes) continue;
      try {
        const created = await api.createAccount(token, {
          name: disc.label,
          account_type: mapAccountType(disc.accountType),
          currency_code: disc.currency,
          balance: seedBalance(stated, null, disc.institution, disc.currency),
          institution_label: disc.institution,
        });
        accounts = [...accounts, created.account];
        accountsAdded++;
      } catch {
        /* skip */
      }
    }
    await saveAskedAccounts(asked);

    const seen = await loadSeen();
    let imported = 0;
    let skipped = 0;
    let duplicates = 0;
    let processed = 0;
    candidates.sort((a, b) => smsTime(a.msg) - smsTime(b.msg));

    for (const { msg, parsed, fp } of candidates) {
      if (seen.has(fp)) {
        skipped++;
        continue;
      }
      // Cap one activation burst so we don't hammer the API / hit rate limits.
      if (processed >= 80) {
        skipped++;
        continue;
      }
      const resolved = await resolveAccountForSms(token, parsed, defaultCurrency, accounts, {
        autoCreate: false,
      });
      accounts = resolved.accounts;
      if (!resolved.accountId) {
        skipped++;
        continue;
      }
      try {
        const result = await ingestParsedSms(token, msg.body, parsed, resolved.accountId);
        processed++;
        seen.add(fp);
        if (result.duplicate) {
          duplicates++;
        } else if (result.imported) {
          imported++;
          const last4 = (parsed.accountLast4 || '').replace(/\D/g, '').slice(-4);
          await notifySmsTransfer({
            kind: parsed.kind!,
            amount: parsed.amount!,
            currency: (parsed.currency || defaultCurrency).toUpperCase(),
            counterparty: parsed.counterparty,
            accountLast4: last4.length === 4 ? last4 : parsed.accountLast4,
            accountId: resolved.accountId,
          });
        } else {
          skipped++;
        }
        await sleep(80);
      } catch (e) {
        if (isRateLimitedError(e)) break;
        skipped++;
      }
    }

    await saveSeen(seen);
    accounts = await mergeDuplicateLast4Accounts(token, accounts, messages, defaultCurrency);
    const balancesUpdated = await applyNewestSmsBalances(token, messages, accounts, defaultCurrency);

    const parts = [
      accountsAdded ? `${accountsAdded} account(s) added` : null,
      imported ? `${imported} transfer(s) imported` : null,
      duplicates ? `${duplicates} already recorded (e.g. receipt)` : null,
    ].filter(Boolean);
    if (parts.length) {
      Alert.alert('SMS import', parts.join('\n'));
    } else if (!accountsAdded && !imported) {
      Alert.alert('SMS import', 'No new transfers to import. Receipts already saved won’t be counted twice.');
    }

    return { imported, skipped, accountsAdded, duplicates, balancesUpdated };
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
  onProgress?: (stage: SmsSyncStage) => void;
  /**
   * Fired as soon as account balances have been snapped to the newest "balance is …" SMS —
   * before the (slow) transfer import — so Home can repaint Total Balance immediately.
   */
  onBalancesReady?: (updated: number) => void;
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
      // Allow a full re-scan; server fingerprint still blocks true duplicates.
      await SecureStore.deleteItemAsync(SEEN_KEY).catch(() => undefined);
    }

    opts?.onProgress?.('reading');
    const messages = await collectCandidateSms(opts?.maxCount ?? 250);
    if (!messages.length) {
      opts?.onProgress?.('done');
      return empty;
    }
    messages.sort((a, b) => smsTime(a) - smsTime(b));

    let accounts = (await api.listAccounts(token).catch(() => ({ accounts: [] as MoneyAccount[] }))).accounts ?? [];
    const defaultCurrency =
      opts?.defaultCurrency ||
      accounts.find((a) => a.currency_code)?.currency_code ||
      'ETB';

    // Balances first: this is what Total Balance reads, and it only needs a few PATCHes.
    opts?.onProgress?.('balances');
    accounts = await mergeDuplicateLast4Accounts(token, accounts, messages, defaultCurrency);
    let balancesUpdated = await applyNewestSmsBalances(token, messages, accounts, defaultCurrency);
    opts?.onBalancesReady?.(balancesUpdated);

    opts?.onProgress?.('importing');
    const seen = await loadSeen();
    let imported = 0;
    let skipped = 0;
    let duplicates = 0;
    let accountsAdded = 0;
    let processed = 0;
    // Incremental sync: don't dump the whole inbox against the rate limiter at once.
    const maxProcess = opts?.force ? 60 : 40;

    for (const msg of messages) {
      if (!isTransferSms(msg.body)) {
        skipped++;
        continue;
      }
      const local = parseTransferSms(msg.body);
      if (!local.amount || !local.kind || local.confidence < 0.45) {
        skipped++;
        continue;
      }
      const fp = smsFingerprint(msg.body);
      if (seen.has(fp)) {
        skipped++;
        continue;
      }
      if (processed >= maxProcess) {
        skipped++;
        continue;
      }
      try {
        // Auto-create missing bank/wallet accounts during sync (Odit-style).
        const resolved = await resolveAccountForSms(token, local, defaultCurrency, accounts, {
          autoCreate: true,
        });
        accounts = resolved.accounts;
        accountsAdded += resolved.added;
        if (!resolved.accountId) {
          skipped++;
          continue;
        }

        const result = await ingestParsedSms(token, msg.body, local, resolved.accountId);
        processed++;
        seen.add(fp);
        if (result.duplicate) {
          duplicates++;
        } else if (result.imported) {
          imported++;
          const last4 = (local.accountLast4 || '').replace(/\D/g, '').slice(-4);
          await notifySmsTransfer({
            kind: local.kind,
            amount: local.amount,
            currency: (local.currency || defaultCurrency).toUpperCase(),
            counterparty: local.counterparty,
            accountLast4: last4.length === 4 ? last4 : local.accountLast4,
            accountId: resolved.accountId,
          });
        } else {
          skipped++;
        }
        await sleep(100);
      } catch (e) {
        if (isRateLimitedError(e)) break;
        skipped++;
      }
    }

    await saveSeen(seen);
    // Re-snap after import: new accounts may have appeared and server-side deltas may
    // have nudged balances away from the SMS-stated truth.
    if (imported > 0 || accountsAdded > 0) {
      accounts = await mergeDuplicateLast4Accounts(token, accounts, messages, defaultCurrency);
      balancesUpdated += await applyNewestSmsBalances(token, messages, accounts, defaultCurrency);
    }
    opts?.onProgress?.('done');
    return { imported, skipped, accountsAdded, duplicates, balancesUpdated };
  } catch {
    opts?.onProgress?.('done');
    return empty;
  }
}
