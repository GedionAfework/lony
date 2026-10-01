import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Landmark, Pencil, RefreshCw, Scale, Trash2, Upload, Wallet } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import {
  api,
  type AccountReconcile,
  type BankLinkConnection,
  type BankLinkStatus,
  type MoneyAccount,
} from '../lib/api';
import { formatMoney, stripAmount } from '../lib/format';
import type { CatalogOption } from '../lib/catalogs';
import { CURRENCIES } from '../lib/catalogs';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { Money } from '../components/Money';
import { Button } from '../components/Button';
import { Field, SelectField } from '../components/Field';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../components/Toast';

const FALLBACK_ACCOUNT_TYPES: CatalogOption[] = [
  { id: 'bank', label: 'Bank' },
  { id: 'cash', label: 'Cash' },
  { id: 'mobile_money', label: 'Mobile money' },
  { id: 'wallet', label: 'Wallet' },
  { id: 'other', label: 'Other' },
];

const COMPOUNDING = [
  { id: 'none', label: 'Simple (yearly)' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'yearly', label: 'Yearly compound' },
];

type Panel = null | 'create' | 'edit' | 'balance' | 'transfer' | 'reconcile' | 'import';

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
  const locale = user?.locale || 'en';

  const [accounts, setAccounts] = useState<MoneyAccount[]>([]);
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
  const [newBalance, setNewBalance] = useState('');

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
      .then((res) => setRemoteInstitutions((res.institutions ?? []).filter((i) => i.active).map((i) => ({ id: i.code, label: i.label }))))
      .catch(() => setRemoteInstitutions([]));
  }, [token, accountType]);

  function resetForm() {
    setAccountType('bank');
    setInstitutionId('');
    setInstitutionOther('');
    setCurrency((user?.default_currency_code || 'USD').toUpperCase());
    setBalance('0');
    setInterest('');
    setCompounding('none');
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
      await api.createAccount(token, {
        name: accountDisplayName(label),
        account_type: accountType as MoneyAccount['account_type'],
        currency_code: currency,
        balance: stripAmount(balance) || '0',
        interest_rate_percent: stripAmount(interest) || undefined,
        compounding: interest.trim() ? (compounding as 'none' | 'monthly' | 'yearly') : undefined,
        institution_label: label.trim() || undefined,
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
      const clear = !interest.trim();
      await api.updateAccount(token, activeId, {
        name: accountDisplayName(label),
        account_type: accountType as MoneyAccount['account_type'],
        currency_code: currency,
        interest_rate_percent: clear ? undefined : stripAmount(interest),
        compounding: clear ? undefined : (compounding as 'none' | 'monthly' | 'yearly'),
        institution_label: label.trim() || undefined,
        clear_interest: clear,
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

  async function onArchive(id: string) {
    if (!token) return;
    if (!window.confirm('Archive this account?')) return;
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
    try {
      await api.disconnectBankLink(token, c.id);
      await reload();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Disconnect failed');
    }
  }

  const accountOptions = accounts.map((a) => ({ id: a.id, label: `${a.name} (${a.currency_code})` }));
  const activeAccount = accounts.find((a) => a.id === activeId);

  return (
    <div className="page">
      <PageHeader
        title="Accounts"
        subtitle="Cash, bank, mobile money, and wallet balances"
        right={
          <div className="flex-row">
            {accounts.length >= 1 ? (
              <Button variant="secondary" size="sm" onClick={onReconcile} busy={busy}>
                <Scale size={14} /> Reconcile
              </Button>
            ) : null}
            {accounts.length >= 2 ? (
              <Button variant="secondary" size="sm" onClick={() => setPanel('transfer')}>
                <ArrowLeftRight size={14} /> Transfer
              </Button>
            ) : null}
            <Button size="sm" onClick={openCreate}>
              <Wallet size={14} /> Add account
            </Button>
          </div>
        }
      />

      <Card>
        <div className="section-label">Linked banks</div>
        <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
          {bankStatus?.available ? 'Bank linking is ready — connect an institution to auto-import transactions.' : bankStatus?.message || 'Bank linking is unavailable right now.'}
        </div>
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

      <Card>
        <div className="section-label">Your accounts</div>
        {accounts.length === 0 ? (
          <EmptyState icon={<Wallet size={22} />} title="No accounts yet" body="Add cash, bank, mobile money, or wallet balances for net worth tracking." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Type</th>
                  <th style={{ textAlign: 'right' }}>Balance</th>
                  <th>Interest</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <div style={{ fontWeight: 700 }}>{a.name}</div>
                      {a.institution_label ? <div className="muted" style={{ fontSize: 12 }}>{a.institution_label}</div> : null}
                    </td>
                    <td className="muted">
                      {accountTypes.find((t) => t.id === a.account_type)?.label || a.account_type} · {a.currency_code}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <Money value={a.balance} currency={a.currency_code} locale={locale} />
                    </td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {a.interest_rate_percent
                        ? `${a.interest_rate_percent}% ${a.compounding || 'none'}${a.projected_balance_12m ? ` → ~${formatMoney(a.projected_balance_12m, a.currency_code, locale)}/12mo` : ''}`
                        : '—'}
                    </td>
                    <td>
                      <div className="flex-row" style={{ justifyContent: 'flex-end' }}>
                        <Button
                          variant="icon"
                          aria-label="Update balance"
                          onClick={() => {
                            setActiveId(a.id);
                            setNewBalance(a.balance);
                            setPanel('balance');
                          }}
                        >
                          <Scale size={15} />
                        </Button>
                        <Button
                          variant="icon"
                          aria-label="Import statement"
                          onClick={() => {
                            setActiveId(a.id);
                            setImportCsv('');
                            setImportFileName('');
                            setImportEndingBalance('');
                            setImportResult(null);
                            setPanel('import');
                          }}
                        >
                          <Upload size={15} />
                        </Button>
                        <Button variant="icon" aria-label="Edit" onClick={() => openEdit(a)}>
                          <Pencil size={15} />
                        </Button>
                        <Button variant="icon" aria-label="Archive" onClick={() => onArchive(a.id)}>
                          <Trash2 size={15} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

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
        {panel === 'create' ? <Field label="Current balance" value={balance} onChange={setBalance} money /> : null}
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
    </div>
  );
}
