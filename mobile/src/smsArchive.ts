import { documentDirectory, readAsStringAsync, writeAsStringAsync } from 'expo-file-system/legacy';

export type ArchivedSms = {
  id: string;
  accountId: string;
  title: string;
  body: string;
  date: number;
  amount?: string;
  currency?: string;
  kind?: 'income' | 'expense' | null;
};

const CAP = 4000;

function archivePath(userId?: string): string | null {
  return documentDirectory ? `${documentDirectory}sms_archive_${userId || 'default'}.json` : null;
}

export async function loadSmsArchive(userId?: string): Promise<ArchivedSms[]> {
  const path = archivePath(userId);
  if (!path) return [];
  try {
    const rows = JSON.parse(await readAsStringAsync(path)) as ArchivedSms[];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function saveSmsArchive(rows: ArchivedSms[], userId?: string): Promise<void> {
  const path = archivePath(userId);
  if (!path) return;
  await writeAsStringAsync(path, JSON.stringify(rows.slice(-CAP))).catch(() => undefined);
}

export async function rememberSms(entry: ArchivedSms, userId?: string): Promise<void> {
  if (!entry.id || !entry.accountId || !entry.body) return;
  const rows = await loadSmsArchive(userId);
  const i = rows.findIndex((r) => r.id === entry.id);
  if (i >= 0) rows[i] = entry;
  else rows.push(entry);
  await saveSmsArchive(rows, userId);
}

export async function rememberSmsMany(entries: ArchivedSms[], userId?: string): Promise<void> {
  if (!entries.length) return;
  const rows = await loadSmsArchive(userId);
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const e of entries) {
    if (!e.id || !e.accountId || !e.body) continue;
    byId.set(e.id, e);
  }
  await saveSmsArchive([...byId.values()], userId);
}

export async function listSmsForAccount(accountId: string, userId?: string): Promise<ArchivedSms[]> {
  const rows = await loadSmsArchive(userId);
  return rows.filter((r) => r.accountId === accountId).sort((a, b) => (b.date || 0) - (a.date || 0));
}
