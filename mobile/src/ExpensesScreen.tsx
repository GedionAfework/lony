import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import {
  api,
  type Budget,
  type PaydayCycle,
  type CashflowBill,
  type CashflowCalendar,
  type CashflowEntry,
  type CashflowSummary,
  type CategorySpend,
  type Friendship,
  type Loan,
  type TripBudget,
  type User,
  type WealthSummary,
} from './api';
import { formatError } from './errors';
import { formatAmountCommas, stripAmount } from './amountFormat';
import { CURRENCIES } from './catalogs';
import { DateField, isoToday } from './DateField';
import {
  addCalendarMonths,
  dateFromCalendarParts,
  daysInCalendarMonth,
  formatCalendarMonthLabel,
  getCalendarParts,
  toIsoLocal,
} from './calendarMath';
import { useDatePrefs, useFormatDate } from './datePrefs';
import { SearchSelect } from './SearchSelect';
import { IconClose, IconRepeat } from './icons';
import { listCashflowDrafts, removeCashflowDraft, type CashflowDraft } from './offlineDrafts';
import { NetWorthCard } from './NetWorthCard';
import { fonts, radii, space, useTheme, type ThemeColors } from './theme';
import { t } from './i18n';
import { Card, EmptyState, Field, Money, PrimaryButton, SecondaryButton, SectionLabel } from './ui';
import { storageGet, storageSet } from './secureStorage';
import { pushWidgetSnapshot } from './widgetSnapshot';

const WEALTH_CACHE_KEY = 'lony.wealth_cache.v1';

function cashflowActionLabel(entry: CashflowEntry, locale?: string | null): string {
  const cat = (entry.category || '').toLowerCase();
  const note = (entry.note || '').toLowerCase();
  const expected = entry.status === 'expected' || entry.is_template;
  if (expected) return entry.kind === 'income' ? t(locale, 'expenses.actionExpected') : t(locale, 'expenses.actionDue');
  if (cat.includes('transfer') || note.includes('transfer') || note.startsWith('acct') || note.startsWith('bank'))
    return t(locale, 'expenses.actionTransfer');
  if (cat.includes('import') || note.startsWith('plaid:') || note.startsWith('sms:'))
    return t(locale, 'expenses.actionImported');
  if (entry.linked_loan_id)
    return entry.kind === 'income' ? t(locale, 'expenses.actionLoanRepayment') : t(locale, 'expenses.actionLoanPayment');
  if (entry.kind === 'income') return t(locale, 'expenses.actionReceived');
  return t(locale, 'expenses.actionSpent');
}

function plusDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function looksLikeRawSms(text: string): boolean {
  const s = (text || '').trim();
  if (!s) return false;
  if (s.length > 120) return true;
  return /dear customer|you have (?:transfered|transferred|received|paid)|transaction of|your (?:a\/c|account)|otp|balance is|e-money|telebirr|ref\s*:?\s*ft/i.test(
    s,
  );
}

/** Short title for lists / show — hide full SMS / long paste blobs. */
export function displayCashflowTitle(entry: CashflowEntry, locale?: string | null): string {
  const raw = (entry.title || entry.category || 'Entry').trim();
  const note = (entry.note || '').trim();
  // Legacy rows stored the SMS body as title or note — never show the raw body.
  if (looksLikeRawSms(raw) || raw.length > 48) {
    if (/^from /i.test(raw) || /^to /i.test(raw) || /^money (received|sent)/i.test(raw)) {
      return raw.slice(0, 48);
    }
    const firstNote = note.split('\n')[0] || '';
    if (/^from /i.test(firstNote) || /^to /i.test(firstNote) || firstNote.startsWith('acct')) {
      return firstNote.slice(0, 48);
    }
    return entry.kind === 'income' ? t(locale, 'expenses.transferIn') : t(locale, 'expenses.transferOut');
  }
  if (raw === 'Bank SMS' || raw === 'Transfer') {
    const first = note.split('\n')[0] || '';
    if (/^from /i.test(first) || /^to /i.test(first) || first.startsWith('acct')) return first.slice(0, 40);
    return t(locale, 'expenses.actionTransfer');
  }
  return raw;
}

/** Short note for show page — never the full SMS body. */
export function displayCashflowNote(entry: CashflowEntry): string | null {
  const note = (entry.note || '').trim();
  if (!note) return null;
  if (looksLikeRawSms(note)) {
    const title = (entry.title || '').trim();
    if (title && !looksLikeRawSms(title) && title.length <= 60) return title;
    return entry.kind === 'income' ? 'Money received' : 'Money sent';
  }
  // Keep first line only (legacy rows sometimes appended SMS after a summary).
  const first = note.split('\n')[0]?.trim() || note;
  return first.slice(0, 120);
}

export type ExpensesTab = 'dashboard' | 'calendar' | 'income' | 'expenses' | 'bills';

function clientHeat(expense: number, max: number): number {
  if (expense <= 0 || max <= 0) return 0;
  const r = expense / max;
  if (r < 0.25) return 1;
  if (r < 0.5) return 2;
  if (r < 0.75) return 3;
  return 4;
}

function heatOpacity(heat: number): number {
  return [0, 0.2, 0.4, 0.65, 1][Math.max(0, Math.min(heat, 4))] ?? 0;
}

type Props = {
  user: User;
  token: string;
  friends: Friendship[];
  loans: Loan[];
  tab: ExpensesTab;
  onTab: (tab: ExpensesTab) => void;
  formatMoney: (amount: string | null | undefined, currency: string | null | undefined, locale?: string) => string;
  onError: (message: string) => void;
  onOpenLoan: (id: string) => void;
  onOpenEntry: (entry: CashflowEntry) => void;
  onOpenAccounts?: () => void;
  /** Reloads cashflow lists only (not net worth). */
  reloadToken?: number;
  /** Reloads net worth (accounts edits). */
  wealthReloadToken?: number;
};

function localDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return (iso || '').slice(0, 10);
  return toIsoLocal(d);
}

function monthBounds(
  d: Date,
  calendarId?: string | null,
): {
  from: string;
  to: string;
  label: string;
  day: string;
  short: string;
  calYear: number;
  calMonth: number;
  dim: number;
  padStart: number;
} {
  const parts = getCalendarParts(d, calendarId);
  const dim = daysInCalendarMonth(calendarId, parts.year, parts.month);
  const fromDate = dateFromCalendarParts(calendarId, parts.year, parts.month, 1) ?? d;
  const nextMonth = addCalendarMonths(fromDate, calendarId, 1);
  const label = formatCalendarMonthLabel(calendarId, parts.year, parts.month);
  const shortMonths = formatCalendarMonthLabel(calendarId, parts.year, parts.month).split(' ')[0] || label;
  return {
    from: toIsoLocal(fromDate),
    to: toIsoLocal(nextMonth),
    label,
    day: String(parts.day),
    short: shortMonths,
    calYear: parts.year,
    calMonth: parts.month,
    dim,
    padStart: fromDate.getDay(),
  };
}

function loanRemaining(loan: Loan): number {
  return Number(loan.expected_total || loan.principal || 0);
}

