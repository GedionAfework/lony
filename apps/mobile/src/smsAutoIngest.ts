import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { api } from './api';
import { parseTransferSms, smsFingerprint } from './smsParse';

const PREF_KEY = 'lony.sms_auto_import';
const SEEN_KEY = 'lony.sms_seen_fps';

export async function getSmsAutoImportEnabled(): Promise<boolean> {
  try {
    const v = await SecureStore.getItemAsync(PREF_KEY);
    // Default on for both platforms (iOS uses clipboard; Android may read inbox).
    if (v == null) return true;
    return v === '1';
  } catch {
    return true;
  }
}

export async function setSmsAutoImportEnabled(on: boolean): Promise<void> {
  await SecureStore.setItemAsync(PREF_KEY, on ? '1' : '0');
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
  const arr = [...seen].slice(-200);
  await SecureStore.setItemAsync(SEEN_KEY, JSON.stringify(arr));
}

type RawSms = { body: string; date?: number };

/**
 * Best-effort SMS collection.
 * Android (custom/dev build): inbox via react-native-get-sms-android when available.
 * iOS / Expo Go: clipboard fallback (copy a bank SMS, then open the app).
 */
async function collectCandidateSms(): Promise<RawSms[]> {
  if (Platform.OS === 'android') {
    try {
      // Optional native module (present after EAS/prebuild with react-native-get-sms-android).
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const SmsAndroid = require('react-native-get-sms-android');
      if (SmsAndroid?.list) {
        const filter = JSON.stringify({
          box: 'inbox',
          maxCount: 40,
          indexFrom: 0,
        });
        const rows: RawSms[] = await new Promise((resolve) => {
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

export type SmsAutoSyncResult = { imported: number; skipped: number };

/** Scan recent bank SMS (or clipboard text) and create cashflow rows for new fingerprints. */
export async function syncBankSms(token: string, accountId?: string): Promise<SmsAutoSyncResult> {
  const enabled = await getSmsAutoImportEnabled();
  if (!enabled) return { imported: 0, skipped: 0 };

  const messages = await collectCandidateSms();
  if (!messages.length) return { imported: 0, skipped: 0 };

  const seen = await loadSeen();
  let imported = 0;
  let skipped = 0;

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
      if (res.entry && !res.duplicate) imported++;
      else skipped++;
    } catch {
      skipped++;
    }
  }

  await saveSeen(seen);
  return { imported, skipped };
}
