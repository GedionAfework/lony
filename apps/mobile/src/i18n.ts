// Lightweight UI i18n packs. Locale from profile (BCP-47); falls back to English.
export type MessageKey =
  | 'menu'
  | 'expenses'
  | 'accounts'
  | 'loans'
  | 'insights'
  | 'plan'
  | 'settings'
  | 'admin'
  | 'profile'
  | 'themes'
  | 'payments'
  | 'notifications'
  | 'privacy'
  | 'legal'
  | 'signOut'
  | 'save'
  | 'cancel'
  | 'connectBank'
  | 'importStatement'
  | 'bankLinkUnavailable'
  | 'bankLinkReady'
  | 'linkedBanks'
  | 'disconnect'
  | 'adminOverview'
  | 'users'
  | 'aiUsage'
  | 'refresh'
  | 'buildReport'
  | 'coach'
  | 'ask'
  | 'thinking';

type Pack = Record<MessageKey, string>;

const en: Pack = {
  menu: 'MENU',
  expenses: 'Expenses',
  accounts: 'Accounts',
  loans: 'Loans',
  insights: 'Insights',
  plan: 'Plan',
  settings: 'Settings',
  admin: 'Admin',
  profile: 'Profile',
  themes: 'Themes',
  payments: 'Payments',
  notifications: 'Notifications',
  privacy: 'Data & privacy',
  legal: 'Legal',
  signOut: 'Sign out',
  save: 'Save',
  cancel: 'Cancel',
  connectBank: 'Connect bank',
  importStatement: 'Import statement',
  bankLinkUnavailable: 'Live bank linking needs Plaid keys. Use Import for CSV statements.',
  bankLinkReady: 'Connect via Plaid to sync balances.',
  linkedBanks: 'Linked banks',
  disconnect: 'Disconnect',
  adminOverview: 'Platform overview',
  users: 'Users',
  aiUsage: 'AI usage',
  refresh: 'Refresh',
  buildReport: 'Build report',
  coach: 'Coach',
  ask: 'Ask',
  thinking: 'Thinking…',
};

const am: Pack = {
  menu: 'ምናሌ',
  expenses: 'ወጪዎች',
  accounts: 'መለያዎች',
  loans: 'ብድሮች',
  insights: 'ግንዛቤዎች',
  plan: 'እቅድ',
  settings: 'ቅንብሮች',
  admin: 'አስተዳዳሪ',
  profile: 'መገለጫ',
  themes: 'ገጽታዎች',
  payments: 'ክፍያዎች',
  notifications: 'ማሳወቂያዎች',
  privacy: 'ውሂብ እና ግላዊነት',
  legal: 'ህጋዊ',
  signOut: 'ውጣ',
  save: 'አስቀምጥ',
  cancel: 'ሰርዝ',
  connectBank: 'ባንክ አገናኝ',
  importStatement: 'መግለጫ አስመጣ',
  bankLinkUnavailable: 'ቀጥተኛ ባንክ ማገናኘት Plaid ቁልፎች ይፈልጋል። CSV ለማስመጣት Import ይጠቀሙ።',
  bankLinkReady: 'በ Plaid በኩል መለያዎችን ያገናኙ።',
  linkedBanks: 'የተገናኙ ባንኮች',
  disconnect: 'አቋርጥ',
  adminOverview: 'የመድረክ አጠቃላይ እይታ',
  users: 'ተጠቃሚዎች',
  aiUsage: 'የ AI አጠቃቀም',
  refresh: 'አድስ',
  buildReport: 'ሪፖርት ገንባ',
  coach: 'አማካሪ',
  ask: 'ጠይቅ',
  thinking: 'በማሰብ ላይ…',
};

const fr: Pack = {
  ...en,
  menu: 'MENU',
  expenses: 'Dépenses',
  accounts: 'Comptes',
  loans: 'Prêts',
  insights: 'Aperçus',
  plan: 'Plan',
  settings: 'Réglages',
  admin: 'Admin',
  profile: 'Profil',
  themes: 'Thèmes',
  payments: 'Paiements',
  notifications: 'Notifications',
  privacy: 'Données et confidentialité',
  legal: 'Mentions légales',
  signOut: 'Se déconnecter',
  save: 'Enregistrer',
  cancel: 'Annuler',
  connectBank: 'Connecter une banque',
  importStatement: 'Importer un relevé',
  bankLinkUnavailable: 'La liaison bancaire nécessite des clés Plaid. Utilisez Import pour les CSV.',
  bankLinkReady: 'Connectez-vous via Plaid pour synchroniser.',
  linkedBanks: 'Banques liées',
  disconnect: 'Déconnecter',
  adminOverview: 'Vue d’ensemble',
  users: 'Utilisateurs',
  aiUsage: 'Usage IA',
  refresh: 'Actualiser',
  buildReport: 'Générer le rapport',
  coach: 'Coach',
  ask: 'Demander',
  thinking: 'Réflexion…',
};

const packs: Record<string, Pack> = {
  en,
  'en-US': en,
  'en-GB': en,
  am,
  'am-ET': am,
  fr,
  'fr-FR': fr,
  'fr-CA': fr,
};

export function resolveLocale(locale?: string | null): string {
  const raw = (locale || 'en').trim();
  if (packs[raw]) return raw;
  const base = raw.split('-')[0];
  if (packs[base]) return base;
  return 'en';
}

export function t(locale: string | null | undefined, key: MessageKey): string {
  const id = resolveLocale(locale);
  return packs[id]?.[key] ?? en[key] ?? key;
}

export function hasPack(locale: string | null | undefined): boolean {
  const id = resolveLocale(locale);
  return id !== 'en' || (locale || '').startsWith('en');
}