function HeatMonthGrid({
  period,
  selectedIso,
  todayIso,
  heatByDate,
  calendarId,
  colors,
  onPick,
}: {
  period: ReturnType<typeof monthBounds>;
  selectedIso: string;
  todayIso: string;
  heatByDate: Map<string, { heat: number; expense: number; income: number }>;
  calendarId?: string | null;
  colors: ThemeColors;
  onPick: (d: Date) => void;
}) {
  return (
    <>
      <View style={{ flexDirection: 'row', marginBottom: 6 }}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <Text
            key={`${d}-${i}`}
            style={{
              flex: 1,
              textAlign: 'center',
              color: colors.muted,
              fontFamily: fonts.uiSemi,
              fontSize: 11,
            }}
          >
            {d}
          </Text>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {Array.from({ length: period.padStart }).map((_, i) => (
          <View key={`pad-${i}`} style={{ width: `${100 / 7}%`, height: 40 }} />
        ))}
        {Array.from({ length: period.dim }, (_, i) => i + 1).map((dayNum) => {
          const dayDate = dateFromCalendarParts(calendarId, period.calYear, period.calMonth, dayNum);
          const iso = dayDate ? toIsoLocal(dayDate) : '';
          const active = selectedIso === iso;
          const today = todayIso === iso;
          const heat = iso ? heatByDate.get(iso)?.heat ?? 0 : 0;
          const strong = active || heat >= 3;
          return (
            <Pressable
              key={iso || `d-${dayNum}`}
              onPress={() => {
                if (dayDate) onPick(dayDate);
              }}
              style={{
                width: `${100 / 7}%`,
                height: 40,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 8,
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  borderWidth: active ? 2 : today ? 1 : 0,
                  borderColor: colors.primary,
                  backgroundColor: active ? colors.primary : 'transparent',
                }}
              >
                {!active && heat > 0 ? (
                  <View
                    style={{
                      position: 'absolute',
                      top: 0,
                      right: 0,
                      bottom: 0,
                      left: 0,
                      backgroundColor: colors.primary,
                      opacity: heatOpacity(heat),
                    }}
                  />
                ) : null}
                <Text
                  style={{
                    color: strong ? colors.onPrimary : colors.text,
                    fontFamily: fonts.uiSemi,
                    fontSize: 13,
                  }}
                >
                  {dayNum}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

function billAsEntry(b: CashflowBill): CashflowEntry {
  return {
    id: b.id,
    kind: b.kind,
    title: b.title,
    amount: b.amount,
    currency_code: b.currency_code,
    category: b.category,
    occurred_at: b.due_at,
    is_template: b.is_template,
    recurrence: b.recurrence,
    template_id: b.template_id,
    account_id: b.account_id,
    status: 'expected',
    paused: b.paused,
    created_at: b.due_at,
    updated_at: b.due_at,
  };
}

export function ExpensesScreen({
  user,
  token,
  loans,
  tab,
  onTab,
  formatMoney,
  onError,
  onOpenLoan,
  onOpenEntry,
  onOpenAccounts,
  reloadToken = 0,
  wealthReloadToken = 0,
}: Props) {
  const { colors } = useTheme();
  const datePrefs = useDatePrefs();
  const calendarId = datePrefs.calendarId || user.calendar_id || 'gregorian';
  const [summary, setSummary] = useState<CashflowSummary | null>(null);
  const [wealth, setWealth] = useState<WealthSummary | null>(null);
  const [income, setIncome] = useState<CashflowEntry[]>([]);
  const [expenseRows, setExpenseRows] = useState<CashflowEntry[]>([]);
  const [incomeTemplates, setIncomeTemplates] = useState<CashflowEntry[]>([]);
  const [expenseTemplates, setExpenseTemplates] = useState<CashflowEntry[]>([]);
  const [bills, setBills] = useState<CashflowBill[]>([]);
  const [billBusy, setBillBusy] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<CategorySpend[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [payday, setPayday] = useState<PaydayCycle | null>(null);
  const [budgetCategory, setBudgetCategory] = useState('');
  const [budgetLimit, setBudgetLimit] = useState('');
  const [budgetBusy, setBudgetBusy] = useState(false);
  const [paydayDay, setPaydayDay] = useState('');
  const [paydayLimit, setPaydayLimit] = useState('');
  const [trips, setTrips] = useState<TripBudget[]>([]);
  const [tripTitle, setTripTitle] = useState('');
  const [tripStarts, setTripStarts] = useState(() => isoToday());
  const [tripEnds, setTripEnds] = useState(() => plusDays(isoToday(), 7));
  const [tripLimit, setTripLimit] = useState('');
  const [tripCurrency, setTripCurrency] = useState((user.default_currency_code || 'USD').toUpperCase());
  const [tripBusy, setTripBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<CashflowDraft[]>([]);
  const [draftBusy, setDraftBusy] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [spendCalendar, setSpendCalendar] = useState<CashflowCalendar | null>(null);

  const period = useMemo(() => monthBounds(selectedDate, calendarId), [selectedDate, calendarId]);
  const selectedIso = useMemo(() => toIsoLocal(selectedDate), [selectedDate]);
  const preferred = (user.default_currency_code || 'USD').toUpperCase();

  const dayIncome = useMemo(
    () => income.filter((e) => localDay(e.occurred_at) === selectedIso),
    [income, selectedIso],
  );
  const dayExpense = useMemo(
    () => expenseRows.filter((e) => localDay(e.occurred_at) === selectedIso),
    [expenseRows, selectedIso],
  );

  const heatByDate = useMemo(() => {
    const map = new Map<string, { heat: number; expense: number; income: number }>();
    if (spendCalendar?.days?.length) {
      for (const d of spendCalendar.days) {
        map.set(d.date, {
          heat: d.heat,
          expense: Number(d.expense) || 0,
          income: Number(d.income) || 0,
        });
      }
      return map;
    }
    const sums = new Map<string, { expense: number; income: number }>();
    for (const e of expenseRows) {
      if (e.currency_code && e.currency_code.toUpperCase() !== preferred) continue;
      const key = localDay(e.occurred_at);
      const cur = sums.get(key) || { expense: 0, income: 0 };
      cur.expense += Number(e.amount) || 0;
      sums.set(key, cur);
    }
    for (const e of income) {
      if (e.currency_code && e.currency_code.toUpperCase() !== preferred) continue;
      const key = localDay(e.occurred_at);
      const cur = sums.get(key) || { expense: 0, income: 0 };
      cur.income += Number(e.amount) || 0;
      sums.set(key, cur);
    }
    let max = 0;
    for (const v of sums.values()) if (v.expense > max) max = v.expense;
    for (const [key, v] of sums) {
      map.set(key, { heat: clientHeat(v.expense, max), expense: v.expense, income: v.income });
    }
    return map;
  }, [spendCalendar, expenseRows, income, preferred]);

  const reload = useCallback(async () => {
    try {
      setLoadError(null);
      const from = new Date(`${period.from}T00:00:00`).toISOString();
      const to = new Date(`${period.to}T00:00:00`).toISOString();
      const [sum, inc, exp, incT, expT, breakRes, budgetRes, billsRes, calRes, tripRes] = await Promise.all([
        api.cashflowSummary(token, { from, to }),
        api.listCashflow(token, { kind: 'income', from, to, limit: 2000 }),
        api.listCashflow(token, { kind: 'expense', from, to, limit: 2000 }),
        api.listCashflow(token, { kind: 'income', templates: true }),
        api.listCashflow(token, { kind: 'expense', templates: true }),
        api.cashflowBreakdown(token, { kind: 'expense', from, to }).catch(() => ({ breakdown: [] })),
        api.listBudgets(token, period.from).catch(() => ({ budgets: [] as Budget[], payday: undefined as PaydayCycle | undefined })),
        api.listCashflowBills(token, 90).catch(() => ({ bills: [] })),
        api
          .cashflowCalendar(token, {
            from: period.from,
            to: period.to,
            currency: preferred,
            tz: user.timezone || 'UTC',
          })
          .catch(() => ({ calendar: null as CashflowCalendar | null })),
        api.listTrips(token).catch(() => ({ trips: [] as TripBudget[] })),
      ]);
      setSummary(sum.summary);
      setIncome(inc.entries ?? []);
      setExpenseRows(exp.entries ?? []);
      setIncomeTemplates(incT.entries ?? []);
      setExpenseTemplates(expT.entries ?? []);
      setBreakdown(breakRes.breakdown ?? []);
      setBudgets(budgetRes.budgets ?? []);
      setPayday(budgetRes.payday ?? null);
      if (budgetRes.payday?.source === 'setting' && budgetRes.payday.payday_day) {
        setPaydayDay(String(budgetRes.payday.payday_day));
      }
      if (budgetRes.payday?.limit_amount) setPaydayLimit(formatAmountCommas(budgetRes.payday.limit_amount));
      setBills(billsRes.bills ?? []);
      setSpendCalendar(calRes.calendar ?? null);
      setTrips(tripRes.trips ?? []);
      setDrafts(await listCashflowDrafts());
    } catch (e) {
      const message = formatError(e, t(user.locale, 'expenses.loadErrorFallback'));
      setLoadError(message);
      onError(message);
      setDrafts(await listCashflowDrafts());
    }
  }, [token, period.from, period.to, onError, user.locale, user.timezone, preferred]);

  const reloadWealth = useCallback(async () => {
    try {
      const wealthRes = await api.wealth(token, preferred).catch(() => null);
      if (wealthRes?.wealth) {
        setWealth(wealthRes.wealth);
        void storageSet(WEALTH_CACHE_KEY, JSON.stringify({ preferred, wealth: wealthRes.wealth }));
      }
    } catch {
      /* keep last snapshot */
    }
  }, [token, preferred]);

  // Paint the last known Total Balance immediately; the live value replaces it when it arrives.
  useEffect(() => {
    let cancelled = false;
    void storageGet(WEALTH_CACHE_KEY).then((raw) => {
      if (cancelled || !raw) return;
      try {
        const cached = JSON.parse(raw) as { preferred?: string; wealth?: WealthSummary };
        if (cached?.wealth && cached.preferred === preferred) {
          setWealth((current) => current ?? cached.wealth ?? null);
        }
      } catch {
        /* ignore corrupt cache */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [preferred]);

  const upcomingBills = useMemo(() => {
    const today = new Date();
    const start = today.toISOString().slice(0, 10);
    const horizon = new Date(today.getTime() + 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const expected = bills
      .filter((b) => !b.paused)
      .map((b) => ({
        id: b.id,
        title:
          b.title ||
          (b.kind === 'income' ? t(user.locale, 'expenses.expectedIncome') : t(user.locale, 'expenses.expectedBill')),
        amount: b.amount,
        currency: b.currency_code,
        at: localDay(b.due_at),
        type: 'cashflow' as const,
        entry: billAsEntry(b),
        loanId: null as string | null,
      }));
    const dues = loans
      .filter(
        (l) =>
          l.your_role === 'borrower' &&
          ['active', 'overdue', 'repayment_pending'].includes(l.status) &&
          Boolean(l.due_at),
      )
      .map((l) => ({
        id: l.id,
        title: l.title || l.reference_code || t(user.locale, 'expenses.loanDue'),
        amount: String(loanRemaining(l)),
        currency: l.currency_code || preferred,
        at: (l.due_at || '').slice(0, 10),
        type: 'loan' as const,
        entry: null as CashflowEntry | null,
        loanId: l.id,
      }));
    return [...expected, ...dues]
      .filter((b) => b.at >= start && b.at <= horizon)
      .sort((a, b) => a.at.localeCompare(b.at))
      .slice(0, 12);
  }, [bills, loans, preferred, user.locale]);

  async function syncDrafts() {
    if (!drafts.length) return;
    setDraftBusy(true);
    try {
      for (const d of [...drafts]) {
        await api.createCashflow(token, {
          kind: d.kind,
          title: d.title,
          amount: d.amount,
          currency_code: d.currency_code,
          category_id: d.category_id,
          account_id: d.account_id,
          note: d.note,
          occurred_at: d.occurred_at,
          recurrence: d.recurrence === 'none' ? undefined : d.recurrence,
          is_template: d.is_template,
        });
        await removeCashflowDraft(d.id);
      }
      await reload();
    } catch (e) {
      onError(e instanceof Error ? e.message : t(user.locale, 'expenses.syncDraftsError'));
      setDrafts(await listCashflowDrafts());
    } finally {
      setDraftBusy(false);
    }
  }

  async function onBillAction(id: string, action: 'record' | 'skip' | 'postpone' | 'pause' | 'resume') {
    setBillBusy(`${id}:${action}`);
    try {
      if (action === 'record') await api.receiveCashflow(token, id);
      else if (action === 'skip') await api.skipCashflow(token, id);
      else if (action === 'postpone') await api.postponeCashflow(token, id, 7);
      else if (action === 'pause') await api.pauseCashflow(token, id);
      else await api.resumeCashflow(token, id);
      await reload();
    } catch (e) {
      onError(formatError(e, t(user.locale, 'expenses.billActionError')));
    } finally {
      setBillBusy(null);
    }
  }

  useEffect(() => {
    void reload();
  }, [reload, reloadToken]);

  useEffect(() => {
    void reloadWealth();
  }, [reloadWealth, wealthReloadToken]);

  const slice =
    summary?.by_currency?.find((s) => s.currency_code === preferred) ?? summary?.by_currency?.[0] ?? null;
  const currency = slice?.currency_code || preferred;
  const incomeTotal = Number(slice?.income ?? 0);
  const expenseTotal = Number(slice?.expense ?? slice?.outcome ?? 0);
  const wealthCurrency = (
    wealth?.by_currency?.find((c) => c.currency_code.toUpperCase() === preferred)?.currency_code ||
    wealth?.preferred_currency ||
    wealth?.by_currency?.find((c) => Number(c.cash_on_hand) !== 0)?.currency_code ||
    currency
  ).toUpperCase();
  const maxSpend = Math.max(
    1,
    ...breakdown.filter((b) => b.currency_code === currency).map((b) => Number(b.amount) || 0),
  );

  useEffect(() => {
    const sliceW =
      wealth?.by_currency?.find((c) => c.currency_code.toUpperCase() === wealthCurrency) ??
      wealth?.by_currency?.[0];
    const netRaw = sliceW?.net_worth ?? wealth?.live_net_worth ?? wealth?.net_worth ?? '';
    pushWidgetSnapshot({
      netWorth: netRaw ? formatMoney(String(netRaw), wealthCurrency, user.locale) : '—',
      spent: formatMoney(String(expenseTotal), currency, user.locale),
      currency: wealthCurrency || currency,
    });
  }, [wealth, wealthCurrency, expenseTotal, currency, user.locale, formatMoney]);

  const openLoans = useMemo(() => {
    const requireApproval = user.loan_require_approval !== false;
    return loans.filter((l) => {
      if (['active', 'overdue', 'repayment_pending'].includes(l.status)) return true;
      if (l.status !== 'pending') return false;
      // Pending: count on creator's side only when approval is off.
      if (requireApproval) return false;
      const me = user.id;
      if (l.proposed_by_user_id && l.proposed_by_user_id === me) return true;
      // Alone loans (no peer wait) — include
      if (l.borrower?.id === me && l.lender?.id === me) return true;
      return false;
    });
  }, [loans, user.id, user.loan_require_approval]);
  const loanIn = useMemo(
    () => openLoans.filter((l) => l.your_role === 'lender').reduce((s, l) => s + loanRemaining(l), 0),
    [openLoans],
  );
  const loanOut = useMemo(
    () => openLoans.filter((l) => l.your_role === 'borrower').reduce((s, l) => s + loanRemaining(l), 0),
    [openLoans],
  );
  const net = incomeTotal - expenseTotal + loanIn - loanOut;

  const list = tab === 'income' ? income : expenseRows;
  const templates = tab === 'income' ? incomeTemplates : expenseTemplates;

  // Templates with no occurrence this month still belong in the list (e.g. salary awaiting Received).
  // Recurring/templates pinned at top; then newest → oldest.
  const monthEntries = useMemo(() => {
    const covered = new Set(
      list.map((e) => e.template_id).filter((id): id is string => Boolean(id)),
    );
    const orphans = templates.filter((t) => !covered.has(t.id));
    const all = [...list, ...orphans];
    const recurring = (e: CashflowEntry) => Boolean(e.is_template || e.template_id || e.recurrence);
    return all.sort((a, b) => {
      const ar = recurring(a) ? 1 : 0;
      const br = recurring(b) ? 1 : 0;
      if (ar !== br) return br - ar;
      return b.occurred_at.localeCompare(a.occurred_at);
    });
  }, [list, templates]);

  const recent = useMemo(() => {
    const coveredIncome = new Set(
      income.map((e) => e.template_id).filter((id): id is string => Boolean(id)),
    );
    const coveredExpense = new Set(
      expenseRows.map((e) => e.template_id).filter((id): id is string => Boolean(id)),
    );
    const orphanIncome = incomeTemplates.filter((t) => !coveredIncome.has(t.id));
    const orphanExpense = expenseTemplates.filter((t) => !coveredExpense.has(t.id));
    const recurring = (e: CashflowEntry) => Boolean(e.is_template || e.template_id || e.recurrence);
    return [...income, ...expenseRows, ...orphanIncome, ...orphanExpense]
      .sort((a, b) => {
        const ar = recurring(a) ? 1 : 0;
        const br = recurring(b) ? 1 : 0;
        if (ar !== br) return br - ar;
        return b.occurred_at.localeCompare(a.occurred_at);
      })
      .slice(0, 16);
  }, [income, expenseRows, incomeTemplates, expenseTemplates]);

  const expenseCats = useMemo(() => {
    const names = new Set<string>();
    for (const e of expenseRows) names.add(e.category);
    for (const b of breakdown) names.add(b.category);
    return [...names].sort().map((name) => ({ id: name, label: name, keywords: name.toLowerCase() }));
  }, [expenseRows, breakdown]);

  async function onSaveBudget() {
    if (!budgetCategory.trim()) {
      onError(t(user.locale, 'expenses.pickCategory'));
      return;
    }
    const limit = stripAmount(budgetLimit);
    if (!limit || Number(limit) <= 0) {
      onError(t(user.locale, 'expenses.enterBudgetLimit'));
      return;
    }
    setBudgetBusy(true);
    try {
      await api.upsertBudget(token, {
        category_name: budgetCategory.trim(),
        currency_code: preferred,
        limit_amount: limit,
        period_month: period.from,
      });
      setBudgetLimit('');
      const res = await api.listBudgets(token, period.from);
      setBudgets(res.budgets ?? []);
    } catch (e) {
      onError(e instanceof Error ? e.message : t(user.locale, 'expenses.saveBudgetError'));
    } finally {
      setBudgetBusy(false);
    }
  }

  async function onSavePayday() {
    const dayRaw = paydayDay.trim();
    const day = dayRaw ? Number(dayRaw) : 0;
    if (dayRaw && (!Number.isInteger(day) || day < 1 || day > 28)) {
      onError(t(user.locale, 'expenses.paydayDayInvalid'));
      return;
    }
    const limit = stripAmount(paydayLimit);
    setBudgetBusy(true);
    try {
      const res = await api.upsertPayday(token, {
        payday_day: dayRaw ? day : 0,
        spend_limit: limit || undefined,
        currency_code: preferred,
        clear_limit: !limit,
      });
      setPayday(res.payday);
      const listed = await api.listBudgets(token, period.from);
      setBudgets(listed.budgets ?? []);
      setPayday(listed.payday ?? res.payday);
    } catch (e) {
      onError(e instanceof Error ? e.message : t(user.locale, 'expenses.saveBudgetError'));
    } finally {
      setBudgetBusy(false);
    }
  }

  async function onSaveTrip() {
    const title = tripTitle.trim();
    if (!title) {
      onError(t(user.locale, 'expenses.tripNeedTitle'));
      return;
    }
    if (!tripStarts || !tripEnds || tripEnds < tripStarts) {
      onError(t(user.locale, 'expenses.tripNeedDates'));
      return;
    }
    const limit = stripAmount(tripLimit);
    if (!limit || Number(limit) <= 0) {
      onError(t(user.locale, 'expenses.tripNeedLimit'));
      return;
    }
    setTripBusy(true);
    try {
      await api.createTrip(token, {
        title,
        currency_code: tripCurrency,
        limit_amount: limit,
        starts_on: tripStarts,
        ends_on: tripEnds,
      });
      setTripTitle('');
      setTripLimit('');
      const res = await api.listTrips(token);
      setTrips(res.trips ?? []);
    } catch (e) {
      onError(e instanceof Error ? e.message : t(user.locale, 'expenses.saveBudgetError'));
    } finally {
      setTripBusy(false);
    }
  }

  async function onDeleteTrip(id: string) {
    setTripBusy(true);
    try {
      await api.deleteTrip(token, id);
      setTrips((rows) => rows.filter((row) => row.id !== id));
    } catch (e) {
      onError(e instanceof Error ? e.message : t(user.locale, 'expenses.saveBudgetError'));
    } finally {
      setTripBusy(false);
    }
  }

  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>
          {t(user.locale, 'expenses.title')}
        </Text>
        <Pressable
          onPress={() => setCalendarOpen(true)}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: radii.md,
            backgroundColor: colors.primarySoft,
            borderWidth: 1,
            borderColor: colors.primary,
            alignItems: 'center',
            minWidth: 72,
          }}
        >
          <Text style={{ color: colors.primary, fontFamily: fonts.uiBold, fontSize: 16 }}>{period.day}</Text>
          <Text style={{ color: colors.primary, fontFamily: fonts.ui, fontSize: 11, opacity: 0.85 }}>{period.short}</Text>
        </Pressable>
      </View>

      <Modal visible={calendarOpen} transparent animationType="fade" onRequestClose={() => setCalendarOpen(false)}>
        <Pressable
          style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: 20 }}
          onPress={() => setCalendarOpen(false)}
        >
          <Pressable
            onPress={(e) => e.stopPropagation?.()}
            style={{
              backgroundColor: colors.surface,
              borderRadius: radii.lg,
              padding: 16,
              borderWidth: 1,
              borderColor: colors.border,
              gap: 8,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Pressable onPress={() => setSelectedDate(addCalendarMonths(selectedDate, calendarId, -1))}>
                <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 14 }}>‹</Text>
              </Pressable>
              <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 15 }}>{period.label}</Text>
              <Pressable onPress={() => setSelectedDate(addCalendarMonths(selectedDate, calendarId, 1))}>
                <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 14 }}>›</Text>
              </Pressable>
            </View>
            <HeatMonthGrid
              period={period}
              selectedIso={selectedIso}
              todayIso={toIsoLocal(new Date())}
              heatByDate={heatByDate}
              calendarId={calendarId}
              colors={colors}
              onPick={(d) => {
                setSelectedDate(d);
                setCalendarOpen(false);
              }}
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 11 }}>
                {t(user.locale, 'expenses.calendarLess')}
              </Text>
              {[1, 2, 3, 4].map((h) => (
                <View
                  key={h}
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 3,
                    backgroundColor: colors.primary,
                    opacity: heatOpacity(h),
                  }}
                />
              ))}
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 11 }}>
                {t(user.locale, 'expenses.calendarMore')}
              </Text>
            </View>
            <Pressable
              onPress={() => setCalendarOpen(false)}
              accessibilityLabel={t(user.locale, 'common.close')}
              style={{
                alignSelf: 'flex-end',
                width: 36,
                height: 36,
                borderRadius: 18,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.surfaceMuted,
                marginTop: 8,
              }}
            >
              <IconClose size={16} color={colors.text} />
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {([
          ['dashboard', 'expenses.tabDashboard'],
          ['calendar', 'expenses.tabCalendar'],
          ['income', 'expenses.tabIncome'],
          ['expenses', 'expenses.tabExpenses'],
          ['bills', 'expenses.tabBills'],
        ] as const).map(([id, key]) => {
          const active = tab === id;
          const label = t(user.locale, key);
          return (
            <Pressable
              key={id}
              onPress={() => onTab(id)}
              style={{
                flexGrow: 1,
                flexBasis: '18%',
                minHeight: 40,
                borderRadius: radii.full,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: active ? colors.primary : colors.surfaceMuted,
                borderWidth: 1,
                borderColor: active ? colors.primary : colors.border,
                paddingHorizontal: 6,
              }}
            >
              <Text style={{ color: active ? colors.onPrimary : colors.text, fontFamily: fonts.uiSemi, fontSize: 12 }}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loadError ? (
        <Card>
          <EmptyState
            title={t(user.locale, 'expenses.loadError')}
            body={
              loadError.includes('cashflow') || loadError.includes('404') || loadError.includes('pq:')
                ? t(user.locale, 'expenses.apiNotDeployed')
                : loadError
            }
          />
        </Card>
      ) : null}

      {tab === 'calendar' ? (
        <>
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Pressable onPress={() => setSelectedDate(addCalendarMonths(selectedDate, calendarId, -1))}>
                <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 18 }}>‹</Text>
              </Pressable>
              <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 15 }}>{period.label}</Text>
              <Pressable onPress={() => setSelectedDate(addCalendarMonths(selectedDate, calendarId, 1))}>
                <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 18 }}>›</Text>
              </Pressable>
            </View>
            <HeatMonthGrid
              period={period}
              selectedIso={selectedIso}
              todayIso={toIsoLocal(new Date())}
              heatByDate={heatByDate}
              calendarId={calendarId}
              colors={colors}
              onPick={setSelectedDate}
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 11 }}>
                {t(user.locale, 'expenses.calendarLess')}
              </Text>
              {[1, 2, 3, 4].map((h) => (
                <View
                  key={h}
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 3,
                    backgroundColor: colors.primary,
                    opacity: heatOpacity(h),
                  }}
                />
              ))}
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 11 }}>
                {t(user.locale, 'expenses.calendarMore')}
              </Text>
            </View>
          </Card>
          <Card>
            <SectionLabel>
              {selectedIso === toIsoLocal(new Date()) ? t(user.locale, 'common.today') : selectedIso}
            </SectionLabel>
            {heatByDate.get(selectedIso) ? (
              <View style={{ flexDirection: 'row', gap: 16, marginBottom: 8 }}>
                <Text style={{ color: colors.success, fontFamily: fonts.uiSemi, fontSize: 13 }}>
                  {t(user.locale, 'expenses.earnedThatDay')}{' '}
                  {formatMoney(String(heatByDate.get(selectedIso)!.income.toFixed(2)), preferred, user.locale)}
                </Text>
                <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 13 }}>
                  {t(user.locale, 'expenses.spentThatDay')}{' '}
                  {formatMoney(String(heatByDate.get(selectedIso)!.expense.toFixed(2)), preferred, user.locale)}
                </Text>
              </View>
            ) : null}
            {dayIncome.length === 0 && dayExpense.length === 0 ? (
              <EmptyState
                title={t(user.locale, 'expenses.emptyDay')}
                body={t(user.locale, 'expenses.emptyDayBody')}
              />
            ) : (
              [...dayIncome, ...dayExpense]
                .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
                .map((e) => (
                  <Pressable
                    key={e.id}
                    onPress={() => onOpenEntry(e)}
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      gap: 8,
                      paddingVertical: 10,
                      borderBottomWidth: 1,
                      borderBottomColor: colors.border,
                    }}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 14 }}>
                        {displayCashflowTitle(e, user.locale)}
                      </Text>
                      <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                        {cashflowActionLabel(e, user.locale)}
                        {e.category ? ` · ${e.category}` : ''}
                      </Text>
                    </View>
                    <Text
                      style={{
                        color: e.kind === 'income' ? colors.success : colors.text,
                        fontFamily: fonts.uiSemi,
                        fontSize: 14,
                      }}
                    >
                      {e.kind === 'income' ? '+' : '−'}
                      {formatMoney(e.amount, e.currency_code, user.locale)}
                    </Text>
                  </Pressable>
                ))
            )}
          </Card>
        </>
      ) : tab === 'dashboard' ? (
        <>
          <NetWorthCard
            token={token}
            wealth={wealth}
            currency={wealthCurrency}
            locale={user.locale}
            formatMoney={formatMoney}
            onOpenAccounts={onOpenAccounts}
          />

          <Card>
            <SectionLabel>
              {selectedIso === toIsoLocal(new Date()) ? t(user.locale, 'common.today') : selectedIso}
            </SectionLabel>
            {dayIncome.length === 0 && dayExpense.length === 0 ? (
              <EmptyState
                title={t(user.locale, 'expenses.emptyDay')}
                body={t(user.locale, 'expenses.emptyDayBody')}
              />
            ) : (
              [...dayIncome, ...dayExpense]
                .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
                .map((e) => (
                  <Pressable
                    key={e.id}
                    onPress={() => onOpenEntry(e)}
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      gap: 8,
                      paddingVertical: 10,
                      borderBottomWidth: 1,
                      borderBottomColor: colors.border,
                    }}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 14 }}>
                        {displayCashflowTitle(e, user.locale)}
                      </Text>
                      <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                        {cashflowActionLabel(e, user.locale)}
                        {e.category ? ` · ${e.category}` : ''}
                      </Text>
                    </View>
                    <Text
                      style={{
                        color: e.kind === 'income' ? colors.success : colors.text,
                        fontFamily: fonts.uiSemi,
                        fontSize: 14,
                      }}
                    >
                      {e.kind === 'income' ? '+' : '−'}
                      {formatMoney(e.amount, e.currency_code, user.locale)}
                    </Text>
                  </Pressable>
                ))
            )}
          </Card>

          {drafts.length > 0 ? (
            <Card>
              <SectionLabel>{t(user.locale, 'expenses.offlineDrafts').replace('{count}', String(drafts.length))}</SectionLabel>
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
                {t(user.locale, 'expenses.offlineDraftsBody')}
              </Text>
              {drafts.slice(0, 5).map((d) => (
                <Text key={d.id} style={{ color: colors.text, fontFamily: fonts.ui, fontSize: 13 }}>
                  {d.kind}: {d.title} · {d.amount} {d.currency_code}
                </Text>
              ))}
              <PrimaryButton
                label={draftBusy ? t(user.locale, 'common.syncing') : t(user.locale, 'expenses.syncDrafts')}
                onPress={() => void syncDrafts()}
                disabled={draftBusy}
              />
            </Card>
          ) : null}

          <Card>
            <SectionLabel>{t(user.locale, 'expenses.comingUp')}</SectionLabel>
            {upcomingBills.length === 0 ? (
              <EmptyState
                title={t(user.locale, 'expenses.noBillsTitle')}
                body={t(user.locale, 'expenses.noBillsBody')}
              />
            ) : (
              upcomingBills.map((b) => (
                <Pressable
                  key={`${b.type}-${b.id}`}
                  onPress={() => {
                    if (b.type === 'loan' && b.loanId) onOpenLoan(b.loanId);
                    else if (b.entry) onOpenEntry(b.entry);
                  }}
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    gap: 8,
                    paddingVertical: 10,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                  }}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 14 }}>{b.title}</Text>
                    <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                      {b.at} ·{' '}
                      {b.type === 'loan' ? t(user.locale, 'loans.loanFallback') : t(user.locale, 'expenses.actionExpected')}
                    </Text>
                  </View>
                  <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 14 }}>
                    {formatMoney(b.amount, b.currency, user.locale)}
                  </Text>
                </Pressable>
              ))
            )}
          </Card>

          <Card>
            <Text
              style={{ color: colors.muted, fontFamily: fonts.uiSemi, fontSize: 12, textTransform: 'uppercase' }}
            >
              {t(user.locale, 'common.thisMonth')}
            </Text>
            <Money
              value={formatMoney(net.toFixed(2), currency, user.locale)}
              size="lg"
              tone={net >= 0 ? 'positive' : 'negative'}
            />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              <Mini
                label={t(user.locale, 'cashflow.income')}
                value={formatMoney(String(incomeTotal), currency, user.locale)}
                tone="positive"
              />
              <Mini
                label={t(user.locale, 'expenses.tabExpenses')}
                value={formatMoney(String(expenseTotal), currency, user.locale)}
                tone="negative"
              />
              <Mini
                label={t(user.locale, 'wealth.owedToYou')}
                value={formatMoney(loanIn.toFixed(2), currency, user.locale)}
                tone="positive"
              />
              <Mini
                label={t(user.locale, 'wealth.youOwe')}
                value={formatMoney(loanOut.toFixed(2), currency, user.locale)}
                tone="negative"
              />
            </View>
          </Card>

          <Card>
            <SectionLabel>{t(user.locale, 'expenses.spendingByCategory')}</SectionLabel>
            {breakdown.filter((b) => b.currency_code === currency).length === 0 ? (
              <EmptyState title={t(user.locale, 'expenses.noExpenses')} body={t(user.locale, 'expenses.categoryBarsBody')} />
            ) : (
              breakdown
                .filter((b) => b.currency_code === currency)
                .slice(0, 8)
                .map((row) => {
                  const amt = Number(row.amount) || 0;
                  const pct = Math.max(4, Math.round((amt / maxSpend) * 100));
                  return (
                    <View key={`${row.category}-${row.currency_code}`} style={{ gap: 4, marginBottom: 10 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 13, flex: 1 }} numberOfLines={1}>
                          {row.category}
                        </Text>
                        <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                          {formatMoney(row.amount, row.currency_code, user.locale)}
                        </Text>
                      </View>
                      <View style={{ height: 8, borderRadius: radii.full, backgroundColor: colors.surfaceMuted }}>
                        <View
                          style={{
                            height: 8,
                            width: `${pct}%`,
                            borderRadius: radii.full,
                            backgroundColor: colors.warning,
                          }}
                        />
                      </View>
                    </View>
                  );
                })
            )}
          </Card>

          <Card>
            <SectionLabel>{t(user.locale, 'expenses.thisPayday')}</SectionLabel>
            {payday ? (
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12, marginBottom: 8 }}>
                {payday.cycle_start} – {payday.cycle_end}
                {payday.days_left >= 0
                  ? ` · ${t(user.locale, 'expenses.daysLeft').replace('{n}', String(payday.days_left))}`
                  : ''}
              </Text>
            ) : null}
            {payday?.limit_amount ? (
              <PaceBar
                label={t(user.locale, 'expenses.spendUntilPayday')}
                spent={payday.spent}
                limit={payday.limit_amount}
                currency={payday.currency_code || preferred}
                spentPct={payday.spent_pct ?? 0}
                pacePct={payday.pace_pct}
                ahead={payday.ahead}
                alert={payday.alert}
                locale={user.locale}
                formatMoney={formatMoney}
              />
            ) : null}
            {budgets.map((b) => (
              <PaceBar
                key={b.id}
                label={b.category_name}
                spent={b.spent}
                limit={b.limit_amount}
                currency={b.currency_code}
                spentPct={b.spent_pct ?? 0}
                pacePct={b.pace_pct ?? payday?.pace_pct ?? 0}
                ahead={Boolean(b.ahead)}
                locale={user.locale}
                formatMoney={formatMoney}
              />
            ))}
            {budgets.length === 0 && !payday?.limit_amount ? (
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13, marginBottom: 8 }}>
                {t(user.locale, 'expenses.budgetsHint')}
              </Text>
            ) : null}
            <Field
              label={t(user.locale, 'expenses.paydayDay')}
              value={paydayDay}
              onChange={setPaydayDay}
              keyboardType="number-pad"
              placeholder="1–28"
            />
            <Field
              label={t(user.locale, 'expenses.spendUntilPayday')}
              value={paydayLimit}
              onChange={setPaydayLimit}
              money
            />
            <PrimaryButton
              label={budgetBusy ? t(user.locale, 'common.saving') : t(user.locale, 'expenses.savePayday')}
              onPress={() => void onSavePayday()}
              disabled={budgetBusy}
            />
            <SearchSelect
              label={t(user.locale, 'common.category')}
              value={budgetCategory}
              onChange={setBudgetCategory}
              options={expenseCats}
              placeholder={t(user.locale, 'expenses.categoryPlaceholder')}
            />
            <Field label={t(user.locale, 'expenses.monthlyLimit')} value={budgetLimit} onChange={setBudgetLimit} money />
            <PrimaryButton
              label={budgetBusy ? t(user.locale, 'common.saving') : t(user.locale, 'expenses.saveBudget')}
              onPress={onSaveBudget}
              disabled={budgetBusy}
            />
          </Card>

          <Card>
            <SectionLabel>{t(user.locale, 'expenses.trips')}</SectionLabel>
            {trips.length === 0 ? (
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13, marginBottom: 8 }}>
                {t(user.locale, 'expenses.tripsHint')}
              </Text>
            ) : null}
            {trips.map((trip) => (
              <View key={trip.id} style={{ gap: 6, marginBottom: 10 }}>
                <PaceBar
                  label={trip.title}
                  spent={trip.spent}
                  limit={trip.limit_amount}
                  currency={trip.currency_code}
                  spentPct={trip.spent_pct}
                  pacePct={trip.pace_pct}
                  ahead={trip.ahead}
                  alert={trip.alert}
                  locale={user.locale}
                  formatMoney={formatMoney}
                />
                <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                  {trip.starts_on} – {trip.ends_on}
                  {trip.days_left >= 0 ? ` · ${t(user.locale, 'expenses.daysLeft').replace('{n}', String(trip.days_left))}` : ''}
                </Text>
                <SecondaryButton
                  label={t(user.locale, 'expenses.deleteTrip')}
                  onPress={() => void onDeleteTrip(trip.id)}
                  disabled={tripBusy}
                />
              </View>
            ))}
            <Field label={t(user.locale, 'expenses.tripTitle')} value={tripTitle} onChange={setTripTitle} />
            <DateField label={t(user.locale, 'expenses.tripStarts')} value={tripStarts} onChange={setTripStarts} />
            <DateField label={t(user.locale, 'expenses.tripEnds')} value={tripEnds} onChange={setTripEnds} />
            <SearchSelect label="Currency" value={tripCurrency} onChange={setTripCurrency} options={CURRENCIES} />
            <Field label={t(user.locale, 'expenses.tripLimit')} value={tripLimit} onChange={setTripLimit} money />
            <PrimaryButton
              label={tripBusy ? t(user.locale, 'common.saving') : t(user.locale, 'expenses.saveTrip')}
              onPress={() => void onSaveTrip()}
              disabled={tripBusy}
            />
          </Card>

          <Card>
            <SectionLabel>{t(user.locale, 'expenses.openLoans')}</SectionLabel>
            {openLoans.length === 0 ? (
              <EmptyState title={t(user.locale, 'expenses.noOpenLoansTitle')} body={t(user.locale, 'expenses.noOpenLoansBody')} />
            ) : (
              openLoans.map((loan) => (
                <Pressable
                  key={loan.id}
                  onPress={() => onOpenLoan(loan.id)}
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    paddingVertical: 10,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                    gap: 8,
                  }}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 14 }} numberOfLines={1}>
                      {loan.title || loan.institution_label || loan.reference_code}
                    </Text>
                    <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                      {loan.your_role === 'borrower' ? t(user.locale, 'wealth.youOwe') : t(user.locale, 'expenses.theyOwe')}
                    </Text>
                  </View>
                  <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 14 }}>
                    {formatMoney(loan.expected_total || loan.principal, loan.currency_code, user.locale)}
                  </Text>
                </Pressable>
              ))
            )}
          </Card>

          <Card>
            <SectionLabel>{t(user.locale, 'common.recent')}</SectionLabel>
            {recent.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  locale={user.locale}
                  formatMoney={formatMoney}
                  onPress={() => onOpenEntry(entry)}
                  recurring={Boolean(entry.is_template || entry.template_id || entry.recurrence)}
                />
              ))}
            {recent.length === 0 && !loadError ? (
              <EmptyState
                title={t(user.locale, 'expenses.quietMonth')}
                body={t(user.locale, 'expenses.quietMonthBody')}
              />
            ) : null}
          </Card>
        </>
      ) : null}

      {tab === 'bills' ? (
        <Card>
          <SectionLabel>{t(user.locale, 'expenses.tabBills')}</SectionLabel>
          {bills.length === 0 ? (
            <EmptyState
              title={t(user.locale, 'expenses.billsEmptyTitle')}
              body={t(user.locale, 'expenses.billsEmptyBody')}
            />
          ) : (
            bills.map((bill) => (
              <BillRow
                key={bill.id}
                bill={bill}
                locale={user.locale}
                formatMoney={formatMoney}
                busy={billBusy}
                onOpen={() => onOpenEntry(billAsEntry(bill))}
                onAction={(action) => void onBillAction(bill.id, action)}
              />
            ))
          )}
        </Card>
      ) : null}

      {tab === 'income' || tab === 'expenses' ? (
        <Card>
          <SectionLabel>
            {tab === 'income' ? t(user.locale, 'expenses.tabIncome') : t(user.locale, 'expenses.tabExpenses')}
          </SectionLabel>
          {monthEntries.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              locale={user.locale}
              formatMoney={formatMoney}
              onPress={() => onOpenEntry(entry)}
              recurring={Boolean(entry.is_template || entry.template_id || entry.recurrence)}
            />
          ))}
          {monthEntries.length === 0 && !loadError ? (
            <EmptyState
              title={
                tab === 'income' ? t(user.locale, 'expenses.noIncome') : t(user.locale, 'expenses.noExpenses')
              }
              body={t(user.locale, 'expenses.tapToAdd')}
            />
          ) : null}
        </Card>
      ) : null}
    </View>
  );
}

