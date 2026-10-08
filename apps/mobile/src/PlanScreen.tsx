import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import {
  EncodingType,
  cacheDirectory,
  deleteAsync,
  documentDirectory,
  downloadAsync,
  readAsStringAsync,
  writeAsStringAsync,
} from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { api, type Goal, type GoalDraft, type GoalPricePoint, type MoneyAccount, type User } from './api';
import { stripAmount } from './amountFormat';
import { CURRENCIES } from './catalogs';
import { DateField } from './DateField';
import { t } from './i18n';
import { IconCamera, IconTrash } from './icons';
import { SearchSelect } from './SearchSelect';
import { apiBaseUrl, fonts, radii, space, useTheme } from './theme';
import {
  Card,
  EmptyState,
  Field,
  GhostButton,
  PrimaryButton,
  ScreenHeader,
  SecondaryButton,
  SectionLabel,
  Segmented,
} from './ui';

type Props = {
  user: User;
  token: string;
  formatMoney: (amount: string | null | undefined, currency: string | null | undefined, locale?: string) => string;
  onError: (message: string) => void;
  reloadToken?: number;
  onDetailChange?: (open: boolean) => void;
};

const FALLBACK_GOAL_TYPES = [
  { id: 'travel', label: 'Travel' },
  { id: 'purchase', label: 'Purchase' },
  { id: 'savings', label: 'Savings' },
  { id: 'debt_payoff', label: 'Debt payoff' },
  { id: 'other', label: 'Other' },
];

const GOAL_TYPE_LABEL_KEYS: Record<string, string> = {
  travel: 'plan.typeTravel',
  purchase: 'plan.typePurchase',
  savings: 'plan.typeSavings',
  debt_payoff: 'plan.typeDebtPayoff',
  other: 'accounts.typeOther',
};

function localizeGoalTypes(
  types: { id: string; label: string }[],
  locale?: string | null,
): { id: string; label: string }[] {
  return types.map((g) => (GOAL_TYPE_LABEL_KEYS[g.id] ? { ...g, label: t(locale, GOAL_TYPE_LABEL_KEYS[g.id]) } : g));
}

function resolveMediaURL(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  const origin = apiBaseUrl.replace(/\/api\/v1\/?$/, '');
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
}

function typeDisplay(g: Goal, goalTypes: { id: string; label: string }[]): string {
  if (g.goal_type === 'custom' && g.type_label) return g.type_label;
  const id = g.goal_type === 'custom' ? 'other' : g.goal_type;
  return goalTypes.find((t) => t.id === id)?.label || g.goal_type;
}

function filterKey(g: Goal): string {
  if (g.goal_type === 'custom') return g.type_label?.trim() || 'custom';
  return g.goal_type;
}

type CoverDraft = {
  filename: string;
  mime: string;
  attachment_base64: string;
  preview: string;
};

type GoalFormFields = {
  title: string;
  goalType: string;
  otherType: string;
  currency: string;
  target: string;
  current: string;
  targetDate: string;
  accountId: string;
  note: string;
  productUrl: string;
  cover: CoverDraft | null;
};

type AiChipKind = 'agree' | 'tooHigh' | 'tooLow' | 'retry' | 'save' | 'editDetail' | 'askSource';

type AiChip = {
  id: string;
  label: string;
  kind: AiChipKind;
};

type AiChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  chips?: AiChip[];
  draft?: GoalDraft;
};

type EstimateMemory = {
  source: NonNullable<AiInterview['estimateSource']>;
  explain: string;
  draft: GoalDraft | null;
};

/** Chat history + interview state survive tab switches and app restarts. */
type PersistedAiChat = {
  v: 1;
  messages: AiChatMessage[];
  interview: AiInterview;
  draft: GoalDraft | null;
  memory: EstimateMemory | null;
};
const AI_CHAT_FILE = documentDirectory ? `${documentDirectory}plan_ai_chat.json` : null;
const AI_CHAT_MAX_MESSAGES = 80;
const EMPTY_INTERVIEW: AiInterview = { phase: 'gather', turns: 0, itemHint: '', details: [] };

