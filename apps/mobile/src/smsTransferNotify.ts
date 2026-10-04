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