function PaceBar({
  label,
  spent,
  limit,
  currency,
  spentPct,
  pacePct,
  ahead,
  alert,
  locale,
  formatMoney,
}: {
  label: string;
  spent: string;
  limit: string;
  currency: string;
  spentPct: number;
  pacePct: number;
  ahead: boolean;
  alert?: string;
  locale?: string | null;
  formatMoney: (amount: string | null | undefined, currency: string | null | undefined, locale?: string) => string;
}) {
  const { colors } = useTheme();
  const over = spentPct >= 100;
  const warn = spentPct >= 80 || ahead;
  const fill = Math.min(100, Math.max(4, spentPct));
  const mark = Math.min(98, Math.max(2, pacePct));
  const paceLabel = over
    ? t(locale, 'expenses.budgetHit')
    : ahead
      ? t(locale, 'expenses.aheadOfPace')
      : t(locale, 'expenses.onPace');
  return (
    <View style={{ gap: 4, marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 13, flex: 1 }}>{label}</Text>
        <Text style={{ color: over ? colors.warning : colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
          {formatMoney(spent, currency, locale ?? undefined)} / {formatMoney(limit, currency, locale ?? undefined)}
        </Text>
      </View>
      <View style={{ height: 10, borderRadius: radii.full, backgroundColor: colors.surfaceMuted, overflow: 'visible' }}>
        <View
          style={{
            height: 10,
            width: `${fill}%`,
            borderRadius: radii.full,
            backgroundColor: over ? colors.warning : warn ? colors.warning : colors.primary,
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: `${mark}%`,
            top: -2,
            width: 2,
            height: 14,
            marginLeft: -1,
            backgroundColor: colors.text,
            opacity: 0.7,
            borderRadius: 1,
          }}
        />
      </View>
      <Text style={{ color: over || ahead ? colors.warning : colors.muted, fontFamily: fonts.ui, fontSize: 11 }}>
        {paceLabel}
        {alert === '80' ? ` · ${t(locale, 'expenses.budget80')}` : ''}
      </Text>
    </View>
  );
}

function Mini({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'positive' | 'negative';
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: '47%',
        flexGrow: 1,
        backgroundColor: colors.surfaceMuted,
        borderRadius: radii.md,
        padding: 12,
        gap: 6,
      }}
    >
      <Text style={{ color: colors.muted, fontFamily: fonts.uiMedium, fontSize: 12 }}>{label}</Text>
      <Money value={value} size="md" tone={tone} />
    </View>
  );
}