async function loadPersistedAiChat(): Promise<PersistedAiChat | null> {
  if (!AI_CHAT_FILE) return null;
  try {
    const raw = await readAsStringAsync(AI_CHAT_FILE);
    const parsed = JSON.parse(raw) as PersistedAiChat;
    if (parsed?.v !== 1 || !Array.isArray(parsed.messages)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function savePersistedAiChat(data: PersistedAiChat): Promise<void> {
  if (!AI_CHAT_FILE) return;
  try {
    await writeAsStringAsync(AI_CHAT_FILE, JSON.stringify(data));
  } catch {
    /* best-effort */
  }
}

async function clearPersistedAiChat(): Promise<void> {
  if (!AI_CHAT_FILE) return;
  await deleteAsync(AI_CHAT_FILE, { idempotent: true }).catch(() => undefined);
}

/** Multi-turn interview: clarify item → estimate price → confirm → save. */
type AiInterview = {
  phase: 'gather' | 'estimate' | 'confirm' | 'done';
  turns: number;
  itemHint: string;
  details: string[];
  /** How the last price was produced — used for “where did you get that?” */
  estimateSource?: 'product_link' | 'market_scrape' | 'market_estimate' | 'user_stated' | 'offline_heuristic';
  estimateExplain?: string;
};

export function PlanScreen({ user, token, formatMoney, onError, reloadToken = 0, onDetailChange }: Props) {
  const { colors } = useTheme();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [accounts, setAccounts] = useState<MoneyAccount[]>([]);
  const [goalTypes, setGoalTypes] = useState(FALLBACK_GOAL_TYPES);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'index' | 'create' | 'show'>('index');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [contributeAmount, setContributeAmount] = useState('');
  const [contributeAccount, setContributeAccount] = useState('');
  const [debitAccount, setDebitAccount] = useState(true);

  const [title, setTitle] = useState('');
  const [goalType, setGoalType] = useState('savings');
  const [otherType, setOtherType] = useState('');
  const [currency, setCurrency] = useState((user.default_currency_code || 'USD').toUpperCase());
  const [target, setTarget] = useState('');
  const [current, setCurrent] = useState('0');
  const [targetDate, setTargetDate] = useState('');
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [productUrl, setProductUrl] = useState('');
  const [urlBusy, setUrlBusy] = useState(false);
  const [pendingCover, setPendingCover] = useState<CoverDraft | null>(null);

  const [createTab, setCreateTab] = useState<'detail' | 'link' | 'ai'>('detail');
  const [aiMessages, setAiMessages] = useState<AiChatMessage[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  /** What the assistant is doing right now; rendered as a live bubble while busy. */
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [aiDraft, setAiDraft] = useState<GoalDraft | null>(null);
  const [aiInterview, setAiInterview] = useState<AiInterview>(EMPTY_INTERVIEW);
  const aiChatLoadedRef = useRef(false);
  /** Survives re-renders so “where did you get that?” always has context. */
  const estimateMemoryRef = useRef<EstimateMemory | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadPersistedAiChat().then((saved) => {
      if (cancelled) return;
      if (saved) {
        setAiMessages(saved.messages);
        setAiInterview(saved.interview ?? EMPTY_INTERVIEW);
        setAiDraft(saved.draft ?? null);
        estimateMemoryRef.current = saved.memory ?? null;
      }
      aiChatLoadedRef.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!aiChatLoadedRef.current) return;
    if (aiMessages.length === 0) {
      void clearPersistedAiChat();
      return;
    }
    void savePersistedAiChat({
      v: 1,
      messages: aiMessages.slice(-AI_CHAT_MAX_MESSAGES),
      interview: aiInterview,
      draft: aiDraft,
      memory: estimateMemoryRef.current,
    });
  }, [aiMessages, aiInterview, aiDraft]);

  function clearAiChat() {
    setAiMessages([]);
    setAiInput('');
    setAiDraft(null);
    setAiInterview(EMPTY_INTERVIEW);
    estimateMemoryRef.current = null;
    void clearPersistedAiChat();
  }
  const pricesRefreshedRef = useRef(false);
  const [priceHistory, setPriceHistory] = useState<GoalPricePoint[]>([]);
  const [priceBusy, setPriceBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [g, a, types] = await Promise.all([
        api.listGoals(token),
        api.listAccounts(token).catch(() => ({ accounts: [] })),
        api.listCatalogTypes(token, 'goal_type').catch(() => ({ types: [] })),
      ]);
      setGoals(g.goals ?? []);
      setAccounts(a.accounts ?? []);
      const fromCatalog = (types.types ?? [])
        .filter((t) => t.active !== false)
        .map((t) => ({
          id: t.code === 'custom' ? 'other' : t.code,
          label: t.label,
        }));
      if (fromCatalog.length) {
        const hasOther = fromCatalog.some((t) => t.id === 'other');
        setGoalTypes(
          localizeGoalTypes(hasOther ? fromCatalog : [...fromCatalog, { id: 'other', label: 'Other' }], user.locale),
        );
      } else {
        setGoalTypes(localizeGoalTypes(FALLBACK_GOAL_TYPES, user.locale));
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not load plans');
    }
  }, [token, onError, user.locale]);

  useEffect(() => {
    void reload();
  }, [reload, reloadToken]);

  useEffect(() => {
    if (!token || pricesRefreshedRef.current) return;
    pricesRefreshedRef.current = true;
    void api
      .refreshGoalPrices(token)
      .then((r) => {
        if (r.changes?.length) void reload();
      })
      .catch(() => undefined);
  }, [token, reload]);

  const showFilters = goals.length >= 5;
  const filterOptions = useMemo(() => {
    if (!showFilters) return [];
    const seen = new Map<string, string>();
    for (const g of goals) {
      const key = filterKey(g);
      if (!seen.has(key)) seen.set(key, typeDisplay(g, goalTypes));
    }
    return [{ id: 'all', label: t(user.locale, 'common.all') }, ...[...seen.entries()].map(([id, label]) => ({ id, label }))];
  }, [goals, showFilters, goalTypes, user.locale]);

  const visible = useMemo(() => {
    if (!showFilters || filter === 'all') return goals;
    return goals.filter((g) => filterKey(g) === filter);
  }, [goals, filter, showFilters]);

  const selected = goals.find((g) => g.id === selectedId) ?? null;

  const loadPriceHistory = useCallback(
    async (goalId: string) => {
      try {
        const res = await api.listGoalPriceHistory(token, goalId);
        setPriceHistory(res.history ?? []);
      } catch {
        setPriceHistory([]);
      }
    },
    [token],
  );

  useEffect(() => {
    if (!selectedId || !selected?.source_url) {
      setPriceHistory([]);
      return;
    }
    void loadPriceHistory(selectedId);
  }, [selectedId, selected?.source_url, loadPriceHistory]);

  async function onCheckPriceNow() {
    if (!selectedId || !selected?.source_url) return;
    setPriceBusy(true);
    try {
      const res = await api.refreshGoalPrice(token, selectedId);
      if (res.goal) {
        setGoals((prev) => prev.map((g) => (g.id === res.goal.id ? res.goal : g)));
      }
      await loadPriceHistory(selectedId);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not scrape that listing');
    } finally {
      setPriceBusy(false);
    }
  }

  function resetForm() {
    setTitle('');
    setGoalType('savings');
    setOtherType('');
    setCurrency((user.default_currency_code || 'USD').toUpperCase());
    setTarget('');
    setCurrent('0');
    setTargetDate('');
    setAccountId('');
    setNote('');
    setProductUrl('');
    setPendingCover(null);
    setCreateTab('detail');
    // AI chat intentionally survives leaving the screen; "Clear chat" wipes it explicitly.
  }

  function goIndex() {
    setMode('index');
    setSelectedId(null);
    setContributeAmount('');
    setContributeAccount('');
    resetForm();
    onDetailChange?.(false);
  }

  async function pickCover(forGoalId?: string) {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.75,
      base64: true,
    });
    if (picked.canceled || !picked.assets?.[0]?.base64) return;
    const asset = picked.assets[0];
    const payload = {
      filename: asset.fileName ?? 'cover.jpg',
      mime: asset.mimeType ?? 'image/jpeg',
      attachment_base64: asset.base64!,
      preview: asset.uri,
    };
    if (forGoalId) {
      setBusy(true);
      try {
        await api.uploadGoalCover(token, forGoalId, {
          filename: payload.filename,
          mime: payload.mime,
          attachment_base64: payload.attachment_base64,
        });
        await reload();
      } catch (e) {
        onError(e instanceof Error ? e.message : 'Could not upload cover');
      } finally {
        setBusy(false);
      }
      return;
    }
    setPendingCover(payload);
  }

  async function fetchCoverFromUrl(imageUrl: string): Promise<CoverDraft | null> {
    try {
      const base = cacheDirectory || documentDirectory || '';
      const dest = `${base}goal-cover-${Date.now()}.jpg`;
      const downloaded = await downloadAsync(imageUrl, dest);
      const base64 = await readAsStringAsync(downloaded.uri, {
        encoding: EncodingType.Base64,
      });
      if (!base64) return null;
      const cover: CoverDraft = {
        filename: 'product.jpg',
        mime: 'image/jpeg',
        attachment_base64: base64,
        preview: downloaded.uri,
      };
      setPendingCover(cover);
      return cover;
    } catch {
      // Cover is best-effort; title/price still apply.
      return null;
    }
  }

  /** Applies extracted fields to the Detail form state and returns the fully resolved
   * form values (not just the delta), so callers can act on them immediately without
   * waiting on React state to flush. */
  async function applyDraft(d: GoalDraft): Promise<GoalFormFields> {
    const nextTitle = d.title ? d.title.slice(0, 120) : title;
    if (d.title) setTitle(nextTitle);

    const nextTarget = d.target_amount ? d.target_amount : target;
    if (d.target_amount) setTarget(nextTarget);

    const nextCurrency = d.currency_code && d.currency_code.length === 3 ? d.currency_code.toUpperCase() : currency;
    if (d.currency_code && d.currency_code.length === 3) setCurrency(nextCurrency);

    let nextGoalType = goalType;
    let nextOtherType = otherType;
    if (d.goal_type) {
      if (d.goal_type === 'custom') {
        nextGoalType = 'other';
        setGoalType('other');
        if (d.type_label) {
          nextOtherType = d.type_label;
          setOtherType(d.type_label);
        }
      } else {
        nextGoalType = d.goal_type;
        setGoalType(d.goal_type);
      }
    } else if (!goalType || goalType === 'savings') {
      nextGoalType = 'purchase';
      setGoalType('purchase');
    }

    const nextTargetDate = d.target_date ? d.target_date : targetDate;
    if (d.target_date) setTargetDate(nextTargetDate);

    const nextNote = d.note && !note.trim() ? d.note.slice(0, 400) : note;
    if (d.note && !note.trim()) setNote(nextNote);

    const nextProductUrl = d.source_url ? d.source_url : productUrl;
    if (d.source_url) setProductUrl(nextProductUrl);

    let nextCover = pendingCover;
    if (d.image_url) {
      nextCover = await fetchCoverFromUrl(d.image_url);
    }

    return {
      title: nextTitle,
      goalType: nextGoalType,
      otherType: nextOtherType,
      currency: nextCurrency,
      target: nextTarget,
      current,
      targetDate: nextTargetDate,
      accountId,
      note: nextNote,
      productUrl: nextProductUrl,
      cover: nextCover,
    };
  }

  async function onFetchProductUrl() {
    const url = productUrl.trim();
    if (!url) {
      onError('Paste a product link first');
      return;
    }
    setUrlBusy(true);
    try {
      // Prefer AI extract so URL + surrounding text fill the form; falls back to scrape-only.
      try {
        const res = await api.extractGoalDraft(token, url);
        await applyDraft(res.draft ?? {});
      } catch {
        const res = await api.previewGoalUrl(token, url);
        const p = res.preview;
        await applyDraft({
          title: p.title,
          target_amount: p.price,
          currency_code: p.currency,
          note: p.description,
          source_url: p.url || url,
          image_url: p.image_url,
          goal_type: 'purchase',
        });
      }
      // Hand off to the Detail tab so the user can review and save.
      setCreateTab('detail');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not read that link');
    } finally {
      setUrlBusy(false);
    }
  }

  async function createGoalWithFields(fields: GoalFormFields) {
    if (!fields.title.trim()) {
      onError('Title is required');
      return;
    }
    if (fields.goalType === 'other' && !fields.otherType.trim()) {
      onError('Name your plan type');
      return;
    }
    const amount = stripAmount(fields.target);
    if (!amount || Number(amount) <= 0) {
      onError('Enter a target amount');
      return;
    }
    setBusy(true);
    try {
      const apiType = fields.goalType === 'other' ? 'custom' : (fields.goalType as Goal['goal_type']);
      const res = await api.createGoal(token, {
        title: fields.title.trim(),
        goal_type: apiType,
        currency_code: fields.currency,
        target_amount: amount,
        current_amount: stripAmount(fields.current) || undefined,
        target_date: fields.targetDate || undefined,
        linked_account_id: fields.accountId || undefined,
        note: fields.note.trim() || undefined,
        type_label: fields.goalType === 'other' ? fields.otherType.trim() : undefined,
        source_url: fields.productUrl.trim() || undefined,
      });
      if (fields.cover && res.goal?.id) {
        await api.uploadGoalCover(token, res.goal.id, {
          filename: fields.cover.filename,
          mime: fields.cover.mime,
          attachment_base64: fields.cover.attachment_base64,
        });
      }
      goIndex();
      await reload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not create plan');
    } finally {
      setBusy(false);
    }
  }

  async function onCreate() {
    await createGoalWithFields({
      title,
      goalType,
      otherType,
      currency,
      target,
      current,
      targetDate,
      accountId,
      note,
      productUrl,
      cover: pendingCover,
    });
  }

  function estimateChips(_d: GoalDraft): AiChip[] {
    return [
      { id: 'agree', label: 'Yes, that works', kind: 'agree' },
      { id: 'high', label: 'Too high', kind: 'tooHigh' },
      { id: 'low', label: 'Too low', kind: 'tooLow' },
      { id: 'source', label: 'Where from?', kind: 'askSource' },
      { id: 'retry', label: 'Start over', kind: 'retry' },
    ];
  }

  function confirmChips(): AiChip[] {
    return [
      { id: 'save', label: 'Save this plan', kind: 'save' },
      { id: 'edit', label: 'Edit in Detail', kind: 'editDetail' },
      { id: 'retry', label: 'Start over', kind: 'retry' },
    ];
  }

  function resetAiInterview() {
    setAiInterview({ phase: 'gather', turns: 0, itemHint: '', details: [] });
    setAiDraft(null);
    estimateMemoryRef.current = null;
  }

  function rememberEstimate(
    source: NonNullable<AiInterview['estimateSource']>,
    explain: string,
    draft: GoalDraft | null,
  ) {
    estimateMemoryRef.current = { source, explain, draft };
  }

  function isYearAmount(n: number): boolean {
    return Number.isInteger(n) && n >= 1900 && n <= 2099;
  }

  function parseStatedPrice(text: string): string | null {
    const withCur =
      text.match(
        /\b(?:about|around|approx(?:imately)?|≈|~|price|cost|for|budget)\s*(?:of\s*)?(?:ETB|USD|EUR|GBP|Br|\$)?\s*([\d,]{3,}(?:\.\d{1,2})?)/i,
      ) ||
      text.match(/\b(?:ETB|USD|EUR|GBP|Br|\$)\s*([\d,]{3,}(?:\.\d{1,2})?)/i) ||
      text.match(/^\s*([\d,]{3,}(?:\.\d{1,2})?)\s*(?:ETB|USD|EUR|GBP|Br)?\s*$/i);
    if (!withCur) return null;
    const n = Number(withCur[1].replace(/,/g, ''));
    if (!Number.isFinite(n) || n <= 0 || isYearAmount(n)) return null;
    return n.toFixed(2);
  }

  /** “Where did you get that?” and similar — must NEVER re-run the price estimator. */
  function isMetaPriceQuestion(text: string): boolean {
    const t = text.trim();
    if (!t) return false;
    if (/where\s+from|from\s+where|what'?s?\s+the\s+source|source\s+of/i.test(t)) return true;
    if (/\b(source|based on what|is that real|did you invent|hallucinat|made up|guess(ing)?)\b/i.test(t)) {
      return true;
    }
    if (/\b(where|how)\b[\s\S]{0,40}\b(get|got|find|found|know|came|come|estimate|number|price|figure|information|info|that)\b/i.test(t)) {
      return true;
    }
    if (/^(why|how come)\b/i.test(t) && /\b(price|number|amount|estimate|that)\b/i.test(t)) return true;
    return false;
  }

  function explainEstimateSource(
    interview: AiInterview,
    draft: GoalDraft | null,
    mem?: EstimateMemory | null,
  ): string {
    const source = mem?.source || interview.estimateSource;
    const explain = mem?.explain || interview.estimateExplain;
    const d = draft || mem?.draft;
    const price = d?.target_amount
      ? formatMoney(d.target_amount, (d.currency_code || currency).toUpperCase(), user.locale)
      : 'that amount';

    if (!source && !d?.target_amount) {
      return "I haven’t suggested a price yet. Tell me the exact item (for an iPhone: which model and storage). I’ll scrape current selling prices.";
    }

    switch (source) {
      case 'product_link':
        return (
          explain ||
          `I pulled ${price} from a product page. If it looks wrong, say too high/low or type the number you want.`
        );
      case 'market_scrape':
        return (
          explain ||
          `${price} is the typical live selling price I scraped from current listings (low–high compared). Not a guess.`
        );
      case 'user_stated':
        return explain || `That’s the price you typed yourself (${price}). I didn’t invent it.`;
      case 'offline_heuristic':
        return (
          explain ||
          `${price} is a rough offline ballpark when live listings weren’t available. Not a scrape — say “too high/low” or give a number.`
        );
      case 'market_estimate':
      default:
        return (
          explain ||
          `${price} is a market estimate from what you described when scrape didn’t return enough listings.`
        );
    }
  }

  function interviewBlob(itemHint: string, details: string[]): string {
    return [itemHint, ...details].join(' ');
  }

  function hasYear(text: string): boolean {
    return extractCarYears(text).some((y) => !implausibleCarYear(y));
  }

  function extractCarYears(text: string): number[] {
    const out: number[] = [];
    const re = /\b((?:19|20)\d{2})\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) out.push(Number(m[1]));
    return out;
  }

  function implausibleCarYear(year: number): string | null {
    const now = new Date().getFullYear();
    const latest = now + 1; // next model year
    if (year > latest) {
      return `There isn’t a ${year} model year on the market (latest is around ${latest}). Which year did you mean?`;
    }
    if (year < 1990) {
      return `${year} is too old to price from current listings. Which year did you mean?`;
    }
    return null;
  }

  type ProductFamily = 'phone' | 'tablet' | 'laptop' | 'car' | 'travel' | 'generic';

  function productFamily(text: string): ProductFamily {
    const t = text.toLowerCase();
    if (/\b(iphone|smartphone|galaxy\s*s|pixel\s*\d|android phone)\b/.test(t) || (/\bphones?\b/.test(t) && !/\bheadphone/.test(t))) {
      return 'phone';
    }
    if (/\b(ipad|tablet)\b/.test(t)) return 'tablet';
    if (/\b(macbook|laptop|thinkpad|chromebook|surface (pro|laptop)|computer)\b/.test(t)) return 'laptop';
    if (/\b(trip|travel|flight|vacation|holiday|ticket to)\b/.test(t)) return 'travel';
    if (
      /\b(car|vehicle|suv|truck|sedan|hatchback|pickup|van|coupe|4x4)\b/.test(t) ||
      /\b(toyota|honda|hyundai|kia|nissan|ford|bmw|mercedes|audi|mazda|subaru|lexus|jeep|suzuki|isuzu)\b/.test(t)
    ) {
      return 'car';
    }
    return 'generic';
  }

  function latestIPhoneGen(): number {
    const now = new Date();
    // iPhone 16 = 2024 → gen ≈ year - 2008; new models typically in September.
    return now.getMonth() >= 8 ? now.getFullYear() - 2008 : now.getFullYear() - 2009;
  }

  function iPhoneGeneration(text: string): number | null {
    const numbered = text.match(/\biphone\s*(?:se\s*)?(\d{1,2})\b/i);
    if (numbered) return Number(numbered[1]);
    if (/\biphone\s*x[sr]?\b/i.test(text)) return 10;
    return null;
  }

  function implausibleIPhone(text: string): string | null {
    if (!/\biphone\b/i.test(text)) return null;
    const gen = iPhoneGeneration(text);
    if (gen == null) return null;
    const latest = latestIPhoneGen();
    if (gen > latest || gen > 18) {
      return `There isn’t an iPhone ${gen} on the market (latest is around iPhone ${Math.min(latest, 18)}). Which model did you mean — 15, 16, 17, Pro, Pro Max?`;
    }
    if (gen < 6) {
      return `iPhone ${gen} isn’t a current listing. Which model did you mean (11–${Math.min(latest, 18)}, SE, or Pro)?`;
    }
    return null;
  }

  function hasPhoneModel(text: string): boolean {
    if (implausibleIPhone(text)) return false;
    if (/\biphone\s*(se(\s*\d)?|\d{1,2}|x[sr]?)\s*(pro(\s*max)?|plus|mini|air)?\b/i.test(text)) return true;
    if (/\biphone\b/i.test(text) && /\b(se|\d{1,2}|x[sr]?|pro|max|plus|mini)\b/i.test(text) && iPhoneGeneration(text) == null) {
      return true;
    }
    if (/\b(galaxy\s*s\d+|pixel\s*\d+|redmi|note\s*\d+)\b/i.test(text)) return true;
    return false;
  }

  const CAR_MAKE_RE =
    /\b(toyota|honda|hyundai|kia|nissan|ford|bmw|mercedes|benz|audi|volkswagen|\bvw\b|mazda|subaru|chevrolet|\bchevy\b|lexus|tesla|jeep|volvo|mitsubishi|suzuki|isuzu|daihatsu|peugeot|renault|porsche|mini|fiat|\bram\b|gmc|cadillac|acura|infiniti|genesis|byd|haval|chery|geely)\b/i;
  const CAR_MODEL_RE =
    /\b(rav-?4|corolla|camry|carina|yaris|hilux|prado|land\s*cruiser|civic|accord|cr-?v|pilot|fit|tucson|sportage|cx-?5|forester|outlander|golf|passat|jetta|f-?150|mustang|camaro|silverado|wrangler|cherokee|model\s*[3syx]|cybertruck)\b/i;
  const MODEL_MAKE: Record<string, string> = {
    carina: 'Toyota',
    'rav4': 'Toyota',
    'rav-4': 'Toyota',
    corolla: 'Toyota',
    camry: 'Toyota',
    yaris: 'Toyota',
    hilux: 'Toyota',
    prado: 'Toyota',
    civic: 'Honda',
    accord: 'Honda',
    'cr-v': 'Honda',
    crv: 'Honda',
  };

  function titleCaseModel(raw: string): string {
    return raw
      .trim()
      .split(/\s+/)
      .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
      .join(' ');
  }

  function looksLikeCarModelPhrase(text: string): boolean {
    const t = text.trim();
    if (!t || /^(yes|no|ok|okay|please|thanks|new|used|hybrid|le|xle)$/i.test(t)) return false;
    if (CAR_MAKE_RE.test(t) || CAR_MODEL_RE.test(t)) return true;
    const words = t.split(/\s+/).filter((w) => !/^(a|an|the|my|car|vehicle|suv)$/i.test(w) && !/^\d{4}$/.test(w));
    if (words.length === 0 || words.length > 4) return false;
    return words.some((w) => /[a-z]{3,}/i.test(w));
  }

  function hasCarMakeModel(text: string): boolean {
    if (CAR_MAKE_RE.test(text) || CAR_MODEL_RE.test(text)) return true;
    const fam = productFamily(text);
    if (fam === 'car' && looksLikeCarModelPhrase(text)) return true;
    return false;
  }

  function currentCarSpec(details: string[]): { make?: string; model?: string; year?: number; badYear?: number } {
    let make: string | undefined;
    let model: string | undefined;
    let year: number | undefined;
    let badYear: number | undefined;
    for (const line of details) {
      const makeHit = line.match(CAR_MAKE_RE);
      const modelHit = line.match(CAR_MODEL_RE);
      if (makeHit) make = titleCaseModel(makeHit[1].replace(/\bvw\b/i, 'VW'));
      if (modelHit) {
        model = titleCaseModel(modelHit[1].replace(/-/g, ''));
        const key = modelHit[1].toLowerCase().replace(/\s+/g, '');
        if (!make && MODEL_MAKE[key]) make = MODEL_MAKE[key];
        if (!make && MODEL_MAKE[modelHit[1].toLowerCase()]) make = MODEL_MAKE[modelHit[1].toLowerCase()];
      } else if (looksLikeCarModelPhrase(line) && !/^\d{4}$/.test(line.trim())) {
        const words = line
          .trim()
          .split(/\s+/)
          .filter((w) => !/^(a|an|the|my|car|vehicle|suv|i|want)$/i.test(w) && !/^\d{4}$/.test(w));
        if (words.length && !CAR_MAKE_RE.test(line)) {
          model = titleCaseModel(words.join(' '));
          const key = words[0].toLowerCase();
          if (!make && MODEL_MAKE[key]) make = MODEL_MAKE[key];
        }
      }
      for (const y of extractCarYears(line)) {
        const bad = implausibleCarYear(y);
        if (bad) badYear = y;
        else {
          year = y;
          badYear = undefined;
        }
      }
    }
    return { make, model, year, badYear };
  }

  function carSearchTitle(details: string[]): string | null {
    const spec = currentCarSpec(details);
    if (!spec.model && !spec.make) return null;
    return [spec.make, spec.model, spec.year && !spec.badYear ? String(spec.year) : null].filter(Boolean).join(' ');
  }

  function hasLaptopModel(text: string): boolean {
    return /\b(macbook\s*(air|pro)?|thinkpad|xps|surface|chromebook|vivobook|zenbook|pavilion|inspiron)\b/i.test(text);
  }

  function hasSpecificItem(text: string): boolean {
    const fam = productFamily(text);
    if (fam === 'phone') return hasPhoneModel(text);
    if (fam === 'car') return hasCarMakeModel(text);
    if (fam === 'laptop') return hasLaptopModel(text);
    if (fam === 'tablet') return /\b(ipad|tab\s*[as]?\d|galaxy tab)\b/i.test(text);
    return hasCarMakeModel(text) || hasPhoneModel(text) || hasLaptopModel(text);
  }

  function buildMarketQuery(details: string[]): string {
    const car = carSearchTitle(details);
    if (car) return car;
    const stop = /^(i|i'm|im|wanna|want|to|buy|a|an|the|please|just|for|my|me|get|some|car|vehicle)$/i;
    return details
      .join(' ')
      .split(/\s+/)
      .filter((w) => w && !stop.test(w) && !/^https?:/i.test(w))
      .join(' ')
      .slice(0, 120)
      .trim();
  }

  /** Offline fallback only for a named model — never a generic “Vehicle 2022”. */
  function heuristicPrice(details: string[], cur: string): { title: string; amount: string; explain: string } | null {
    const blob = details.join(' ').toLowerCase();
    if (!hasSpecificItem(blob)) return null;
    const yearMatch = blob.match(/\b(20\d{2})\b/);
    const year = yearMatch ? Number(yearMatch[1]) : undefined;
    const isETB = cur === 'ETB';
    const scale = isETB ? 55 : 1;

    const pack = (title: string, usd: number) => ({
      title,
      amount: String(Math.round(usd * scale)),
      explain: `Rough ${cur} ballpark for ${title} (offline table${year ? `, ${year}` : ''}${isETB ? ', USD→ETB scaled' : ''}). Not a live listing.`,
    });

    if (/rav\s*4|rav4/.test(blob)) {
      const base = year && year <= 2018 ? 18000 : year && year <= 2021 ? 24000 : 32000;
      return pack(`Toyota RAV4${year ? ` ${year}` : ''}`, base);
    }
    if (/corolla/.test(blob)) {
      const base = year && year <= 2018 ? 12000 : 18000;
      return pack(`Toyota Corolla${year ? ` ${year}` : ''}`, base);
    }
    if (/honda\s*cr-?v|crv/.test(blob)) {
      return pack(`Honda CR-V${year ? ` ${year}` : ''}`, 28000);
    }
    return null;
  }

  function enoughToEstimate(details: string[], text: string): boolean {
    if (parseStatedPrice(text)) return true;
    const blob = details.join(' ');
    const fam = productFamily(blob);
    if (fam === 'phone') return hasPhoneModel(blob);
    if (fam === 'car') {
      const spec = currentCarSpec(details);
      return Boolean((spec.model || spec.make) && spec.year && !spec.badYear);
    }
    if (fam === 'laptop') return hasLaptopModel(blob);
    if (fam === 'tablet') return /\bipad\b/i.test(blob) && /\b(air|pro|mini|\d)\b/i.test(blob);
    if (/\b(go ahead|that'?s all|how much)\b/i.test(text) && hasSpecificItem(blob)) return true;
    return hasSpecificItem(blob) && (hasYear(blob) || /\b(new|used|refurb|gb|pro|air)\b/i.test(blob));
  }

  function askFollowUp(itemHint: string, details: string[]): string {
    const blob = interviewBlob(itemHint, details);
    const fam = productFamily(blob);

    if (fam === 'phone') {
      const bad = implausibleIPhone(blob);
      if (bad) return bad;
      if (!hasPhoneModel(blob)) {
        if (/\biphone\b/i.test(blob)) return 'Which iPhone — 15, 16, 17, SE, Pro, or Pro Max?';
        if (/\bgalaxy|samsung\b/i.test(blob)) return 'Which Galaxy — for example S24, S24 Ultra, A55?';
        return 'Which phone model exactly (e.g. iPhone 16 Pro, Galaxy S24)?';
      }
      if (!/\b(\d{2,4}\s*gb|new|used|refurb)\b/i.test(blob)) {
        return 'What storage (128GB, 256GB, 512GB) and is it new or used? Then I’ll scrape current selling prices.';
      }
      return 'I’ll scrape live listings next — any other detail (color, carrier locked) or say “go ahead”.';
    }

    if (fam === 'laptop') {
      if (!hasLaptopModel(blob) || (/\bmacbook\b/i.test(blob) && !/\b(air|pro|14|16|13|m[1-4])\b/i.test(blob))) {
        return 'Which laptop — MacBook Air or Pro, which size (13/14/16) and chip (M2, M3…)?';
      }
      return 'New or used, and how much RAM/storage if you know? Then I’ll scrape current selling prices.';
    }

    if (fam === 'tablet') {
      if (!/\b(air|pro|mini|\d)\b/i.test(blob)) return 'Which iPad — Air, Pro, Mini, or which generation?';
      return 'What storage, and new or used? Then I’ll scrape current selling prices.';
    }

    if (fam === 'car') {
      const spec = currentCarSpec(details);
      if (spec.badYear) return implausibleCarYear(spec.badYear) || 'Which model year?';
      if (!spec.model && !hasCarMakeModel(blob)) {
        return 'What make and model — for example Toyota RAV4 or Honda Civic?';
      }
      if (!spec.year) {
        const item = [spec.make, spec.model].filter(Boolean).join(' ') || 'that car';
        return `Which model year for the ${item}?`;
      }
      return 'I’ll scrape live listings next — new or used, or say “go ahead”.';
    }

    if (fam === 'travel') {
      return details.length <= 1 ? 'Where to, and roughly when?' : 'How many people, and flights only or hotel too?';
    }

    if (!hasSpecificItem(blob)) {
      return 'Which product or model exactly? For example “iPhone 15 Pro 256GB” or “Toyota RAV4 2022”.';
    }
    return 'New or used, and any details that affect the price? Then I’ll scrape current selling prices.';
  }

  async function runPriceEstimate(
    contextLines: string[],
    latestText: string,
  ): Promise<{
    draft: GoalDraft;
    financeNote: string;
    warning?: string;
    source: NonNullable<AiInterview['estimateSource']>;
    explain: string;
  }> {
    const blob = contextLines.join('\n');
    const cur = currency.toUpperCase();
    const merged: GoalDraft = { ...(aiDraft ?? {}), currency_code: cur };
    let warning: string | undefined;
    let source: NonNullable<AiInterview['estimateSource']> = 'market_estimate';
    let explain = '';

    const urlMatch = blob.match(/\bhttps?:\/\/[^\s<>"']+/i) || latestText.match(/\bwww\.[^\s<>"']+/i);
    if (urlMatch) {
      const rawUrl = urlMatch[0].toLowerCase().startsWith('http') ? urlMatch[0] : `https://${urlMatch[0]}`;
      setAiStatus('Reading the product page…');
      try {
        const preview = await api.previewGoalUrl(token, rawUrl);
        const p = preview.preview;
        // Server already filters bare years and "/mo" installments; a $2,000 item is a real price.
        if (p?.price) {
          merged.target_amount = p.price;
          if (p.currency) merged.currency_code = p.currency.toUpperCase();
          if (p.title) merged.title = p.title;
          if (p.image_url) merged.image_url = p.image_url;
          merged.source_url = p.url || rawUrl;
          source = 'product_link';
          explain = `Scraped live price ${formatMoney(p.price, (merged.currency_code || cur).toUpperCase(), user.locale)} from ${merged.source_url}. I’ll keep tracking this listing for price changes.`;
        } else {
          merged.source_url = p?.url || rawUrl;
          if (p?.title) merged.title = p.title;
          warning = 'Opened the page but could not find a listed price.';
        }
      } catch (e) {
        warning = e instanceof Error ? e.message : 'Could not scrape that link';
        merged.source_url = rawUrl;
      }
      try {
        const res = await api.extractGoalDraft(token, `${rawUrl}\n${blob}`);
        for (const [key, value] of Object.entries(res.draft ?? {})) {
          if (value === undefined || value === null || value === '') continue;
          if (key === 'target_amount' && merged.target_amount) continue;
          (merged as Record<string, unknown>)[key] = value;
        }
        if (!merged.source_url && res.draft?.source_url) merged.source_url = res.draft.source_url;
        if (merged.target_amount && !isYearAmount(Number(merged.target_amount)) && source !== 'product_link') {
          source = merged.source_url ? 'product_link' : source;
          explain =
            explain ||
            `Pulled ${formatMoney(merged.target_amount, (merged.currency_code || cur).toUpperCase(), user.locale)} from the product page (${merged.source_url || rawUrl}).`;
        }
      } catch (e) {
        if (!warning) warning = e instanceof Error ? e.message : 'Could not read that link';
      }
    }

    const stated = parseStatedPrice(latestText);
    if (stated) {
      merged.target_amount = stated;
      source = 'user_stated';
      explain = `Using the price you stated: ${formatMoney(stated, (merged.currency_code || cur).toUpperCase(), user.locale)}.`;
    }

    const carSpec = currentCarSpec(contextLines);
    const badModel =
      implausibleIPhone(blob) || (carSpec.badYear ? implausibleCarYear(carSpec.badYear) : null);
    if (badModel) {
      merged.target_amount = undefined;
      return {
        draft: merged,
        financeNote: '',
        warning: badModel,
        source: 'market_estimate',
        explain: '',
      };
    }

    const trusted = source === 'product_link' || source === 'user_stated';
    if (!merged.target_amount || (!trusted && isYearAmount(Number(merged.target_amount)))) {
      if (!trusted && isYearAmount(Number(merged.target_amount))) merged.target_amount = undefined;
      const q = buildMarketQuery(contextLines);
      if (q) {
        setAiStatus(`Scraping live listings for “${carSearchTitle(contextLines) || q}”… (up to ~10s)`);
        try {
          const res = await api.searchGoalMarket(token, q, cur);
          const m = res.market;
          if (m?.typical) {
            merged.target_amount = m.typical;
            merged.currency_code = (m.currency_code || cur).toUpperCase();
            if (m.source_url) merged.source_url = m.source_url;
            if (!merged.title) merged.title = carSearchTitle(contextLines) || m.query;
            source = 'market_scrape';
            const low = m.low ? formatMoney(m.low, merged.currency_code, user.locale) : '';
            const high = m.high ? formatMoney(m.high, merged.currency_code, user.locale) : '';
            const typical = formatMoney(m.typical, merged.currency_code, user.locale);
            const n = m.sample_count || m.listings?.length || 0;
            explain = [
              `Scraped live selling prices for “${merged.title || m.query}”.`,
              `Typical ${typical}` + (low && high ? ` (listings from ${low} to ${high}` + (n ? `, ${n} prices` : '') + ')' : ''),
            ]
              .filter(Boolean)
              .join(' ');
            merged.note = explain.slice(0, 240);
          }
        } catch (e) {
          warning = e instanceof Error ? e.message : 'Could not scrape live listings';
        }
      }
    }

    if (merged.target_amount && !trusted && source !== 'market_scrape' && isYearAmount(Number(merged.target_amount))) {
      merged.target_amount = undefined;
    }

    if (!merged.title) {
      merged.title = carSearchTitle(contextLines) || buildMarketQuery(contextLines) || heuristicPrice(contextLines, cur)?.title;
    }

    const genericTitle = !merged.title || /^(20\d{2}|new purchase|vehicle(?:\s+\d{4})?|used car)$/i.test(merged.title.trim());
    if (genericTitle && !hasSpecificItem(blob)) {
      merged.target_amount = undefined;
      merged.title = undefined;
    } else if (genericTitle) {
      const named = heuristicPrice(contextLines, cur);
      merged.title = named?.title || merged.title;
    }
    if (!merged.goal_type) merged.goal_type = 'purchase';
    if (!merged.currency_code) merged.currency_code = cur;

    let financeNote = '';
    setAiStatus('Comparing with your cashflow…');
    try {
      const ov = await api.insightsOverview(token, cur);
      const income = Number(ov.overview?.income || 0);
      const expense = Number(ov.overview?.expense || 0);
      const net = income - expense;
      const price = Number(merged.target_amount || 0);
      if (price > 0) {
        if (income > 0) {
          const months = Math.max(1, Math.ceil(price / Math.max(net > 0 ? net : income * 0.15, 1)));
          financeNote =
            net > 0
              ? `Based on this month’s cashflow (~${formatMoney(String(net), cur, user.locale)} net), you’d need about ${months} month(s) of similar surplus to fund it.`
              : `This month’s spending is tight vs income — plan a dedicated savings streak for ${formatMoney(String(price), cur, user.locale)}.`;
        } else {
          financeNote = 'Log some income in Lony and I can compare this target to your cashflow.';
        }
      }
    } catch {
      /* optional */
    }

    return { draft: merged, financeNote, warning, source, explain };
  }

  async function onAiSend() {
    const text = aiInput.trim();
    if (!text) return;
    const userMsg: AiChatMessage = { id: `u-${Date.now()}`, role: 'user', content: text };
    setAiMessages((prev) => [...prev, userMsg]);
    setAiInput('');
    setAiBusy(true);
    setAiStatus('Thinking…');
    try {
      // Meta / source questions — always answer; never treat as a new product detail.
      if (isMetaPriceQuestion(text)) {
        const mem = estimateMemoryRef.current;
        const draft = aiDraft || mem?.draft || null;
        setAiMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            content: explainEstimateSource(aiInterview, draft, mem),
            chips: draft?.target_amount ? estimateChips(draft) : undefined,
            draft: draft ?? undefined,
          },
        ]);
        return;
      }

      const nextDetails = [...aiInterview.details, text];
      const itemHint = aiInterview.itemHint || text;
      const turns = aiInterview.turns + 1;
      const implausible =
        implausibleIPhone(interviewBlob(itemHint, nextDetails)) ||
        (() => {
          const spec = currentCarSpec(nextDetails);
          return spec.badYear ? implausibleCarYear(spec.badYear) : null;
        })();
      if (implausible) {
        setAiInterview({
          phase: 'gather',
          turns,
          itemHint,
          details: nextDetails,
          estimateSource: aiInterview.estimateSource,
          estimateExplain: aiInterview.estimateExplain,
        });
        setAiMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: 'assistant', content: implausible },
        ]);
        return;
      }
      const ready = aiInterview.phase !== 'gather' || enoughToEstimate(nextDetails, text);

      if (!ready) {
        setAiInterview({
          phase: 'gather',
          turns,
          itemHint,
          details: nextDetails,
          estimateSource: aiInterview.estimateSource,
          estimateExplain: aiInterview.estimateExplain,
        });
        setAiMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: 'assistant', content: askFollowUp(itemHint, nextDetails) },
        ]);
        return;
      }

      const { draft, financeNote, warning, source, explain } = await runPriceEstimate(nextDetails, text);
      setAiDraft(draft);
      rememberEstimate(source, explain, draft);
      setAiInterview({
        phase: draft.target_amount ? 'estimate' : 'gather',
        turns,
        itemHint,
        details: nextDetails,
        estimateSource: source,
        estimateExplain: explain,
      });

      if (!draft.target_amount) {
        setAiMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            content: [
              implausibleIPhone(interviewBlob(itemHint, nextDetails)) ||
                "I couldn't find live selling prices for that yet.",
              warning ? `(${warning})` : null,
              askFollowUp(itemHint, nextDetails),
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ]);
        return;
      }

      const priceLabel = formatMoney(
        draft.target_amount,
        (draft.currency_code || currency).toUpperCase(),
        user.locale,
      );
      const sourceLine =
        source === 'market_scrape'
          ? 'Source: scraped live listings (compared current selling prices).'
          : source === 'product_link'
            ? 'Source: product page (paste links in the Link tab).'
            : source === 'user_stated'
              ? 'Source: the price you typed.'
              : source === 'offline_heuristic'
                ? 'Source: rough offline ballpark (listings unavailable).'
                : 'Source: market estimate — live scrape didn’t return enough listings.';
      const content = [
        `That’s around ${priceLabel} for ${draft.title || 'that item'}.`,
        sourceLine,
        explain && (source === 'market_scrape' || source === 'market_estimate') ? explain : null,
        financeNote,
        'Does that price work for you? (Ask “where from?” anytime.)',
      ]
        .filter(Boolean)
        .join('\n\n');
      setAiMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content,
          chips: estimateChips(draft),
          draft,
        },
      ]);
    } catch (e) {
      setAiMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content:
            e instanceof Error
              ? `Something went wrong: ${e.message}. Try the exact model (e.g. iPhone 15 Pro).`
              : "I couldn't scrape a price yet — tell me the exact model.",
        },
      ]);
    } finally {
      setAiBusy(false);
      setAiStatus(null);
    }
  }

  function onAiChipPress(chip: AiChip, draftSnapshot: GoalDraft) {
    if (chip.kind === 'askSource') {
      const mem = estimateMemoryRef.current;
      const draft = draftSnapshot || aiDraft || mem?.draft || null;
      setAiMessages((prev) => [
        ...prev,
        {
          id: `u-${Date.now()}`,
          role: 'user',
          content: 'Where did you get that price?',
        },
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: explainEstimateSource(aiInterview, draft, mem),
          chips: draft?.target_amount ? estimateChips(draft) : undefined,
          draft: draft ?? undefined,
        },
      ]);
      return;
    }
    if (chip.kind === 'retry') {
      resetAiInterview();
      setAiMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: 'Okay — what do you want to save for? (e.g. “I want a new car”)',
        },
      ]);
      return;
    }
    if (chip.kind === 'tooHigh' || chip.kind === 'tooLow') {
      setAiInterview((prev) => ({
        ...prev,
        phase: 'gather',
        turns: Math.max(1, prev.turns - 1),
        estimateSource: prev.estimateSource,
        estimateExplain: prev.estimateExplain,
      }));
      setAiMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content:
            chip.kind === 'tooHigh'
              ? 'Got it — what would make it cheaper? (older year, used, different trim/model)'
              : 'Got it — what would raise the budget? (newer year, extras, different model)',
        },
      ]);
      return;
    }
    if (chip.kind === 'agree') {
      setAiInterview((prev) => ({ ...prev, phase: 'confirm' }));
      const cur = (draftSnapshot.currency_code || currency).toUpperCase();
      const summary = [
        'Here’s your plan one more time:',
        `• ${draftSnapshot.title || 'Goal'}`,
        draftSnapshot.target_amount
          ? `• Target: ${formatMoney(draftSnapshot.target_amount, cur, user.locale)}`
          : '• Target: (add amount)',
        draftSnapshot.target_date ? `• By: ${draftSnapshot.target_date}` : null,
        'Save it, or open Detail to tweak fields first.',
      ]
        .filter(Boolean)
        .join('\n');
      setAiDraft(draftSnapshot);
      setAiMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: summary,
          chips: confirmChips(),
          draft: draftSnapshot,
        },
      ]);
      return;
    }
    if (chip.kind === 'editDetail') {
      void (async () => {
        await applyDraft(draftSnapshot);
        setCreateTab('detail');
      })();
      return;
    }
    if (chip.kind === 'save') {
      void onAiSavePlan(draftSnapshot);
    }
  }

  async function onAiSavePlan(draft?: GoalDraft | null) {
    const src = draft ?? aiDraft;
    if (!src || !src.title) {
      onError('Agree on a price first, then save');
      return;
    }
    if (!src.target_amount) {
      onError('Need an estimated price before saving');
      return;
    }
    const fields = await applyDraft(src);
    setAiInterview((prev) => ({ ...prev, phase: 'done' }));
    await createGoalWithFields(fields);
  }

  async function onContribute() {
    if (!selectedId) return;
    const amount = stripAmount(contributeAmount);
    if (!amount || Number(amount) <= 0) {
      onError('Enter a contribution amount');
      return;
    }
    setBusy(true);
    try {
      await api.contributeGoal(token, selectedId, {
        amount,
        account_id: contributeAccount || undefined,
        debit_account: debitAccount && Boolean(contributeAccount),
      });
      setContributeAmount('');
      await reload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not contribute');
    } finally {
      setBusy(false);
    }
  }

  async function onArchive(id: string) {
    setBusy(true);
    try {
      await api.updateGoal(token, id, { status: 'archived' });
      goIndex();
      await reload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not archive');
    } finally {
      setBusy(false);
    }
  }

  async function onClearCover(id: string) {
    setBusy(true);
    try {
      await api.uploadGoalCover(token, id, { clear: true });
      await reload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not remove cover');
    } finally {
      setBusy(false);
    }
  }

  const accountOptions = accounts
    .filter((a) => a.currency_code.toUpperCase() === currency.toUpperCase())
    .map((a) => ({
      id: a.id,
      label: `${a.name} · ${a.balance} ${a.currency_code}`,
      keywords: a.name.toLowerCase(),
    }));

  const contributeAccountOptions = (() => {
    const code = (selected?.currency_code || currency).toUpperCase();
    return accounts
      .filter((a) => a.currency_code.toUpperCase() === code)
      .map((a) => ({
        id: a.id,
        label: `${a.name} · ${a.balance} ${a.currency_code}`,
        keywords: a.name.toLowerCase(),
      }));
  })();

  if (mode === 'create') {
    return (
      <View style={{ gap: space.md }}>
        <ScreenHeader title={t(user.locale, 'plan.new') || 'New financial plan'} onBack={goIndex} />
        <Segmented
          value={createTab}
          onChange={(id) => setCreateTab(id as 'detail' | 'link' | 'ai')}
          options={[
            { id: 'detail', label: t(user.locale, 'plan.tabDetail') },
            { id: 'link', label: t(user.locale, 'plan.tabLink') },
            { id: 'ai', label: t(user.locale, 'plan.tabAi') },
          ]}
        />

        {createTab === 'detail' ? (
          <Card>
            <SectionLabel>{t(user.locale, 'plan.details')}</SectionLabel>
            <Field label={t(user.locale, 'cashflow.title')} value={title} onChange={setTitle} />
            <SearchSelect label={t(user.locale, 'plan.type')} value={goalType} onChange={setGoalType} options={goalTypes} />
            {goalType === 'other' ? (
              <Field label={t(user.locale, 'plan.typeName')} value={otherType} onChange={setOtherType} />
            ) : null}
            <SearchSelect label={t(user.locale, 'common.currency')} value={currency} onChange={setCurrency} options={CURRENCIES} />
            <Field label={t(user.locale, 'plan.targetAmount')} value={target} onChange={setTarget} money />
            <Field label={t(user.locale, 'plan.alreadySaved')} value={current} onChange={setCurrent} money />
            <DateField label={t(user.locale, 'plan.targetDate')} value={targetDate} onChange={setTargetDate} />
            {accountOptions.length ? (
              <SearchSelect label={t(user.locale, 'plan.linkedAccount')} value={accountId} onChange={setAccountId} options={accountOptions} />
            ) : null}
            <Field label={t(user.locale, 'cashflow.note')} value={note} onChange={setNote} />
            <SectionLabel>{t(user.locale, 'plan.cover')}</SectionLabel>
            {pendingCover ? (
              <Image
                source={{ uri: pendingCover.preview }}
                style={{ width: '100%', height: 140, borderRadius: radii.lg }}
                resizeMode="cover"
              />
            ) : null}
            <SecondaryButton
              label={pendingCover ? t(user.locale, 'profile.changePhoto') : t(user.locale, 'profile.addPhoto')}
              onPress={() => void pickCover()}
            />
            {pendingCover ? (
              <SecondaryButton label={t(user.locale, 'plan.removePhoto')} onPress={() => setPendingCover(null)} />
            ) : null}
            <PrimaryButton
              label={busy ? t(user.locale, 'common.saving') : t(user.locale, 'common.create')}
              onPress={onCreate}
              disabled={busy}
            />
          </Card>
        ) : null}

        {createTab === 'link' ? (
          <Card>
            <SectionLabel>{t(user.locale, 'plan.pasteLink')}</SectionLabel>
            <Field label={t(user.locale, 'plan.productLink')} value={productUrl} onChange={setProductUrl} placeholder="https://…" />
            <SecondaryButton
              label={urlBusy ? t(user.locale, 'plan.readingLink') : t(user.locale, 'plan.fetchFromLink')}
              onPress={() => void onFetchProductUrl()}
              disabled={urlBusy || busy}
            />
            <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12, lineHeight: 18 }}>
              {t(user.locale, 'plan.linkHint')}
            </Text>
          </Card>
        ) : null}

        {createTab === 'ai' ? (
          <Card>
            <SectionLabel>{t(user.locale, 'plan.askAssistant')}</SectionLabel>
            {aiMessages.length === 0 ? (
              <EmptyState
                title={t(user.locale, 'plan.describePlanTitle')}
                body={t(user.locale, 'plan.describePlanBody')}
              />
            ) : (
              <View style={{ gap: 10 }}>
                {aiMessages.map((m, idx) => {
                  const isUser = m.role === 'user';
                  const isLast = idx === aiMessages.length - 1;
                  return (
                    <View key={m.id} style={{ gap: 8 }}>
                      <View
                        style={{
                          alignSelf: isUser ? 'flex-end' : 'flex-start',
                          maxWidth: '92%',
                          backgroundColor: isUser ? colors.primary : colors.surfaceMuted,
                          borderRadius: isUser ? 18 : 16,
                          borderBottomRightRadius: isUser ? 6 : 16,
                          borderBottomLeftRadius: isUser ? 18 : 6,
                          paddingHorizontal: 14,
                          paddingVertical: 10,
                          borderWidth: isUser ? 0 : 1,
                          borderColor: colors.border,
                        }}
                      >
                        {!isUser ? (
                          <Text
                            style={{
                              color: colors.primary,
                              fontFamily: fonts.uiSemi,
                              fontSize: 10,
                              marginBottom: 4,
                              letterSpacing: 0.4,
                              textTransform: 'uppercase',
                            }}
                          >
                            {t(user.locale, 'plan.assistant')}
                          </Text>
                        ) : null}
                        <Text
                          style={{
                            color: isUser ? colors.onPrimary : colors.text,
                            fontFamily: fonts.ui,
                            fontSize: 14,
                            lineHeight: 20,
                          }}
                        >
                          {m.content}
                        </Text>
                      </View>
                      {isLast && m.chips && m.chips.length > 0 && m.draft ? (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                          {m.chips.map((chip) => (
                            <Pressable
                              key={chip.id}
                              onPress={() => onAiChipPress(chip, m.draft!)}
                              style={{
                                paddingHorizontal: 12,
                                paddingVertical: 8,
                                borderRadius: radii.full,
                                backgroundColor: colors.primarySoft,
                                borderWidth: 1,
                                borderColor: colors.primary,
                              }}
                            >
                              <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 12 }}>
                                {chip.label}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
                {aiBusy ? (
                  <View
                    style={{
                      alignSelf: 'flex-start',
                      maxWidth: '92%',
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                      backgroundColor: colors.surfaceMuted,
                      borderRadius: 16,
                      borderBottomLeftRadius: 6,
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      borderWidth: 1,
                      borderColor: colors.border,
                    }}
                  >
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={{ flex: 1, color: colors.muted, fontFamily: fonts.ui, fontSize: 13, lineHeight: 18 }}>
                      {aiStatus || t(user.locale, 'insights.thinking')}
                    </Text>
                  </View>
                ) : null}
              </View>
            )}
            <Field
              label={t(user.locale, 'plan.message')}
              value={aiInput}
              onChange={setAiInput}
              placeholder="Describe what you're saving for…"
              multiline
            />
            <PrimaryButton
              label={aiBusy ? t(user.locale, 'insights.thinking') : t(user.locale, 'common.send') || 'Send'}
              onPress={() => void onAiSend()}
              disabled={aiBusy || !aiInput.trim()}
            />
            {aiDraft?.title && aiDraft?.target_amount && aiInterview.phase === 'confirm' ? (
              <SecondaryButton
                label={busy ? t(user.locale, 'common.saving') : t(user.locale, 'plan.savePlan')}
                onPress={() => void onAiSavePlan()}
                disabled={busy}
              />
            ) : null}
            {aiMessages.length > 0 && !aiBusy ? (
              <GhostButton label={t(user.locale, 'plan.clearChat') || 'Clear chat'} onPress={clearAiChat} />
            ) : null}
          </Card>
        ) : null}
      </View>
    );
  }

  if (mode === 'show' && selected) {
    const pct = Math.min(100, Math.max(0, Math.round(selected.progress_percent || 0)));
    const done = selected.status === 'completed';
    const cover = resolveMediaURL(selected.cover_image_url);
    return (
      <View style={{ gap: space.md }}>
        <ScreenHeader title={selected.title} onBack={goIndex} />
        <Card>
          {cover ? (
            <Image
              source={{
                uri: cover,
                headers: token ? { Authorization: `Bearer ${token}` } : undefined,
              }}
              style={{ width: '100%', height: 180, borderRadius: radii.lg }}
              resizeMode="cover"
            />
          ) : null}
          <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>{selected.title}</Text>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
            {typeDisplay(selected, goalTypes)}
            {selected.target_date ? ` · ${selected.target_date}` : ''}
            {done ? ` · ${t(user.locale, 'plan.done')}` : ''}
          </Text>
          <View style={{ height: 10, borderRadius: radii.full, backgroundColor: colors.surfaceMuted }}>
            <View
              style={{
                height: 10,
                width: `${Math.max(pct > 0 ? 4 : 0, pct)}%`,
                borderRadius: radii.full,
                backgroundColor: done ? colors.success : colors.primary,
              }}
            />
          </View>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
            {formatMoney(selected.current_amount, selected.currency_code, user.locale)} of{' '}
            {formatMoney(selected.target_amount, selected.currency_code, user.locale)} · {pct}%
          </Text>
          {selected.note ? (
            <Text style={{ color: colors.textSecondary, fontFamily: fonts.ui, fontSize: 14 }}>{selected.note}</Text>
          ) : null}
          {selected.source_url ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: colors.primary, fontFamily: fonts.ui, fontSize: 12 }} numberOfLines={2}>
                {t(user.locale, 'plan.trackingPriceFrom').replace('{url}', selected.source_url)}
              </Text>
              {selected.last_price_checked_at ? (
                <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                  {t(user.locale, 'plan.lastChecked').replace(
                    '{when}',
                    new Date(selected.last_price_checked_at).toLocaleString(user.locale || undefined),
                  )}
                </Text>
              ) : null}
              <SecondaryButton
                label={priceBusy ? t(user.locale, 'plan.checkingPrice') : t(user.locale, 'plan.checkPriceNow')}
                onPress={() => void onCheckPriceNow()}
                disabled={priceBusy}
              />
              <SectionLabel>{t(user.locale, 'plan.priceHistory')}</SectionLabel>
              {priceHistory.length === 0 ? (
                <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
                  {t(user.locale, 'plan.noPriceHistory')}
                </Text>
              ) : (
                priceHistory.slice(0, 12).map((row) => {
                  const dirLabel =
                    row.direction === 'up'
                      ? t(user.locale, 'plan.priceWentUp')
                      : row.direction === 'down'
                        ? t(user.locale, 'plan.priceDropped')
                        : t(user.locale, 'plan.priceUnchanged');
                  const dirColor =
                    row.direction === 'up'
                      ? colors.warning
                      : row.direction === 'down'
                        ? colors.success
                        : colors.muted;
                  return (
                    <View
                      key={row.id}
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        gap: 8,
                        paddingVertical: 6,
                        borderBottomWidth: 1,
                        borderBottomColor: colors.border,
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 14 }}>
                          {formatMoney(row.price, row.currency_code, user.locale)}
                        </Text>
                        <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                          {new Date(row.created_at).toLocaleString(user.locale || undefined)}
                        </Text>
                      </View>
                      <Text style={{ color: dirColor, fontFamily: fonts.ui, fontSize: 12 }}>{dirLabel}</Text>
                    </View>
                  );
                })
              )}
            </View>
          ) : null}

          {!done && selected.status === 'active' ? (
            <>
              <SectionLabel>{t(user.locale, 'plan.contribute')}</SectionLabel>
              <Field label={t(user.locale, 'cashflow.amount')} value={contributeAmount} onChange={setContributeAmount} money />
              {contributeAccountOptions.length ? (
                <>
                  <SearchSelect
                    label={t(user.locale, 'plan.fromAccount')}
                    value={contributeAccount}
                    onChange={setContributeAccount}
                    options={contributeAccountOptions}
                  />
                  {contributeAccount ? (
                    <Pressable
                      onPress={() => setDebitAccount((v) => !v)}
                      style={{
                        paddingVertical: 10,
                        paddingHorizontal: 12,
                        borderRadius: radii.md,
                        borderWidth: 1,
                        borderColor: debitAccount ? colors.primary : colors.border,
                        backgroundColor: debitAccount ? colors.primarySoft : colors.surfaceMuted,
                      }}
                    >
                      <Text style={{ color: colors.text, fontFamily: fonts.ui, fontSize: 13 }}>
                        {debitAccount ? t(user.locale, 'plan.debitAccount') : t(user.locale, 'plan.logOnly')}
                      </Text>
                    </Pressable>
                  ) : null}
                </>
              ) : null}
              <PrimaryButton
                label={busy ? t(user.locale, 'common.saving') : t(user.locale, 'plan.addContribution')}
                onPress={onContribute}
                disabled={busy}
              />
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <Pressable
                  onPress={() => void pickCover(selected.id)}
                  accessibilityLabel={cover ? t(user.locale, 'profile.changePhoto') : t(user.locale, 'profile.addPhoto')}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: radii.full,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.primarySoft,
                    borderWidth: 1,
                    borderColor: colors.primary,
                  }}
                >
                  <IconCamera size={16} color={colors.primary} />
                </Pressable>
                {cover ? (
                  <Pressable
                    onPress={() => void onClearCover(selected.id)}
                    accessibilityLabel={t(user.locale, 'plan.removePhoto')}
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: radii.full,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: colors.warningSoft,
                      borderWidth: 1,
                      borderColor: colors.warning,
                    }}
                  >
                    <IconTrash size={16} color={colors.warning} />
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => onArchive(selected.id)}
                  accessibilityLabel={t(user.locale, 'accounts.archive')}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: radii.full,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.warningSoft,
                    borderWidth: 1,
                    borderColor: colors.warning,
                  }}
                >
                  <IconTrash size={16} color={colors.warning} />
                </Pressable>
              </View>
            </>
          ) : null}
        </Card>
      </View>
    );
  }

  return (
    <View style={{ gap: space.md }}>
      <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>
        {t(user.locale, 'plan.title')}
      </Text>

      <PrimaryButton
        label={t(user.locale, 'plan.new')}
        onPress={() => {
          resetForm();
          setMode('create');
          onDetailChange?.(true);
        }}
      />

      {showFilters && filterOptions.length > 1 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {filterOptions.map((opt) => {
            const active = filter === opt.id;
            return (
              <Pressable
                key={opt.id}
                onPress={() => setFilter(opt.id)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: radii.full,
                  backgroundColor: active ? colors.primarySoft : colors.surfaceMuted,
                  borderWidth: 1,
                  borderColor: active ? colors.primary : colors.border,
                }}
              >
                <Text
                  style={{
                    color: active ? colors.primary : colors.muted,
                    fontFamily: fonts.uiSemi,
                    fontSize: 12,
                  }}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <Card>
        <SectionLabel>{t(user.locale, 'plan.yourPlans').replace('{count}', String(visible.length))}</SectionLabel>
        {visible.length === 0 ? (
          <EmptyState title={t(user.locale, 'plan.noPlansTitle')} body={t(user.locale, 'plan.noPlansBody')} />
        ) : (
          visible.map((g) => {
            const pct = Math.min(100, Math.max(0, Math.round(g.progress_percent || 0)));
            const cover = resolveMediaURL(g.cover_image_url);
            return (
              <Pressable
                key={g.id}
                onPress={() => {
                  setSelectedId(g.id);
                  setContributeAccount(g.linked_account_id || '');
                  setContributeAmount('');
                  setDebitAccount(true);
                  setMode('show');
                  onDetailChange?.(true);
                }}
                style={{
                  gap: 10,
                  paddingVertical: 14,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                }}
              >
                {cover ? (
                  <Image
                    source={{
                      uri: cover,
                      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                    }}
                    style={{ width: '100%', height: 120, borderRadius: radii.lg }}
                    resizeMode="cover"
                  />
                ) : (
                  <View
                    style={{
                      height: 56,
                      borderRadius: radii.lg,
                      backgroundColor: colors.primarySoft,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 13 }}>
                      {typeDisplay(g, goalTypes)}
                    </Text>
                  </View>
                )}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>{g.title}</Text>
                    <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                      {typeDisplay(g, goalTypes)}
                      {g.target_date ? ` · ${g.target_date}` : ''}
                    </Text>
                  </View>
                  <Text style={{ color: colors.primary, fontFamily: fonts.uiBold, fontSize: 14 }}>{pct}%</Text>
                </View>
                <View style={{ height: 8, borderRadius: radii.full, backgroundColor: colors.surfaceMuted }}>
                  <View
                    style={{
                      height: 8,
                      width: `${Math.max(pct > 0 ? 4 : 0, pct)}%`,
                      borderRadius: radii.full,
                      backgroundColor: colors.primary,
                    }}
                  />
                </View>
                <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                  {formatMoney(g.current_amount, g.currency_code, user.locale)} of{' '}
                  {formatMoney(g.target_amount, g.currency_code, user.locale)}
                </Text>
              </Pressable>
            );
          })
        )}
      </Card>
    </View>
  );
}
