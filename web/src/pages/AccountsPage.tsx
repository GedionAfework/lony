import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Banknote, CreditCard, Landmark, Pencil, PiggyBank, Plus, RefreshCw, Scale, Smartphone, Trash2, Upload, Wallet, type LucideIcon } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import {
  api,
  type AccountReconcile,
  type BankLinkConnection,
  type BankLinkStatus,
  type CardInstallment,
  type MoneyAccount,
  type PossibleDuplicateDebt,
} from '../lib/api';
import { formatMoney, stripAmount } from '../lib/format';
import type { CatalogOption } from '../lib/catalogs';
import { CURRENCIES } from '../lib/catalogs';
import { Hero, HeroStat, SectionHead, hueFor } from '../components/Visuals';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Field, SelectField } from '../components/Field';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';

const FALLBACK_ACCOUNT_TYPES: CatalogOption[] = [
  { id: 'bank', label: 'Bank' },
  { id: 'cash', label: 'Cash' },
  { id: 'mobile_money', label: 'Mobile money' },
  { id: 'wallet', label: 'Wallet' },
  { id: 'credit_card', label: 'Credit card' },
  { id: 'other', label: 'Other' },
];

const COMPOUNDING = [
  { id: 'none', label: 'Simple (yearly)' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'yearly', label: 'Yearly compound' },
];

const ACCOUNT_ICONS: Record<string, LucideIcon> = {
  bank: Landmark,
  cash: Banknote,
  mobile_money: Smartphone,
  wallet: Wallet,
  credit_card: CreditCard,
};

type Panel = null | 'create' | 'edit' | 'balance' | 'transfer' | 'reconcile' | 'import' | 'installments';

function mergeOptions(primary: CatalogOption[], fallback: CatalogOption[]): CatalogOption[] {
  const seen = new Set<string>();
  const out: CatalogOption[] = [];
  for (const o of [...primary, ...fallback]) {
    if (!o.id || seen.has(o.id)) continue;
    seen.add(o.id);
    out.push(o);
  }
  if (!seen.has('other')) out.push({ id: 'other', label: 'Other' });
  return out;
}

