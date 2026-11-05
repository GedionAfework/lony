import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  Check,
  CircleAlert,
  Copy,
  Eye,
  EyeOff,
  Home,
  Palette,
  PieChart,
  Plus,
  RotateCcw,
  Save,
  Search,
  User,
  Wallet,
} from 'lucide-react';
import { api, DEFAULT_THEME_COLORS, THEME_COLOR_FIELDS, type SystemTheme, type ThemeColors } from '../api';
import { useAuth } from '../auth';
import { Button } from '../components/Button';
import { Drawer } from '../components/Drawer';
import { IconButton } from '../components/IconButton';
import { PageHeader } from '../components/PageHeader';
import { PermissionGate } from '../components/PermissionGate';
import { statusOk, type StatusFilter } from '../components/CatalogBar';

function slugify(label: string) {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

type FormState = {
  slug: string;
  label: string;
  sortOrder: number;
  colors: ThemeColors;
};

function emptyForm(): FormState {
  return { slug: '', label: '', sortOrder: 0, colors: { ...DEFAULT_THEME_COLORS } };
}

const GROUPS: { label: string; keys: (keyof ThemeColors)[] }[] = [
  { label: 'Surfaces', keys: ['background', 'surface', 'surfaceMuted', 'border', 'nav'] },
  { label: 'Text', keys: ['text', 'muted'] },
  { label: 'Brand', keys: ['primary', 'primarySoft', 'onPrimary', 'secondary'] },
  { label: 'Status', keys: ['success', 'warning', 'error'] },
];
const FIELD_LABEL = Object.fromEntries(THEME_COLOR_FIELDS.map((f) => [f.key, f.label])) as Record<keyof ThemeColors, string>;

/* ------------------------------------------------------------ contrast */

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance([r, g, b]: [number, number, number]) {
  const c = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a: string, b: string): number | null {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  if (!x || !y) return null;
  const [l1, l2] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (l1 + 0.05) / (l2 + 0.05);
}

function contrastChecks(c: ThemeColors) {
  return [
    { label: 'Text on background', ratio: contrast(c.text, c.background), min: 4.5 },
    { label: 'Text on cards', ratio: contrast(c.text, c.surface), min: 4.5 },
    { label: 'Muted text on background', ratio: contrast(c.muted, c.background), min: 3 },
    { label: 'Button label on primary', ratio: contrast(c.onPrimary, c.primary), min: 3 },
  ];
}

/* --------------------------------------------------------------- page */

export function ThemesPage() {
  const { token, hasPerm } = useAuth();
  const [themes, setThemes] = useState<SystemTheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  const canWrite = hasPerm('themes.write');

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.listThemes(token);
      setThemes((res.themes ?? []).slice().sort((a, b) => a.sort_order - b.sort_order));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load themes');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  function startCreate(from?: SystemTheme) {
    setForm(
      from
        ? { slug: '', label: `${from.label} copy`, sortOrder: from.sort_order + 1, colors: { ...DEFAULT_THEME_COLORS, ...from.colors } }
        : emptyForm(),
    );
    setEditingId('new');
  }

  function startEdit(theme: SystemTheme) {
    setForm({ slug: theme.slug, label: theme.label, sortOrder: theme.sort_order, colors: { ...DEFAULT_THEME_COLORS, ...theme.colors } });
    setEditingId(theme.id);
  }

  function setColor(key: keyof ThemeColors, value: string) {
    setForm((f) => ({ ...f, colors: { ...f.colors, [key]: value } }));
  }

  async function onSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (!token || !form.label.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (editingId === 'new') {
        await api.createTheme(token, {
          slug: form.slug.trim() ? slugify(form.slug) : slugify(form.label),
          label: form.label.trim(),
          colors: form.colors,
          sort_order: form.sortOrder,
        });
      } else if (editingId) {
        await api.updateTheme(token, editingId, { label: form.label.trim(), colors: form.colors, sort_order: form.sortOrder });
      }
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save theme');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(theme: SystemTheme) {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateTheme(token, theme.id, { active: !theme.active });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update theme');
    } finally {
      setBusy(false);
    }
  }

  async function move(theme: SystemTheme, dir: -1 | 1) {
    if (!token) return;
    const i = themes.findIndex((t) => t.id === theme.id);
    const other = themes[i + dir];
    if (!other) return;
    setBusy(true);
    try {
      await Promise.all([
        api.updateTheme(token, theme.id, { sort_order: other.sort_order }),
        api.updateTheme(token, other.id, { sort_order: theme.sort_order }),
      ]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reorder');
    } finally {
      setBusy(false);
    }
  }

  const visible = themes.filter((t) => {
    const q = search.trim().toLowerCase();
    return statusOk(t.active, status) && (!q || t.label.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q));
  });
  const activeCount = themes.filter((t) => t.active).length;
  const checks = useMemo(() => contrastChecks(form.colors), [form.colors]);
  const failing = checks.filter((c) => c.ratio !== null && c.ratio < c.min).length;

  return (
    <div className="page">
      <PageHeader
        icon={Palette}
        title="Themes"
        actions={
          canWrite ? (
            <Button variant="primary" icon={<Plus size={15} strokeWidth={2} />} onClick={() => startCreate()}>
              New theme
            </Button>
          ) : undefined
        }
      />

      {error ? (
        <div className="alert alert-error">
          <AlertTriangle size={16} strokeWidth={2} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="catalog-bar">
        <div className="catalog-bar-row">
          <label className="catalog-search">
            <Search size={16} strokeWidth={2} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search themes…" aria-label="Search themes" />
          </label>
          <div className="seg" role="tablist" aria-label="Status">
            {(
              [
                ['all', 'All', themes.length],
                ['active', 'Live', activeCount],
                ['hidden', 'Hidden', themes.length - activeCount],
              ] as [StatusFilter, string, number][]
            ).map(([id, label, n]) => (
              <button key={id} type="button" className={status === id ? 'active' : ''} onClick={() => setStatus(id)}>
                {label}
                <span className="seg-count">{n}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="theme-gallery">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 320 }} />
          ))}
        </div>
      ) : (
        <div className="theme-gallery">
          {visible.map((theme) => {
            const colors = { ...DEFAULT_THEME_COLORS, ...theme.colors };
            const idx = themes.findIndex((t) => t.id === theme.id);
            return (
              <article key={theme.id} className={`theme-tile${theme.active ? ' live' : ''}`}>
                <button type="button" className="theme-tile-preview" onClick={() => (canWrite ? startEdit(theme) : undefined)} aria-label={`Edit ${theme.label}`}>
                  <PhonePreview colors={colors} compact />
                </button>
                <div className="theme-tile-body">
                  <div className="cell-stack">
                    <strong>{theme.label}</strong>
                    <span className="muted mono" style={{ fontSize: 12 }}>
                      {theme.slug}
                    </span>
                  </div>
                  <span className={`badge badge-${theme.active ? 'success' : 'muted'}`}>{theme.active ? 'live' : 'hidden'}</span>
                </div>
                <div className="theme-tile-swatches">
                  {(['background', 'surface', 'primary', 'secondary', 'success', 'warning', 'error'] as (keyof ThemeColors)[]).map((k) => (
                    <span key={k} title={`${FIELD_LABEL[k] ?? k}: ${colors[k]}`} style={{ background: colors[k] }} />
                  ))}
                </div>
                <PermissionGate perm="themes.write">
                  <div className="theme-tile-actions">
                    <Button size="sm" variant="secondary" onClick={() => startEdit(theme)}>
                      Edit
                    </Button>
                    <IconButton size="sm" icon={Copy} label="Duplicate" onClick={() => startCreate(theme)} />
                    <IconButton
                      size="sm"
                      icon={theme.active ? EyeOff : Eye}
                      label={theme.active ? 'Hide from app' : 'Make live'}
                      disabled={busy}
                      onClick={() => void toggleActive(theme)}
                    />
                    <IconButton size="sm" icon={ChevronLeft} label="Move earlier" disabled={busy || idx <= 0} onClick={() => void move(theme, -1)} />
                  </div>
                </PermissionGate>
              </article>
            );
          })}
          {canWrite ? (
            <button type="button" className="lang-add theme-add" onClick={() => startCreate()}>
              <Plus size={22} strokeWidth={2} />
              <strong>New theme</strong>
              <span className="muted">Start from the default palette</span>
            </button>
          ) : null}
          {!canWrite && visible.length === 0 ? <p className="muted">No themes match.</p> : null}
        </div>
      )}

      <Drawer
        open={editingId !== null}
        onClose={() => setEditingId(null)}
        width={880}
        eyebrow={editingId === 'new' ? 'New theme' : 'Edit theme'}
        title={form.label.trim() || 'Untitled theme'}
        icon={
          <span className="settings-panel-icon" style={{ background: form.colors.primary, color: form.colors.onPrimary }}>
            <Palette size={18} strokeWidth={2} />
          </span>
        }
        footer={
          <>
            <Button variant="ghost" icon={<RotateCcw size={15} />} onClick={() => setForm((f) => ({ ...f, colors: { ...DEFAULT_THEME_COLORS } }))}>
              Reset colours
            </Button>
            <span style={{ flex: 1 }} />
            <Button variant="secondary" onClick={() => setEditingId(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" busy={busy} disabled={!form.label.trim()} icon={<Save size={15} />} onClick={() => void onSubmit()}>
              Save theme
            </Button>
          </>
        }
      >
        <form className="theme-studio" onSubmit={onSubmit}>
          <div className="theme-studio-form">
            <div className="theme-studio-fields">
              <label className="field">
                <span className="field-label">Name</span>
                <input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} required autoFocus />
              </label>
              {editingId === 'new' ? (
                <label className="field">
                  <span className="field-label">Slug</span>
                  <input
                    value={form.slug}
                    onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                    placeholder={slugify(form.label) || 'auto from name'}
                  />
                </label>
              ) : null}
              <label className="field">
                <span className="field-label">Order</span>
                <input type="number" value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) || 0 }))} />
              </label>
            </div>

            {GROUPS.map((g) => (
              <fieldset key={g.label} className="color-group">
                <legend>{g.label}</legend>
                {g.keys.map((key) => {
                  const value = form.colors[key];
                  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
                  return (
                    <label key={key} className={`color-row${valid ? '' : ' invalid'}`}>
                      <input type="color" value={valid ? value : '#1FA8A8'} onChange={(e) => setColor(key, e.target.value)} aria-label={FIELD_LABEL[key]} />
                      <span>{FIELD_LABEL[key] ?? key}</span>
                      <input className="mono" value={value} onChange={(e) => setColor(key, e.target.value)} spellCheck={false} />
                    </label>
                  );
                })}
              </fieldset>
            ))}
          </div>

          <aside className="theme-studio-preview">
            <PhonePreview colors={form.colors} />
            <div className="contrast-card">
              <div className="contrast-head">
                <strong>Readability</strong>
                <span className={`badge ${failing ? 'badge-warning' : 'badge-success'}`}>{failing ? `${failing} to fix` : 'Passes'}</span>
              </div>
              {checks.map((c) => {
                const ok = c.ratio === null ? null : c.ratio >= c.min;
                return (
                  <div key={c.label} className="contrast-row">
                    {ok === false ? <CircleAlert size={14} className="warn" /> : <Check size={14} className="ok" />}
                    <span>{c.label}</span>
                    <b>{c.ratio === null ? '—' : `${c.ratio.toFixed(1)}:1`}</b>
                  </div>
                );
              })}
              <p className="muted" style={{ margin: '6px 0 0', fontSize: 11.5 }}>
                WCAG: 4.5:1 for body text, 3:1 for large text and buttons.
              </p>
            </div>
          </aside>
        </form>
      </Drawer>
    </div>
  );
}

