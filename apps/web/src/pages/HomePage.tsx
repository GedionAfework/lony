import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Repeat } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { api, type Budget, type CashflowEntry, type CashflowSummary, type CategorySpend, type Loan, type WealthSummary } from '../lib/api';
import { formatMoney, stripAmount } from '../lib/format';
import { Card } from '../components/Card';
import { Money } from '../components/Money';
import { Button } from '../components/Button';
import { Segmented } from '../components/Segmented';
import { EmptyState } from '../components/EmptyState';
import { Field, SelectField } from '../components/Field';
import { useToast } from '../components/Toast';

type Tab = 'dashboard' | 'income' | 'expenses';

function monthBounds(d: Date) {
  const from = new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1));
  const to = new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 1));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
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
  const [breakdown, setBreakdown] = useState<CategorySpend[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [budgetCategory, setBudgetCategory] = useState('');
  const [budgetLimit, setBudgetLimit] = useState('');
  const [budgetBusy, setBudgetBusy] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => new Date());

  const period = useMemo(() => monthBounds(selectedDate), [selectedDate]);
  const selectedIso = useMemo(() => toIsoLocal(selectedDate), [selectedDate]);
  const preferred = (user?.default_currency_code || 'USD').toUpperCase();
  const locale = user?.locale || 'en';

  const dayIncome = useMemo(() => income.filter((e) => e.occurred_at.slice(0, 10) === selectedIso), [income, selectedIso]);
  const dayExpense = useMemo(() => expenseRows.filter((e) => e.occurred_at.slice(0, 10) === selectedIso), [expenseRows, selectedIso]);

  const reload = useCallback(async () => {
    if (!token) return;
    try {
      const [sum, inc, exp, incT, expT, wealthRes, breakRes, budgetRes, loanRes] = await Promise.all([
        api.cashflowSummary(token, { from: period.from, to: period.to }),
        api.listCashflow(token, { kind: 'income', from: period.from, to: period.to }),
        api.listCashflow(token, { kind: 'expense', from: period.from, to: period.to }),
        api.listCashflow(token, { kind: 'income', templates: true }),
        api.listCashflow(token, { kind: 'expense', templates: true }),
        api.wealth(token, preferred).catch(() => null),
        api.cashflowBreakdown(token, { kind: 'expense', from: period.from, to: period.to }).catch(() => ({ breakdown: [] })),
        api.listBudgets(token, period.from).catch(() => ({ budgets: [] })),
        api.listLoans(token).catch(() => ({ loans: [] })),
      ]);
      setSummary(sum.summary);
      setIncome(inc.entries ?? []);
      setExpenseRows(exp.entries ?? []);
      setIncomeTemplates(incT.entries ?? []);
      setExpenseTemplates(expT.entries ?? []);
      setWealth(wealthRes?.wealth ?? null);
      setBreakdown(breakRes.breakdown ?? []);
      setBudgets(budgetRes.budgets ?? []);
      setLoans(loanRes.loans ?? []);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not load dashboard');
    }
  }, [token, period.from, period.to, preferred, showError]);

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
    const expected = [...income, ...expenseRows]
      .filter((e) => e.status === 'expected' && !e.is_template)
      .map((e) => ({
        id: e.id,
        title: e.title || (e.kind === 'income' ? 'Expected income' : 'Expected bill'),
        amount: e.amount,
        currency: e.currency_code,
        at: e.occurred_at.slice(0, 10),
        type: 'cashflow' as const,
        entryId: e.id as string | null,
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
  }, [income, expenseRows, loans, preferred]);

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
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not save budget');
    } finally {
      setBudgetBusy(false);
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
          { id: 'income', label: 'Income' },
          { id: 'expenses', label: 'Expenses' },
        ]}
      />

      {tab === 'dashboard' ? (
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
              <div className="section-label">Budgets this month</div>
              {budgets.length === 0 ? (
                <div className="muted" style={{ fontSize: 13 }}>
                  Set a monthly limit per category to track burn.
                </div>
              ) : (
                budgets.map((b) => {
                  const limit = Number(b.limit_amount) || 1;
                  const spent = Number(b.spent) || 0;
                  const pct = Math.min(100, Math.round((spent / limit) * 100));
                  const over = spent > limit;
                  return (
                    <div key={b.id} className="flex-col" style={{ gap: 4 }}>
                      <div className="card-row">
                        <span style={{ fontWeight: 700, fontSize: 13 }}>{b.category_name}</span>
                        <span className="muted" style={{ fontSize: 12 }}>
                          {formatMoney(b.spent, b.currency_code, locale)} / {formatMoney(b.limit_amount, b.currency_code, locale)}
                        </span>
                      </div>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${Math.max(4, pct)}%`, background: over ? 'var(--warning)' : 'var(--primary)' }} />
                      </div>
                    </div>
                  );
                })
              )}
              <SelectField label="Category" value={budgetCategory} onChange={setBudgetCategory} options={expenseCatOptions} placeholder="Category to budget" />
              <Field label="Monthly limit" value={budgetLimit} onChange={setBudgetLimit} money placeholder="0.00" />
              <Button onClick={onSaveBudget} busy={budgetBusy} block variant="secondary">
                {budgetBusy ? 'Saving…' : 'Save budget'}
              </Button>
            </Card>
          </div>
        </div>
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
