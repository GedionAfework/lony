import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
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
import { stripAmount } from './amountFormat';
import { SearchSelect } from './SearchSelect';
import { IconRepeat } from './icons';
import { listCashflowDrafts, removeCashflowDraft, type CashflowDraft } from './offlineDrafts';
import { fonts, radii, space, useTheme } from './theme';
import { Card, EmptyState, Field, Money, PrimaryButton, SecondaryButton, SectionLabel } from './ui';

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
  reloadToken?: number;
};

function monthBounds(d = new Date()): { from: string; to: string; label: string; day: string; short: string } {
  const from = new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1));
  const to = new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 1));
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    label: from.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    day: String(d.getDate()),
    short: d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }),
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
}: Props) {
  const { colors } = useTheme();
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

  const period = useMemo(() => monthBounds(), []);
  const preferred = (user.default_currency_code || 'USD').toUpperCase();

  const reload = useCallback(async () => {
    try {
      setLoadError(null);
      const [sum, inc, exp, incT, expT, wealthRes, breakRes, budgetRes] = await Promise.all([
        api.cashflowSummary(token, { from: period.from, to: period.to }),
        api.listCashflow(token, { kind: 'income', from: period.from, to: period.to }),
        api.listCashflow(token, { kind: 'expense', from: period.from, to: period.to }),
        api.listCashflow(token, { kind: 'income', templates: true }),
        api.listCashflow(token, { kind: 'expense', templates: true }),
        api.wealth(token, preferred).catch(() => null),
        api.cashflowBreakdown(token, { kind: 'expense', from: period.from, to: period.to }).catch(() => ({ breakdown: [] })),
        api.listBudgets(token, period.from).catch(() => ({ budgets: [] })),
      ]);
      setSummary(sum.summary);
      setIncome(inc.entries ?? []);
      setExpenseRows(exp.entries ?? []);
      setIncomeTemplates(incT.entries ?? []);
      setExpenseTemplates(expT.entries ?? []);
      setWealth(wealthRes?.wealth ?? null);
      setBreakdown(breakRes.breakdown ?? []);
      setBudgets(budgetRes.budgets ?? []);
      setDrafts(await listCashflowDrafts());
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not load expenses';
      setLoadError(message);
      onError(message);
      setDrafts(await listCashflowDrafts());
    }
  }, [token, period.from, period.to, preferred, onError]);

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
        title: l.title || l.reference_code || 'Loan due',
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
  }, [income, expenseRows, loans, preferred]);

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
      onError(e instanceof Error ? e.message : 'Could not sync drafts');
      setDrafts(await listCashflowDrafts());
    } finally {
      setDraftBusy(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [reload, reloadToken]);

  const slice =
    summary?.by_currency?.find((s) => s.currency_code === preferred) ?? summary?.by_currency?.[0] ?? null;
  const currency = slice?.currency_code || preferred;
  const incomeTotal = Number(slice?.income ?? 0);
  const expenseTotal = Number(slice?.expense ?? slice?.outcome ?? 0);
  const maxSpend = Math.max(
    1,
    ...breakdown.filter((b) => b.currency_code === currency).map((b) => Number(b.amount) || 0),
  );

  const openLoans = useMemo(
    () => loans.filter((l) => ['active', 'overdue', 'repayment_pending', 'pending'].includes(l.status)),
    [loans],
  );
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
  const monthEntries = useMemo(() => {
    const covered = new Set(
      list.map((e) => e.template_id).filter((id): id is string => Boolean(id)),
    );
    const orphans = templates.filter((t) => !covered.has(t.id));
    return [...list, ...orphans].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
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
    return [...income, ...expenseRows, ...orphanIncome, ...orphanExpense]
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
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
      onError('Pick a category');
      return;
    }
    const limit = stripAmount(budgetLimit);
    if (!limit || Number(limit) <= 0) {
      onError('Enter a budget limit');
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
      onError(e instanceof Error ? e.message : 'Could not save budget');
    } finally {
      setBudgetBusy(false);
    }
  }

  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>Expenses</Text>
        <View
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
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        {([
          ['dashboard', 'Dashboard'],
          ['income', 'Income'],
          ['expenses', 'Expenses'],
        ] as const).map(([id, label]) => {
          const active = tab === id;
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
            title="Couldn’t load cashflow"
            body={
              loadError.includes('cashflow') || loadError.includes('404') || loadError.includes('pq:')
                ? 'Expense API may not be deployed yet. Pull to refresh after the API update.'
                : loadError
            }
          />
        </Card>
      ) : null}

      {tab === 'dashboard' ? (
        <>
          {drafts.length > 0 ? (
            <Card>
              <SectionLabel>Offline drafts ({drafts.length})</SectionLabel>
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
                Saved on this device while offline. Sync when you’re back online.
              </Text>
              {drafts.slice(0, 5).map((d) => (
                <Text key={d.id} style={{ color: colors.text, fontFamily: fonts.ui, fontSize: 13 }}>
                  {d.kind}: {d.title} · {d.amount} {d.currency_code}
                </Text>
              ))}
              <PrimaryButton
                label={draftBusy ? 'Syncing…' : 'Sync drafts'}
                onPress={() => void syncDrafts()}
                disabled={draftBusy}
              />
            </Card>
          ) : null}

          <Card>
            <SectionLabel>Coming up</SectionLabel>
            {upcomingBills.length === 0 ? (
              <EmptyState
                title="No bills in the next 45 days"
                body="Expected income/expenses and loan dues will show here."
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
                      {b.at} · {b.type === 'loan' ? 'Loan' : 'Expected'}
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
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text
                style={{ color: colors.muted, fontFamily: fonts.uiSemi, fontSize: 12, textTransform: 'uppercase' }}
              >
                Net worth
              </Text>
              {onOpenAccounts ? (
                <Pressable onPress={onOpenAccounts} hitSlop={8}>
                  <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 13 }}>Accounts</Text>
                </Pressable>
              ) : null}
            </View>
            <Money
              value={formatMoney(wealth?.net_worth ?? '0', wealth?.preferred_currency || currency, user.locale)}
              size="xl"
              tone={Number(wealth?.net_worth || 0) >= 0 ? 'positive' : 'negative'}
            />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              <Mini
                label="Cash on hand"
                value={formatMoney(wealth?.cash_on_hand ?? '0', wealth?.preferred_currency || currency, user.locale)}
                tone="positive"
              />
              <Mini
                label="Owed to you"
                value={formatMoney(wealth?.receivables ?? '0', wealth?.preferred_currency || currency, user.locale)}
                tone="positive"
              />
              <Mini
                label="You owe"
                value={formatMoney(wealth?.payables ?? '0', wealth?.preferred_currency || currency, user.locale)}
                tone="negative"
              />
            </View>
            {(wealth?.accounts?.length ?? 0) === 0 ? (
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
                Add account balances to complete net worth. Loan positions are included already.
              </Text>
            ) : null}
          </Card>

          <Card>
            <Text
              style={{ color: colors.muted, fontFamily: fonts.uiSemi, fontSize: 12, textTransform: 'uppercase' }}
            >
              This month
            </Text>
            <Money
              value={formatMoney(net.toFixed(2), currency, user.locale)}
              size="lg"
              tone={net >= 0 ? 'positive' : 'negative'}
            />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              <Mini
                label="Income"
                value={formatMoney(String(incomeTotal), currency, user.locale)}
                tone="positive"
              />
              <Mini
                label="Expenses"
                value={formatMoney(String(expenseTotal), currency, user.locale)}
                tone="negative"
              />
              <Mini
                label="Owed to you"
                value={formatMoney(loanIn.toFixed(2), currency, user.locale)}
                tone="positive"
              />
              <Mini
                label="You owe"
                value={formatMoney(loanOut.toFixed(2), currency, user.locale)}
                tone="negative"
              />
            </View>
          </Card>

          <Card>
            <SectionLabel>Spending by category</SectionLabel>
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
            <SectionLabel>Budgets this month</SectionLabel>
            {budgets.length === 0 ? (
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13, marginBottom: 8 }}>
                Set a monthly limit per category to track burn.
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
              label="Category"
              value={budgetCategory}
              onChange={setBudgetCategory}
              options={expenseCats}
              placeholder="Category to budget"
            />
            <Field label="Monthly limit" value={budgetLimit} onChange={setBudgetLimit} money />
            <PrimaryButton
              label={budgetBusy ? 'Saving…' : 'Save budget'}
              onPress={onSaveBudget}
              disabled={budgetBusy}
            />
          </Card>

          <Card>
            <SectionLabel>Open loans</SectionLabel>
            {openLoans.length === 0 ? (
              <EmptyState title="No open loans" body="Shared spends and peer loans appear here." />
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
                      {loan.your_role === 'borrower' ? 'You owe' : 'They owe'}
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
            <SectionLabel>Recent</SectionLabel>
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
              <EmptyState title="Quiet month" body="Tap + to add income or an expense." />
            ) : null}
          </Card>
        </>
      ) : null}

      {tab === 'income' || tab === 'expenses' ? (
        <Card>
          <SectionLabel>{tab === 'income' ? 'Income' : 'Expenses'}</SectionLabel>
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
              title={tab === 'income' ? 'No income yet' : 'No expenses yet'}
              body="Tap + at the bottom left to add one."
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
  const income = entry.kind === 'income';
  const when = new Date(entry.occurred_at);
  const dayNum = when.getDate();
  const monthShort = when.toLocaleDateString(locale || 'en', { month: 'short' });
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
            {entry.title || entry.category}
          </Text>
          {recurring || entry.is_template ? <IconRepeat size={12} color={colors.muted} /> : null}
        </View>
        <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }} numberOfLines={1}>
          {entry.category}
          {expected ? (income ? '  Expected' : '  Due') : ''}
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
        {formatMoney(entry.amount, entry.currency_code, locale)}
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
        <Text style={{ color: colors.primary, fontFamily: fonts.ui, fontSize: 10, opacity: 0.85 }}>{monthShort}</Text>
      </View>
    </Pressable>
  );
}
