import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowDownUp,
  ArrowLeftRight,
  Ban,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Landmark,
  Layers,
  Pencil,
  Plus,
  Target,
  X,
} from 'lucide-react';
import { api, type CatalogInstitution, type CatalogType, type SystemCategory } from '../api';
import { useAuth } from '../auth';
import { BulkJsonUpload, asBulkArray } from '../components/BulkJsonUpload';
import { Button } from '../components/Button';
import { ButtonGroup } from '../components/ButtonGroup';
import { IconButton } from '../components/IconButton';
import { PageHeader } from '../components/PageHeader';
import { CatalogBar, statusOk, type StatusFilter } from '../components/CatalogBar';
import { PermissionGate } from '../components/PermissionGate';
import { Table, type TableColumn } from '../components/Table';

type SubTab = 'account_type' | 'institution_type' | 'institutions' | 'goal_type' | 'cashflow';

const SUB_NAV: { id: SubTab; label: string; hint: string; icon: typeof CreditCard; color: string }[] = [
  { id: 'account_type', label: 'Account types', hint: 'Bank, wallet, cash…', icon: CreditCard, color: '#0ea5a0' },
  { id: 'institution_type', label: 'Lender types', hint: 'Bank, MFI, SACCO…', icon: Building2, color: '#7c6cf6' },
  { id: 'institutions', label: 'Institutions', hint: 'Named banks & lenders', icon: Landmark, color: '#0891b2' },
  { id: 'goal_type', label: 'Goal types', hint: 'Savings goal presets', icon: Target, color: '#f59e0b' },
  { id: 'cashflow', label: 'Cashflow', hint: 'Income & expense', icon: ArrowLeftRight, color: '#db2777' },
];

function readTab(): SubTab {
  const t = new URLSearchParams(window.location.search).get('tab') as SubTab | null;
  return t && SUB_NAV.some((n) => n.id === t) ? t : 'account_type';
}

export function CategoriesPage() {
  const [tab, setTab] = useState<SubTab>(readTab);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    window.history.replaceState({}, '', url.toString());
  }, [tab]);

  return (
    <div className="page">
      <PageHeader icon={Layers} title="Categories" subtitle="Catalogs, institutions, and cashflow categories" />

      <div className="cat-tabs" role="tablist" aria-label="Catalog">
        {SUB_NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`cat-tab${tab === item.id ? ' active' : ''}`}
            style={{ ['--tab' as string]: item.color }}
            onClick={() => setTab(item.id)}
          >
            <span className="cat-tab-icon">
              <item.icon size={18} strokeWidth={2} />
            </span>
            <span className="cat-tab-text">
              <strong>{item.label}</strong>
              <small>{item.hint}</small>
            </span>
          </button>
        ))}
      </div>

      {tab === 'account_type' ? <CatalogTypeSection kind="account_type" title="Account types" /> : null}
      {tab === 'institution_type' ? <CatalogTypeSection kind="institution_type" title="Institution types" /> : null}
      {tab === 'goal_type' ? <CatalogTypeSection kind="goal_type" title="Goal types" /> : null}
      {tab === 'institutions' ? <InstitutionsSection /> : null}
      {tab === 'cashflow' ? <CashflowSection /> : null}
    </div>
  );
}

function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="alert alert-error">
      <AlertTriangle size={16} strokeWidth={2} />
      <span>{message}</span>
    </div>
  );
}

