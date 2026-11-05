import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, Repeat, TrendingDown, TrendingUp, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { api, type Budget, type CashflowBill, type CashflowCalendar, type CashflowEntry, type CashflowSummary, type CategorySpend, type DeclinedShare, type Loan, type PaydayCycle, type TripBudget, type WealthSummary } from '../lib/api';
import { CURRENCIES } from '../lib/catalogs';
import { formatMoney, stripAmount } from '../lib/format';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Segmented } from '../components/Segmented';
import { EmptyState } from '../components/EmptyState';
import { Field, SelectField } from '../components/Field';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { CategoryIcon, Hero, HeroStat, Initials, SectionHead, hueFor } from '../components/Visuals';

type Tab = 'dashboard' | 'income' | 'expenses' | 'bills';

function heatOpacity(heat: number): number {
  return [0, 0.2, 0.4, 0.65, 1][Math.max(0, Math.min(heat, 4))] ?? 0;
}

function clientHeat(expense: number, max: number): number {
  if (expense <= 0 || max <= 0) return 0;
  const r = expense / max;
  if (r < 0.25) return 1;
  if (r < 0.5) return 2;
  if (r < 0.75) return 3;
  return 4;
}

function monthBounds(d: Date) {
  const from = new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1));
  const to = new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 1));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function plusDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function toIsoLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function loanRemaining(loan: Loan): number {
  return Number(loan.outstanding_amount || loan.expected_total || loan.principal || 0);
}

