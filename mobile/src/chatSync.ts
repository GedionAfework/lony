import type { ChatMessage } from './api';

// Keeps a thread in step with the server: incoming messages replace ones with the same
// id, deleted ones are removed, and the list stays in time order. Pages can overlap,
// so merging the same message twice is harmless.

const at = (iso: string) => Date.parse(iso) || 0;

export function sortMessages(list: ChatMessage[]): ChatMessage[] {
  return [...list].sort((a, b) => at(a.created_at) - at(b.created_at) || a.id.localeCompare(b.id));
}

export function mergeMessages(prev: ChatMessage[], incoming: ChatMessage[], peerReadAt?: string | null): ChatMessage[] {
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) {
    if (m.deleted) byId.delete(m.id);
    else byId.set(m.id, m);
  }
  return markRead(sortMessages([...byId.values()]), peerReadAt);
}

/** Your messages up to the moment the other person last opened the chat are read. */
export function markRead(list: ChatMessage[], peerReadAt?: string | null): ChatMessage[] {
  if (!peerReadAt) return list;
  const readAt = at(peerReadAt);
  return list.map((m) => (m.mine && !m.read && at(m.created_at) <= readAt ? { ...m, read: true } : m));
}