export function AccountsPage() {
  const { user, token } = useAuth();
  const { showError, show } = useToast();
  const confirm = useConfirm();
  const locale = user?.locale || 'en';

  const [accounts, setAccounts] = useState<MoneyAccount[]>([]);
  // Self-recorded debts that may already be inside a card balance (counted twice).
  const [duplicates, setDuplicates] = useState<PossibleDuplicateDebt[]>([]);
  const [bankStatus, setBankStatus] = useState<BankLinkStatus | null>(null);
  const [bankConnections, setBankConnections] = useState<BankLinkConnection[]>([]);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [accountType, setAccountType] = useState('bank');
  const [institutionId, setInstitutionId] = useState('');
  const [institutionOther, setInstitutionOther] = useState('');
  const [currency, setCurrency] = useState((user?.default_currency_code || 'USD').toUpperCase());
  const [balance, setBalance] = useState('0');
  const [interest, setInterest] = useState('');
  const [compounding, setCompounding] = useState('none');
  const [creditLimit, setCreditLimit] = useState('');
  const [statementDay, setStatementDay] = useState('');
  const [dueDay, setDueDay] = useState('');
  const [newBalance, setNewBalance] = useState('');
  const [installments, setInstallments] = useState<CardInstallment[]>([]);
  const [instMerchant, setInstMerchant] = useState('');
  const [instTotal, setInstTotal] = useState('');
  const [instMonths, setInstMonths] = useState('12');
  const [instMonthly, setInstMonthly] = useState('');

  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferNote, setTransferNote] = useState('');

  const [reconcileRows, setReconcileRows] = useState<AccountReconcile[]>([]);
  const [importCsv, setImportCsv] = useState('');
  const [importFileName, setImportFileName] = useState('');
  const [importEndingBalance, setImportEndingBalance] = useState('');
  const [importResult, setImportResult] = useState<string | null>(null);

  const [remoteTypes, setRemoteTypes] = useState<CatalogOption[]>([]);
  const [remoteInstitutions, setRemoteInstitutions] = useState<CatalogOption[]>([]);

  const accountTypes = useMemo(() => mergeOptions(remoteTypes, FALLBACK_ACCOUNT_TYPES), [remoteTypes]);
  const institutionOptions = useMemo(() => mergeOptions(remoteInstitutions, []), [remoteInstitutions]);
  const needsOtherInstitution = !institutionId || institutionId === 'other' || accountType === 'other';

  const reload = useCallback(async () => {
    if (!token) return;
    try {
      const res = await api.listAccounts(token);
      setAccounts(res.accounts ?? []);
      api
        .possibleDuplicateDebts(token)
        .then((r) => setDuplicates(r.duplicates ?? []))
        .catch(() => setDuplicates([]));
      const links = await api.listBankLinks(token).catch(() => null);
      if (links) {
        setBankStatus(links.status);
        setBankConnections(links.connections ?? []);
      } else {
        const st = await api.bankLinkStatus(token).catch(() => null);
        if (st) setBankStatus(st);
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not load accounts');
    }
  }, [token, showError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!token) return;
    api
      .listCatalogTypes(token, 'account_type')
      .then((res) => setRemoteTypes((res.types ?? []).filter((t) => t.active).map((t) => ({ id: t.code, label: t.label }))))
      .catch(() => setRemoteTypes([]));
  }, [token]);

  useEffect(() => {
    if (!token) return;
    api
      .listCatalogInstitutions(token, 'account_type', accountType)
      .then((res) => {
        // Your own country first, then worldwide services, then everything else.
        const home = (user?.country_code || '').toUpperCase();
        const rank = (cc?: string | null) => (cc && cc.toUpperCase() === home ? 0 : !cc ? 1 : 2);
        setRemoteInstitutions(
          (res.institutions ?? [])
            .filter((i) => i.active)
            .sort((a, b) => rank(a.country_code) - rank(b.country_code))
            .map((i) => ({ id: i.code, label: i.label })),
        );
      })
      .catch(() => setRemoteInstitutions([]));
  }, [token, accountType, user?.country_code]);

  function resetForm() {
    setAccountType('bank');
    setInstitutionId('');
    setInstitutionOther('');
    setCurrency((user?.default_currency_code || 'USD').toUpperCase());
    setBalance('0');
    setInterest('');
    setCompounding('none');
    setCreditLimit('');
    setStatementDay('');
    setDueDay('');
  }

  function resolveInstitution(): string {
    if (!institutionId || institutionId === 'other') return institutionOther.trim() || (accountType === 'cash' ? 'Cash' : '');
    const hit = institutionOptions.find((o) => o.id === institutionId);
    if (!hit || hit.id === 'other') return institutionOther.trim();
    return hit.label;
  }

  function accountDisplayName(institutionLabel: string): string {
    const typeLabel = accountTypes.find((t) => t.id === accountType)?.label || accountType;
    return institutionLabel.trim() || typeLabel;
  }

  function openCreate() {
    resetForm();
    setPanel('create');
  }

  function openEdit(a: MoneyAccount) {
    setActiveId(a.id);
    setAccountType(a.account_type);
    setInterest(a.interest_rate_percent || '');
    setCompounding(a.compounding || 'none');
    setCreditLimit(a.credit_limit || '');
    setStatementDay(a.statement_day ? String(a.statement_day) : '');
    setDueDay(a.due_day ? String(a.due_day) : '');
    setCurrency(a.currency_code);
    const label = (a.institution_label || '').trim();
    const hit = institutionOptions.find((o) => o.label.toLowerCase() === label.toLowerCase());
    if (hit && hit.id !== 'other') {
      setInstitutionId(hit.id);
      setInstitutionOther('');
    } else if (label) {
      setInstitutionId('other');
      setInstitutionOther(label);
    } else {
      setInstitutionId('');
      setInstitutionOther('');
    }
    setPanel('edit');
  }

  async function onCreate() {
    if (!token) return;
    const label = resolveInstitution();
    if (accountType !== 'cash' && !label.trim()) {
      showError('Choose an institution');
      return;
    }
    setBusy(true);
    try {
      const stmt = Number(statementDay.trim());
      const due = Number(dueDay.trim());
      if (accountType === 'credit_card') {
        if ((statementDay.trim() && (!Number.isInteger(stmt) || stmt < 1 || stmt > 28)) ||
            (dueDay.trim() && (!Number.isInteger(due) || due < 1 || due > 28))) {
          showError('Statement and due days must be from 1 to 28');
          setBusy(false);
          return;
        }
      }
      await api.createAccount(token, {
        name: accountDisplayName(label),
        account_type: accountType as MoneyAccount['account_type'],
        currency_code: currency,
        balance: stripAmount(balance) || '0',
        interest_rate_percent: stripAmount(interest) || undefined,
        compounding: interest.trim() ? (compounding as 'none' | 'monthly' | 'yearly') : undefined,
        institution_label: label.trim() || undefined,
        credit_limit: accountType === 'credit_card' ? stripAmount(creditLimit) || undefined : undefined,
        statement_day: accountType === 'credit_card' && statementDay.trim() ? stmt : undefined,
        due_day: accountType === 'credit_card' && dueDay.trim() ? due : undefined,
      });
      setPanel(null);
      await reload();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not create account');
    } finally {
      setBusy(false);
    }
  }

  async function onSaveEdit() {
    if (!token || !activeId) return;
    const label = resolveInstitution();
    if (accountType !== 'cash' && !label.trim()) {
      showError('Choose an institution');
      return;
    }
    setBusy(true);
    try {
      const stmt = Number(statementDay.trim());
      const due = Number(dueDay.trim());
      if (accountType === 'credit_card') {
        if ((statementDay.trim() && (!Number.isInteger(stmt) || stmt < 1 || stmt > 28)) ||
            (dueDay.trim() && (!Number.isInteger(due) || due < 1 || due > 28))) {
          showError('Statement and due days must be from 1 to 28');
          setBusy(false);
          return;
        }
      }
      const clear = !interest.trim();
      await api.updateAccount(token, activeId, {
        name: accountDisplayName(label),
        account_type: accountType as MoneyAccount['account_type'],
        currency_code: currency,
        interest_rate_percent: clear ? undefined : stripAmount(interest),
        compounding: clear ? undefined : (compounding as 'none' | 'monthly' | 'yearly'),
        institution_label: label.trim() || undefined,
        clear_interest: clear,
        credit_limit: accountType === 'credit_card' ? stripAmount(creditLimit) || '' : undefined,
        statement_day: accountType === 'credit_card' ? (statementDay.trim() ? stmt : 0) : undefined,
        due_day: accountType === 'credit_card' ? (dueDay.trim() ? due : 0) : undefined,
      });
      setPanel(null);
      await reload();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not update account');
    } finally {
      setBusy(false);
    }
  }

  async function onSaveBalance() {
    if (!token || !activeId) return;
    setBusy(true);
    try {
      await api.setAccountBalance(token, activeId, { balance: stripAmount(newBalance) || '0' });
      setPanel(null);
      await reload();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not update balance');
    } finally {
      setBusy(false);
    }
  }

  async function openInstallments(a: MoneyAccount) {
    if (!token) return;
    setActiveId(a.id);
    setInstMerchant('');
    setInstTotal('');
    setInstMonths('12');
    setInstMonthly('');
    setPanel('installments');
    try {
      const res = await api.listInstallments(token, a.id);
      setInstallments(res.installments ?? []);
    } catch (e) {
      setInstallments([]);
      showError(e instanceof Error ? e.message : 'Could not load installments');
    }
  }

  async function onAddInstallment() {
    if (!token || !activeId) return;
    const months = Number(instMonths.trim());
    if (!instMerchant.trim() || !stripAmount(instTotal) || !Number.isInteger(months) || months < 2) {
      showError('Enter merchant, total, and months (2–60)');
      return;
    }
    setBusy(true);
    try {
      await api.createInstallment(token, activeId, {
        merchant: instMerchant.trim(),
        total_amount: stripAmount(instTotal) || '0',
        monthly_amount: stripAmount(instMonthly) || undefined,
        months_total: months,
      });
      setInstMerchant('');
      setInstTotal('');
      setInstMonths('12');
      setInstMonthly('');
      const res = await api.listInstallments(token, activeId);
      setInstallments(res.installments ?? []);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not add installment');
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteInstallment(id: string) {
    if (!token || !activeId) return;
    const ok = await confirm({ title: 'Delete this payment plan?', body: 'This can’t be undone.', confirmLabel: 'Delete', tone: 'danger' });
    if (!ok) return;
    setBusy(true);
    try {
      await api.deleteInstallment(token, activeId, id);
      setInstallments((rows) => rows.filter((r) => r.id !== id));
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not delete installment');
    } finally {
      setBusy(false);
    }
  }

  async function onArchive(id: string) {
    if (!token) return;
    const acct = accounts.find((a) => a.id === id);
    const ok = await confirm({
      title: `Archive ${acct?.name || 'this account'}?`,
      body: 'It leaves your list and your total balance. Its past records are kept.',
      confirmLabel: 'Archive',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.archiveAccount(token, id);
      await reload();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not archive');
    } finally {
      setBusy(false);
    }
  }

  async function onTransfer() {
    if (!token) return;
    if (!fromId || !toId || fromId === toId) {
      showError('Pick two different accounts');
      return;
    }
    const amt = stripAmount(transferAmount);
    if (!amt || Number(amt) <= 0) {
      showError('Enter a positive amount');
      return;
    }
    setBusy(true);
    try {
      await api.transferAccounts(token, { from_account_id: fromId, to_account_id: toId, amount: amt, note: transferNote.trim() || undefined });
      setPanel(null);
      setFromId('');
      setToId('');
      setTransferAmount('');
      setTransferNote('');
      await reload();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Transfer failed');
    } finally {
      setBusy(false);
    }
  }

  async function onReconcile() {
    if (!token) return;
    setBusy(true);
    try {
      const res = await api.reconcileAccounts(token);
      setReconcileRows(res.reconcile ?? []);
      setPanel('reconcile');
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not reconcile');
    } finally {
      setBusy(false);
    }
  }

  async function matchToLedger(row: AccountReconcile) {
    if (!token) return;
    setBusy(true);
    try {
      await api.setAccountBalance(token, row.account_id, { balance: row.expected_balance, note: 'reconcile to ledger' });
      await reload();
      const res = await api.reconcileAccounts(token);
      setReconcileRows(res.reconcile ?? []);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not update balance');
    } finally {
      setBusy(false);
    }
  }

  function onPickFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      setImportCsv(String(reader.result || ''));
      setImportFileName(file.name);
      setImportResult(null);
    };
    reader.readAsText(file);
  }

  async function onImportStatement() {
    if (!token || !activeId) return;
    const csv = importCsv.trim();
    if (!csv) {
      showError('Paste CSV or pick a statement file');
      return;
    }
    setBusy(true);
    setImportResult(null);
    try {
      const ending = stripAmount(importEndingBalance);
      const res = await api.importAccountStatement(token, activeId, {
        csv,
        set_balance: ending && Number(ending) >= 0 ? ending : undefined,
        balance_note: ending ? 'statement import ending balance' : undefined,
      });
      const errN = res.import.errors?.length ?? 0;
      setImportResult(`Imported ${res.import.imported}, skipped ${res.import.skipped}${errN ? `, ${errN} row issue(s)` : ''}.`);
      await reload();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  async function onConnectBank() {
    if (!token) return;
    setBusy(true);
    try {
      const session = await api.createBankLinkSession(token);
      if (!session.link_url) {
        showError('Bank link URL missing — configure PUBLIC_BASE_URL on the API.');
        return;
      }
      window.open(session.link_url, '_blank', 'noopener,noreferrer');
      show('Complete the bank connection in the new tab, then hit Sync on the connection.');
      await reload();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Bank linking unavailable');
    } finally {
      setBusy(false);
    }
  }

  async function onSyncConnection(c: BankLinkConnection) {
    if (!token) return;
    setBusy(true);
    try {
      const res = await api.syncBankLink(token, c.id);
      show(`Synced ${res.imported} new · skipped ${res.skipped}`);
      await reload();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setBusy(false);
    }
  }

  async function onDisconnect(c: BankLinkConnection) {
    if (!token) return;
    const ok = await confirm({
      title: `Disconnect ${c.institution_label || 'this bank'}?`,
      body: 'Balances stop syncing. Your accounts and records stay.',
      confirmLabel: 'Disconnect',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.disconnectBankLink(token, c.id);
      await reload();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Disconnect failed');
    }
  }

  const accountOptions = accounts.map((a) => ({ id: a.id, label: `${a.name} (${a.currency_code})` }));
  const activeAccount = accounts.find((a) => a.id === activeId);

  async function onResolveDuplicate(loanId: string, accountId: string | null) {
    if (!token) return;
    try {
      await api.setLoanAccountLink(token, loanId, accountId ? { account_id: accountId } : { dismiss: true });
      setDuplicates((prev) => prev.filter((d) => d.loan_id !== loanId));
      show(accountId ? 'Linked to the card, counted once' : 'Kept as a separate debt');
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not update the debt');
    }
  }

  const heroCurrency = (() => {
    const pref = (user?.default_currency_code || '').toUpperCase();
    if (accounts.some((a) => a.currency_code === pref)) return pref;
    return accounts[0]?.currency_code || pref || 'USD';
  })();
  const inHero = accounts.filter((a) => a.currency_code === heroCurrency);
  const heroTotal = inHero.reduce((sum, a) => sum + (Number(a.balance) || 0), 0);
  const heroAssets = inHero.filter((a) => a.account_type !== 'credit_card').reduce((sum, a) => sum + (Number(a.balance) || 0), 0);
  const heroCards = Math.abs(inHero.filter((a) => a.account_type === 'credit_card').reduce((sum, a) => sum + (Number(a.balance) || 0), 0));
  const otherCurrencies = [...new Set(accounts.map((a) => a.currency_code).filter((c) => c !== heroCurrency))];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Accounts</h1>
          <div className="page-subtitle muted">Your cash, banks, cards and wallets</div>
        </div>
        <div className="page-actions">
          {accounts.length >= 1 ? (
            <Button variant="secondary" onClick={onReconcile} busy={busy}>
              <Scale size={15} /> Reconcile
            </Button>
          ) : null}
          {accounts.length >= 2 ? (
            <Button variant="secondary" onClick={() => setPanel('transfer')}>
              <ArrowLeftRight size={15} /> Transfer
            </Button>
          ) : null}
          <Button onClick={openCreate}>
            <Plus size={15} /> Add account
          </Button>
        </div>
      </div>

      {accounts.length > 0 ? (
        <Hero
          label="Across all accounts"
          value={formatMoney(heroTotal.toFixed(2), heroCurrency, locale)}
          sub={otherCurrencies.length ? `Plus ${otherCurrencies.join(', ')} accounts, shown separately below` : `${accounts.length} account${accounts.length === 1 ? '' : 's'}`}
          aside={
            <>
              <HeroStat label="Money you have" value={formatMoney(heroAssets.toFixed(2), heroCurrency, locale)} tone="up" />
              <HeroStat label="Card balances" value={formatMoney(heroCards.toFixed(2), heroCurrency, locale)} tone="down" />
            </>
          }
        />
      ) : null}

      {duplicates.length > 0 ? (
        <div className="notice">
          <div className="notice-text">
            <strong>These may be counted twice.</strong> If a debt is already part of a card balance, link it so it's only subtracted once.
            {duplicates.map((d) => (
              <div key={d.loan_id} className="flex-row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                <span style={{ fontWeight: 700 }}>
                  {d.loan_title} · {formatMoney(d.outstanding, d.currency_code, locale)}
                </span>
                {d.cards.map((c) => (
                  <Button key={c.id} size="sm" onClick={() => onResolveDuplicate(d.loan_id, c.id)}>
                    <CreditCard size={14} /> Part of {c.name}
                  </Button>
                ))}
                <Button size="sm" variant="secondary" onClick={() => onResolveDuplicate(d.loan_id, null)}>
                  Not the same
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {accounts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Wallet size={24} />}
            title="No accounts yet"
            body="Add your cash, bank accounts, cards or wallets to see your total balance."
            action={
              <Button onClick={openCreate} style={{ marginTop: 8 }}>
                <Plus size={15} /> Add account
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="acct-grid">
          {accounts.map((a) => {
            const Icon = ACCOUNT_ICONS[a.account_type] ?? PiggyBank;
            const color = hueFor(a.institution_label || a.name);
            const negative = Number(a.balance) < 0;
            const typeLabel = accountTypes.find((t) => t.id === a.account_type)?.label || a.account_type;
            return (
              <div key={a.id} className="acct-card">
                <div className="acct-top">
                  <span className="cat-icon" style={{ width: 42, height: 42, color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
                    <Icon size={19} />
                  </span>
                  <div className="acct-name">
                    <strong>{a.name}</strong>
                    <small>
                      {a.institution_label && a.institution_label !== a.name ? `${a.institution_label} · ` : ''}
                      {typeLabel}
                    </small>
                  </div>
                  <span className="acct-ccy">{a.currency_code}</span>
                </div>
                <div className={`acct-balance ${negative ? 'neg' : ''}`}>{formatMoney(a.balance, a.currency_code, locale)}</div>
                {a.account_type === 'credit_card' && a.credit_limit ? (
                  <div className="acct-credit">
                    <div className="cat-track">
                      <div
                        style={{
                          width: `${Math.min(100, Math.max(2, a.utilization_pct ?? 0))}%`,
                          background: (a.utilization_pct ?? 0) >= 70 ? 'var(--error)' : (a.utilization_pct ?? 0) >= 30 ? 'var(--warning)' : 'var(--primary)',
                        }}
                      />
                    </div>
                    <span>
                      {a.utilization_pct ?? 0}% of {formatMoney(a.credit_limit, a.currency_code, locale)}
                      {a.next_due_at ? ` · due ${new Date(a.next_due_at).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}` : ''}
                    </span>
                  </div>
                ) : a.interest_rate_percent ? (
                  <div className="acct-note">
                    {a.interest_rate_percent}% interest
                    {a.projected_balance_12m ? ` · about ${formatMoney(a.projected_balance_12m, a.currency_code, locale)} in a year` : ''}
                  </div>
                ) : (
                  <div className="acct-note">Updated {new Date(a.balance_as_of || a.updated_at).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}</div>
                )}
                <div className="acct-actions">
                  <button
                    type="button"
                    className="acct-action"
                    onClick={() => {
                      setActiveId(a.id);
                      setNewBalance(a.balance);
                      setPanel('balance');
                    }}
                  >
                    <Scale size={14} /> Balance
                  </button>
                  <button
                    type="button"
                    className="acct-action"
                    onClick={() => {
                      setActiveId(a.id);
                      setImportCsv('');
                      setImportFileName('');
                      setImportEndingBalance('');
                      setImportResult(null);
                      setPanel('import');
                    }}
                  >
                    <Upload size={14} /> Import
                  </button>
                  {a.account_type === 'credit_card' ? (
                    <button type="button" className="acct-action" onClick={() => void openInstallments(a)}>
                      <CreditCard size={14} /> Plans
                    </button>
                  ) : null}
                  <span className="spacer" />
                  <button type="button" className="icon-btn sm ghost" aria-label="Edit" title="Edit" onClick={() => openEdit(a)}>
                    <Pencil size={14} />
                  </button>
                  <button type="button" className="icon-btn sm ghost" aria-label="Archive" title="Archive" onClick={() => onArchive(a.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
          <button type="button" className="acct-card acct-add" onClick={openCreate}>
            <Plus size={22} />
            <span>Add account</span>
          </button>
        </div>
      )}

      {bankConnections.length > 0 || bankStatus?.available ? (
        <Card>
          <SectionHead title="Linked banks" sub="Balances sync automatically" />
          {bankConnections.map((c) => (
            <div key={c.id} className="list-row">
              <div className="main">
                <div className="title">{c.institution_label || c.provider}</div>
                <div className="sub">
                  {c.status}
                  {c.last_synced_at ? ` · synced ${new Date(c.last_synced_at).toLocaleDateString(locale)}` : ''}
                </div>
              </div>
              <div className="flex-row">
                <Button variant="secondary" size="sm" onClick={() => onSyncConnection(c)} disabled={busy || c.status !== 'active'}>
                  <RefreshCw size={13} /> Sync
                </Button>
                <Button variant="icon" aria-label="Disconnect" onClick={() => onDisconnect(c)}>
                  <Trash2 size={15} />
                </Button>
              </div>
            </div>
          ))}
          {bankStatus?.available ? (
            <Button variant="secondary" onClick={onConnectBank} busy={busy} block>
              <Landmark size={15} /> Connect a bank
            </Button>
          ) : null}
        </Card>
      ) : null}

      <Modal open={panel === 'create' || panel === 'edit'} title={panel === 'edit' ? 'Edit account' : 'New account'} onClose={() => setPanel(null)}>
        <SelectField
          label="Type"
          value={accountType}
          onChange={(id) => {
            setAccountType(id);
            setInstitutionId('');
            setInstitutionOther('');
          }}
          options={accountTypes}
        />
        {accountType !== 'cash' ? (
          <>
            <SelectField label="Institution" value={institutionId} onChange={setInstitutionId} options={institutionOptions} placeholder="Select institution" />
            {needsOtherInstitution ? <Field label="Institution name" value={institutionOther} onChange={setInstitutionOther} placeholder="Type the institution name" /> : null}
          </>
        ) : null}
        <SelectField label="Currency" value={currency} onChange={setCurrency} options={CURRENCIES} />
        {panel === 'create' ? (
          <Field
            label={accountType === 'credit_card' ? 'Amount owed' : 'Current balance'}
            value={balance}
            onChange={setBalance}
            money
          />
        ) : null}
        {accountType === 'credit_card' ? (
          <>
            <Field label="Credit limit" value={creditLimit} onChange={setCreditLimit} money />
            <Field label="Statement day (1–28)" value={statementDay} onChange={setStatementDay} placeholder="15" />
            <Field label="Payment due day (1–28)" value={dueDay} onChange={setDueDay} placeholder="10" />
          </>
        ) : null}
        <Field label="Interest rate % (optional)" value={interest} onChange={setInterest} placeholder="e.g. 8" />
        {interest.trim() ? <SelectField label="Compounding" value={compounding} onChange={setCompounding} options={COMPOUNDING} /> : null}
        <Button onClick={panel === 'edit' ? onSaveEdit : onCreate} busy={busy} block>
          {busy ? 'Saving…' : panel === 'edit' ? 'Save changes' : 'Create'}
        </Button>
      </Modal>

      <Modal open={panel === 'balance'} title="Update balance" onClose={() => setPanel(null)}>
        <Field label="New balance" value={newBalance} onChange={setNewBalance} money />
        <Button onClick={onSaveBalance} busy={busy} block>
          {busy ? 'Saving…' : 'Save balance'}
        </Button>
      </Modal>

      <Modal open={panel === 'transfer'} title="Transfer between accounts" onClose={() => setPanel(null)}>
        <SelectField label="From" value={fromId} onChange={setFromId} options={accountOptions} placeholder="Source account" />
        <SelectField label="To" value={toId} onChange={setToId} options={accountOptions.filter((o) => o.id !== fromId)} placeholder="Destination account" />
        <Field label="Amount" value={transferAmount} onChange={setTransferAmount} money />
        <Field label="Note (optional)" value={transferNote} onChange={setTransferNote} />
        <Button onClick={onTransfer} busy={busy} block>
          {busy ? 'Moving…' : 'Transfer'}
        </Button>
      </Modal>

      <Modal open={panel === 'reconcile'} title="Reconcile" onClose={() => setPanel(null)} wide>
        <div className="muted" style={{ fontSize: 13 }}>
          Stated balance vs ledger since your last manual set (income − expenses ± transfers).
        </div>
        {reconcileRows.length === 0 ? (
          <EmptyState title="Nothing to compare" body="Add an account first." />
        ) : (
          reconcileRows.map((row) => (
            <div key={row.account_id} className="card" style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 700 }}>{row.account_name}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                Stated {formatMoney(row.stated_balance, row.currency_code, locale)} · Ledger {formatMoney(row.expected_balance, row.currency_code, locale)}
              </div>
              <div style={{ color: row.in_sync ? 'var(--success)' : 'var(--warning)', fontWeight: 700, fontSize: 13 }}>
                {row.in_sync ? 'In sync' : `Difference ${formatMoney(row.difference, row.currency_code, locale)}`}
              </div>
              {!row.in_sync ? (
                <Button variant="secondary" size="sm" onClick={() => matchToLedger(row)} busy={busy}>
                  Set balance to ledger
                </Button>
              ) : null}
            </div>
          ))
        )}
      </Modal>

      <Modal open={panel === 'import'} title={`Import statement${activeAccount ? ` — ${activeAccount.name}` : ''}`} onClose={() => setPanel(null)}>
        <div className="muted" style={{ fontSize: 13 }}>
          CSV with Date + Amount (signed) or Debit/Credit columns. Re-uploads skip duplicates.
        </div>
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={(e) => e.target.files?.[0] && onPickFile(e.target.files[0])}
        />
        {importFileName ? <div className="muted" style={{ fontSize: 12 }}>File: {importFileName}</div> : null}
        <div className="section-label">Or paste CSV</div>
        <textarea
          className="textarea"
          value={importCsv}
          onChange={(e) => {
            setImportCsv(e.target.value);
            setImportFileName('');
            setImportResult(null);
          }}
          rows={6}
          placeholder={'Date,Amount,Description\n2026-01-05,-12.50,Coffee'}
        />
        <Field label="Ending balance (optional)" value={importEndingBalance} onChange={setImportEndingBalance} money placeholder="Set stated balance after import" />
        {importResult ? <div style={{ color: 'var(--primary)', fontWeight: 700, fontSize: 13 }}>{importResult}</div> : null}
        <Button onClick={onImportStatement} busy={busy} block>
          {busy ? 'Importing…' : 'Import'}
        </Button>
      </Modal>

      <Modal open={panel === 'installments'} title={`Installments${activeAccount ? ` — ${activeAccount.name}` : ''}`} onClose={() => setPanel(null)}>
        <div className="muted" style={{ fontSize: 13 }}>
          Each month we add the charge to this card until the plan is done.
        </div>
        {installments.length === 0 ? (
          <EmptyState title="No installment plans" body="Add a purchase split across months." />
        ) : (
          installments.map((row) => (
            <div key={row.id} className="card" style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 700 }}>{row.merchant}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {formatMoney(row.monthly_amount, row.currency_code, locale)} · {row.months_remaining}/{row.months_total} remaining {formatMoney(row.remaining_amount, row.currency_code, locale)}
              </div>
              {row.months_remaining > 0 ? (
                <Button variant="secondary" size="sm" onClick={() => void onDeleteInstallment(row.id)} busy={busy}>
                  Delete
                </Button>
              ) : null}
            </div>
          ))
        )}
        <Field label="Merchant" value={instMerchant} onChange={setInstMerchant} placeholder="Store or purchase" />
        <Field label="Total amount" value={instTotal} onChange={setInstTotal} money />
        <Field label="Months" value={instMonths} onChange={setInstMonths} placeholder="12" />
        <Field label="Monthly amount (optional)" value={instMonthly} onChange={setInstMonthly} money />
        <Button onClick={() => void onAddInstallment()} busy={busy} block>
          {busy ? 'Saving…' : 'Add installment'}
        </Button>
      </Modal>
    </div>
  );
}