/* ------------------------------------------------------- phone preview */

function PhonePreview({ colors: c, compact }: { colors: ThemeColors; compact?: boolean }) {
  const v = {
    '--p-bg': c.background,
    '--p-surface': c.surface,
    '--p-muted-bg': c.surfaceMuted,
    '--p-text': c.text,
    '--p-muted': c.muted,
    '--p-border': c.border,
    '--p-primary': c.primary,
    '--p-primary-soft': c.primarySoft,
    '--p-on-primary': c.onPrimary,
    '--p-secondary': c.secondary,
    '--p-success': c.success,
    '--p-warning': c.warning,
    '--p-error': c.error,
    '--p-nav': c.nav,
  } as CSSProperties;
  return (
    <div className={`phone${compact ? ' phone-compact' : ''}`} style={v} aria-hidden>
      <div className="phone-screen">
        <div className="phone-status">
          <span>9:41</span>
          <span>●●●</span>
        </div>
        <div className="phone-head">
          <small>Good morning</small>
          <b>Your money</b>
        </div>
        <div className="phone-card phone-balance">
          <small>Total balance</small>
          <b>ETB 24,580</b>
          <div className="phone-chips">
            <span className="up">+ 12%</span>
            <span>This month</span>
          </div>
        </div>
        <div className="phone-row">
          <div className="phone-card phone-mini">
            <i style={{ background: c.success }} />
            <small>Income</small>
            <b>8,200</b>
          </div>
          <div className="phone-card phone-mini">
            <i style={{ background: c.error }} />
            <small>Spent</small>
            <b>3,140</b>
          </div>
        </div>
        {!compact ? (
          <>
            <div className="phone-card phone-list">
              <div>
                <span className="dot" style={{ background: c.warning }} />
                Loan to Abel
                <em>Due Fri</em>
              </div>
              <div>
                <span className="dot" style={{ background: c.secondary }} />
                Savings goal
                <em>64%</em>
              </div>
            </div>
            <div className="phone-btn">Add entry</div>
          </>
        ) : null}
        <nav className="phone-nav">
          <Home size={compact ? 12 : 15} className="on" />
          <Wallet size={compact ? 12 : 15} />
          <PieChart size={compact ? 12 : 15} />
          <User size={compact ? 12 : 15} />
        </nav>
      </div>
    </div>
  );
}
