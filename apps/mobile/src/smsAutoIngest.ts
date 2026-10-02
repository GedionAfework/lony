import { Alert, PermissionsAndroid, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { api, type MoneyAccount } from './api';
import { parseTransferSms, smsFingerprint, type ParsedSmsTransfer } from './smsParse';

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
};

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
    const discovered = new Map<string, { last4: string; currency: string; label: string }>();

    for (const msg of messages) {
      const parsed = parseTransferSms(msg.body);
      if (!parsed.amount || !parsed.kind || parsed.confidence < 0.45) continue;
      const fp = smsFingerprint(msg.body);
      candidates.push({ msg, parsed, fp });
      const last4 = (parsed.accountLast4 || parsed.accountNumber || '').replace(/\D/g, '').slice(-4);
      if (last4.length === 4) {
        const currency = (parsed.currency || defaultCurrency || 'USD').toUpperCase();
        const key = accountKey(last4, currency);
        if (!discovered.has(key)) {
          discovered.set(key, {
            last4,
            currency,
            label: parsed.accountNumber
              ? `Bank …${last4}`
              : `Account …${last4}`,
          });
        }
      }
    }

    let accounts = (await api.listAccounts(token).catch(() => ({ accounts: [] as MoneyAccount[] }))).accounts ?? [];
    const asked = await loadAskedAccounts();
    let accountsAdded = 0;
    const accountByKey = new Map<string, string>();

    for (const a of accounts) {
      const m = `${a.name} ${a.institution_label || ''}`.match(/(\d{4})\b/);
      if (m) accountByKey.set(accountKey(m[1], a.currency_code), a.id);
    }

    for (const disc of discovered.values()) {
      const key = accountKey(disc.last4, disc.currency);
      const existing = accountAlreadyExists(accounts, disc.last4, disc.currency);
      if (existing) {
        accountByKey.set(key, existing.id);
        continue;
      }
      if (asked.has(key)) continue;
      asked.add(key);
      const yes = await askAddAccount(disc.label, disc.currency);
      if (!yes) continue;
      try {
        const created = await api.createAccount(token, {
          name: disc.label,
          account_type: 'bank',
          currency_code: disc.currency,
          balance: '0',
          institution_label: disc.label,
        });
        accounts = [...accounts, created.account];
        accountByKey.set(key, created.account.id);
        accountsAdded++;
      } catch {
        /* skip create failure */
      }
    }
    await saveAskedAccounts(asked);

    // Fallback: any account the user already has.
    const fallbackId = accounts[0]?.id;

    const seen = await loadSeen();
    let imported = 0;
    let skipped = 0;
    let duplicates = 0;

    for (const { msg, parsed, fp } of candidates) {
      if (seen.has(fp)) {
        skipped++;
        continue;
      }
      const last4 = (parsed.accountLast4 || parsed.accountNumber || '').replace(/\D/g, '').slice(-4);
      const currency = (parsed.currency || defaultCurrency || 'USD').toUpperCase();
      let accountId: string | undefined;
      if (last4.length === 4) {
        accountId = accountByKey.get(accountKey(last4, currency));
      }
      if (!accountId) {
        accountId = accounts.find((a) => a.currency_code.toUpperCase() === currency)?.id ?? fallbackId;
      }
      if (!accountId) {
        skipped++;
        continue;
      }
      try {
        const res = await api.ingestCashflowSms(token, {
          text: msg.body,
          account_id: accountId,
          create: true,
        });
        seen.add(fp);
        if (res.duplicate || res.matched_existing_id) {
          duplicates++;
        } else if (res.entry) {
          imported++;
        } else {
          skipped++;
        }
      } catch {
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

/** Incremental sync when opening Home (no account prompts). */
export async function syncBankSms(token: string, accountId?: string): Promise<SmsAutoSyncResult> {
  const empty: SmsAutoSyncResult = { imported: 0, skipped: 0, accountsAdded: 0, duplicates: 0 };
  try {
    const enabled = await getSmsAutoImportEnabled();
    if (!enabled) return empty;

    const messages = await collectCandidateSms(80);
    if (!messages.length) return empty;

    const seen = await loadSeen();
    let imported = 0;
    let skipped = 0;
    let duplicates = 0;

    for (const msg of messages) {
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
      try {
        const res = await api.ingestCashflowSms(token, {
          text: msg.body,
          account_id: accountId,
          create: true,
        });
        seen.add(fp);
        if (res.duplicate || res.matched_existing_id) duplicates++;
        else if (res.entry) imported++;
        else skipped++;
      } catch {
        skipped++;
      }
    }

    await saveSeen(seen);
    return { imported, skipped, accountsAdded: 0, duplicates };
  } catch {
    return empty;
  }
}
