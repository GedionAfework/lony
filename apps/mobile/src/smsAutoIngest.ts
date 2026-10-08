import { Alert, PermissionsAndroid, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { api, type MoneyAccount } from './api';
import {
  accountTypeLabel,
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
        const filter = JSON.stringify({
          box: 'inbox',
          maxCount,
          indexFrom: 0,
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
        if (rows.length) return rows;
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

function accountAlreadyExists(accounts: MoneyAccount[], last4: string, currency: string): MoneyAccount | undefined {
  const c = currency.toUpperCase();
  const want = last4.slice(-4);
  return accounts.find((a) => {
    if (a.currency_code.toUpperCase() !== c) return false;
    if (a.account_type === 'cash') return false;
    const digits = `${a.name} ${a.institution_label || ''}`.replace(/\D/g, '');
    if (digits.length >= 4 && digits.slice(-4) === want) return true;
    const hay = `${a.name} ${a.institution_label || ''}`.toLowerCase();
    return hay.includes(want);
  });
}

function findWalletAccount(
  accounts: MoneyAccount[],
  institution: string,
  currency: string,
): MoneyAccount | undefined {
  const c = currency.toUpperCase();
  const needle = institution.toLowerCase();
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
          balance: '0',
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

  // Telebirr / wallets often have no account digits — match by institution + currency.
  if (parsed.accountType === 'mobile_money' || parsed.institutionHint) {
    const wallet = findWalletAccount(list, inst, currency);
    if (wallet) return { accountId: wallet.id, accounts: list, added };
    if (opts?.autoCreate) {
      try {
        const created = await api.createAccount(token, {
          name: inst,
          account_type: mapAccountType(parsed.accountType === 'other' ? 'bank' : parsed.accountType),
          currency_code: currency,
          balance: '0',
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

  const byCurrency = list.find((a) => a.currency_code.toUpperCase() === currency && a.account_type !== 'cash');
  if (byCurrency) return { accountId: byCurrency.id, accounts: list, added };
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
      if (!isTransferSms(msg.body)) continue;
      const parsed = parseTransferSms(msg.body);
      if (!parsed.amount || !parsed.kind || parsed.confidence < 0.45) continue;
      const fp = smsFingerprint(msg.body);
      candidates.push({ msg, parsed, fp });

      const currency = (parsed.currency || defaultCurrency || 'USD').toUpperCase();
      const last4 = (parsed.accountLast4 || '').replace(/\D/g, '').slice(-4);
      if (last4.length === 4 && !(parsed.otherAccountLast4 && parsed.otherAccountLast4 === last4)) {
        const key = accountKey(last4, currency);
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
      } else if (parsed.institutionHint || parsed.accountType === 'mobile_money') {
        const inst = parsed.institutionHint || 'Mobile money';
        const key = walletKey(inst, currency);
        if (!discoveredWallets.has(key)) {
          discoveredWallets.set(key, {
            currency,
            accountType: parsed.accountType === 'other' ? 'mobile_money' : parsed.accountType,
            institution: inst,
            label: inst,
          });
        }
      }
    }

    let accounts = (await api.listAccounts(token).catch(() => ({ accounts: [] as MoneyAccount[] }))).accounts ?? [];
    const asked = await loadAskedAccounts();
    let accountsAdded = 0;

    for (const disc of discovered.values()) {
      const key = accountKey(disc.last4, disc.currency);
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
          balance: '0',
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
          balance: '0',
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

    return { imported, skipped, accountsAdded, duplicates };
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
};

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

    const messages = await collectCandidateSms(opts?.maxCount ?? 80);
    if (!messages.length) return empty;

    let accounts = (await api.listAccounts(token).catch(() => ({ accounts: [] as MoneyAccount[] }))).accounts ?? [];
    const defaultCurrency =
      opts?.defaultCurrency ||
      accounts.find((a) => a.currency_code)?.currency_code ||
      'ETB';

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
    return { imported, skipped, accountsAdded, duplicates };
  } catch {
    return empty;
  }
}
