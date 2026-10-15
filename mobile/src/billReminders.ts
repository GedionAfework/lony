import { Platform } from 'react-native';

/** Schedule local reminders for a recurring bill (Expo Notifications). */

export type BillReminderInput = {
  id: string;
  title: string;
  amount: string;
  currency: string;
  /** Day of month for monthly bills (1–28 recommended). */
  dayOfMonth: number;
  /** Days before due date to remind (default 3). */
  daysBefore?: number;
  /** How many future months to schedule (default 6). */
  monthsAhead?: number;
  /** income → “Did you receive…?”; expense (default) → bill due. */
  kind?: 'income' | 'expense';
};

async function notificationsModule() {
  try {
    return await import('expo-notifications');
  } catch {
    return null;
  }
}

export async function ensureNotificationPermission(): Promise<boolean> {
  const Notifications = await notificationsModule();
  if (!Notifications) return false;
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

function atLocal(y: number, m: number, d: number, hour = 9, minute = 0): Date {
  return new Date(y, m, d, hour, minute, 0, 0);
}

/** Cancel previously scheduled reminders for this cashflow template id. */
export async function cancelBillReminders(templateId: string): Promise<void> {
  const Notifications = await notificationsModule();
  if (!Notifications) return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const prefix = `bill:${templateId}:`;
  await Promise.all(
    scheduled.filter((n) => String(n.identifier || '').startsWith(prefix)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
}

/**
 * Schedule local notifications for upcoming due dates.
 * Works offline as a complement to server push when MaterializeDue fires.
 */
export async function scheduleBillReminders(input: BillReminderInput): Promise<number> {
  if (Platform.OS === 'web') return 0;
  const ok = await ensureNotificationPermission();
  if (!ok) return 0;
  const Notifications = await notificationsModule();
  if (!Notifications) return 0;

  await cancelBillReminders(input.id);

  const daysBefore = Math.max(0, input.daysBefore ?? 3);
  const monthsAhead = Math.max(1, Math.min(12, input.monthsAhead ?? 6));
  const day = Math.min(28, Math.max(1, input.dayOfMonth));
  const income = input.kind === 'income';
  const now = new Date();
  let scheduled = 0;

  for (let i = 0; i < monthsAhead; i++) {
    const due = atLocal(now.getFullYear(), now.getMonth() + i, day, 9, 0);
    if (due.getTime() <= now.getTime() + 60_000) continue;

    const remindAt = new Date(due.getTime() - daysBefore * 24 * 60 * 60 * 1000);
    if (remindAt.getTime() > now.getTime()) {
      await Notifications.scheduleNotificationAsync({
        identifier: `bill:${input.id}:pre:${due.toISOString().slice(0, 10)}`,
        content: {
          title: income ? 'Upcoming income' : 'Upcoming bill',
          body: income
            ? `${input.title}: ${input.amount} ${input.currency} expected ${due.toLocaleDateString()}`
            : `${input.title}: ${input.amount} ${input.currency} due ${due.toLocaleDateString()}`,
          data: { type: 'bill_reminder', cashflow_id: input.id, kind: input.kind || 'expense' },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: remindAt,
        },
      });
      scheduled++;
    }

    await Notifications.scheduleNotificationAsync({
      identifier: `bill:${input.id}:due:${due.toISOString().slice(0, 10)}`,
      content: {
        title: income ? 'Income today' : 'Bill due today',
        body: income
          ? `${input.title}: ${input.amount} ${input.currency} — did you receive it?`
          : `${input.title}: ${input.amount} ${input.currency}`,
        data: { type: 'bill_due', cashflow_id: input.id, kind: input.kind || 'expense' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: due,
      },
    });
    scheduled++;
  }
  return scheduled;
}