export function HomePage() {
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const { showError, show } = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>('dashboard');
  // Friends who turned down their share of one of your expenses.
  const [declined, setDeclined] = useState<DeclinedShare[]>([]);
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
  const [loans, setLoans] = useState<Loan[]>([]);
  const [budgetCategory, setBudgetCategory] = useState('');
  const [budgetLimit, setBudgetLimit] = useState('');
  const [budgetBusy, setBudgetBusy] = useState(false);
  const [paydayDay, setPaydayDay] = useState('');
  const [paydayLimit, setPaydayLimit] = useState('');
  const [trips, setTrips] = useState<TripBudget[]>([]);
  const [tripTitle, setTripTitle] = useState('');
  const [tripStarts, setTripStarts] = useState(() => toIsoLocal(new Date()));
  const [tripEnds, setTripEnds] = useState(() => plusDays(toIsoLocal(new Date()), 7));
  const [tripLimit, setTripLimit] = useState('');
  const [tripCurrency, setTripCurrency] = useState((user?.default_currency_code || 'USD').toUpperCase());
  const [tripBusy, setTripBusy] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [spendCalendar, setSpendCalendar] = useState<CashflowCalendar | null>(null);
  const [editBudgets, setEditBudgets] = useState(false);
  const [addTrip, setAddTrip] = useState(false);

  const period = useMemo(() => monthBounds(selectedDate), [selectedDate]);
  const selectedIso = useMemo(() => toIsoLocal(selectedDate), [selectedDate]);
  const preferred = (user?.default_currency_code || 'USD').toUpperCase();
  const locale = user?.locale || 'en';

  const dayIncome = useMemo(() => income.filter((e) => e.occurred_at.slice(0, 10) === selectedIso), [income, selectedIso]);
  const dayExpense = useMemo(() => expenseRows.filter((e) => e.occurred_at.slice(0, 10) === selectedIso), [expenseRows, selectedIso]);

  const heatByDate = useMemo(() => {
    const map = new Map<string, { heat: number; expense: number; income: number }>();
    if (spendCalendar?.days?.length) {
      for (const d of spendCalendar.days) {
        map.set(d.date, { heat: d.heat, expense: Number(d.expense) || 0, income: Number(d.income) || 0 });
      }
      return map;
    }
    const sums = new Map<string, { expense: number; income: number }>();
    for (const e of expenseRows) {
      if (e.currency_code && e.currency_code.toUpperCase() !== preferred) continue;
      const key = e.occurred_at.slice(0, 10);
      const cur = sums.get(key) || { expense: 0, income: 0 };
      cur.expense += Number(e.amount) || 0;
      sums.set(key, cur);
    }
    for (const e of income) {
      if (e.currency_code && e.currency_code.toUpperCase() !== preferred) continue;
      const key = e.occurred_at.slice(0, 10);
      const cur = sums.get(key) || { expense: 0, income: 0 };
      cur.income += Number(e.amount) || 0;
      sums.set(key, cur);
    }
    let max = 0;
    for (const v of sums.values()) if (v.expense > max) max = v.expense;
    for (const [key, v] of sums) map.set(key, { heat: clientHeat(v.expense, max), expense: v.expense, income: v.income });
    return map;
  }, [spendCalendar, expenseRows, income, preferred]);

  const reload = useCallback(async () => {
    if (!token) return;
    try {
      const [sum, inc, exp, incT, expT, wealthRes, breakRes, budgetRes, loanRes, billsRes, calRes, tripRes] = await Promise.all([
        api.cashflowSummary(token, { from: period.from, to: period.to }),
        api.listCashflow(token, { kind: 'income', from: period.from, to: period.to }),
        api.listCashflow(token, { kind: 'expense', from: period.from, to: period.to }),
        api.listCashflow(token, { kind: 'income', templates: true }),
        api.listCashflow(token, { kind: 'expense', templates: true }),
        api.wealth(token, preferred).catch(() => null),
        api.cashflowBreakdown(token, { kind: 'expense', from: period.from, to: period.to }).catch(() => ({ breakdown: [] })),
        api.listBudgets(token, period.from).catch(() => ({ budgets: [] as Budget[], payday: undefined as PaydayCycle | undefined })),
        api.listLoans(token).catch(() => ({ loans: [] })),
        api.listCashflowBills(token, 90).catch(() => ({ bills: [] })),
        api
          .cashflowCalendar(token, {
            from: period.from,
            to: period.to,
            currency: preferred,
            tz: user?.timezone || 'UTC',
          })
          .catch(() => ({ calendar: null as CashflowCalendar | null })),
        api.listTrips(token).catch(() => ({ trips: [] as TripBudget[] })),
      ]);
      setSummary(sum.summary);
      setIncome(inc.entries ?? []);
      setExpenseRows(exp.entries ?? []);
      setIncomeTemplates(incT.entries ?? []);
      setExpenseTemplates(expT.entries ?? []);
      setWealth(wealthRes?.wealth ?? null);
      setBreakdown(breakRes.breakdown ?? []);
      setBudgets(budgetRes.budgets ?? []);
      setPayday(budgetRes.payday ?? null);
      if (budgetRes.payday?.source === 'setting' && budgetRes.payday.payday_day) {
        setPaydayDay(String(budgetRes.payday.payday_day));
      }
      if (budgetRes.payday?.limit_amount) setPaydayLimit(budgetRes.payday.limit_amount);
      setLoans(loanRes.loans ?? []);
      setBills(billsRes.bills ?? []);
      setSpendCalendar(calRes.calendar ?? null);
      setTrips(tripRes.trips ?? []);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not load dashboard');
    }
  }, [token, period.from, period.to, preferred, showError, user?.timezone]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!token) return;
    api
      .declinedShares(token)
      .then((r) => setDeclined(r.declined_shares ?? []))
      .catch(() => setDeclined([]));
  }, [token]);

  async function onDeclined(share: DeclinedShare, action: 'ask_again' | 'keep_cost') {
    if (!token) return;
    try {
      await api.resolveDeclinedShare(token, share.loan_id, action);
      setDeclined((prev) => prev.filter((d) => d.loan_id !== share.loan_id));
      show(action === 'ask_again' ? `Asked ${share.friend.display_name} again` : 'Kept the full cost');
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not update the share');
    }
  }

  const slice = summary?.by_currency?.find((s) => s.currency_code === preferred) ?? summary?.by_currency?.[0] ?? null;
  const currency = slice?.currency_code || preferred;
  const incomeTotal = Number(slice?.income ?? 0);
  const expenseTotal = Number(slice?.expense ?? slice?.outcome ?? 0);
  const maxSpend = Math.max(1, ...breakdown.filter((b) => b.currency_code === currency).map((b) => Number(b.amount) || 0));

  const openLoans = useMemo(() => loans.filter((l) => ['active', 'overdue', 'repayment_pending', 'pending'].includes(l.status)), [loans]);

  const upcomingBills = useMemo(() => {
    const today = new Date();
    const start = today.toISOString().slice(0, 10);
    const horizon = new Date(today.getTime() + 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const expected = bills
      .filter((b) => !b.paused)
      .map((b) => ({
        id: b.id,
        title: b.title || (b.kind === 'income' ? 'Expected income' : 'Expected bill'),
        amount: b.amount,
        currency: b.currency_code,
        at: b.due_at.slice(0, 10),
        type: 'cashflow' as const,
        entryId: b.id as string | null,
        loanId: null as string | null,
      }));
    const dues = loans
      .filter((l) => l.your_role === 'borrower' && ['active', 'overdue', 'repayment_pending'].includes(l.status) && Boolean(l.due_at))
      .map((l) => ({
        id: l.id,
        title: l.title || l.reference_code || 'Loan due',
        amount: String(loanRemaining(l)),
        currency: l.currency_code || preferred,
        at: (l.due_at || '').slice(0, 10),
        type: 'loan' as const,
        entryId: null as string | null,
        loanId: l.id,
      }));
    return [...expected, ...dues].filter((b) => b.at >= start && b.at <= horizon).sort((a, b) => a.at.localeCompare(b.at)).slice(0, 8);
  }, [bills, loans, preferred]);

  const list = tab === 'income' ? income : expenseRows;
  const templates = tab === 'income' ? incomeTemplates : expenseTemplates;
  const monthEntries = useMemo(() => {
    const covered = new Set(list.map((e) => e.template_id).filter((id): id is string => Boolean(id)));
    const orphans = templates.filter((t) => !covered.has(t.id));
    return [...list, ...orphans].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  }, [list, templates]);

  const recent = useMemo(() => {
    const coveredIncome = new Set(income.map((e) => e.template_id).filter((id): id is string => Boolean(id)));
    const coveredExpense = new Set(expenseRows.map((e) => e.template_id).filter((id): id is string => Boolean(id)));
    const orphanIncome = incomeTemplates.filter((t) => !coveredIncome.has(t.id));
    const orphanExpense = expenseTemplates.filter((t) => !coveredExpense.has(t.id));
    return [...income, ...expenseRows, ...orphanIncome, ...orphanExpense].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, 14);
  }, [income, expenseRows, incomeTemplates, expenseTemplates]);

  const expenseCatOptions = useMemo(() => {
    const names = new Set<string>();
    for (const e of expenseRows) names.add(e.category);
    for (const b of breakdown) names.add(b.category);
    return [...names].sort().map((name) => ({ id: name, label: name }));
  }, [expenseRows, breakdown]);

  async function onSaveBudget() {
    if (!token) return;
    if (!budgetCategory.trim()) {
      showError('Pick a category');
      return;
    }
    const limit = stripAmount(budgetLimit);
    if (!limit || Number(limit) <= 0) {
      showError('Enter a budget limit');
      return;
    }
    setBudgetBusy(true);
    try {
      await api.upsertBudget(token, { category_name: budgetCategory.trim(), currency_code: preferred, limit_amount: limit, period_month: period.from });
      setBudgetLimit('');
      const res = await api.listBudgets(token, period.from);
      setBudgets(res.budgets ?? []);
      setPayday(res.payday ?? null);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not save budget');
    } finally {
      setBudgetBusy(false);
    }
  }

  async function onSavePayday() {
    if (!token) return;
    const dayRaw = paydayDay.trim();
    const day = dayRaw ? Number(dayRaw) : 0;
    if (dayRaw && (!Number.isInteger(day) || day < 1 || day > 28)) {
      showError('Payday must be a day from 1 to 28');
      return;
    }
    const limit = stripAmount(paydayLimit);
    setBudgetBusy(true);
    try {
      await api.upsertPayday(token, {
        payday_day: dayRaw ? day : 0,
        spend_limit: limit || undefined,
        currency_code: preferred,
        clear_limit: !limit,
      });
      const res = await api.listBudgets(token, period.from);
      setBudgets(res.budgets ?? []);
      setPayday(res.payday ?? null);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not save payday');
    } finally {
      setBudgetBusy(false);
    }
  }

  async function onSaveTrip(): Promise<boolean> {
    if (!token) return false;
    if (!tripTitle.trim()) {
      showError('Name the trip or event');
      return false;
    }
    if (!tripStarts || !tripEnds || tripEnds < tripStarts) {
      showError('Choose start and end dates');
      return false;
    }
    const limit = stripAmount(tripLimit);
    if (!limit || Number(limit) <= 0) {
      showError('Enter a spend limit');
      return false;
    }
    setTripBusy(true);
    try {
      await api.createTrip(token, {
        title: tripTitle.trim(),
        currency_code: tripCurrency,
        limit_amount: limit,
        starts_on: tripStarts,
        ends_on: tripEnds,
      });
      setTripTitle('');
      setTripLimit('');
      const res = await api.listTrips(token);
      setTrips(res.trips ?? []);
      return true;
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not save trip');
      return false;
    } finally {
      setTripBusy(false);
    }
  }

  async function onDeleteTrip(id: string) {
    if (!token) return;
    const trip = trips.find((t) => t.id === id);
    const ok = await confirm({
      title: `Remove ${trip?.title || 'this trip'}?`,
      body: 'Its spending limit goes away. Your expenses stay.',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    setTripBusy(true);
    try {
      await api.deleteTrip(token, id);
      setTrips((rows) => rows.filter((row) => row.id !== id));
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not remove trip');
    } finally {
      setTripBusy(false);
    }
  }

  function PaceBar({
    label,
    spent,
    limitAmt,
    currency,
    spentPct,
    pacePct,
    ahead,
  }: {
    label: string;
    spent: string;
    limitAmt: string;
    currency: string;
    spentPct: number;
    pacePct: number;
    ahead: boolean;
  }) {
    const over = spentPct >= 100;
    const warn = spentPct >= 80 || ahead;
    return (
      <div className="pace">
        <div className="pace-top">
          <span className="pace-label">{label}</span>
          <span className="pace-num">
            <strong>{formatMoney(spent, currency, locale)}</strong> / {formatMoney(limitAmt, currency, locale)}
          </span>
        </div>
        <div className="pace-track">
          <div className={`pace-fill ${over ? 'over' : warn ? 'warn' : ''}`} style={{ width: `${Math.min(100, Math.max(3, spentPct))}%` }} />
          <div className="pace-tick" style={{ left: `${Math.min(99, Math.max(1, pacePct))}%` }} title="Today's pace" />
        </div>
        <div className={`pace-note ${over || ahead ? 'warn' : ''}`}>{over ? 'Budget reached' : ahead ? 'Spending faster than planned' : 'On track'}</div>
      </div>
    );
  }

  async function onBillAction(id: string, action: 'record' | 'skip' | 'postpone' | 'pause' | 'resume') {
    if (!token) return;
    setBillBusy(`${id}:${action}`);
    try {
      if (action === 'record') await api.receiveCashflow(token, id);
      else if (action === 'skip') await api.skipCashflow(token, id);
      else if (action === 'postpone') await api.postponeCashflow(token, id, 7);
      else if (action === 'pause') await api.pauseCashflow(token, id);
      else await api.resumeCashflow(token, id);
      await reload();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not update this bill');
    } finally {
      setBillBusy(null);
    }
  }

  function EntryRow({ entry, showDate = true }: { entry: CashflowEntry; showDate?: boolean }) {
    const isIncome = entry.kind === 'income';
    const expected = entry.status === 'expected' || entry.is_template;
    const repeats = entry.is_template || entry.template_id || entry.recurrence;
    return (
      <button type="button" className="tx-row" onClick={() => navigate(`/cashflow/${entry.id}`)}>
        <CategoryIcon category={entry.category} kind={entry.kind} />
        <div className="tx-main">
          <div className="tx-title">
            {entry.title || entry.category}
            {repeats ? <Repeat size={12} className="tx-repeat" /> : null}
          </div>
          <div className="tx-sub">
            {entry.category}
            {expected ? (isIncome ? ' · Expected' : ' · Due') : ''}
            {showDate ? ` · ${new Date(entry.occurred_at).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}` : ''}
          </div>
        </div>
        <div className={`tx-amount ${expected ? 'muted' : isIncome ? 'in' : ''}`}>
          {isIncome ? '+' : '−'}
          {formatMoney(entry.amount, entry.currency_code, locale)}
        </div>
      </button>
    );
  }

  const todayIso = toIsoLocal(new Date());
  const yesterdayIso = plusDays(todayIso, -1);
  function dayHeading(isoDay: string): string {
    if (isoDay === todayIso) return 'Today';
    if (isoDay === yesterdayIso) return 'Yesterday';
    return new Date(`${isoDay}T12:00:00`).toLocaleDateString(locale, { weekday: 'long', month: 'short', day: 'numeric' });
  }
  function grouped(rows: CashflowEntry[]) {
    const out: { day: string; rows: CashflowEntry[] }[] = [];
    for (const r of rows) {
      const d = r.occurred_at.slice(0, 10);
      const last = out[out.length - 1];
      if (last && last.day === d) last.rows.push(r);
      else out.push({ day: d, rows: [r] });
    }
    return out;
  }

  // Calendar: move by whole months, keeping the day when the new month has it.
  function shiftMonth(delta: number) {
    setSelectedDate((d) => {
      const y = d.getFullYear();
      const m = d.getMonth() + delta;
      const last = new Date(y, m + 1, 0).getDate();
      return new Date(y, m, Math.min(d.getDate(), last), 12);
    });
  }
  function jumpTo(year: number, month: number) {
    setSelectedDate((d) => {
      const last = new Date(year, month + 1, 0).getDate();
      return new Date(year, month, Math.min(d.getDate(), last), 12);
    });
  }
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 8 }, (_, i) => thisYear - 5 + i);
  const monthNames = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleDateString(locale, { month: 'long' }));
  const weekdayNames = Array.from({ length: 7 }, (_, i) => new Date(2023, 0, 1 + i).toLocaleDateString(locale, { weekday: 'narrow' }));

  const firstName = (user?.first_name || user?.display_name || '').split(' ')[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const heroCurrency = wealth?.preferred_currency || currency;
  const spentShare = incomeTotal > 0 ? Math.min(100, Math.round((expenseTotal / incomeTotal) * 100)) : expenseTotal > 0 ? 100 : 0;
  const monthNet = incomeTotal - expenseTotal;
  const catRows = breakdown.filter((b) => b.currency_code === currency).slice(0, 6);
  const catTotal = catRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const selectedDay = heatByDate.get(selectedIso);
  const dayRows = [...dayIncome, ...dayExpense].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));

  return (
    <div className="page home">
      <div className="page-head">
        <div>
          <div className="eyebrow">{new Date().toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          <h1 className="page-title">
            {greeting}
            {firstName ? `, ${firstName}` : ''}
          </h1>
        </div>
        <div className="page-actions">
          <Button onClick={() => navigate('/cashflow/new?kind=income')} variant="secondary">
            <Plus size={15} /> Income
          </Button>
          <Button onClick={() => navigate('/cashflow/new?kind=expense')}>
            <Plus size={15} /> Expense
          </Button>
        </div>
      </div>

      {declined.map((d) => (
        <div key={d.loan_id} className="notice">
          <div className="notice-text">
            <strong>{d.friend.display_name}</strong> declined their {formatMoney(d.amount, d.currency_code, locale)} share
            {d.entry_title ? ` of “${d.entry_title}”` : ''}. You're covering the full cost for now.
          </div>
          <div className="notice-actions">
            <Button size="sm" onClick={() => onDeclined(d, 'ask_again')}>
              Ask again
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onDeclined(d, 'keep_cost')}>
              Keep the cost
            </Button>
          </div>
        </div>
      ))}

      <Hero
        label="Total balance"
        value={formatMoney(wealth?.net_worth ?? '0', heroCurrency, locale)}
        sub={
          wealth?.converted
            ? `All currencies at today's rate${wealth.missing_rates?.length ? ` · left out: ${wealth.missing_rates.join(', ')}` : ''}`
            : undefined
        }
        aside={
          <>
            <HeroStat label="Cash on hand" value={formatMoney(wealth?.cash_on_hand ?? '0', heroCurrency, locale)} />
            <HeroStat label="Owed to you" value={formatMoney(wealth?.receivables ?? '0', heroCurrency, locale)} tone="up" />
            <HeroStat label="You owe" value={formatMoney(wealth?.payables ?? '0', heroCurrency, locale)} tone="down" />
          </>
        }
      >
        <div className="hero-flow">
          <div className="hero-flow-row">
            <span>
              <TrendingUp size={14} /> In {formatMoney(incomeTotal.toFixed(2), currency, locale)}
            </span>
            <span>
              <TrendingDown size={14} /> Out {formatMoney(expenseTotal.toFixed(2), currency, locale)}
            </span>
            <span className={`hero-net ${monthNet >= 0 ? 'up' : 'down'}`}>
              {monthNet >= 0 ? '+' : '−'}
              {formatMoney(Math.abs(monthNet).toFixed(2), currency, locale)} this month
            </span>
          </div>
          <div className="hero-bar" title={`${spentShare}% of income spent`}>
            <div style={{ width: `${spentShare}%` }} />
          </div>
        </div>
      </Hero>

      <div className="tabs-row">
        <Segmented
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          options={[
            { id: 'dashboard', label: 'Dashboard' },
            { id: 'income', label: 'Income' },
            { id: 'expenses', label: 'Expenses' },
            { id: 'bills', label: 'Bills' },
          ]}
        />
      </div>

      {tab === 'dashboard' ? (
        <div className="grid grid-main-side">
          <div className="flex-col gap-lg">
            <Card>
              <SectionHead
                title="Spending"
                sub={selectedDate.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
                action={catRows.length ? <span className="section-total">{formatMoney(catTotal.toFixed(2), currency, locale)}</span> : undefined}
              />
              {catRows.length === 0 ? (
                <EmptyState title="No spending yet" body="Categories show up after you add an expense." />
              ) : (
                <>
                  <div className="stack-bar">
                    {catRows.map((r) => (
                      <div
                        key={r.category}
                        style={{ flex: Number(r.amount) || 0, background: hueFor(r.category) }}
                        title={`${r.category}: ${formatMoney(r.amount, r.currency_code, locale)}`}
                      />
                    ))}
                  </div>
                  <div className="cat-list">
                    {catRows.map((row) => {
                      const amt = Number(row.amount) || 0;
                      const pct = catTotal > 0 ? Math.round((amt / catTotal) * 100) : 0;
                      return (
                        <div key={row.category} className="cat-row">
                          <CategoryIcon category={row.category} kind="expense" size={34} />
                          <div className="cat-main">
                            <div className="cat-top">
                              <span>{row.category}</span>
                              <strong>{formatMoney(row.amount, row.currency_code, locale)}</strong>
                            </div>
                            <div className="cat-track">
                              <div style={{ width: `${Math.max(3, Math.round((amt / maxSpend) * 100))}%`, background: hueFor(row.category) }} />
                            </div>
                          </div>
                          <span className="cat-pct">{pct}%</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </Card>

            <Card>
              <SectionHead
                title="Recent activity"
                action={
                  <button className="link-btn" onClick={() => setTab('expenses')}>
                    See all
                  </button>
                }
              />
              {recent.length === 0 ? (
                <EmptyState title="Nothing yet this month" body="Add income or an expense to get started." />
              ) : (
                <div className="scroll-list">
                  {grouped(recent).map((g) => (
                    <div key={g.day} className="tx-group">
                      <div className="tx-day">{dayHeading(g.day)}</div>
                      {g.rows.map((entry) => (
                        <EntryRow key={entry.id} entry={entry} showDate={false} />
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <div className="grid grid-2 home-bottom">
            <Card>
              <SectionHead
                title="Budgets"
                sub={payday ? `${payday.days_left} days to payday` : undefined}
                action={
                  <button className="link-btn" onClick={() => setEditBudgets((v) => !v)}>
                    {editBudgets ? 'Done' : 'Edit'}
                  </button>
                }
              />
              {payday?.limit_amount ? (
                <PaceBar
                  label="Until payday"
                  spent={payday.spent}
                  limitAmt={payday.limit_amount}
                  currency={payday.currency_code || preferred}
                  spentPct={payday.spent_pct ?? 0}
                  pacePct={payday.pace_pct}
                  ahead={payday.ahead}
                />
              ) : null}
              {budgets.map((b) => (
                <PaceBar
                  key={b.id}
                  label={b.category_name}
                  spent={b.spent}
                  limitAmt={b.limit_amount}
                  currency={b.currency_code}
                  spentPct={b.spent_pct ?? 0}
                  pacePct={b.pace_pct ?? payday?.pace_pct ?? 0}
                  ahead={Boolean(b.ahead)}
                />
              ))}
              {budgets.length === 0 && !payday?.limit_amount && !editBudgets ? (
                <div className="quiet">
                  No budgets yet.{' '}
                  <button className="link-btn" onClick={() => setEditBudgets(true)}>
                    Set one
                  </button>
                </div>
              ) : null}
              {editBudgets ? (
                <div className="inline-form">
                  <div className="form-row">
                    <Field label="Payday" value={paydayDay} onChange={setPaydayDay} inputMode="numeric" placeholder="1–28" />
                    <Field label="Spend limit" value={paydayLimit} onChange={setPaydayLimit} money placeholder="0.00" />
                  </div>
                  <Button onClick={() => void onSavePayday()} busy={budgetBusy} block variant="secondary">
                    Save payday
                  </Button>
                  <div className="form-row">
                    <SelectField label="Category" value={budgetCategory} onChange={setBudgetCategory} options={expenseCatOptions} placeholder="Choose" />
                    <Field label="Limit" value={budgetLimit} onChange={setBudgetLimit} money placeholder="0.00" />
                  </div>
                  <Button onClick={onSaveBudget} busy={budgetBusy} block variant="secondary">
                    Save budget
                  </Button>
                </div>
              ) : null}
            </Card>
            <Card>
              <SectionHead
                title="Trips & events"
                action={
                  <button className="link-btn" onClick={() => setAddTrip((v) => !v)}>
                    {addTrip ? 'Cancel' : 'Add'}
                  </button>
                }
              />
              {trips.length === 0 && !addTrip ? <div className="quiet">Set a spending cap for a trip or event.</div> : null}
              {trips.map((trip) => (
                <div key={trip.id} className="trip">
                  <PaceBar
                    label={trip.title}
                    spent={trip.spent}
                    limitAmt={trip.limit_amount}
                    currency={trip.currency_code}
                    spentPct={trip.spent_pct}
                    pacePct={trip.pace_pct}
                    ahead={trip.ahead}
                  />
                  <div className="trip-foot">
                    <span>
                      {trip.starts_on} – {trip.ends_on}
                      {trip.days_left >= 0 ? ` · ${trip.days_left} days left` : ''}
                    </span>
                    <button className="icon-btn sm ghost" aria-label="Remove trip" title="Remove trip" disabled={tripBusy} onClick={() => void onDeleteTrip(trip.id)}>
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}
              {addTrip ? (
                <div className="inline-form">
                  <Field label="Name" value={tripTitle} onChange={setTripTitle} placeholder="Addis trip, wedding…" />
                  <div className="form-row">
                    <Field label="Starts" type="date" value={tripStarts} onChange={setTripStarts} />
                    <Field label="Ends" type="date" value={tripEnds} onChange={setTripEnds} />
                  </div>
                  <div className="form-row">
                    <SelectField label="Currency" value={tripCurrency} onChange={setTripCurrency} options={CURRENCIES} />
                    <Field label="Limit" value={tripLimit} onChange={setTripLimit} money placeholder="0.00" />
                  </div>
                  <Button onClick={() => void onSaveTrip().then((ok) => ok && setAddTrip(false))} busy={tripBusy} block>
                    Save trip
                  </Button>
                </div>
              ) : null}
            </Card>
            </div>
          </div>

          <div className="flex-col gap-lg">
            <Card>
              <div className="cal-head">
                <button type="button" className="icon-btn sm" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
                  <ChevronLeft size={16} />
                </button>
                <div className="cal-pickers">
                  <select aria-label="Month" value={selectedDate.getMonth()} onChange={(e) => jumpTo(selectedDate.getFullYear(), Number(e.target.value))}>
                    {monthNames.map((m, i) => (
                      <option key={m} value={i}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <select aria-label="Year" value={selectedDate.getFullYear()} onChange={(e) => jumpTo(Number(e.target.value), selectedDate.getMonth())}>
                    {years.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="button" className="icon-btn sm" aria-label="Next month" onClick={() => shiftMonth(1)}>
                  <ChevronRight size={16} />
                </button>
              </div>
              <div className="cal-grid">
                {weekdayNames.map((d, i) => (
                  <div key={`${d}-${i}`} className="cal-dow">
                    {d}
                  </div>
                ))}
                {Array.from({ length: new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1).getDay() }).map((_, i) => (
                  <div key={`pad-${i}`} />
                ))}
                {Array.from({ length: new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0).getDate() }, (_, i) => i + 1).map((dayNum) => {
                  const iso = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                  const active = selectedIso === iso;
                  const heat = heatByDate.get(iso)?.heat ?? 0;
                  return (
                    <button
                      key={iso}
                      type="button"
                      className={`cal-day ${active ? 'active' : ''} ${todayIso === iso ? 'today' : ''}`}
                      style={heat > 0 && !active ? { background: `color-mix(in srgb, var(--primary) ${Math.round(heatOpacity(heat) * 55)}%, transparent)` } : undefined}
                      onClick={() => setSelectedDate(new Date(`${iso}T12:00:00`))}
                    >
                      {dayNum}
                    </button>
                  );
                })}
              </div>
              <div className="cal-day-head">
                <strong>{selectedIso === todayIso ? 'Today' : dayHeading(selectedIso)}</strong>
                {selectedDay ? (
                  <span>
                    <em className="in">+{formatMoney(selectedDay.income.toFixed(2), preferred, locale)}</em>
                    <em>−{formatMoney(selectedDay.expense.toFixed(2), preferred, locale)}</em>
                  </span>
                ) : null}
              </div>
              {dayRows.length === 0 ? (
                <div className="quiet">Nothing recorded on this day.</div>
              ) : (
                dayRows.map((e) => <EntryRow key={e.id} entry={e} showDate={false} />)
              )}
            </Card>

            <Card>
              <SectionHead title="Coming up" sub="Next 45 days" />
              {upcomingBills.length === 0 ? (
                <div className="quiet">No bills or loan payments due.</div>
              ) : (
                upcomingBills.map((b) => {
                  const when = new Date(`${b.at}T12:00:00`);
                  return (
                    <button
                      key={`${b.type}-${b.id}`}
                      type="button"
                      className="tx-row"
                      onClick={() => (b.type === 'loan' && b.loanId ? navigate(`/loans/${b.loanId}`) : b.entryId && navigate(`/cashflow/${b.entryId}`))}
                    >
                      <span className="date-chip">
                        <small>{when.toLocaleDateString(locale, { month: 'short' })}</small>
                        <strong>{when.getDate()}</strong>
                      </span>
                      <div className="tx-main">
                        <div className="tx-title">{b.title}</div>
                        <div className="tx-sub">{b.type === 'loan' ? 'Loan payment' : 'Expected'}</div>
                      </div>
                      <div className="tx-amount">{formatMoney(b.amount, b.currency, locale)}</div>
                    </button>
                  );
                })
              )}
            </Card>

            <Card>
              <SectionHead
                title="Open loans"
                action={
                  <button className="link-btn" onClick={() => navigate('/loans')}>
                    All loans
                  </button>
                }
              />
              {openLoans.length === 0 ? (
                <div className="quiet">No open loans.</div>
              ) : (
                openLoans.slice(0, 5).map((loan) => {
                  const other = loan.your_role === 'borrower' ? loan.lender : loan.borrower;
                  const theyOwe = loan.your_role === 'lender';
                  return (
                    <button key={loan.id} type="button" className="tx-row" onClick={() => navigate(`/loans/${loan.id}`)}>
                      <Initials name={other?.display_name || loan.title || '?'} />
                      <div className="tx-main">
                        <div className="tx-title">{other?.display_name || loan.title || loan.reference_code}</div>
                        <div className={`tx-sub ${loan.status === 'overdue' ? 'warn' : ''}`}>
                          {loan.status === 'overdue' ? 'Overdue · ' : ''}
                          {theyOwe ? 'Owes you' : 'You owe'}
                        </div>
                      </div>
                      <div className={`tx-amount ${theyOwe ? 'in' : 'out'}`}>{formatMoney(loanRemaining(loan), loan.currency_code, locale)}</div>
                    </button>
                  );
                })
              )}
            </Card>


          </div>
        </div>
      ) : tab === 'bills' ? (
        <Card>
          <SectionHead title="Bills & subscriptions" sub="Repeating income and expenses" />
          {bills.length === 0 ? (
            <EmptyState title="No bills yet" body="Add a repeating income or expense and it will show here." />
          ) : (
            bills.map((bill) => {
              const locked = Boolean(billBusy);
              const status = bill.paused ? 'Paused' : bill.status === 'overdue' ? 'Overdue' : bill.status === 'expected' ? 'Expected' : 'Upcoming';
              return (
                <div key={bill.id} className="bill">
                  <button type="button" className="tx-row" onClick={() => navigate(`/cashflow/${bill.id}`)}>
                    <CategoryIcon category={bill.category || bill.title} kind={bill.kind} />
                    <div className="tx-main">
                      <div className="tx-title">
                        {bill.title || bill.category}
                        {bill.recurrence ? <Repeat size={12} className="tx-repeat" /> : null}
                      </div>
                      <div className={`tx-sub ${bill.status === 'overdue' ? 'warn' : ''}`}>
                        {status} · {new Date(bill.due_at).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}
                        {bill.recurrence ? ` · ${bill.recurrence}` : ''}
                      </div>
                    </div>
                    <div className={`tx-amount ${bill.kind === 'income' ? 'in' : ''}`}>{formatMoney(bill.amount, bill.currency_code, locale)}</div>
                  </button>
                  <div className="bill-actions">
                    {bill.paused ? (
                      <Button size="sm" variant="secondary" busy={locked} onClick={() => void onBillAction(bill.id, 'resume')}>
                        Resume
                      </Button>
                    ) : (
                      <>
                        <Button size="sm" busy={locked} onClick={() => void onBillAction(bill.id, 'record')}>
                          {bill.kind === 'income' ? 'Received' : 'Paid'}
                        </Button>
                        <Button size="sm" variant="secondary" busy={locked} onClick={() => void onBillAction(bill.id, 'skip')}>
                          Skip
                        </Button>
                        <Button size="sm" variant="secondary" busy={locked} onClick={() => void onBillAction(bill.id, 'postpone')}>
                          Postpone 7 days
                        </Button>
                        {bill.recurrence || bill.is_template ? (
                          <Button size="sm" variant="ghost" busy={locked} onClick={() => void onBillAction(bill.id, 'pause')}>
                            Pause
                          </Button>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </Card>
      ) : (
        <Card>
          <SectionHead
            title={tab === 'income' ? 'Income' : 'Expenses'}
            sub={`${selectedDate.toLocaleDateString(locale, { month: 'long', year: 'numeric' })} · ${formatMoney((tab === 'income' ? incomeTotal : expenseTotal).toFixed(2), currency, locale)}`}
            action={
              <Button size="sm" onClick={() => navigate(`/cashflow/new?kind=${tab === 'income' ? 'income' : 'expense'}`)}>
                <Plus size={14} /> Add
              </Button>
            }
          />
          {monthEntries.length === 0 ? (
            <EmptyState title={tab === 'income' ? 'No income yet' : 'No expenses yet'} body="Tap Add to record one." />
          ) : (
            grouped(monthEntries).map((g) => (
              <div key={g.day} className="tx-group">
                <div className="tx-day">{dayHeading(g.day)}</div>
                {g.rows.map((entry) => (
                  <EntryRow key={entry.id} entry={entry} showDate={false} />
                ))}
              </div>
            ))
          )}
        </Card>
      )}
    </div>
  );
}
