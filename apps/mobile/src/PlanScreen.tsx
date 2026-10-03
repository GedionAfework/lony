import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { EncodingType, cacheDirectory, documentDirectory, downloadAsync, readAsStringAsync } from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { api, type Goal, type GoalDraft, type MoneyAccount, type User } from './api';
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

type AiChipKind = 'agree' | 'tooHigh' | 'tooLow' | 'retry' | 'save' | 'editDetail';

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

/** Multi-turn interview: clarify item → estimate price → confirm → save. */
type AiInterview = {
  phase: 'gather' | 'estimate' | 'confirm' | 'done';
  turns: number;
  itemHint: string;
  details: string[];
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
  const [aiDraft, setAiDraft] = useState<GoalDraft | null>(null);
  const [aiInterview, setAiInterview] = useState<AiInterview>({
    phase: 'gather',
    turns: 0,
    itemHint: '',
    details: [],
  });

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
    setAiMessages([]);
    setAiInput('');
    setAiDraft(null);
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
  }

  /** Offline / AI-down fallback so the chat still reaches a number. */
  function heuristicPrice(details: string[], cur: string): { title: string; amount: string } | null {
    const blob = details.join(' ').toLowerCase();
    const yearMatch = blob.match(/\b(20\d{2})\b/);
    const year = yearMatch ? Number(yearMatch[1]) : undefined;
    const isETB = cur === 'ETB';
    const scale = isETB ? 55 : 1; // rough USD→ETB for local fallbacks

    if (/rav\s*4|rav4/.test(blob)) {
      const base = year && year <= 2018 ? 18000 : year && year <= 2021 ? 24000 : 32000;
      return { title: `Toyota RAV4${year ? ` ${year}` : ''}`, amount: String(Math.round(base * scale)) };
    }
    if (/corolla/.test(blob)) {
      const base = year && year <= 2018 ? 12000 : 18000;
      return { title: `Toyota Corolla${year ? ` ${year}` : ''}`, amount: String(Math.round(base * scale)) };
    }
    if (/honda\s*cr-?v|crv/.test(blob)) {
      return { title: `Honda CR-V${year ? ` ${year}` : ''}`, amount: String(Math.round(28000 * scale)) };
    }
    if (/macbook/.test(blob)) {
      return { title: 'MacBook', amount: String(Math.round(1800 * scale)) };
    }
    if (/iphone/.test(blob)) {
      return { title: 'iPhone', amount: String(Math.round(900 * scale)) };
    }
    if (/car|vehicle|suv|truck/.test(blob) && year) {
      return { title: `Vehicle ${year}`, amount: String(Math.round(22000 * scale)) };
    }
    if (/car|vehicle|suv|truck/.test(blob)) {
      return { title: 'Used car', amount: String(Math.round(15000 * scale)) };
    }
    return null;
  }

  function enoughToEstimate(details: string[], text: string): boolean {
    if (/\b(estimate|price|how much|go ahead|that'?s all)\b/i.test(text)) return true;
    if (/\b(20\d{2})\b/.test(text)) return true; // year
    if (/\b\d{4,}\b/.test(text) && /\b(about|around|etb|usd|\$|br|birr|cost|price)\b/i.test(text)) return true;
    if (/^\s*[\d,]{3,}(?:\.\d{1,2})?\s*$/.test(text)) return true; // bare amount
    if (details.length >= 3) return true;
    const blob = details.join(' ');
    if (details.length >= 2 && /\b(rav|toyota|honda|macbook|iphone|laptop|trip|dubai|japan)\b/i.test(blob)) {
      return true;
    }
    return false;
  }

  async function askFollowUp(itemHint: string, details: string[]): Promise<string> {
    const blob = details.join('\n');
    try {
      const coachRes = await api.aiCoach(
        token,
        currency,
        [
          'You are helping someone create a savings Plan in Lony.',
          'Ask ONE short clarifying question to estimate the purchase price.',
          'Do not give a price yet. Prefer make/model/year/condition questions.',
          `What they said so far:\n${blob || itemHint}`,
        ].join('\n'),
      );
      const reply = coachRes.coach?.reply?.trim();
      if (reply) return reply.split('\n')[0]!.slice(0, 220);
    } catch {
      /* fallback below */
    }
    if (/car|vehicle|rav|toyota|honda|suv|truck/i.test(itemHint)) {
      return details.length <= 1
        ? 'What kind of car — make and model?'
        : 'Which year (and trim, if you know)?';
    }
    if (/phone|laptop|macbook|iphone|ipad|computer/i.test(itemHint)) {
      return 'Which model and storage/size do you want?';
    }
    return details.length <= 1
      ? 'Can you be more specific — which product or model?'
      : 'Any year, condition (new/used), or other details that affect the price?';
  }

  async function runPriceEstimate(contextLines: string[]): Promise<{ draft: GoalDraft; financeNote: string; warning?: string }> {
    const blob = contextLines.join('\n');
    const cur = currency.toUpperCase();
    const prompt = [
      `Estimate a realistic purchase price in ${cur} for this savings goal.`,
      'Fill target_amount with a realistic market estimate (digits only).',
      'Also set a clear title and goal_type purchase when buying something.',
      blob,
    ].join('\n');
    const merged: GoalDraft = { ...(aiDraft ?? {}), currency_code: cur };
    let warning: string | undefined;

    try {
      const res = await api.extractGoalDraft(token, prompt);
      for (const [key, value] of Object.entries(res.draft ?? {})) {
        if (value !== undefined && value !== null && value !== '') {
          (merged as Record<string, unknown>)[key] = value;
        }
      }
    } catch (e) {
      warning = e instanceof Error ? e.message : 'AI extract unavailable';
    }

    if (!merged.target_amount) {
      try {
        const coachRes = await api.aiCoach(
          token,
          cur,
          `Estimate a realistic ${cur} market price for:\n${blob}\nReply with exactly one line: ESTIMATE: <number>`,
        );
        const reply = coachRes.coach?.reply || '';
        const m = reply.match(/ESTIMATE:\s*([\d,]+(?:\.\d{1,2})?)/i) || reply.match(/(\d[\d,]{2,}(?:\.\d{1,2})?)/);
        if (m) merged.target_amount = m[1].replace(/,/g, '');
      } catch (e) {
        if (!warning) warning = e instanceof Error ? e.message : 'AI coach unavailable';
      }
    }

    if (!merged.target_amount || !merged.title) {
      const fallback = heuristicPrice(contextLines, cur);
      if (fallback) {
        if (!merged.title) merged.title = fallback.title;
        if (!merged.target_amount) {
          merged.target_amount = Number(fallback.amount).toFixed(2);
          merged.note = (merged.note ? `${merged.note} · ` : '') + 'Rough offline estimate';
        }
      }
    }

    if (!merged.title) {
      merged.title = contextLines[contextLines.length - 1]?.slice(0, 80) || 'New purchase';
    }
    if (!merged.goal_type) merged.goal_type = 'purchase';
    if (!merged.currency_code) merged.currency_code = cur;

    let financeNote = '';
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

    return { draft: merged, financeNote, warning };
  }

  async function onAiSend() {
    const text = aiInput.trim();
    if (!text) return;
    const userMsg: AiChatMessage = { id: `u-${Date.now()}`, role: 'user', content: text };
    setAiMessages((prev) => [...prev, userMsg]);
    setAiInput('');
    setAiBusy(true);
    try {
      const nextDetails = [...aiInterview.details, text];
      const itemHint = aiInterview.itemHint || text;
      const turns = aiInterview.turns + 1;
      const ready = aiInterview.phase !== 'gather' || enoughToEstimate(nextDetails, text);

      if (!ready) {
        setAiInterview({ phase: 'gather', turns, itemHint, details: nextDetails });
        const q = await askFollowUp(itemHint, nextDetails);
        setAiMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: q }]);
        return;
      }

      setAiInterview({ phase: 'estimate', turns, itemHint, details: nextDetails });
      const { draft, financeNote, warning } = await runPriceEstimate(nextDetails);
      setAiDraft(draft);

      if (!draft.target_amount) {
        setAiMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            content: [
              "I still don't have a solid price.",
              warning ? `(${warning})` : null,
              'Tell me the model and year more clearly, or type a number like “about 25000”.',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ]);
        setAiInterview({ phase: 'gather', turns, itemHint, details: nextDetails });
        return;
      }

      // User typed an explicit amount — prefer it.
      const typedAmt = text.match(/(?:about|around|≈|~)?\s*([\d]{3,}(?:[.,]\d{2})?)/i);
      if (typedAmt && /\b(about|around|etb|usd|\$|price|cost)\b/i.test(text)) {
        draft.target_amount = typedAmt[1].replace(/,/g, '');
      }

      const priceLabel = formatMoney(
        draft.target_amount,
        (draft.currency_code || currency).toUpperCase(),
        user.locale,
      );
      const content = [
        `That’s around ${priceLabel} for ${draft.title || 'that item'}.`,
        financeNote,
        'Does that price work for you?',
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
              ? `Something went wrong: ${e.message}. Try again with the model and year.`
              : "I couldn't estimate that yet — tell me the item, model, and year.",
        },
      ]);
    } finally {
      setAiBusy(false);
    }
  }

  function onAiChipPress(chip: AiChip, draftSnapshot: GoalDraft) {
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
      setAiInterview((prev) => ({ ...prev, phase: 'gather', turns: Math.max(1, prev.turns - 1) }));
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
            <Text style={{ color: colors.primary, fontFamily: fonts.ui, fontSize: 12 }} numberOfLines={2}>
              {t(user.locale, 'plan.trackingPriceFrom').replace('{url}', selected.source_url)}
            </Text>
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
