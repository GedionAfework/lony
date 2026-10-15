import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Repeat } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { api, type Budget, type CashflowBill, type CashflowCalendar, type CashflowEntry, type CashflowSummary, type CategorySpend, type Loan, type PaydayCycle, type TripBudget, type WealthSummary } from '../lib/api';
import { CURRENCIES } from '../lib/catalogs';
import { formatMoney, stripAmount } from '../lib/format';
import { Card } from '../components/Card';
import { Money } from '../components/Money';
import { Button } from '../components/Button';
import { Segmented } from '../components/Segmented';
import { EmptyState } from '../components/EmptyState';
import { Field, SelectField } from '../components/Field';
import { useToast } from '../components/Toast';

type Tab = 'dashboard' | 'calendar' | 'income' | 'expenses' | 'bills';

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
  return Number(loan.expected_total || loan.principal || 0);
}

export function HomePage() {
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const { showError } = useToast();
  const [tab, setTab] = useState<Tab>('dashboard');
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

  const slice = summary?.by_currency?.find((s) => s.currency_code === preferred) ?? summary?.by_currency?.[0] ?? null;
  const currency = slice?.currency_code || preferred;
  const incomeTotal = Number(slice?.income ?? 0);
  const expenseTotal = Number(slice?.expense ?? slice?.outcome ?? 0);
  const maxSpend = Math.max(1, ...breakdown.filter((b) => b.currency_code === currency).map((b) => Number(b.amount) || 0));

  const openLoans = useMemo(() => loans.filter((l) => ['active', 'overdue', 'repayment_pending', 'pending'].includes(l.status)), [loans]);
  const loanIn = useMemo(() => openLoans.filter((l) => l.your_role === 'lender').reduce((s, l) => s + loanRemaining(l), 0), [openLoans]);
  const loanOut = useMemo(() => openLoans.filter((l) => l.your_role === 'borrower').reduce((s, l) => s + loanRemaining(l), 0), [openLoans]);
  const net = incomeTotal - expenseTotal + loanIn - loanOut;

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

  async function onSaveTrip() {
    if (!token) return;
    if (!tripTitle.trim()) {
      showError('Name the trip or event');
      return;
    }
    if (!tripStarts || !tripEnds || tripEnds < tripStarts) {
      showError('Choose start and end dates');
      return;
    }
    const limit = stripAmount(tripLimit);
    if (!limit || Number(limit) <= 0) {
      showError('Enter a spend limit');
      return;
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
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not save trip');
    } finally {
      setTripBusy(false);
    }
  }

  async function onDeleteTrip(id: string) {
    if (!token) return;
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

  function WebPaceBar({
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
      <div className="flex-col" style={{ gap: 4 }}>
        <div className="card-row">
          <span style={{ fontWeight: 700, fontSize: 13 }}>{label}</span>
          <span className="muted" style={{ fontSize: 12, color: over ? 'var(--warning)' : undefined }}>
            {formatMoney(spent, currency, locale)} / {formatMoney(limitAmt, currency, locale)}
          </span>
        </div>
        <div className="bar-track" style={{ position: 'relative', overflow: 'visible' }}>
          <div
            className="bar-fill"
            style={{
              width: `${Math.min(100, Math.max(4, spentPct))}%`,
              background: over || warn ? 'var(--warning)' : 'var(--primary)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: `${Math.min(98, Math.max(2, pacePct))}%`,
              top: -2,
              width: 2,
              height: 14,
              marginLeft: -1,
              background: 'var(--text)',
              opacity: 0.7,
              borderRadius: 1,
            }}
          />
        </div>
        <div className="muted" style={{ fontSize: 11, color: over || ahead ? 'var(--warning)' : undefined }}>
          {over ? 'Budget reached' : ahead ? 'Ahead of pace' : 'On pace'}
        </div>
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

  function EntryRow({ entry }: { entry: CashflowEntry }) {
    const isIncome = entry.kind === 'income';
    const expected = entry.status === 'expected' || entry.is_template;
    return (
      <div className="list-row clickable-row" onClick={() => navigate(`/cashflow/${entry.id}`)}>
        <div className="main">
          <div className="title flex-row" style={{ gap: 6 }}>
            {entry.title || entry.category}
            {entry.is_template || entry.template_id || entry.recurrence ? <Repeat size={11} /> : null}
          </div>
          <div className="sub">
            {entry.category}
            {expected ? (isIncome ? ' · Expected' : ' · Due') : ''} · {new Date(entry.occurred_at).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}
          </div>
        </div>
        <Money
          value={`${isIncome ? '+' : '−'}${formatMoney(entry.amount, entry.currency_code, locale)}`}
          raw
          tone={expected ? 'muted' : isIncome ? 'positive' : undefined}
          size="sm"
        />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="flex-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page-title">Home</h1>
          <div className="page-subtitle">{selectedDate.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</div>
        </div>
        <div className="flex-row">
          <input
            type="date"
            value={selectedIso}
            onChange={(e) => e.target.value && setSelectedDate(new Date(`${e.target.value}T12:00:00`))}
            style={{ height: 40, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-muted)', color: 'var(--text)', padding: '0 12px' }}
          />
          <Button onClick={() => navigate('/cashflow/new?kind=income')} variant="secondary">
            <Plus size={15} /> Income
          </Button>
          <Button onClick={() => navigate('/cashflow/new?kind=expense')}>
            <Plus size={15} /> Expense
          </Button>
        </div>
      </div>

      <Segmented
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        options={[
          { id: 'dashboard', label: 'Dashboard' },
          { id: 'calendar', label: 'Calendar' },
          { id: 'income', label: 'Income' },
          { id: 'expenses', label: 'Expenses' },
          { id: 'bills', label: 'Bills' },
        ]}
      />

      {tab === 'calendar' ? (
        <div className="flex-col">
          <Card>
            <div className="card-row">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, Math.min(selectedDate.getDate(), 28)))}
              >
                ‹
              </Button>
              <div className="section-label" style={{ margin: 0 }}>
                {selectedDate.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, Math.min(selectedDate.getDate(), 28)))}
              >
                ›
              </Button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, marginTop: 12 }}>
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                <div key={`${d}-${i}`} className="muted" style={{ textAlign: 'center', fontSize: 11, fontWeight: 600 }}>
                  {d}
                </div>
              ))}
              {Array.from({ length: new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1).getDay() }).map((_, i) => (
                <div key={`pad-${i}`} />
              ))}
              {Array.from({ length: new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0).getDate() }, (_, i) => i + 1).map((dayNum) => {
                const iso = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                const active = selectedIso === iso;
                const today = toIsoLocal(new Date()) === iso;
                const heat = heatByDate.get(iso)?.heat ?? 0;
                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => setSelectedDate(new Date(`${iso}T12:00:00`))}
                    style={{
                      height: 40,
                      borderRadius: 8,
                      border: active ? '2px solid var(--primary)' : today ? '1px solid var(--primary)' : '1px solid var(--border)',
                      background: active ? 'var(--primary)' : heat > 0 ? `color-mix(in srgb, var(--primary) ${Math.round(heatOpacity(heat) * 100)}%, transparent)` : 'var(--surface-muted)',
                      color: active || heat >= 3 ? 'var(--on-primary, #fff)' : 'var(--text)',
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    {dayNum}
                  </button>
                );
              })}
            </div>
            <div className="flex-row" style={{ gap: 6, marginTop: 12, alignItems: 'center' }}>
              <span className="muted" style={{ fontSize: 11 }}>Less</span>
              {[1, 2, 3, 4].map((h) => (
                <span
                  key={h}
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 3,
                    background: `color-mix(in srgb, var(--primary) ${Math.round(heatOpacity(h) * 100)}%, transparent)`,
                  }}
                />
              ))}
              <span className="muted" style={{ fontSize: 11 }}>More</span>
            </div>
          </Card>
          <Card>
            <div className="section-label">{selectedIso === toIsoLocal(new Date()) ? 'Today' : selectedIso}</div>
            {heatByDate.get(selectedIso) ? (
              <div className="flex-row" style={{ gap: 16, marginBottom: 8 }}>
                <span className="muted" style={{ fontSize: 13 }}>
                  In <Money value={heatByDate.get(selectedIso)!.income.toFixed(2)} currency={preferred} size="sm" tone="positive" locale={locale} />
                </span>
                <span className="muted" style={{ fontSize: 13 }}>
                  Spent <Money value={heatByDate.get(selectedIso)!.expense.toFixed(2)} currency={preferred} size="sm" locale={locale} />
                </span>
              </div>
            ) : null}
            {dayIncome.length === 0 && dayExpense.length === 0 ? (
              <EmptyState title="Quiet day" body="No income or expenses on this date." />
            ) : (
              [...dayIncome, ...dayExpense]
                .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
                .map((entry) => <EntryRow key={entry.id} entry={entry} />)
            )}
          </Card>
        </div>
      ) : tab === 'dashboard' ? (
        <div className="grid grid-main-side">
          <div className="flex-col">
            <Card>
              <div className="card-row">
                <div className="section-label">Net worth</div>
                <button className="link-btn" onClick={() => navigate('/accounts')}>
                  Accounts
                </button>
              </div>
              <Money value={wealth?.net_worth ?? '0'} currency={wealth?.preferred_currency || currency} size="xl" tone={Number(wealth?.net_worth || 0) >= 0 ? 'positive' : 'negative'} locale={locale} />
              <div className="grid grid-3">
                <div className="stat-card">
                  <div className="label">Cash on hand</div>
                  <Money value={wealth?.cash_on_hand ?? '0'} currency={wealth?.preferred_currency || currency} tone="positive" locale={locale} />
                </div>
                <div className="stat-card">
                  <div className="label">Owed to you</div>
                  <Money value={wealth?.receivables ?? '0'} currency={wealth?.preferred_currency || currency} tone="positive" locale={locale} />
                </div>
                <div className="stat-card">
                  <div className="label">You owe</div>
                  <Money value={wealth?.payables ?? '0'} currency={wealth?.preferred_currency || currency} tone="negative" locale={locale} />
                </div>
              </div>
            </Card>

            <Card>
              <div className="section-label">This month</div>
              <Money value={net.toFixed(2)} currency={currency} size="lg" tone={net >= 0 ? 'positive' : 'negative'} locale={locale} />
              <div className="grid grid-4">
                <div className="stat-card">
                  <div className="label">Income</div>
                  <Money value={incomeTotal.toFixed(2)} currency={currency} tone="positive" locale={locale} />
                </div>
                <div className="stat-card">
                  <div className="label">Expenses</div>
                  <Money value={expenseTotal.toFixed(2)} currency={currency} tone="negative" locale={locale} />
                </div>
                <div className="stat-card">
                  <div className="label">Owed to you</div>
                  <Money value={loanIn.toFixed(2)} currency={currency} tone="positive" locale={locale} />
                </div>
                <div className="stat-card">
                  <div className="label">You owe</div>
                  <Money value={loanOut.toFixed(2)} currency={currency} tone="negative" locale={locale} />
                </div>
              </div>
            </Card>

            <Card>
              <div className="section-label">Spending by category</div>
              {breakdown.filter((b) => b.currency_code === currency).length === 0 ? (
                <EmptyState title="No expenses yet" body="Category bars appear after you log spends." />
              ) : (
                breakdown
                  .filter((b) => b.currency_code === currency)
                  .slice(0, 8)
                  .map((row) => {
                    const amt = Number(row.amount) || 0;
                    const pct = Math.max(4, Math.round((amt / maxSpend) * 100));
                    return (
                      <div key={`${row.category}-${row.currency_code}`} className="flex-col" style={{ gap: 4 }}>
                        <div className="card-row">
                          <span style={{ fontWeight: 700, fontSize: 13 }}>{row.category}</span>
                          <Money value={row.amount} currency={row.currency_code} size="sm" locale={locale} />
                        </div>
                        <div className="bar-track">
                          <div className="bar-fill" style={{ width: `${pct}%`, background: 'var(--warning)' }} />
                        </div>
                      </div>
                    );
                  })
              )}
            </Card>

            <Card>
              <div className="section-label">Recent</div>
              {recent.length === 0 ? (
                <EmptyState title="Quiet month" body="Use the buttons above to add income or an expense." />
              ) : (
                recent.map((entry) => <EntryRow key={entry.id} entry={entry} />)
              )}
            </Card>
          </div>

          <div className="flex-col">
            <Card>
              <div className="section-label">{selectedIso === toIsoLocal(new Date()) ? 'Today' : selectedIso}</div>
              {dayIncome.length === 0 && dayExpense.length === 0 ? (
                <EmptyState title="Nothing this day" body="Income and expenses for the selected day show here." />
              ) : (
                [...dayIncome, ...dayExpense]
                  .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
                  .map((e) => <EntryRow key={e.id} entry={e} />)
              )}
            </Card>

            <Card>
              <div className="section-label">Coming up</div>
              {upcomingBills.length === 0 ? (
                <EmptyState title="Nothing in 45 days" body="Expected cashflow and loan dues show here." />
              ) : (
                upcomingBills.map((b) => (
                  <div
                    key={`${b.type}-${b.id}`}
                    className="list-row clickable-row"
                    onClick={() => (b.type === 'loan' && b.loanId ? navigate(`/loans/${b.loanId}`) : b.entryId && navigate(`/cashflow/${b.entryId}`))}
                  >
                    <div className="main">
                      <div className="title">{b.title}</div>
                      <div className="sub">
                        {b.at} · {b.type === 'loan' ? 'Loan' : 'Expected'}
                      </div>
                    </div>
                    <Money value={b.amount} currency={b.currency} size="sm" locale={locale} />
                  </div>
                ))
              )}
            </Card>

            <Card>
              <div className="section-label">Open loans</div>
              {openLoans.length === 0 ? (
                <EmptyState title="No open loans" body="Shared spends and peer loans appear here." />
              ) : (
                openLoans.slice(0, 6).map((loan) => (
                  <div key={loan.id} className="list-row clickable-row" onClick={() => navigate(`/loans/${loan.id}`)}>
                    <div className="main">
                      <div className="title">{loan.title || loan.institution_label || loan.reference_code}</div>
                      <div className="sub">{loan.your_role === 'borrower' ? 'You owe' : 'They owe'}</div>
                    </div>
                    <Money value={loan.expected_total || loan.principal} currency={loan.currency_code} size="sm" tone={loan.your_role === 'lender' ? 'positive' : 'negative'} locale={locale} />
                  </div>
                ))
              )}
            </Card>

            <Card>
              <div className="section-label">This payday</div>
              {payday ? (
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  {payday.cycle_start} – {payday.cycle_end} · {payday.days_left} days left
                </div>
              ) : null}
              {payday?.limit_amount ? (
                <WebPaceBar
                  label="Spend until payday"
                  spent={payday.spent}
                  limitAmt={payday.limit_amount}
                  currency={payday.currency_code || preferred}
                  spentPct={payday.spent_pct ?? 0}
                  pacePct={payday.pace_pct}
                  ahead={payday.ahead}
                />
              ) : null}
              {budgets.map((b) => (
                <WebPaceBar
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
              {budgets.length === 0 && !payday?.limit_amount ? (
                <div className="muted" style={{ fontSize: 13 }}>
                  Set a spend-until-payday limit, or a category budget. The tick mark is today’s pace.
                </div>
              ) : null}
              <Field label="Payday (day of month)" value={paydayDay} onChange={setPaydayDay} inputMode="numeric" placeholder="1–28" />
              <Field label="Spend until payday" value={paydayLimit} onChange={setPaydayLimit} money placeholder="0.00" />
              <Button onClick={() => void onSavePayday()} busy={budgetBusy} block variant="secondary">
                {budgetBusy ? 'Saving…' : 'Save payday'}
              </Button>
              <SelectField label="Category" value={budgetCategory} onChange={setBudgetCategory} options={expenseCatOptions} placeholder="Category to budget" />
              <Field label="Category limit" value={budgetLimit} onChange={setBudgetLimit} money placeholder="0.00" />
              <Button onClick={onSaveBudget} busy={budgetBusy} block variant="secondary">
                {budgetBusy ? 'Saving…' : 'Save budget'}
              </Button>
            </Card>

            <Card>
              <div className="section-label">Trips & events</div>
              {trips.length === 0 ? (
                <div className="muted" style={{ fontSize: 13 }}>
                  Set a spend cap for a trip or event. Expenses in those dates, or tagged to it, count toward the limit.
                </div>
              ) : null}
              {trips.map((trip) => (
                <div key={trip.id} className="flex-col" style={{ gap: 6, marginBottom: 12 }}>
                  <WebPaceBar
                    label={trip.title}
                    spent={trip.spent}
                    limitAmt={trip.limit_amount}
                    currency={trip.currency_code}
                    spentPct={trip.spent_pct}
                    pacePct={trip.pace_pct}
                    ahead={trip.ahead}
                  />
                  <div className="muted" style={{ fontSize: 12 }}>
                    {trip.starts_on} – {trip.ends_on}
                    {trip.days_left >= 0 ? ` · ${trip.days_left} days left` : ''}
                  </div>
                  <Button size="sm" variant="ghost" busy={tripBusy} onClick={() => void onDeleteTrip(trip.id)}>
                    Remove trip
                  </Button>
                </div>
              ))}
              <Field label="Trip or event" value={tripTitle} onChange={setTripTitle} placeholder="Addis trip, wedding…" />
              <div className="form-row">
                <Field label="Starts" type="date" value={tripStarts} onChange={setTripStarts} />
                <Field label="Ends" type="date" value={tripEnds} onChange={setTripEnds} />
              </div>
              <div className="form-row">
                <SelectField label="Currency" value={tripCurrency} onChange={setTripCurrency} options={CURRENCIES} />
                <Field label="Spend limit" value={tripLimit} onChange={setTripLimit} money placeholder="0.00" />
              </div>
              <Button onClick={() => void onSaveTrip()} busy={tripBusy} block variant="secondary">
                {tripBusy ? 'Saving…' : 'Save trip'}
              </Button>
            </Card>
          </div>
        </div>
      ) : tab === 'bills' ? (
        <Card>
          <div className="section-label">Bills & subscriptions</div>
          {bills.length === 0 ? (
            <EmptyState title="No bills on the calendar" body="Add a repeating income or expense and it will show here." />
          ) : (
            bills.map((bill) => {
              const locked = Boolean(billBusy);
              const status =
                bill.paused ? 'Paused' : bill.status === 'overdue' ? 'Overdue' : bill.status === 'expected' ? 'Expected' : 'Upcoming';
              return (
                <div key={bill.id} className="flex-col" style={{ gap: 8, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                  <div className="list-row clickable-row" onClick={() => navigate(`/cashflow/${bill.id}`)}>
                    <div className="main">
                      <div className="title flex-row" style={{ gap: 6 }}>
                        {bill.title || bill.category}
                        {bill.recurrence ? <Repeat size={11} /> : null}
                      </div>
                      <div className="sub">
                        {status}
                        {bill.category ? ` · ${bill.category}` : ''} · {new Date(bill.due_at).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}
                        {bill.recurrence ? ` · ${bill.recurrence}` : ''}
                      </div>
                    </div>
                    <Money value={bill.amount} currency={bill.currency_code} size="sm" tone={bill.kind === 'income' ? 'positive' : undefined} locale={locale} />
                  </div>
                  <div className="flex-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                    {bill.paused ? (
                      <Button size="sm" variant="secondary" busy={locked} onClick={() => void onBillAction(bill.id, 'resume')}>
                        Resume
                      </Button>
                    ) : (
                      <>
                        <Button size="sm" busy={locked} onClick={() => void onBillAction(bill.id, 'record')}>
                          {bill.kind === 'income' ? 'Received' : 'Record'}
                        </Button>
                        <Button size="sm" variant="secondary" busy={locked} onClick={() => void onBillAction(bill.id, 'skip')}>
                          Skip
                        </Button>
                        <Button size="sm" variant="secondary" busy={locked} onClick={() => void onBillAction(bill.id, 'postpone')}>
                          Postpone 7d
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
          <div className="card-row">
            <div className="section-label">{tab === 'income' ? 'Income' : 'Expenses'}</div>
            <Button size="sm" onClick={() => navigate(`/cashflow/new?kind=${tab === 'income' ? 'income' : 'expense'}`)}>
              <Plus size={14} /> New
            </Button>
          </div>
          {monthEntries.length === 0 ? (
            <EmptyState title={tab === 'income' ? 'No income yet' : 'No expenses yet'} body="Use the New button to add one." />
          ) : (
            monthEntries.map((entry) => <EntryRow key={entry.id} entry={entry} />)
          )}
        </Card>
      )}
    </div>
  );
}