function CatalogTypeSection({ kind, title }: { kind: 'account_type' | 'institution_type' | 'goal_type'; title: string }) {
  const { token } = useAuth();
  const [items, setItems] = useState<CatalogType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.listCatalogTypes(token, kind);
      setItems((res.types ?? []).slice().sort((a, b) => a.sort_order - b.sort_order));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [token, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((row) => {
      if (!statusOk(row.active, status)) return false;
      if (!q) return true;
      return row.label.toLowerCase().includes(q) || row.code.toLowerCase().includes(q);
    });
  }, [items, search, status]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!token || !newLabel.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.createCatalogType(token, { kind, label: newLabel.trim() });
      setNewLabel('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create');
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(row: CatalogType) {
    if (!token || !editValue.trim()) return;
    setBusy(true);
    try {
      await api.updateCatalogType(token, row.id, { label: editValue.trim() });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(row: CatalogType) {
    if (!token) return;
    setBusy(true);
    try {
      await api.updateCatalogType(token, row.id, { active: !row.active });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update');
    } finally {
      setBusy(false);
    }
  }

  async function swap(a: CatalogType, b: CatalogType) {
    if (!token) return;
    setBusy(true);
    try {
      await Promise.all([
        api.updateCatalogType(token, a.id, { sort_order: b.sort_order }),
        api.updateCatalogType(token, b.id, { sort_order: a.sort_order }),
      ]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reorder');
    } finally {
      setBusy(false);
    }
  }

  async function importJSON(parsed: unknown) {
    if (!token) return;
    const rows = asBulkArray(parsed, ['items', 'types', 'rows']);
    setBusy(true);
    setError(null);
    let ok = 0;
    const failures: string[] = [];
    try {
      for (const raw of rows) {
        let label = '';
        let code: string | undefined;
        if (typeof raw === 'string') {
          label = raw.trim();
        } else if (raw && typeof raw === 'object') {
          const o = raw as Record<string, unknown>;
          label = String(o.label ?? o.name ?? '').trim();
          const c = String(o.code ?? '').trim();
          if (c) code = c;
        }
        if (!label) {
          failures.push('empty label');
          continue;
        }
        try {
          await api.createCatalogType(token, { kind, label, code });
          ok++;
        } catch (err) {
          failures.push(`${label}: ${err instanceof Error ? err.message : 'failed'}`);
        }
      }
      await load();
      if (failures.length) {
        setError(`Imported ${ok}, skipped ${failures.length}. ${failures.slice(0, 3).join('; ')}`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-lg">
      <ErrorBanner message={error} />

      <CatalogBar
        search={search}
        onSearch={setSearch}
        placeholder="Search by label or code…"
        status={status}
        onStatus={setStatus}
        counts={{ all: items.length, active: items.filter((r) => r.active).length }}
        addLabel="Add"
        addForm={
          <form className="inline-form" onSubmit={onCreate}>
                <input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder={`New ${title.toLowerCase().replace(/s$/, '')} label…`}
                />
                <Button type="submit" variant="primary" disabled={busy || !newLabel.trim()} icon={<Plus size={14} strokeWidth={2} />}>
                  Add
                </Button>
              </form>
        }
        importer={
          <BulkJsonUpload
                title={`Upload ${title.toLowerCase()} JSON`}
                hint='[ { "label": "Checking" }, { "label": "Savings", "code": "savings" } ]'
                example={`[\n  { "label": "Example ${title.slice(0, -1)}" }\n]`}
                disabled={busy}
                busy={busy}
                onImport={importJSON}
              />
        }
      />

      <Table
        title={title}
        subtitle={`${visibleItems.length}${visibleItems.length !== items.length ? ` / ${items.length}` : ''} items`}
        columns={[
          {
            key: 'item',
            header: 'Label',
            render: (row) =>
              editingId === row.id ? (
                <input className="catalog-row-input" value={editValue} onChange={(e) => setEditValue(e.target.value)} autoFocus />
              ) : (
                <div className="cell-stack">
                  <strong>{row.label}</strong>
                  <span className="muted mono">{row.code}</span>
                </div>
              ),
          },
          {
            key: 'status',
            header: 'Status',
            width: 100,
            render: (row) => (
              <span className={`badge badge-${row.active ? 'success' : 'muted'}`}>{row.active ? 'active' : 'off'}</span>
            ),
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            width: 160,
            render: (row) => {
              const fullIndex = items.findIndex((x) => x.id === row.id);
              if (editingId === row.id) {
                return (
                  <ButtonGroup>
                    <IconButton icon={Check} label="Save" size="sm" disabled={busy} onClick={() => void saveEdit(row)} />
                    <IconButton icon={X} label="Cancel" size="sm" disabled={busy} onClick={() => setEditingId(null)} />
                  </ButtonGroup>
                );
              }
              return (
                <PermissionGate perm="categories.write">
                  <ButtonGroup>
                    <IconButton
                      icon={ChevronUp}
                      label="Move up"
                      size="sm"
                      disabled={busy || fullIndex <= 0}
                      onClick={() => void swap(row, items[fullIndex - 1])}
                    />
                    <IconButton
                      icon={ChevronDown}
                      label="Move down"
                      size="sm"
                      disabled={busy || fullIndex < 0 || fullIndex >= items.length - 1}
                      onClick={() => void swap(row, items[fullIndex + 1])}
                    />
                    <IconButton
                      icon={Pencil}
                      label="Rename"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setEditingId(row.id);
                        setEditValue(row.label);
                      }}
                    />
                    <IconButton
                      icon={row.active ? Ban : CheckCircle2}
                      label={row.active ? 'Deactivate' : 'Activate'}
                      size="sm"
                      disabled={busy}
                      onClick={() => void toggleActive(row)}
                    />
                  </ButtonGroup>
                </PermissionGate>
              );
            },
          },
        ] satisfies TableColumn<CatalogType>[]}
        rows={visibleItems}
        rowKey={(r) => r.id}
        loading={loading}
        emptyIcon={ArrowDownUp}
        emptyMessage={`No ${title.toLowerCase()} match.`}
      />
    </div>
  );
}

function InstitutionsSection() {
  const { token } = useAuth();
  const [typeCodes, setTypeCodes] = useState<CatalogType[]>([]);
  const [typeCodeFilter, setTypeCodeFilter] = useState('');
  const [items, setItems] = useState<CatalogInstitution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newTypeCode, setNewTypeCode] = useState('');
  const [newCountry, setNewCountry] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  // Accounts: banks, wallets and mobile money people keep money in. Lenders: who a loan is from.
  const [kind, setKind] = useState<'account_type' | 'institution_type'>('account_type');
  const INSTITUTION_TYPE_KIND = kind;
  const [countryFilter, setCountryFilter] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const PAGE_SIZE = 50;

  const loadTypeCodes = useCallback(async () => {
    if (!token) return;
    try {
      const res = await api.listCatalogTypes(token, INSTITUTION_TYPE_KIND);
      const sorted = (res.types ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
      setTypeCodes(sorted);
      if (!newTypeCode && sorted.length > 0) setNewTypeCode(sorted[0].code);
    } catch {
      /* surfaced via main load error */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, kind]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.listCatalogInstitutions(token, INSTITUTION_TYPE_KIND, typeCodeFilter);
      setItems((res.institutions ?? []).slice().sort((a, b) => a.sort_order - b.sort_order));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load institutions');
    } finally {
      setLoading(false);
    }
  }, [token, typeCodeFilter, kind]);

  // A filter change starts again from the first page.
  useEffect(() => {
    setPageIndex(0);
  }, [kind, typeCodeFilter, countryFilter, search, status]);

  const countries = Array.from(new Set(items.map((r) => r.country_code || '').filter(Boolean))).sort();
  const filtered = items.filter((r) => {
    if (!statusOk(r.active, status)) return false;
    if (countryFilter === 'global' ? Boolean(r.country_code) : countryFilter && r.country_code !== countryFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return r.label.toLowerCase().includes(q) || (r.country_code || '').toLowerCase().includes(q) || r.type_code.toLowerCase().includes(q);
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => {
    void loadTypeCodes();
  }, [loadTypeCodes]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!token || !newLabel.trim() || !newTypeCode.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.createCatalogInstitution(token, {
        label: newLabel.trim(),
        type_kind: INSTITUTION_TYPE_KIND,
        type_code: newTypeCode.trim(),
        country_code: newCountry.trim() || undefined,
      });
      setNewLabel('');
      setNewCountry('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create institution');
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(row: CatalogInstitution) {
    if (!token || !editValue.trim()) return;
    setBusy(true);
    try {
      await api.updateCatalogInstitution(token, row.id, { label: editValue.trim() });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(row: CatalogInstitution) {
    if (!token) return;
    setBusy(true);
    try {
      await api.updateCatalogInstitution(token, row.id, { active: !row.active });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update');
    } finally {
      setBusy(false);
    }
  }

  async function swap(a: CatalogInstitution, b: CatalogInstitution) {
    if (!token) return;
    setBusy(true);
    try {
      await Promise.all([
        api.updateCatalogInstitution(token, a.id, { sort_order: b.sort_order }),
        api.updateCatalogInstitution(token, b.id, { sort_order: a.sort_order }),
      ]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reorder');
    } finally {
      setBusy(false);
    }
  }

  async function importJSON(parsed: unknown) {
    if (!token) return;
    const rows = asBulkArray(parsed, ['items', 'institutions', 'banks', 'rows']);
    const fallbackType = newTypeCode || typeCodes[0]?.code || '';
    setBusy(true);
    setError(null);
    let ok = 0;
    const failures: string[] = [];
    try {
      for (const raw of rows) {
        let label = '';
        let typeCode = fallbackType;
        let country: string | undefined;
        let code: string | undefined;
        if (typeof raw === 'string') {
          label = raw.trim();
        } else if (raw && typeof raw === 'object') {
          const o = raw as Record<string, unknown>;
          label = String(o.label ?? o.name ?? '').trim();
          const tc = String(o.type_code ?? o.typeCode ?? '').trim();
          if (tc) typeCode = tc;
          const cc = String(o.country_code ?? o.countryCode ?? o.country ?? '').trim().toUpperCase();
          if (cc) country = cc;
          const c = String(o.code ?? '').trim();
          if (c) code = c;
        }
        if (!label || !typeCode) {
          failures.push(label || 'missing label/type_code');
          continue;
        }
        try {
          await api.createCatalogInstitution(token, {
            label,
            code,
            type_kind: INSTITUTION_TYPE_KIND,
            type_code: typeCode,
            country_code: country,
          });
          ok++;
        } catch (err) {
          failures.push(`${label}: ${err instanceof Error ? err.message : 'failed'}`);
        }
      }
      await load();
      if (failures.length) {
        setError(`Imported ${ok}, skipped ${failures.length}. ${failures.slice(0, 3).join('; ')}`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-lg">
      <ErrorBanner message={error} />

      <CatalogBar
        search={search}
        onSearch={setSearch}
        placeholder="Search by name, type or country…"
        status={status}
        onStatus={setStatus}
        counts={{ all: items.length, active: items.filter((r) => r.active).length }}
        extra={
          <>
        <div className="seg" role="tablist" aria-label="Institution group">
          <button type="button" role="tab" aria-selected={kind === 'account_type'} className={kind === 'account_type' ? 'active' : ''} onClick={() => { setKind('account_type'); setTypeCodeFilter(''); }}>
            Accounts
          </button>
          <button type="button" role="tab" aria-selected={kind === 'institution_type'} className={kind === 'institution_type' ? 'active' : ''} onClick={() => { setKind('institution_type'); setTypeCodeFilter(''); }}>
            Lenders
          </button>
        </div>
        <select value={typeCodeFilter} onChange={(e) => setTypeCodeFilter(e.target.value)} aria-label="Type">
          <option value="">All types</option>
          {typeCodes.map((t) => (
            <option key={t.id} value={t.code}>
              {t.label}
            </option>
          ))}
        </select>
        <select value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} aria-label="Country">
          <option value="">All countries</option>
          <option value="global">Worldwide</option>
          {countries.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
                </>
        }
        addLabel="Add institution"
        addForm={
          <form className="inline-form inline-form-wrap" onSubmit={onCreate}>
                <select value={newTypeCode} onChange={(e) => setNewTypeCode(e.target.value)} required>
                  <option value="" disabled>
                    Institution type…
                  </option>
                  {typeCodes.map((t) => (
                    <option key={t.id} value={t.code}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Institution label…" required />
                <input
                  value={newCountry}
                  onChange={(e) => setNewCountry(e.target.value.toUpperCase())}
                  placeholder="Country (optional)"
                  maxLength={2}
                  style={{ width: 120 }}
                />
                <Button
                  type="submit"
                  variant="primary"
                  disabled={busy || !newLabel.trim() || !newTypeCode}
                  icon={<Plus size={14} strokeWidth={2} />}
                >
                  Add
                </Button>
              </form>
        }
        importer={
          <BulkJsonUpload
                title="Upload institutions JSON (banks, wallets…)"
                hint='[ { "label": "Commercial Bank of Ethiopia", "type_code": "bank", "country_code": "ET" } ]'
                example={`[\n  { "label": "Example Bank", "type_code": "${newTypeCode || 'bank'}", "country_code": "ET" }\n]`}
                disabled={busy}
                busy={busy}
                onImport={importJSON}
              />
        }
      />

      <Table
        title={kind === 'account_type' ? 'Account institutions' : 'Lenders'}
        subtitle={`${filtered.length.toLocaleString()} of ${items.length.toLocaleString()} · page ${pageIndex + 1} of ${pageCount}`}
        columns={[
          {
            key: 'item',
            header: 'Institution',
            render: (row) =>
              editingId === row.id ? (
                <input className="catalog-row-input" value={editValue} onChange={(e) => setEditValue(e.target.value)} autoFocus />
              ) : (
                <div className="cell-stack">
                  <strong>{row.label}</strong>
                  <span className="muted">
                    <span className="chip-mini">{row.country_code || 'Worldwide'}</span> {row.type_code.replace(/_/g, ' ')}
                  </span>
                </div>
              ),
          },
          {
            key: 'status',
            header: 'Status',
            width: 100,
            render: (row) => (
              <span className={`badge badge-${row.active ? 'success' : 'muted'}`}>{row.active ? 'active' : 'off'}</span>
            ),
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            width: 160,
            render: (row) => {
              const fullIndex = items.findIndex((x) => x.id === row.id);
              if (editingId === row.id) {
                return (
                  <ButtonGroup>
                    <IconButton icon={Check} label="Save" size="sm" disabled={busy} onClick={() => void saveEdit(row)} />
                    <IconButton icon={X} label="Cancel" size="sm" disabled={busy} onClick={() => setEditingId(null)} />
                  </ButtonGroup>
                );
              }
              return (
                <PermissionGate perm="categories.write">
                  <ButtonGroup>
                    <IconButton
                      icon={ChevronUp}
                      label="Move up"
                      size="sm"
                      disabled={busy || fullIndex <= 0}
                      onClick={() => void swap(row, items[fullIndex - 1])}
                    />
                    <IconButton
                      icon={ChevronDown}
                      label="Move down"
                      size="sm"
                      disabled={busy || fullIndex < 0 || fullIndex >= items.length - 1}
                      onClick={() => void swap(row, items[fullIndex + 1])}
                    />
                    <IconButton
                      icon={Pencil}
                      label="Rename"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setEditingId(row.id);
                        setEditValue(row.label);
                      }}
                    />
                    <IconButton
                      icon={row.active ? Ban : CheckCircle2}
                      label={row.active ? 'Deactivate' : 'Activate'}
                      size="sm"
                      disabled={busy}
                      onClick={() => void toggleActive(row)}
                    />
                  </ButtonGroup>
                </PermissionGate>
              );
            },
          },
        ] satisfies TableColumn<CatalogInstitution>[]}
        rows={pageRows}
        rowKey={(r) => r.id}
        loading={loading}
        emptyIcon={Landmark}
        emptyMessage="No institutions match."
      />
      {pageCount > 1 ? (
        <div className="pager">
          <Button variant="ghost" disabled={pageIndex === 0} onClick={() => setPageIndex((i) => Math.max(0, i - 1))}>
            Previous
          </Button>
          <span className="muted">
            Page {pageIndex + 1} of {pageCount}
          </span>
          <Button variant="ghost" disabled={pageIndex >= pageCount - 1} onClick={() => setPageIndex((i) => Math.min(pageCount - 1, i + 1))}>
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function CashflowSection() {
  const { token } = useAuth();
  const [kind, setKind] = useState<'income' | 'expense'>('expense');
  const [items, setItems] = useState<SystemCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.listCategories(token, kind);
      setItems(res.categories ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load categories');
    } finally {
      setLoading(false);
    }
  }, [token, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!token || !newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.createCategory(token, { kind, name: newName.trim() });
      setNewName('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create category');
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(row: SystemCategory) {
    if (!token || !editValue.trim()) return;
    setBusy(true);
    try {
      await api.updateCategory(token, row.id, { name: editValue.trim() });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(row: SystemCategory) {
    if (!token) return;
    setBusy(true);
    try {
      await api.updateCategory(token, row.id, { active: !row.active });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update category');
    } finally {
      setBusy(false);
    }
  }

  async function importJSON(parsed: unknown) {
    if (!token) return;
    const rows = asBulkArray(parsed, ['items', 'categories', 'rows']);
    setBusy(true);
    setError(null);
    let ok = 0;
    const failures: string[] = [];
    try {
      for (const raw of rows) {
        let name = '';
        if (typeof raw === 'string') {
          name = raw.trim();
        } else if (raw && typeof raw === 'object') {
          const o = raw as Record<string, unknown>;
          name = String(o.name ?? o.label ?? '').trim();
        }
        if (!name) {
          failures.push('empty name');
          continue;
        }
        try {
          await api.createCategory(token, { kind, name });
          ok++;
        } catch (err) {
          failures.push(`${name}: ${err instanceof Error ? err.message : 'failed'}`);
        }
      }
      await load();
      if (failures.length) {
        setError(`Imported ${ok}, skipped ${failures.length}. ${failures.slice(0, 3).join('; ')}`);
      }
    } finally {
      setBusy(false);
    }
  }

  const kindTabs = useMemo(
    () => [
      { id: 'expense' as const, label: 'Expense' },
      { id: 'income' as const, label: 'Income' },
    ],
    [],
  );

  return (
    <div className="stack-lg">
      <ErrorBanner message={error} />

      <div className="segmented segmented-sm">
        {kindTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`segmented-btn${kind === t.id ? ' active' : ''}`}
            onClick={() => setKind(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <CatalogBar
        search={search}
        onSearch={setSearch}
        placeholder="Search by name or slug…"
        status={status}
        onStatus={setStatus}
        counts={{ all: items.length, active: items.filter((r) => r.active).length }}
        addLabel="Add category"
        addForm={
          <form className="inline-form" onSubmit={onCreate}>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={`New ${kind} category name…`} />
                <Button type="submit" variant="primary" disabled={busy || !newName.trim()} icon={<Plus size={14} strokeWidth={2} />}>
                  Add
                </Button>
              </form>
        }
        importer={
          <BulkJsonUpload
                title={`Upload ${kind} categories JSON`}
                hint='[ { "name": "Groceries" }, "Rent" ]'
                example={`[\n  { "name": "Example ${kind}" }\n]`}
                disabled={busy}
                busy={busy}
                onImport={importJSON}
              />
        }
      />

      <Table
        title={`${kind === 'income' ? 'Income' : 'Expense'} categories`}
        subtitle={`${items.filter((r) => {
          if (!statusOk(r.active, status)) return false;
          const q = search.trim().toLowerCase();
          if (!q) return true;
          return r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q);
        }).length} items`}
        columns={[
          {
            key: 'item',
            header: 'Category',
            render: (row) =>
              editingId === row.id ? (
                <input className="catalog-row-input" value={editValue} onChange={(e) => setEditValue(e.target.value)} autoFocus />
              ) : (
                <div className="cell-stack">
                  <strong>{row.name}</strong>
                  <span className="muted mono">{row.slug}</span>
                </div>
              ),
          },
          {
            key: 'status',
            header: 'Status',
            width: 100,
            render: (row) => (
              <span className={`badge badge-${row.active ? 'success' : 'muted'}`}>{row.active ? 'active' : 'off'}</span>
            ),
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            width: 120,
            render: (row) => {
              if (editingId === row.id) {
                return (
                  <ButtonGroup>
                    <IconButton icon={Check} label="Save" size="sm" disabled={busy} onClick={() => void saveEdit(row)} />
                    <IconButton icon={X} label="Cancel" size="sm" disabled={busy} onClick={() => setEditingId(null)} />
                  </ButtonGroup>
                );
              }
              return (
                <PermissionGate perm="categories.write">
                  <ButtonGroup>
                    <IconButton
                      icon={Pencil}
                      label="Rename"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setEditingId(row.id);
                        setEditValue(row.name);
                      }}
                    />
                    <IconButton
                      icon={row.active ? Ban : CheckCircle2}
                      label={row.active ? 'Deactivate' : 'Activate'}
                      size="sm"
                      disabled={busy}
                      onClick={() => void toggleActive(row)}
                    />
                  </ButtonGroup>
                </PermissionGate>
              );
            },
          },
        ] satisfies TableColumn<SystemCategory>[]}
        rows={items.filter((r) => {
          if (!statusOk(r.active, status)) return false;
          const q = search.trim().toLowerCase();
          if (!q) return true;
          return r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q);
        })}
        rowKey={(r) => r.id}
        loading={loading}
        emptyIcon={ArrowLeftRight}
        emptyMessage="No categories yet."
      />
    </div>
  );
}
