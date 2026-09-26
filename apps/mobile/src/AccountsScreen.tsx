import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { api, type AccountReconcile, type MoneyAccount, type User } from './api';
import { stripAmount } from './amountFormat';
import type { CatalogOption } from './catalogs';
import { CURRENCIES } from './catalogs';
import {
  institutionsForAccountType,
} from './institutions';
import { SearchSelect } from './SearchSelect';
import { fonts, radii, space, useTheme } from './theme';
import { Card, EmptyState, Field, PrimaryButton, SecondaryButton, SectionLabel } from './ui';

type Props = {
  user: User;
  token: string;
  formatMoney: (amount: string | null | undefined, currency: string | null | undefined, locale?: string) => string;
  onError: (message: string) => void;
  reloadToken?: number;
};

const FALLBACK_ACCOUNT_TYPES: CatalogOption[] = [
  { id: 'bank', label: 'Bank', keywords: 'bank' },
  { id: 'cash', label: 'Cash', keywords: 'cash' },
  { id: 'mobile_money', label: 'Mobile money', keywords: 'mobile money momo' },
  { id: 'wallet', label: 'Wallet', keywords: 'wallet fintech' },
  { id: 'other', label: 'Other', keywords: 'other' },
];

const COMPOUNDING = [
  { id: 'none', label: 'Simple (yearly)' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'yearly', label: 'Yearly compound' },
];

function defaultCurrency(user: User): string {
  return (user.default_currency_code || 'USD').toUpperCase();
}

function mergeOptions(primary: CatalogOption[], fallback: CatalogOption[]): CatalogOption[] {
  const seen = new Set<string>();
  const out: CatalogOption[] = [];
  for (const o of [...primary, ...fallback]) {
    if (!o.id || seen.has(o.id)) continue;
    seen.add(o.id);
    out.push({
      ...o,
      keywords: o.keywords || `${o.id} ${o.label}`.toLowerCase(),
    });
  }
  if (!seen.has('other')) {
    out.push({ id: 'other', label: 'Other', keywords: 'other custom' });
  }
  return out;
}

