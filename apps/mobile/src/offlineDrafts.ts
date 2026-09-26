import * as FileSystem from 'expo-file-system/legacy';

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

const DRAFT_FILE = `${FileSystem.documentDirectory ?? ''}lony-cashflow-drafts.json`;

async function readAll(): Promise<CashflowDraft[]> {
  try {
    const info = await FileSystem.getInfoAsync(DRAFT_FILE);
    if (!info.exists) return [];
    const raw = await FileSystem.readAsStringAsync(DRAFT_FILE);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CashflowDraft[]) : [];
  } catch {
    return [];
  }
}

async function writeAll(rows: CashflowDraft[]): Promise<void> {
  await FileSystem.writeAsStringAsync(DRAFT_FILE, JSON.stringify(rows));
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
