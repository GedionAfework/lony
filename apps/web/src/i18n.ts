import enCatalog from './i18n/en.json';

export type MessageMap = Record<string, string>;

type PackMeta = {
  locale: string;
  name: string;
  dir: 'ltr' | 'rtl' | string;
  messages: MessageMap;
};

const fallbackMessages: MessageMap = { ...((enCatalog as { messages?: MessageMap }).messages || {}) };

const cache = new Map<string, PackMeta>();
cache.set('en', {
  locale: 'en',
  name: (enCatalog as { name?: string }).name || 'English',
  dir: (enCatalog as { dir?: string }).dir || 'ltr',
  messages: { ...fallbackMessages },
});

let activeCode = 'en';

export function resolveLocale(locale?: string | null): string {
  const raw = (locale || 'en').trim();
  if (cache.has(raw)) return raw;
  const base = raw.split('-')[0];
  if (cache.has(base)) return base;
  if (raw === 'en' || raw.startsWith('en')) return 'en';
  return 'en';
}

export function setActivePack(pack: {
  locale: string;
  name?: string;
  dir?: string;
  messages?: MessageMap;
}) {
  const code = pack.locale || 'en';
  const prev = cache.get(code);
  cache.set(code, {
    locale: code,
    name: pack.name || prev?.name || code,
    dir: pack.dir || prev?.dir || 'ltr',
    messages: { ...fallbackMessages, ...(prev?.messages || {}), ...(pack.messages || {}) },
  });
  activeCode = code;
}

export function getTextDirection(locale?: string | null): string {
  const code = resolveLocale(locale || activeCode);
  return cache.get(code)?.dir === 'rtl' ? 'rtl' : 'ltr';
}

export function applyDocumentDirection(locale?: string | null) {
  if (typeof document === 'undefined') return;
  const code = resolveLocale(locale || activeCode);
  const dir = getTextDirection(code);
  document.documentElement.dir = dir;
  document.documentElement.lang = code;
}

/** Translate UI string. t(key) or t(locale, key). */
export function t(localeOrKey: string | null | undefined, key?: string): string {
  if (key === undefined) {
    const k = String(localeOrKey || '');
    const pack = cache.get(resolveLocale(activeCode));
    return pack?.messages[k] ?? fallbackMessages[k] ?? k;
  }
  const code = resolveLocale(localeOrKey || activeCode);
  const pack = cache.get(code);
  return pack?.messages[key] ?? fallbackMessages[key] ?? key;
}

export function parseLocaleMessages(raw: unknown): MessageMap {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return typeof parsed === 'object' && parsed && !Array.isArray(parsed) ? (parsed as MessageMap) : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as MessageMap;
  }
  return {};
}
