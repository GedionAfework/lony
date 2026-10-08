import { AppState, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { getSmsAutoImportEnabled, syncBankSms } from './smsAutoIngest';

const HOUR_KEY = 'lony.sms_checkup_hour';
const MINUTE_KEY = 'lony.sms_checkup_minute';
const DAILY_ID = 'lony.sms.daily';
const DEFAULT_HOUR = 8;
const DEFAULT_MINUTE = 0;
const LIVE_POLL_MS = 8_000;

export type SmsWatchCallbacks = {
  token: string;
  defaultCurrency?: string;
  onImported?: (imported: number, accountsAdded: number) => void;
};

async function notificationsModule() {
  try {
    return await import('expo-notifications');
  } catch {
    return null;
  }
}

export async function getSmsCheckupTime(): Promise<{ hour: number; minute: number }> {
  try {
    const h = await SecureStore.getItemAsync(HOUR_KEY);
    const m = await SecureStore.getItemAsync(MINUTE_KEY);
    const hour = h != null ? Number(h) : DEFAULT_HOUR;
    const minute = m != null ? Number(m) : DEFAULT_MINUTE;
    return {
      hour: Number.isFinite(hour) ? Math.min(23, Math.max(0, Math.trunc(hour))) : DEFAULT_HOUR,
      minute: Number.isFinite(minute) ? Math.min(59, Math.max(0, Math.trunc(minute))) : DEFAULT_MINUTE,
    };
  } catch {
    return { hour: DEFAULT_HOUR, minute: DEFAULT_MINUTE };
  }
}

export async function setSmsCheckupTime(hour: number, minute = 0): Promise<void> {
  const h = Math.min(23, Math.max(0, Math.trunc(hour)));
  const m = Math.min(59, Math.max(0, Math.trunc(minute)));
  await SecureStore.setItemAsync(HOUR_KEY, String(h));
  await SecureStore.setItemAsync(MINUTE_KEY, String(m));
  const enabled = await getSmsAutoImportEnabled();
  if (enabled) await scheduleDailySmsCheckup(h, m);
}

export async function cancelDailySmsCheckup(): Promise<void> {
  const Notifications = await notificationsModule();
  if (!Notifications) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(DAILY_ID);
  } catch {
    /* ignore */
  }
}

export async function scheduleDailySmsCheckup(hour?: number, minute?: number): Promise<void> {
  if (Platform.OS === 'web') return;
  const Notifications = await notificationsModule();
  if (!Notifications) return;
  const enabled = await getSmsAutoImportEnabled();
  if (!enabled) {
    await cancelDailySmsCheckup();
    return;
  }
  const t = hour != null ? { hour, minute: minute ?? 0 } : await getSmsCheckupTime();
  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (status !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== 'granted') return;

  await cancelDailySmsCheckup();
  const hh = String(t.hour).padStart(2, '0');
  const mm = String(t.minute).padStart(2, '0');
  await Notifications.scheduleNotificationAsync({
    identifier: DAILY_ID,
    content: {
      title: 'Daily message checkup',
      body: `Scanning bank SMS at ${hh}:${mm}.`,
      data: { type: 'sms_daily_checkup' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: t.hour,
      minute: t.minute,
    },
  });
}

export function isDailySmsCheckup(data: Record<string, unknown> | undefined | null): boolean {
  return String(data?.type || '') === 'sms_daily_checkup';
}

let liveTimer: ReturnType<typeof setInterval> | null = null;
let liveAppSub: { remove: () => void } | null = null;
let liveBusy = false;
let liveOpts: SmsWatchCallbacks | null = null;

async function pollInboxOnce(forceDaily = false): Promise<void> {
  if (!liveOpts?.token || liveBusy) return;
  const enabled = await getSmsAutoImportEnabled();
  if (!enabled) return;
  liveBusy = true;
  try {
    const res = await syncBankSms(liveOpts.token, undefined, {
      force: forceDaily,
      maxCount: forceDaily ? 200 : 30,
      defaultCurrency: liveOpts.defaultCurrency || 'ETB',
    });
    if (res.imported > 0 || res.accountsAdded > 0) {
      liveOpts.onImported?.(res.imported, res.accountsAdded);
    }
  } catch {
    /* best-effort */
  } finally {
    liveBusy = false;
  }
}

export async function runDailySmsCheckup(): Promise<void> {
  await pollInboxOnce(true);
}

function startPolling(): void {
  if (liveTimer) return;
  liveTimer = setInterval(() => {
    if (AppState.currentState !== 'active') return;
    void pollInboxOnce(false);
  }, LIVE_POLL_MS);
}

function stopPolling(): void {
  if (liveTimer) {
    clearInterval(liveTimer);
    liveTimer = null;
  }
}

/** Poll the inbox while the app is open so each new transfer SMS is imported quickly. */
export function startLiveSmsWatch(opts: SmsWatchCallbacks): void {
  stopLiveSmsWatch();
  liveOpts = opts;
  startPolling();
  liveAppSub = AppState.addEventListener('change', (next) => {
    if (next === 'active') {
      startPolling();
      void pollInboxOnce(false);
      return;
    }
    stopPolling();
  });
  void pollInboxOnce(false);
  void scheduleDailySmsCheckup();
}

export function stopLiveSmsWatch(): void {
  stopPolling();
  liveAppSub?.remove();
  liveAppSub = null;
  liveOpts = null;
  liveBusy = false;
}
