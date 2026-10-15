import { Platform } from 'react-native';

export type CashflowDraft = {
  id: string;
  kind: 'income' | 'expense';
  title: string;
  amount: string;
  currency_code: string;
  category_id?: string;
  account_id: string;
  note?: string;
  occurred_at: string;
  recurrence?: 'weekly' | 'monthly' | 'yearly' | 'none';
  is_template?: boolean;
  created_at: string;
};

const WEB_KEY = 'lony.cashflow_drafts';

async function readAll(): Promise<CashflowDraft[]> {
  try {
    if (Platform.OS === 'web') {
      const raw = localStorage.getItem(WEB_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as CashflowDraft[]) : [];
    }
    const FileSystem = await import('expo-file-system/legacy');
    const path = `${FileSystem.documentDirectory ?? ''}lony-cashflow-drafts.json`;
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return [];
    const raw = await FileSystem.readAsStringAsync(path);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CashflowDraft[]) : [];
  } catch {
    return [];
  }
}

async function writeAll(rows: CashflowDraft[]): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.setItem(WEB_KEY, JSON.stringify(rows));
    return;
  }
  const FileSystem = await import('expo-file-system/legacy');
  const path = `${FileSystem.documentDirectory ?? ''}lony-cashflow-drafts.json`;
  await FileSystem.writeAsStringAsync(path, JSON.stringify(rows));
}

export async function listCashflowDrafts(): Promise<CashflowDraft[]> {
  return readAll();
}

export async function saveCashflowDraft(
  draft: Omit<CashflowDraft, 'id' | 'created_at'> & { id?: string },
): Promise<CashflowDraft> {
  const rows = await readAll();
  const saved: CashflowDraft = {
    ...draft,
    id: draft.id || `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    created_at: new Date().toISOString(),
  };
  const next = [saved, ...rows.filter((r) => r.id !== saved.id)].slice(0, 40);
  await writeAll(next);
  return saved;
}

export async function removeCashflowDraft(id: string): Promise<void> {
  const rows = await readAll();
  await writeAll(rows.filter((r) => r.id !== id));
}
