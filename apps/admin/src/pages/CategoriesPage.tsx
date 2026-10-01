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
  Filter,
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
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { PageToolbar } from '../components/PageToolbar';
import { PermissionGate } from '../components/PermissionGate';
import { Table, type TableColumn } from '../components/Table';

type SubTab = 'account_type' | 'institution_type' | 'institutions' | 'goal_type' | 'cashflow';

const SUB_NAV: { id: SubTab; label: string; icon: typeof CreditCard }[] = [
  { id: 'account_type', label: 'Account types', icon: CreditCard },
  { id: 'institution_type', label: 'Institution types', icon: Building2 },
  { id: 'institutions', label: 'Institutions', icon: Landmark },
  { id: 'goal_type', label: 'Goal types', icon: Target },
  { id: 'cashflow', label: 'Cashflow', icon: ArrowLeftRight },
];

export function CategoriesPage() {
  const [tab, setTab] = useState<SubTab>('account_type');

  return (
    <div className="page">
      <PageHeader icon={Layers} title="Categories" subtitle="Catalogs, institutions, and cashflow categories" />

      <div className="segmented">
        {SUB_NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`segmented-btn${tab === item.id ? ' active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            <item.icon size={15} strokeWidth={2} />
            {item.label}
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
  const [filterOpen, setFilterOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);

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
      if (activeOnly && !row.active) return false;
      if (!q) return true;
      return row.label.toLowerCase().includes(q) || row.code.toLowerCase().includes(q);
    });
  }, [items, search, activeOnly]);

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

      <PageToolbar
        left={
          <PermissionGate perm="categories.write">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
              <form className="card inline-form" onSubmit={onCreate} style={{ margin: 0 }}>
                <input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder={`New ${title.toLowerCase().replace(/s$/, '')} label…`}
                />
                <Button type="submit" variant="primary" disabled={busy || !newLabel.trim()} icon={<Plus size={14} strokeWidth={2} />}>
                  Add
                </Button>
              </form>
              <BulkJsonUpload
                title={`Upload ${title.toLowerCase()} JSON`}
                hint='[ { "label": "Checking" }, { "label": "Savings", "code": "savings" } ]'
                example={`[\n  { "label": "Example ${title.slice(0, -1)}" }\n]`}
                disabled={busy}
                busy={busy}
                onImport={importJSON}
              />
            </div>
          </PermissionGate>
        }
        right={
          <IconButton
            icon={Filter}
            label={(search || activeOnly) ? 'Filters active' : 'Filter'}
            variant={(search || activeOnly) ? 'primary' : 'ghost'}
            className={(search || activeOnly) ? 'filter-icon-active' : undefined}
            onClick={() => setFilterOpen(true)}
          />
        }
      />

      <Modal
        open={filterOpen}
        title={`Filter ${title.toLowerCase()}`}
        subtitle="Narrow the list without leaving this page."
        onClose={() => setFilterOpen(false)}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setSearch('');
                setActiveOnly(false);
              }}
            >
              Clear
            </Button>
            <Button variant="primary" onClick={() => setFilterOpen(false)}>
              Apply
            </Button>
          </>
        }
      >
        <div className="stack">
          <label className="field">
            <span className="field-label">Search</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Label or code…" />
          </label>
          <label className="checkbox-row" style={{ justifyContent: 'space-between' }}>
            Active only
            <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
          </label>
        </div>
      </Modal>

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
  const [filterOpen, setFilterOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);

  // Institutions are always scoped to institution_type — goal_type must never be sent as type_kind here.
  const INSTITUTION_TYPE_KIND = 'institution_type' as const;

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
  }, [token]);

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
  }, [token, typeCodeFilter]);

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

      <PageToolbar
        left={
          <PermissionGate perm="categories.write">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
              <form className="card inline-form inline-form-wrap" onSubmit={onCreate} style={{ margin: 0 }}>
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
              <BulkJsonUpload
                title="Upload institutions JSON (banks, wallets…)"
                hint='[ { "label": "Commercial Bank of Ethiopia", "type_code": "bank", "country_code": "ET" } ]'
                example={`[\n  { "label": "Example Bank", "type_code": "${newTypeCode || 'bank'}", "country_code": "ET" }\n]`}
                disabled={busy}
                busy={busy}
                onImport={importJSON}
              />
            </div>
          </PermissionGate>
        }
        right={
          <IconButton
            icon={Filter}
            label={(typeCodeFilter || search || activeOnly) ? 'Filters active' : 'Filter'}
            variant={(typeCodeFilter || search || activeOnly) ? 'primary' : 'ghost'}
            className={(typeCodeFilter || search || activeOnly) ? 'filter-icon-active' : undefined}
            onClick={() => setFilterOpen(true)}
          />
        }
      />

      <Modal
        open={filterOpen}
        title="Filter institutions"
        subtitle="Type, search, and active state."
        onClose={() => setFilterOpen(false)}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setTypeCodeFilter('');
                setSearch('');
                setActiveOnly(false);
              }}
            >
              Clear
            </Button>
            <Button variant="primary" onClick={() => setFilterOpen(false)}>
              Apply
            </Button>
          </>
        }
      >
        <div className="stack">
          <label className="field">
            <span className="field-label">Institution type</span>
            <select value={typeCodeFilter} onChange={(e) => setTypeCodeFilter(e.target.value)}>
              <option value="">All institution types</option>
              {typeCodes.map((t) => (
                <option key={t.id} value={t.code}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Search</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or country…" />
          </label>
          <label className="checkbox-row" style={{ justifyContent: 'space-between' }}>
            Active only
            <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
          </label>
        </div>
      </Modal>

      <Table
        title="Institutions"
        subtitle={`${items.filter((r) => {
          if (activeOnly && !r.active) return false;
          const q = search.trim().toLowerCase();
          if (!q) return true;
          return r.label.toLowerCase().includes(q) || (r.country_code || '').toLowerCase().includes(q) || r.type_code.toLowerCase().includes(q);
        }).length} items`}
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
                  <span className="muted mono">
                    {row.type_code}
                    {row.country_code ? ` · ${row.country_code}` : ''}
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
        rows={items.filter((r) => {
          if (activeOnly && !r.active) return false;
          const q = search.trim().toLowerCase();
          if (!q) return true;
          return r.label.toLowerCase().includes(q) || (r.country_code || '').toLowerCase().includes(q) || r.type_code.toLowerCase().includes(q);
        })}
        rowKey={(r) => r.id}
        loading={loading}
        emptyIcon={Landmark}
        emptyMessage="No institutions yet."
      />
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
  const [filterOpen, setFilterOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);

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

      <PageToolbar
        left={
          <PermissionGate perm="categories.write">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
              <form className="card inline-form" onSubmit={onCreate} style={{ margin: 0 }}>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={`New ${kind} category name…`} />
                <Button type="submit" variant="primary" disabled={busy || !newName.trim()} icon={<Plus size={14} strokeWidth={2} />}>
                  Add
                </Button>
              </form>
              <BulkJsonUpload
                title={`Upload ${kind} categories JSON`}
                hint='[ { "name": "Groceries" }, "Rent" ]'
                example={`[\n  { "name": "Example ${kind}" }\n]`}
                disabled={busy}
                busy={busy}
                onImport={importJSON}
              />
            </div>
          </PermissionGate>
        }
        right={
          <IconButton
            icon={Filter}
            label={(search || activeOnly) ? 'Filters active' : 'Filter'}
            variant={(search || activeOnly) ? 'primary' : 'ghost'}
            className={(search || activeOnly) ? 'filter-icon-active' : undefined}
            onClick={() => setFilterOpen(true)}
          />
        }
      />

      <Modal
        open={filterOpen}
        title={`Filter ${kind} categories`}
        onClose={() => setFilterOpen(false)}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setSearch('');
                setActiveOnly(false);
              }}
            >
              Clear
            </Button>
            <Button variant="primary" onClick={() => setFilterOpen(false)}>
              Apply
            </Button>
          </>
        }
      >
        <div className="stack">
          <label className="field">
            <span className="field-label">Search</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or slug…" />
          </label>
          <label className="checkbox-row" style={{ justifyContent: 'space-between' }}>
            Active only
            <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
          </label>
        </div>
      </Modal>

      <Table
        title={`${kind === 'income' ? 'Income' : 'Expense'} categories`}
        subtitle={`${items.filter((r) => {
          if (activeOnly && !r.active) return false;
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
          if (activeOnly && !r.active) return false;
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
