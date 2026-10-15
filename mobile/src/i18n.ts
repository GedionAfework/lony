import { I18nManager, Platform } from 'react-native';
import enCatalog from './i18n/en.json';
import frCatalog from './i18n/fr.json';
import amEtCatalog from './i18n/am-ET.json';

export type MessageMap = Record<string, string>;

type PackMeta = {
  locale: string;
  name: string;
  dir: 'ltr' | 'rtl' | string;
  messages: MessageMap;
};

type BundledCatalog = { locale?: string; name?: string; dir?: string; messages?: MessageMap };

const fallbackMessages: MessageMap = { ...((enCatalog as BundledCatalog).messages || {}) };

const cache = new Map<string, PackMeta>();
cache.set('en', {
  locale: 'en',
  name: (enCatalog as BundledCatalog).name || 'English',
  dir: (enCatalog as BundledCatalog).dir || 'ltr',
  messages: { ...fallbackMessages },
});

/**
 * Registers a bundled (compiled-in) locale pack without changing the active locale.
 * Bundled packs are merged over the English fallback so every en key resolves to
 * *something* even if the pack is missing a translation — real translations always
 * win over the English fallback.
 */
function registerBundledPack(catalog: BundledCatalog) {
  const code = catalog.locale;
  if (!code) return;
  const messages: MessageMap = { ...fallbackMessages, ...(catalog.messages || {}) };
  cache.set(code, {
    locale: code,
    name: catalog.name || code,
    dir: catalog.dir || 'ltr',
    messages,
  });
}

// Bundle French and Amharic translations at boot so the UI can switch languages
// immediately, even before (or if) the API's locale packs load / are complete.
registerBundledPack(frCatalog as BundledCatalog);
registerBundledPack(amEtCatalog as BundledCatalog);

let activeCode = 'en';

export type MessageKey = string;

export function resolveLocale(locale?: string | null): string {
  const raw = (locale || 'en').trim();
  if (cache.has(raw)) return raw;
  const base = raw.split('-')[0];
  if (cache.has(base)) return base;
  if (raw === 'en' || raw.startsWith('en')) return 'en';
  return 'en';
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

export function setActivePack(pack: {
  locale: string;
  name?: string;
  dir?: string;
  messages?: MessageMap;
}) {
  const code = pack.locale || 'en';
  const prev = cache.get(code);
  const messages: MessageMap = { ...fallbackMessages, ...(prev?.messages || {}), ...(pack.messages || {}) };
  // Only rewrite stale English labels — never overwrite real translations.
  if (messages['settings.region'] && /^region$/i.test(messages['settings.region'].trim())) {
    messages['settings.region'] = fallbackMessages['settings.region'] || 'Preferences';
  }
  if (messages['settings.regionSubtitle'] && /^region\b/i.test(messages['settings.regionSubtitle'].trim())) {
    messages['settings.regionSubtitle'] =
      fallbackMessages['settings.regionSubtitle'] || messages['settings.regionSubtitle'];
  }
  // Stale short label "Plan" → Financial Plan (keep non-English translations).
  if (!messages['plan'] || /^plan$/i.test(messages['plan'].trim())) {
    messages['plan'] = fallbackMessages['plan'] || 'Financial Plan';
  }
  if (!messages['plan.title'] || /^plan$/i.test(messages['plan.title'].trim())) {
    messages['plan.title'] = fallbackMessages['plan.title'] || 'Financial Plan';
  }
  if (!messages['nav.plan'] || /^plan$/i.test(messages['nav.plan'].trim())) {
    messages['nav.plan'] = fallbackMessages['nav.plan'] || 'Financial Plan';
  }
  cache.set(code, {
    locale: code,
    name: pack.name || prev?.name || code,
    dir: pack.dir || prev?.dir || 'ltr',
    messages,
  });
  activeCode = code;
}

export function getTextDirection(locale?: string | null): string {
  const code = resolveLocale(locale || activeCode);
  return cache.get(code)?.dir === 'rtl' ? 'rtl' : 'ltr';
}

/** Apply RTL layout when the active pack is rtl. May require app reload on native. */
export function applyNativeDirection(locale?: string | null) {
  const rtl = getTextDirection(locale) === 'rtl';
  try {
    I18nManager.allowRTL(true);
    if (I18nManager.isRTL !== rtl) {
      I18nManager.forceRTL(rtl);
    }
  } catch {
    // ignore on web / unsupported
  }
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
  }
}

/** Translate UI string. Signature: t(locale, key) for back-compat. */
export function t(locale: string | null | undefined, key: string): string {
  const code = resolveLocale(locale || activeCode);
  const pack = cache.get(code);
  return pack?.messages[key] ?? fallbackMessages[key] ?? key;
}

export function hasPack(locale: string | null | undefined): boolean {
  const id = resolveLocale(locale);
  return cache.has(id);
}
