import { api } from './api';
import { storageGet, storageSet } from './secureStorage';
import { getSmsAutoImportEnabled, syncBankSms } from './smsAutoIngest';

// Runs when Android delivers an SMS (native SmsReceiver → headless task "LonySmsReceived"),
// including while the app is closed, so transfers are saved and notified right away.

const ACCESS_KEY = 'lony.access_token';
const REFRESH_KEY = 'lony.refresh_token';
const CONTEXT_KEY = 'lony.sms_context';

export type SmsContext = { userId?: string; defaultCurrency?: string };

/** Remembered by the open app so the background task knows whose inbox it is. */
export async function rememberSmsContext(ctx: SmsContext): Promise<void> {
  await storageSet(CONTEXT_KEY, JSON.stringify(ctx));
}

async function loadSmsContext(): Promise<SmsContext> {
  try {
    return JSON.parse((await storageGet(CONTEXT_KEY)) || '{}') as SmsContext;
  } catch {
    return {};
  }
}

/** A working access token: the stored one, or a refreshed one when it expired. */
async function backgroundToken(): Promise<string | null> {
  const access = await storageGet(ACCESS_KEY);
  if (access) {
    try {
      await api.me(access);
      return access;
    } catch {
      /* expired: refresh below */
    }
  }
  const refresh = await storageGet(REFRESH_KEY);
  if (!refresh) return null; // signed out
  try {
    const tokens = await api.refresh(refresh);
    await storageSet(ACCESS_KEY, tokens.access_token);
    await storageSet(REFRESH_KEY, tokens.refresh_token);
    return tokens.access_token;
  } catch {
    return null;
  }
}

export async function handleIncomingSms(data: { address?: string; body?: string; date?: string | number }): Promise<void> {
  const body = String(data?.body || '').trim();
  if (!body || !(await getSmsAutoImportEnabled())) return;
  const token = await backgroundToken();
  if (!token) return;
  const ctx = await loadSmsContext();
  const date = Number(data.date) || Date.now();
  // The SMS app writes the message to the inbox right after the broadcast; give it a moment
  // so the inbox read and this message line up, and pass the message in directly as well.
  await new Promise((resolve) => setTimeout(resolve, 2500));
  await syncBankSms(token, undefined, {
    userId: ctx.userId,
    defaultCurrency: ctx.defaultCurrency,
    extraMessages: [{ body, address: data.address || undefined, date }],
  });
}