export function AccountsScreen({ user, token, formatMoney, onError, reloadToken = 0 }: Props) {
  const { colors } = useTheme();
  const [accounts, setAccounts] = useState<MoneyAccount[]>([]);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [balanceId, setBalanceId] = useState<string | null>(null);

  const [accountType, setAccountType] = useState('bank');
  const [institutionId, setInstitutionId] = useState('');
  const [institutionOther, setInstitutionOther] = useState('');
  const [currency, setCurrency] = useState(defaultCurrency(user));
  const [balance, setBalance] = useState('0');
  const [interest, setInterest] = useState('');
  const [compounding, setCompounding] = useState('none');
  const [newBalance, setNewBalance] = useState('');
  const [transferOpen, setTransferOpen] = useState(false);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferNote, setTransferNote] = useState('');
  const [remoteTypes, setRemoteTypes] = useState<CatalogOption[]>([]);
  const [remoteInstitutions, setRemoteInstitutions] = useState<CatalogOption[]>([]);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconcileRows, setReconcileRows] = useState<AccountReconcile[]>([]);
  const [importId, setImportId] = useState<string | null>(null);
  const [importCsv, setImportCsv] = useState('');
  const [importFileName, setImportFileName] = useState('');
  const [importEndingBalance, setImportEndingBalance] = useState('');
  const [importResult, setImportResult] = useState<string | null>(null);

  const accountTypes = useMemo(
    () => mergeOptions(remoteTypes, FALLBACK_ACCOUNT_TYPES),
    [remoteTypes],
  );

  const institutionOptions = useMemo(
    () => mergeOptions(remoteInstitutions, institutionsForAccountType(accountType)),
    [remoteInstitutions, accountType],
  );
  const needsOtherInstitution =
    !institutionId ||
    institutionId === 'other' ||
    accountType === 'other';

  const reload = useCallback(async () => {
    try {
      const res = await api.listAccounts(token);
      setAccounts(res.accounts ?? []);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not load accounts');
    }
  }, [token, onError]);

  useEffect(() => {
    void reload();
  }, [reload, reloadToken]);

  useEffect(() => {
    let cancelled = false;
    api
      .listCatalogTypes(token, 'account_type')
      .then((res) => {
        if (cancelled) return;
        setRemoteTypes(
          (res.types ?? [])
            .filter((t) => t.active)
            .map((t) => ({
              id: t.code,
              label: t.label,
              keywords: `${t.code} ${t.label}`.toLowerCase(),
            })),
        );
      })
      .catch(() => {
        if (!cancelled) setRemoteTypes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    api
      .listCatalogInstitutions(token, 'account_type', accountType)
      .then((res) => {
        if (cancelled) return;
        setRemoteInstitutions(
          (res.institutions ?? [])
            .filter((i) => i.active)
            .map((i) => ({
              id: i.code,
              label: i.label,
              keywords: `${i.code} ${i.label} ${i.country_code || ''}`.toLowerCase(),
            })),
        );
      })
      .catch(() => {
        if (!cancelled) setRemoteInstitutions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [token, accountType]);

  function resetForm() {
    setAccountType('bank');
    setInstitutionId('');
    setInstitutionOther('');
    setCurrency(defaultCurrency(user));
    setBalance('0');
    setInterest('');
    setCompounding('none');
    setCreating(false);
    setEditId(null);
  }

  function accountDisplayName(type: string, institutionLabel: string): string {
    const typeLabel = accountTypes.find((t) => t.id === type)?.label || type;
    if (institutionLabel.trim()) return institutionLabel.trim();
    return typeLabel;
  }

  function resolveInstitution(type: string, instId: string, other: string): string {
    if (!instId || instId === 'other') {
      return other.trim() || (type === 'cash' ? 'Cash' : '');
    }
    const hit = institutionOptions.find((o) => o.id === instId);
    if (!hit || hit.id === 'other') return other.trim();
    return hit.label;
  }

  function startEdit(a: MoneyAccount) {
    setCreating(false);
    setBalanceId(null);
    setEditId(a.id);
    setAccountType(a.account_type);
    setInterest(a.interest_rate_percent || '');
    setCompounding(a.compounding || 'none');
    setCurrency(a.currency_code);
    const label = (a.institution_label || '').trim();
    const opts = mergeOptions([], institutionsForAccountType(a.account_type));
    // Prefer currently loaded remote+local options when type matches
    const pool = a.account_type === accountType ? institutionOptions : opts;
    const hit = pool.find((o) => o.label.toLowerCase() === label.toLowerCase());
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
  }

  async function onCreate() {
    const institutionLabel = resolveInstitution(accountType, institutionId, institutionOther);
    if (accountType !== 'cash' && !institutionLabel.trim()) {
      onError('Choose an institution');
      return;
    }
    setBusy(true);
    try {
      const name = accountDisplayName(accountType, institutionLabel);
      await api.createAccount(token, {
        name,
        account_type: accountType as MoneyAccount['account_type'],
        currency_code: currency,
        balance: stripAmount(balance) || '0',
        interest_rate_percent: stripAmount(interest) || undefined,
        compounding: interest.trim() ? (compounding as 'none' | 'monthly' | 'yearly') : undefined,
        institution_label: institutionLabel.trim() || undefined,
      });
      resetForm();
      await reload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not create account');
    } finally {
      setBusy(false);
    }
  }

  async function onSaveEdit() {
    if (!editId) return;
    const institutionLabel = resolveInstitution(accountType, institutionId, institutionOther);
    if (accountType !== 'cash' && !institutionLabel.trim()) {
      onError('Choose an institution');
      return;
    }
    setBusy(true);
    try {
      const clear = !interest.trim();
      await api.updateAccount(token, editId, {
        name: accountDisplayName(accountType, institutionLabel),
        account_type: accountType as MoneyAccount['account_type'],
        currency_code: currency,
        interest_rate_percent: clear ? undefined : stripAmount(interest),
        compounding: clear ? undefined : (compounding as 'none' | 'monthly' | 'yearly'),
        institution_label: institutionLabel.trim() || undefined,
        clear_interest: clear,
      });
      resetForm();
      await reload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not update account');
    } finally {
      setBusy(false);
    }
  }

  async function onSaveBalance() {
    if (!balanceId) return;
    setBusy(true);
    try {
      await api.setAccountBalance(token, balanceId, { balance: stripAmount(newBalance) || '0' });
      setBalanceId(null);
      setNewBalance('');
      await reload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not update balance');
    } finally {
      setBusy(false);
    }
  }

  async function onArchive(id: string) {
    setBusy(true);
    try {
      await api.archiveAccount(token, id);
      await reload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not archive');
    } finally {
      setBusy(false);
    }
  }

  async function onTransfer() {
    if (!fromId || !toId) {
      onError('Pick both accounts');
      return;
    }
    if (fromId === toId) {
      onError('Pick two different accounts');
      return;
    }
    const amt = stripAmount(transferAmount);
    if (!amt || Number(amt) <= 0) {
      onError('Enter a positive amount');
      return;
    }
    setBusy(true);
    try {
      await api.transferAccounts(token, {
        from_account_id: fromId,
        to_account_id: toId,
        amount: amt,
        note: transferNote.trim() || undefined,
      });
      setTransferOpen(false);
      setFromId('');
      setToId('');
      setTransferAmount('');
      setTransferNote('');
      await reload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Transfer failed');
    } finally {
      setBusy(false);
    }
  }

  async function onReconcile() {
    setBusy(true);
    try {
      const res = await api.reconcileAccounts(token);
      setReconcileRows(res.reconcile ?? []);
      setReconcileOpen(true);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not reconcile');
    } finally {
      setBusy(false);
    }
  }

  async function matchToLedger(row: AccountReconcile) {
    setBusy(true);
    try {
      await api.setAccountBalance(token, row.account_id, {
        balance: row.expected_balance,
        note: 'reconcile to ledger',
      });
      await reload();
      const res = await api.reconcileAccounts(token);
      setReconcileRows(res.reconcile ?? []);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not update balance');
    } finally {
      setBusy(false);
    }
  }

  function resetImport() {
    setImportId(null);
    setImportCsv('');
    setImportFileName('');
    setImportEndingBalance('');
    setImportResult(null);
  }

  async function pickImportFile() {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      const text = await FileSystem.readAsStringAsync(asset.uri);
      setImportCsv(text);
      setImportFileName(asset.name || 'statement.csv');
      setImportResult(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not open file');
    }
  }

  async function onImportStatement() {
    if (!importId) return;
    const csv = importCsv.trim();
    if (!csv) {
      onError('Paste CSV or pick a statement file');
      return;
    }
    setBusy(true);
    setImportResult(null);
    try {
      const ending = stripAmount(importEndingBalance);
      const res = await api.importAccountStatement(token, importId, {
        csv,
        set_balance: ending && Number(ending) >= 0 ? ending : undefined,
        balance_note: ending ? 'statement import ending balance' : undefined,
      });
      const errN = res.import.errors?.length ?? 0;
      const msg = `Imported ${res.import.imported}, skipped ${res.import.skipped}${
        errN ? `, ${errN} row issue(s)` : ''
      }.`;
      setImportResult(msg);
      if (errN && res.import.errors[0]) {
        Alert.alert('Import notes', res.import.errors.slice(0, 5).join('\n'));
      }
      await reload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  const formOpen = creating || editId;
  const panelOpen = formOpen || transferOpen || reconcileOpen || Boolean(importId);
  const accountOptions = accounts.map((a) => ({
    id: a.id,
    label: `${a.name} (${a.currency_code})`,
    keywords: `${a.name} ${a.currency_code}`.toLowerCase(),
  }));
  const importAccount = accounts.find((a) => a.id === importId);

  return (
    <View style={{ gap: space.md }}>
      <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>Accounts</Text>

      {!panelOpen ? (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <View style={{ flex: 1, minWidth: 100 }}>
            <PrimaryButton
              label="Add account"
              onPress={() => {
                resetForm();
                setCreating(true);
              }}
            />
          </View>
          {accounts.length >= 1 ? (
            <View style={{ flex: 1, minWidth: 100 }}>
              <SecondaryButton label="Reconcile" onPress={() => void onReconcile()} />
            </View>
          ) : null}
          {accounts.length >= 2 ? (
            <View style={{ flex: 1, minWidth: 100 }}>
              <SecondaryButton label="Transfer" onPress={() => setTransferOpen(true)} />
            </View>
          ) : null}
        </View>
      ) : null}

      {importId && importAccount ? (
        <Card>
          <SectionLabel>Import statement · {importAccount.name}</SectionLabel>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
            CSV with Date + Amount (signed) or Debit/Credit columns. Re-uploads skip duplicates.
          </Text>
          <SecondaryButton
            label={importFileName ? `File: ${importFileName}` : 'Pick CSV file'}
            onPress={() => void pickImportFile()}
            disabled={busy}
          />
          <View style={{ gap: 6 }}>
            <Text
              style={{
                color: colors.muted,
                fontFamily: fonts.uiSemi,
                fontSize: 12,
                letterSpacing: 0.4,
                textTransform: 'uppercase',
              }}
            >
              Or paste CSV
            </Text>
            <TextInput
              value={importCsv}
              onChangeText={(v) => {
                setImportCsv(v);
                setImportFileName('');
                setImportResult(null);
              }}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={'Date,Amount,Description\n2026-01-05,-12.50,Coffee'}
              placeholderTextColor={colors.muted}
              style={{
                backgroundColor: colors.surfaceMuted,
                color: colors.text,
                fontFamily: fonts.ui,
                fontSize: 14,
                borderRadius: radii.md,
                paddingHorizontal: 12,
                paddingVertical: 10,
                minHeight: 120,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            />
          </View>
          <Field
            label="Ending balance (optional)"
            value={importEndingBalance}
            onChange={setImportEndingBalance}
            money
            placeholder="Set stated balance after import"
          />
          {importResult ? (
            <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 13 }}>{importResult}</Text>
          ) : null}
          <PrimaryButton
            label={busy ? 'Importing…' : 'Import'}
            onPress={() => void onImportStatement()}
            disabled={busy}
          />
          <SecondaryButton label="Done" onPress={resetImport} />
        </Card>
      ) : null}

      {reconcileOpen ? (
        <Card>
          <SectionLabel>Reconcile balances</SectionLabel>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
            Stated balance vs ledger since your last manual set (income − expenses ± transfers).
          </Text>
          {reconcileRows.length === 0 ? (
            <EmptyState title="Nothing to compare" body="Add an account first." />
          ) : (
            reconcileRows.map((row) => (
              <View
                key={row.account_id}
                style={{
                  gap: 6,
                  paddingVertical: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                }}
              >
                <Text style={{ color: colors.text, fontFamily: fonts.uiSemi }}>{row.account_name}</Text>
                <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                  Stated {formatMoney(row.stated_balance, row.currency_code, user.locale)} · Ledger{' '}
                  {formatMoney(row.expected_balance, row.currency_code, user.locale)}
                </Text>
                <Text
                  style={{
                    color: row.in_sync ? colors.primary : colors.warning,
                    fontFamily: fonts.uiSemi,
                    fontSize: 13,
                  }}
                >
                  {row.in_sync
                    ? 'In sync'
                    : `Difference ${formatMoney(row.difference, row.currency_code, user.locale)}`}
                </Text>
                <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 11 }}>
                  Since baseline: +{row.income_since} in · −{row.expense_since} out · transfers +
                  {row.transfers_in_since}/−{row.transfers_out_since}
                </Text>
                {Number(row.unassigned_confirmed) !== 0 ? (
                  <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 11 }}>
                    Unassigned confirmed cashflow (same currency): {row.unassigned_confirmed}
                  </Text>
                ) : null}
                {!row.in_sync ? (
                  <SecondaryButton
                    label={busy ? 'Updating…' : 'Set balance to ledger'}
                    onPress={() => void matchToLedger(row)}
                    disabled={busy}
                  />
                ) : null}
              </View>
            ))
          )}
          <SecondaryButton
            label="Done"
            onPress={() => {
              setReconcileOpen(false);
              setReconcileRows([]);
            }}
          />
        </Card>
      ) : null}

      {transferOpen ? (
        <Card>
          <SectionLabel>Transfer between accounts</SectionLabel>
          <SearchSelect label="From" value={fromId} onChange={setFromId} options={accountOptions} />
          <SearchSelect
            label="To"
            value={toId}
            onChange={setToId}
            options={accountOptions.filter((o) => o.id !== fromId)}
          />
          <Field label="Amount" value={transferAmount} onChange={setTransferAmount} money />
          <Field label="Note (optional)" value={transferNote} onChange={setTransferNote} />
          <PrimaryButton label={busy ? 'Moving…' : 'Transfer'} onPress={onTransfer} disabled={busy} />
          <SecondaryButton
            label="Cancel"
            onPress={() => {
              setTransferOpen(false);
              setFromId('');
              setToId('');
              setTransferAmount('');
              setTransferNote('');
            }}
          />
        </Card>
      ) : null}

      {formOpen ? (
        <Card>
          <SectionLabel>{editId ? 'Edit account' : 'New account'}</SectionLabel>
          <SearchSelect
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
              <SearchSelect
                label="Institution"
                value={institutionId}
                onChange={setInstitutionId}
                options={institutionOptions}
                placeholder="Search institution"
              />
              {needsOtherInstitution ? (
                <Field
                  label="Institution name"
                  value={institutionOther}
                  onChange={setInstitutionOther}
                  placeholder="Type the institution name"
                />
              ) : null}
            </>
          ) : null}
          <SearchSelect label="Currency" value={currency} onChange={setCurrency} options={CURRENCIES} />
          {!editId ? (
            <Field label="Current balance" value={balance} onChange={setBalance} money />
          ) : null}
          <Field
            label="Interest rate % (optional)"
            value={interest}
            onChange={setInterest}
            keyboardType="decimal-pad"
            placeholder="e.g. 8"
          />
          {interest.trim() ? (
            <SearchSelect label="Compounding" value={compounding} onChange={setCompounding} options={COMPOUNDING} />
          ) : null}
          <PrimaryButton
            label={busy ? 'Saving…' : editId ? 'Save changes' : 'Create'}
            onPress={editId ? onSaveEdit : onCreate}
            disabled={busy}
          />
          <SecondaryButton label="Cancel" onPress={resetForm} />
        </Card>
      ) : null}

      {balanceId ? (
        <Card>
          <SectionLabel>Update balance</SectionLabel>
          <Field label="New balance" value={newBalance} onChange={setNewBalance} money />
          <PrimaryButton label={busy ? 'Saving…' : 'Save balance'} onPress={onSaveBalance} disabled={busy} />
          <SecondaryButton
            label="Cancel"
            onPress={() => {
              setBalanceId(null);
              setNewBalance('');
            }}
          />
        </Card>
      ) : null}

      <Card>
        <SectionLabel>Your accounts</SectionLabel>
        {accounts.length === 0 ? (
          <EmptyState
            title="No accounts yet"
            body="Add cash, bank, mobile money, or wallet balances for net worth."
          />
        ) : (
          accounts.map((a) => (
            <View
              key={a.id}
              style={{
                gap: 8,
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 15 }}>{a.name}</Text>
                  <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                    {accountTypes.find((t) => t.id === a.account_type)?.label || a.account_type}
                    {a.institution_label ? ` · ${a.institution_label}` : ''}
                    {` · ${a.currency_code}`}
                  </Text>
                </View>
                <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 15 }}>
                  {formatMoney(a.balance, a.currency_code, user.locale)}
                </Text>
              </View>
              {a.interest_rate_percent ? (
                <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                  {a.interest_rate_percent}% {a.compounding || 'none'}
                  {a.projected_balance_12m
                    ? ` → ~${formatMoney(a.projected_balance_12m, a.currency_code, user.locale)} in 12 mo`
                    : ''}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <Chip
                  label="Balance"
                  onPress={() => {
                    setEditId(null);
                    setCreating(false);
                    setBalanceId(a.id);
                    setNewBalance(a.balance);
                  }}
                />
                <Chip
                  label="Import"
                  onPress={() => {
                    resetForm();
                    setTransferOpen(false);
                    setReconcileOpen(false);
                    setImportId(a.id);
                    setImportCsv('');
                    setImportFileName('');
                    setImportEndingBalance('');
                    setImportResult(null);
                  }}
                />
                <Chip label="Edit" onPress={() => startEdit(a)} />
                <Chip label="Archive" onPress={() => onArchive(a.id)} danger />
              </View>
            </View>
          ))
        )}
      </Card>
    </View>
  );
}

function Chip({
  label,
  onPress,
  danger,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: radii.full,
        backgroundColor: danger ? colors.warningSoft : colors.primarySoft,
        borderWidth: 1,
        borderColor: danger ? colors.warning : colors.primary,
      }}
    >
      <Text
        style={{
          color: danger ? colors.warning : colors.primary,
          fontFamily: fonts.uiSemi,
          fontSize: 12,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
