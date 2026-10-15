import { NativeModules, Platform } from 'react-native';

type WidgetNative = {
  updateSnapshot: (netWorth: string, spent: string, currency: string) => Promise<boolean>;
};

export function pushWidgetSnapshot(input: { netWorth: string; spent: string; currency: string }): void {
  if (Platform.OS !== 'android') return;
  const Native = NativeModules.LonyWidget as WidgetNative | undefined;
  if (!Native?.updateSnapshot) return;
  Native.updateSnapshot(input.netWorth, input.spent, input.currency).catch(() => undefined);
}

/** Parse `lony://quick-add?kind=expense|income`. */
export function parseQuickAddUrl(url: string): 'income' | 'expense' | null {
  const raw = (url || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (!lower.includes('quick-add') && !/lony:\/\/\/?add(\?|$|\/)/.test(lower)) return null;
  const q = raw.indexOf('?');
  const qs = q >= 0 ? raw.slice(q + 1) : '';
  try {
    const kind = new URLSearchParams(qs).get('kind');
    return kind === 'income' ? 'income' : 'expense';
  } catch {
    return 'expense';
  }
}
