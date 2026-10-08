import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import {
  api,
  type Budget,
  type CashflowEntry,
  type CashflowSummary,
  type CategorySpend,
  type Friendship,
  type Loan,
  type User,
  type WealthSummary,
} from './api';
import { formatError } from './errors';
import { stripAmount } from './amountFormat';
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
import { fonts, radii, space, useTheme } from './theme';
import { t } from './i18n';
import { Card, EmptyState, Field, Money, PrimaryButton, SecondaryButton, SectionLabel } from './ui';
import { storageGet, storageSet } from './secureStorage';

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

export type ExpensesTab = 'dashboard' | 'income' | 'expenses';

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
  const [breakdown, setBreakdown] = useState<CategorySpend[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [budgetCategory, setBudgetCategory] = useState('');
  const [budgetLimit, setBudgetLimit] = useState('');
  const [budgetBusy, setBudgetBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<CashflowDraft[]>([]);
  const [draftBusy, setDraftBusy] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [calendarOpen, setCalendarOpen] = useState(false);

  const period = useMemo(() => monthBounds(selectedDate, calendarId), [selectedDate, calendarId]);
  const selectedIso = useMemo(() => toIsoLocal(selectedDate), [selectedDate]);
  const preferred = (user.default_currency_code || 'USD').toUpperCase();

  const dayIncome = useMemo(
    () => income.filter((e) => e.occurred_at.slice(0, 10) === selectedIso),
    [income, selectedIso],
  );
  const dayExpense = useMemo(
    () => expenseRows.filter((e) => e.occurred_at.slice(0, 10) === selectedIso),
    [expenseRows, selectedIso],
  );

  const reload = useCallback(async () => {
    try {
      setLoadError(null);
      const [sum, inc, exp, incT, expT, breakRes, budgetRes] = await Promise.all([
        api.cashflowSummary(token, { from: period.from, to: period.to }),
        api.listCashflow(token, { kind: 'income', from: period.from, to: period.to }),
        api.listCashflow(token, { kind: 'expense', from: period.from, to: period.to }),
        api.listCashflow(token, { kind: 'income', templates: true }),
        api.listCashflow(token, { kind: 'expense', templates: true }),
        api.cashflowBreakdown(token, { kind: 'expense', from: period.from, to: period.to }).catch(() => ({ breakdown: [] })),
        api.listBudgets(token, period.from).catch(() => ({ budgets: [] })),
      ]);
      setSummary(sum.summary);
      setIncome(inc.entries ?? []);
      setExpenseRows(exp.entries ?? []);
      setIncomeTemplates(incT.entries ?? []);
      setExpenseTemplates(expT.entries ?? []);
      setBreakdown(breakRes.breakdown ?? []);
      setBudgets(budgetRes.budgets ?? []);
      setDrafts(await listCashflowDrafts());
    } catch (e) {
      const message = formatError(e, t(user.locale, 'expenses.loadErrorFallback'));
      setLoadError(message);
      onError(message);
      setDrafts(await listCashflowDrafts());
    }
  }, [token, period.from, period.to, onError, user.locale]);

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
    const expected = [...income, ...expenseRows]
      .filter((e) => e.status === 'expected' && !e.is_template)
      .map((e) => ({
        id: e.id,
        title:
          e.title ||
          (e.kind === 'income' ? t(user.locale, 'expenses.expectedIncome') : t(user.locale, 'expenses.expectedBill')),
        amount: e.amount,
        currency: e.currency_code,
        at: e.occurred_at.slice(0, 10),
        type: 'cashflow' as const,
        entry: e,
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
  }, [income, expenseRows, loans, preferred, user.locale]);

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
                <View key={`pad-${i}`} style={{ width: `${100 / 7}%`, height: 36 }} />
              ))}
              {Array.from({ length: period.dim }, (_, i) => i + 1).map((dayNum) => {
                const dayDate = dateFromCalendarParts(calendarId, period.calYear, period.calMonth, dayNum);
                const iso = dayDate ? toIsoLocal(dayDate) : '';
                const active = selectedIso === iso;
                const has =
                  !!iso &&
                  (income.some((e) => e.occurred_at.slice(0, 10) === iso) ||
                    expenseRows.some((e) => e.occurred_at.slice(0, 10) === iso));
                return (
                  <Pressable
                    key={iso || `d-${dayNum}`}
                    onPress={() => {
                      if (dayDate) {
                        setSelectedDate(dayDate);
                        setCalendarOpen(false);
                      }
                    }}
                    style={{
                      width: `${100 / 7}%`,
                      height: 36,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <View
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 16,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: active ? colors.primary : 'transparent',
                      }}
                    >
                      <Text
                        style={{
                          color: active ? colors.onPrimary : colors.text,
                          fontFamily: fonts.uiSemi,
                          fontSize: 13,
                        }}
                      >
                        {dayNum}
                      </Text>
                    </View>
                    {has && !active ? (
                      <View
                        style={{
                          position: 'absolute',
                          bottom: 2,
                          width: 4,
                          height: 4,
                          borderRadius: 2,
                          backgroundColor: colors.primary,
                        }}
                      />
                    ) : null}
                  </Pressable>
                );
              })}
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

      <View style={{ flexDirection: 'row', gap: 8 }}>
        {([
          ['dashboard', 'expenses.tabDashboard'],
          ['income', 'expenses.tabIncome'],
          ['expenses', 'expenses.tabExpenses'],
        ] as const).map(([id, key]) => {
          const active = tab === id;
          const label = t(user.locale, key);
          return (
            <Pressable
              key={id}
              onPress={() => onTab(id)}
              style={{
                flex: 1,
                minHeight: 40,
                borderRadius: radii.full,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: active ? colors.primary : colors.surfaceMuted,
                borderWidth: 1,
                borderColor: active ? colors.primary : colors.border,
              }}
            >
              <Text style={{ color: active ? colors.onPrimary : colors.text, fontFamily: fonts.uiSemi, fontSize: 13 }}>
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

      {tab === 'dashboard' ? (
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
                .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
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
            <SectionLabel>{t(user.locale, 'expenses.budgetsThisMonth')}</SectionLabel>
            {budgets.length === 0 ? (
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13, marginBottom: 8 }}>
                {t(user.locale, 'expenses.budgetsHint')}
              </Text>
            ) : (
              budgets.map((b) => {
                const limit = Number(b.limit_amount) || 1;
                const spent = Number(b.spent) || 0;
                const pct = Math.min(100, Math.round((spent / limit) * 100));
                const over = spent > limit;
                return (
                  <View key={b.id} style={{ gap: 4, marginBottom: 12 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                      <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 13, flex: 1 }}>
                        {b.category_name}
                      </Text>
                      <Text style={{ color: over ? colors.warning : colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                        {formatMoney(b.spent, b.currency_code, user.locale)} /{' '}
                        {formatMoney(b.limit_amount, b.currency_code, user.locale)}
                      </Text>
                    </View>
                    <View style={{ height: 8, borderRadius: radii.full, backgroundColor: colors.surfaceMuted }}>
                      <View
                        style={{
                          height: 8,
                          width: `${Math.max(4, pct)}%`,
                          borderRadius: radii.full,
                          backgroundColor: over ? colors.warning : colors.primary,
                        }}
                      />
                    </View>
                  </View>
                );
              })
            )}
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
