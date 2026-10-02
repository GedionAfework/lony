import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import { api, type AccountReconcile, type BankLinkConnection, type BankLinkStatus, type MoneyAccount, type User } from './api';
import { stripAmount } from './amountFormat';
import type { CatalogOption } from './catalogs';
import { CURRENCIES } from './catalogs';
import { t } from './i18n';
import {
  institutionsForAccountType,
} from './institutions';
import { SearchSelect } from './SearchSelect';
import { IconBalance, IconEdit, IconTrash, IconUpload } from './icons';
import { fonts, radii, space, useTheme } from './theme';
import { Card, EmptyState, Field, PrimaryButton, ScreenHeader, SecondaryButton, SectionLabel } from './ui';

type Props = {
  user: User;
  token: string;
  formatMoney: (amount: string | null | undefined, currency: string | null | undefined, locale?: string) => string;
  onError: (message: string) => void;
  reloadToken?: number;
  onPanelChange?: (open: boolean) => void;
  onChanged?: () => void;
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

export function AccountsScreen({
  user,
  token,
  formatMoney,
  onError,
  reloadToken = 0,
  onPanelChange,
  onChanged,
}: Props) {
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
  const [bankStatus, setBankStatus] = useState<BankLinkStatus | null>(null);
  const [bankConnections, setBankConnections] = useState<BankLinkConnection[]>([]);
  const [acceptId, setAcceptId] = useState<string | null>(null);
  const [acceptFullName, setAcceptFullName] = useState('');
  const [acceptAccountNumber, setAcceptAccountNumber] = useState('');
  const [acceptProfit, setAcceptProfit] = useState('');
  const [acceptBusy, setAcceptBusy] = useState(false);

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
      const links = await api.listBankLinks(token).catch(() => null);
      if (links) {
        setBankStatus(links.status);
        setBankConnections(links.connections ?? []);
      } else {
        const st = await api.bankLinkStatus(token).catch(() => null);
        if (st) setBankStatus(st);
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not load accounts');
    }
  }, [token, onError]);

  async function onConnectBank() {
    setBusy(true);
    try {
      const session = await api.createBankLinkSession(token);
      const url = session.link_url;
      if (!url) {
        onError('Bank link URL missing — set PUBLIC_BASE_URL on the API.');
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(url, 'lony://bank-link');
      if (result.type === 'success' && result.url) {
        const q = result.url.split('?')[1] || '';
        const params = new URLSearchParams(q);
        if (params.get('cancelled')) return;
        const publicToken = params.get('public_token');
        if (publicToken) {
          const linked = await api.exchangeBankLink(token, publicToken);
          try {
            await api.syncBankLink(token, linked.connection.id);
          } catch {
            /* sync can be retried manually */
          }
          await reload();
        }
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : t(user.locale, 'bankLinkUnavailable'));
    } finally {
      setBusy(false);
    }
  }

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
      onChanged?.();
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
      onChanged?.();
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
      onChanged?.();
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

  function startAccept(a: MoneyAccount) {
    resetForm();
    setTransferOpen(false);
    setReconcileOpen(false);
    setImportId(null);
    setBalanceId(null);
    setAcceptId(a.id);
    setAcceptFullName(user.display_name || '');
    setAcceptAccountNumber('');
    setAcceptProfit(a.interest_rate_percent || '');
  }

  async function onScanAcceptStatement() {
    if (!acceptId) return;
    const cam = await ImagePicker.requestCameraPermissionsAsync();
    if (!cam.granted) {
      Alert.alert(
        t(user.locale, 'accounts.cameraPermission') || 'Camera permission',
        t(user.locale, 'accounts.cameraPermissionBody') || 'Allow camera to scan the statement.',
      );
      return;
    }
    const pick = await ImagePicker.launchCameraAsync({
      quality: 0.45,
      base64: true,
      allowsEditing: false,
      exif: false,
    });
    if (pick.canceled || !pick.assets?.[0]?.base64) return;
    setAcceptBusy(true);
    try {
      const res = await api.extractBankProfile(token, {
        mime: pick.assets[0].mimeType || 'image/jpeg',
        image_base64: pick.assets[0].base64!,
      });
      const e = res.extract;
      if (e.full_name) setAcceptFullName(e.full_name);
      if (e.account_number) setAcceptAccountNumber(e.account_number);
      if (e.profit_percent_yearly) setAcceptProfit(e.profit_percent_yearly);
    } catch (err) {
      onError(err instanceof Error ? err.message : t(user.locale, 'accounts.scanFailed') || 'Could not read statement');
    } finally {
      setAcceptBusy(false);
    }
  }

  async function onConfirmAccept() {
    if (!acceptId) return;
    const name = acceptFullName.trim();
    const number = acceptAccountNumber.trim();
    if (!name) {
      onError(t(user.locale, 'accounts.fullNameRequired') || 'Enter the account holder full name');
      return;
    }
    if (!number) {
      onError(t(user.locale, 'accounts.accountNumberRequired') || 'Enter the account number');
      return;
    }
    setAcceptBusy(true);
    try {
      const profit = stripAmount(acceptProfit);
      const res = await api.acceptAccountForLoans(token, acceptId, {
        full_name: name,
        account_identifier: number,
        profit_percent_yearly: profit || undefined,
      });
      setAcceptId(null);
      await reload();
      onChanged?.();
      if (res.account_number_masked) {
        Alert.alert(
          t(user.locale, 'accounts.maskedTitle') || 'Account number incomplete',
          t(user.locale, 'accounts.maskedBody') ||
            'Some digits were hidden. We’ll remind you in notifications to enter the full number before sharing for loan repayments.',
        );
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : t(user.locale, 'accounts.acceptFailed') || 'Could not accept account');
    } finally {
      setAcceptBusy(false);
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
      let text = '';
      if (Platform.OS === 'web' && typeof fetch === 'function') {
        text = await fetch(asset.uri).then((r) => r.text());
      } else {
        text = await FileSystem.readAsStringAsync(asset.uri);
      }
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

  const formOpen = creating || Boolean(editId);
  const panelOpen = formOpen || transferOpen || reconcileOpen || Boolean(importId) || Boolean(balanceId);
  useEffect(() => {
    onPanelChange?.(Boolean(panelOpen));
  }, [panelOpen, onPanelChange]);

  function closePanel() {
    resetForm();
    setTransferOpen(false);
    setReconcileOpen(false);
    resetImport();
    setBalanceId(null);
    setNewBalance('');
    setReconcileRows([]);
    setAcceptId(null);
  }

  function panelTitle() {
    if (importId) return 'Import statement';
    if (reconcileOpen) return 'Reconcile';
    if (transferOpen) return 'Transfer';
    if (balanceId) return 'Update balance';
    if (editId) return 'Edit account';
    return 'New account';
  }

  const accountOptions = accounts.map((a) => ({
    id: a.id,
    label: `${a.name} (${a.currency_code})`,
    keywords: `${a.name} ${a.currency_code}`.toLowerCase(),
  }));
  const importAccount = accounts.find((a) => a.id === importId);

  return (
    <View style={{ gap: space.md }}>
      {panelOpen ? (
        <ScreenHeader title={panelTitle()} onBack={closePanel} />
      ) : (
        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>
          {t(user.locale, 'accounts')}
        </Text>
      )}

      {!panelOpen ? (
      <>
      <Card>
        <SectionLabel>{t(user.locale, 'linkedBanks')}</SectionLabel>
        <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13, marginBottom: 8 }}>
          {bankStatus?.available
            ? t(user.locale, 'bankLinkReady')
            : bankStatus?.message || t(user.locale, 'bankLinkUnavailable')}
        </Text>
        {bankConnections.map((c) => (
          <View
            key={c.id}
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingVertical: 8,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              gap: 8,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 14 }}>
                {c.institution_label || c.provider}
              </Text>
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                {c.status}
                {c.last_synced_at ? ` · synced ${new Date(c.last_synced_at).toLocaleDateString()}` : ''}
              </Text>
            </View>
            <Pressable
              onPress={async () => {
                setBusy(true);
                try {
                  const res = await api.syncBankLink(token, c.id);
                  onError(`Synced ${res.imported} new · skipped ${res.skipped}`);
                  await reload();
                } catch (e) {
                  onError(e instanceof Error ? e.message : 'Sync failed');
                } finally {
                  setBusy(false);
                }
              }}
              hitSlop={8}
              accessibilityLabel="Sync bank"
              disabled={busy || c.status !== 'active'}
              style={{
                paddingHorizontal: 10,
                height: 40,
                borderRadius: radii.full,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.primarySoft,
                borderWidth: 1,
                borderColor: colors.primary,
                opacity: busy || c.status !== 'active' ? 0.45 : 1,
              }}
            >
              <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 12 }}>Sync</Text>
            </Pressable>
            <Pressable
              onPress={async () => {
                try {
                  await api.disconnectBankLink(token, c.id);
                  await reload();
                } catch (e) {
                  onError(e instanceof Error ? e.message : 'Disconnect failed');
                }
              }}
              hitSlop={8}
              accessibilityLabel={t(user.locale, 'disconnect')}
              style={{
                width: 40,
                height: 40,
                borderRadius: radii.full,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.warningSoft,
              }}
            >
              <IconTrash size={16} color={colors.error} />
            </Pressable>
          </View>
        ))}
        {bankStatus?.available ? (
          <PrimaryButton
            label={busy ? '…' : t(user.locale, 'connectBank')}
            onPress={() => void onConnectBank()}
            disabled={busy}
          />
        ) : null}
      </Card>

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
      </>
      ) : null}

      {importId && importAccount ? (
        <Card>
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
          </Card>
        ) : null}

        {reconcileOpen ? (
          <Card>
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
          </Card>
        ) : null}

        {transferOpen ? (
          <Card>
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
          </Card>
        ) : null}

        {formOpen ? (
          <Card>
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
          </Card>
        ) : null}

        {balanceId ? (
          <Card>
            <Field label="New balance" value={newBalance} onChange={setNewBalance} money />
            <PrimaryButton label={busy ? 'Saving…' : 'Save balance'} onPress={onSaveBalance} disabled={busy} />
          </Card>
        ) : null}

      {!panelOpen ? (
      <Card>
        <SectionLabel>Your accounts</SectionLabel>
        {accounts.length === 0 ? (
          <EmptyState
            title="No accounts yet"
            body="Add cash, bank, mobile money, or wallet balances for net worth."
          />
        ) : (
          accounts.map((a) => {
            const typeLabel = accountTypes.find((t) => t.id === a.account_type)?.label || a.account_type;
            const last4 = `${a.name} ${a.institution_label || ''}`.match(/(\d{4})\b/)?.[1];
            return (
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
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <View
                      style={{
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        borderRadius: radii.sm,
                        backgroundColor:
                          a.account_type === 'cash'
                            ? colors.surfaceMuted
                            : a.account_type === 'mobile_money'
                              ? colors.warningSoft
                              : colors.primarySoft,
                        borderWidth: 1,
                        borderColor:
                          a.account_type === 'cash'
                            ? colors.border
                            : a.account_type === 'mobile_money'
                              ? colors.warning
                              : colors.primary,
                      }}
                    >
                      <Text
                        style={{
                          color:
                            a.account_type === 'cash'
                              ? colors.muted
                              : a.account_type === 'mobile_money'
                                ? colors.warning
                                : colors.primary,
                          fontFamily: fonts.uiSemi,
                          fontSize: 11,
                        }}
                      >
                        {typeLabel}
                      </Text>
                    </View>
                    {a.bank_profile_id ? (
                      <View
                        style={{
                          paddingHorizontal: 8,
                          paddingVertical: 3,
                          borderRadius: radii.sm,
                          backgroundColor: colors.successSoft,
                        }}
                      >
                        <Text style={{ color: colors.success, fontFamily: fonts.uiSemi, fontSize: 11 }}>
                          {t(user.locale, 'accounts.forLoans') || 'For loans'}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 15 }}>{a.name}</Text>
                  <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                    {a.institution_label && a.institution_label !== a.name ? `${a.institution_label} · ` : ''}
                    {a.currency_code}
                    {last4 ? ` · ••••${last4}` : ''}
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
                {!a.bank_profile_id && a.account_type !== 'cash' ? (
                  <Pressable
                    onPress={() => startAccept(a)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: radii.md,
                      backgroundColor: colors.primarySoft,
                      borderWidth: 1,
                      borderColor: colors.primary,
                    }}
                  >
                    <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 12 }}>
                      {t(user.locale, 'accounts.accept') || 'Accept'}
                    </Text>
                  </Pressable>
                ) : null}
                <IconAction
                  accessibilityLabel="Update balance"
                  onPress={() => {
                    setEditId(null);
                    setCreating(false);
                    setAcceptId(null);
                    setBalanceId(a.id);
                    setNewBalance(a.balance);
                  }}
                >
                  <IconBalance size={16} color={colors.primary} />
                </IconAction>
                <IconAction
                  accessibilityLabel="Import statement"
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
                >
                  <IconUpload size={16} color={colors.primary} />
                </IconAction>
                <IconAction accessibilityLabel="Edit" onPress={() => startEdit(a)}>
                  <IconEdit size={16} color={colors.primary} />
                </IconAction>
                <IconAction accessibilityLabel="Archive" danger onPress={() => onArchive(a.id)}>
                  <IconTrash size={16} color={colors.warning} />
                </IconAction>
              </View>
            </View>
            );
          })
        )}
      </Card>
      ) : null}

      <Modal visible={Boolean(acceptId)} transparent animationType="slide" onRequestClose={() => setAcceptId(null)}>
        <Pressable
          onPress={() => !acceptBusy && setAcceptId(null)}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={{
              backgroundColor: colors.surface,
              borderTopLeftRadius: radii.xl,
              borderTopRightRadius: radii.xl,
              padding: space.lg,
              maxHeight: '88%',
              gap: space.md,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <View style={{ alignItems: 'center', marginBottom: 4 }}>
              <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
            </View>
            <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 20 }}>
              {t(user.locale, 'accounts.acceptTitle') || 'Accept for loan repayments'}
            </Text>
            <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
              {t(user.locale, 'accounts.acceptHint') ||
                'Scan a statement or fill in the holder name, account number, and yearly profit %. You can then share this account when someone owes you.'}
            </Text>
            <ScrollView contentContainerStyle={{ gap: space.md }} keyboardShouldPersistTaps="handled">
              <SecondaryButton
                label={
                  acceptBusy
                    ? t(user.locale, 'common.loading') || 'Working…'
                    : t(user.locale, 'accounts.scanStatement') || 'Scan statement'
                }
                onPress={() => void onScanAcceptStatement()}
                disabled={acceptBusy}
              />
              <Field
                label={t(user.locale, 'accounts.fullName') || 'Full name'}
                value={acceptFullName}
                onChange={setAcceptFullName}
                placeholder="Account holder name"
              />
              <Field
                label={t(user.locale, 'accounts.accountNumber') || 'Account number'}
                value={acceptAccountNumber}
                onChange={setAcceptAccountNumber}
                placeholder="Full number if known"
              />
              <Field
                label={t(user.locale, 'accounts.profitYearly') || 'Profit % per year'}
                value={acceptProfit}
                onChange={setAcceptProfit}
                keyboardType="decimal-pad"
                placeholder="e.g. 7.5"
              />
            </ScrollView>
            <PrimaryButton
              label={
                acceptBusy
                  ? t(user.locale, 'common.loading') || 'Saving…'
                  : t(user.locale, 'accounts.acceptConfirm') || 'Accept account'
              }
              onPress={() => void onConfirmAccept()}
              disabled={acceptBusy}
            />
            <SecondaryButton
              label={t(user.locale, 'common.cancel') || 'Cancel'}
              onPress={() => setAcceptId(null)}
              disabled={acceptBusy}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function IconAction({
  children,
  onPress,
  accessibilityLabel,
  danger,
}: {
  children: React.ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
  danger?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
      style={{
        width: 40,
        height: 40,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: danger ? colors.warningSoft : colors.primarySoft,
        borderWidth: 1,
        borderColor: danger ? colors.warning : colors.primary,
      }}
    >
      {children}
    </Pressable>
  );
}
