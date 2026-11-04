import { Platform } from 'react-native';
import type { CashflowFormPrefill } from './CashflowScreens';

export type SmsTransferNotifyPayload = {
  type: 'sms_transfer';
  kind: 'income' | 'expense';
  amount: string;
  currency_code: string;
  title: string;
  note: string;
  account_id?: string;
  /** When true, open the cashflow form so the user can complete details. */
  open_form: '1' | '0';
};

export type SmsTransferNotifyInput = {
  kind: 'income' | 'expense';
  amount: string;
  currency?: string | null;
  counterparty?: string | null;
  accountLast4?: string | null;
  accountId?: string | null;
};

async function notificationsModule() {
  try {
    return await import('expo-notifications');
  } catch {
    return null;
  }
}

export async function ensureSmsNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const Notifications = await notificationsModule();
  if (!Notifications) return false;
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/** Show banners while the app is open. */
export async function configureSmsNotificationHandler(): Promise<void> {
  const Notifications = await notificationsModule();
  if (!Notifications) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

function buildTitleNote(input: SmsTransferNotifyInput): { title: string; note: string } {
  const cp = (input.counterparty || '').trim();
  const acct = (input.accountLast4 || '').replace(/\D/g, '').slice(-4);
  const noteBits = [acct.length === 4 ? `acct …${acct}` : null, cp || null].filter(Boolean);
  const note = noteBits.join(' · ') || 'Bank transfer';
  if (input.kind === 'income') {
    return { title: cp ? `From ${cp}` : 'Money received', note };
  }
  return { title: cp ? `To ${cp}` : 'Money sent', note };
}

export function smsNotifyToPrefill(data: Record<string, unknown>): CashflowFormPrefill {
  return {
    title: typeof data.title === 'string' ? data.title : undefined,
    amount: typeof data.amount === 'string' ? data.amount : undefined,
    currency_code: typeof data.currency_code === 'string' ? data.currency_code : undefined,
    note: typeof data.note === 'string' ? data.note : undefined,
    account_id: typeof data.account_id === 'string' ? data.account_id : undefined,
    source: 'sms',
  };
}

export function parseSmsNotificationData(
  raw: Record<string, unknown> | undefined | null,
): SmsTransferNotifyPayload | null {
  if (!raw || raw.type !== 'sms_transfer') return null;
  if (raw.kind !== 'income' && raw.kind !== 'expense') return null;
  return {
    type: 'sms_transfer',
    kind: raw.kind,
    amount: String(raw.amount || ''),
    currency_code: String(raw.currency_code || ''),
    title: String(raw.title || ''),
    note: String(raw.note || ''),
    account_id: typeof raw.account_id === 'string' ? raw.account_id : undefined,
    open_form: raw.open_form === '1' ? '1' : '0',
  };
}

/** Fire a local notification for a money received / money sent SMS. */
export async function notifySmsTransfer(input: SmsTransferNotifyInput): Promise<void> {
  if (Platform.OS === 'web') return;
  const ok = await ensureSmsNotificationPermission();
  if (!ok) return;
  const Notifications = await notificationsModule();
  if (!Notifications) return;

  const currency = (input.currency || '').toUpperCase();
  const { title, note } = buildTitleNote(input);
  const amountLabel = currency ? `${currency} ${input.amount}` : input.amount;
  const isExpense = input.kind === 'expense';

  const payload: SmsTransferNotifyPayload = {
    type: 'sms_transfer',
    kind: input.kind,
    amount: input.amount,
    currency_code: currency,
    title,
    note,
    account_id: input.accountId || undefined,
    // Entries are auto-created from SMS; tap just opens the matching list.
    open_form: '0',
  };

  await Notifications.scheduleNotificationAsync({
    content: {
      title: isExpense ? 'Money sent' : 'Money received',
      body: isExpense
        ? `${amountLabel}${cpBit(input)} saved as an expense.`
        : `${amountLabel}${cpBit(input)} saved as income.`,
      data: payload,
      sound: true,
    },
    trigger: null,
  });
}

function cpBit(input: SmsTransferNotifyInput): string {
  const cp = (input.counterparty || '').trim();
  if (!cp) return '';
  return input.kind === 'income' ? ` from ${cp}` : ` to ${cp}`;
}

/** What the server actually saved for one SMS (not the phone's guess). */
export type SmsSavedNotice = {
  kind: 'income' | 'expense';
  amount: string;
  currency: string;
  title: string;
  accountId: string;
  accountName: string;
  when: number;
};

function money(amount: string, currency: string): string {
  const n = Number(amount);
  const text = Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : amount;
  return currency ? `${currency} ${text}` : text;
}

/**
 * One notification for what a sync saved: the transfer itself when there is one, a
 * summary when several arrive together (e.g. after the phone was offline).
 */
export async function notifySmsSaved(notices: SmsSavedNotice[]): Promise<void> {
  if (Platform.OS === 'web' || !notices.length) return;
  const ok = await ensureSmsNotificationPermission();
  if (!ok) return;
  const Notifications = await notificationsModule();
  if (!Notifications) return;

  if (notices.length === 1) {
    const n = notices[0];
    const payload: SmsTransferNotifyPayload = {
      type: 'sms_transfer',
      kind: n.kind,
      amount: n.amount,
      currency_code: n.currency,
      title: n.title,
      note: n.accountName,
      account_id: n.accountId,
      open_form: '0',
    };
    await Notifications.scheduleNotificationAsync({
      content: {
        title: n.kind === 'income' ? `Money received · ${money(n.amount, n.currency)}` : `Money sent · ${money(n.amount, n.currency)}`,
        body: `${n.title} · saved to ${n.accountName}`,
        data: payload,
        sound: true,
      },
      trigger: null,
    });
    return;
  }

  const totals = new Map<string, { in: number; out: number }>();
  for (const n of notices) {
    const t = totals.get(n.currency) || { in: 0, out: 0 };
    if (n.kind === 'income') t.in += Number(n.amount) || 0;
    else t.out += Number(n.amount) || 0;
    totals.set(n.currency, t);
  }
  const parts: string[] = [];
  for (const [cur, t] of totals) {
    if (t.in) parts.push(`+${money(String(t.in), cur)} in`);
    if (t.out) parts.push(`−${money(String(t.out), cur)} out`);
  }
  const allIncome = notices.every((n) => n.kind === 'income');
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${notices.length} transfers saved`,
      body: parts.join(' · '),
      data: {
        type: 'sms_transfer',
        kind: allIncome ? 'income' : 'expense',
        amount: '',
        currency_code: '',
        title: '',
        note: '',
        open_form: '0',
      },
      sound: true,
    },
    trigger: null,
  });
}

/** Tells the user when bank messages or accounts wait for their answer. */
export async function notifySmsNeedsReview(messages: number, accounts: number): Promise<void> {
  if (Platform.OS === 'web' || (!messages && !accounts)) return;
  const ok = await ensureSmsNotificationPermission();
  if (!ok) return;
  const Notifications = await notificationsModule();
  if (!Notifications) return;
  const bits = [
    messages ? `${messages} bank message${messages === 1 ? '' : 's'} to check` : null,
    accounts ? `${accounts} account${accounts === 1 ? '' : 's'} found in your SMS` : null,
  ].filter(Boolean);
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Needs a quick look',
      body: `${bits.join(' · ')}. Open Home to confirm.`,
      data: { type: 'sms_review' },
      sound: false,
    },
    trigger: null,
  });
}

export function isSmsReviewNotification(data: Record<string, unknown> | undefined | null): boolean {
  return data?.type === 'sms_review';
}