function BillChip({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={{
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: radii.full,
        backgroundColor: colors.surfaceMuted,
        borderWidth: 1,
        borderColor: colors.border,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}

function BillRow({
  bill,
  locale,
  formatMoney,
  busy,
  onOpen,
  onAction,
}: {
  bill: CashflowBill;
  locale?: string | null;
  formatMoney: (amount: string | null | undefined, currency: string | null | undefined, locale?: string) => string;
  busy: string | null;
  onOpen: () => void;
  onAction: (action: 'record' | 'skip' | 'postpone' | 'pause' | 'resume') => void;
}) {
  const { colors } = useTheme();
  const formatDate = useFormatDate();
  const dueLabel = formatDate(bill.due_at);
  const income = bill.kind === 'income';
  const locked = Boolean(busy);
  const statusLabel = bill.paused
    ? t(locale, 'expenses.billPaused')
    : bill.status === 'overdue'
      ? t(locale, 'expenses.billOverdue')
      : bill.status === 'expected'
        ? t(locale, 'expenses.actionExpected')
        : t(locale, 'expenses.billUpcoming');
  return (
    <View
      style={{
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        gap: 8,
      }}
    >
      <Pressable onPress={onOpen} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 14, flexShrink: 1 }} numberOfLines={1}>
              {bill.title || bill.category}
            </Text>
            {bill.recurrence ? <IconRepeat size={12} color={colors.muted} /> : null}
          </View>
          <Text style={{ color: bill.status === 'overdue' ? colors.warning : colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
            {statusLabel}
            {bill.category ? ` · ${bill.category}` : ''}
            {` · ${dueLabel}`}
            {bill.recurrence ? ` · ${bill.recurrence}` : ''}
          </Text>
        </View>
        <Text
          style={{
            color: income ? colors.success : colors.text,
            fontFamily: fonts.uiSemi,
            fontSize: 14,
          }}
        >
          {income ? '+' : '−'}
          {formatMoney(bill.amount, bill.currency_code, locale ?? undefined)}
        </Text>
      </Pressable>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {bill.paused ? (
          <BillChip
            label={t(locale, 'expenses.billResume')}
            disabled={locked}
            onPress={() => onAction('resume')}
          />
        ) : (
          <>
            <BillChip
              label={income ? t(locale, 'expenses.actionReceived') : t(locale, 'expenses.billRecord')}
              disabled={locked}
              onPress={() => onAction('record')}
            />
            <BillChip label={t(locale, 'expenses.billSkip')} disabled={locked} onPress={() => onAction('skip')} />
            <BillChip
              label={t(locale, 'expenses.billPostpone')}
              disabled={locked}
              onPress={() => onAction('postpone')}
            />
            {bill.recurrence || bill.is_template ? (
              <BillChip label={t(locale, 'expenses.billPause')} disabled={locked} onPress={() => onAction('pause')} />
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

function EntryRow({
  entry,
  locale,
  formatMoney,
  onPress,
  recurring,
}: {
  entry: CashflowEntry;
  locale?: string | null;
  formatMoney: (amount: string | null | undefined, currency: string | null | undefined, locale?: string) => string;
  onPress: () => void;
  recurring?: boolean;
}) {
  const { colors } = useTheme();
  const formatDate = useFormatDate();
  const { calendarId } = useDatePrefs();
  const income = entry.kind === 'income';
  const dateLabel = formatDate(entry.occurred_at);
  const parts = getCalendarParts(new Date(entry.occurred_at), calendarId);
  const dayNum = String(parts.day);
  const monthShort = formatCalendarMonthLabel(calendarId, parts.year, parts.month).split(' ')[0];
  const expected = entry.status === 'expected' || entry.is_template;
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 14, flexShrink: 1 }} numberOfLines={1}>
            {displayCashflowTitle(entry, locale)}
          </Text>
          {recurring || entry.is_template ? <IconRepeat size={12} color={colors.muted} /> : null}
        </View>
        <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }} numberOfLines={1}>
          {cashflowActionLabel(entry, locale)}
          {entry.category ? ` · ${entry.category}` : ''}
          {` · ${dateLabel}`}
        </Text>
      </View>
      <Text
        style={{
          color: expected ? colors.muted : income ? colors.success : colors.warning,
          fontFamily: fonts.uiSemi,
          fontSize: 14,
        }}
      >
        {income ? '+' : '−'}
        {formatMoney(entry.amount, entry.currency_code, locale ?? undefined)}
      </Text>
      <View
        style={{
          width: 48,
          paddingVertical: 6,
          borderRadius: radii.md,
          backgroundColor: colors.primarySoft,
          borderWidth: 1,
          borderColor: colors.primary,
          alignItems: 'center',
        }}
      >
        <Text style={{ color: colors.primary, fontFamily: fonts.uiBold, fontSize: 15 }}>{dayNum}</Text>
        <Text style={{ color: colors.primary, fontFamily: fonts.ui, fontSize: 10, opacity: 0.85 }} numberOfLines={1}>
          {monthShort}
        </Text>
      </View>
    </Pressable>
  );
}
