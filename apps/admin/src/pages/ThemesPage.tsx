import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, Check, Palette, Plus, X } from 'lucide-react';
import {
  api,
  DEFAULT_THEME_COLORS,
  THEME_COLOR_FIELDS,
  type SystemTheme,
  type ThemeColors,
} from '../api';
import { useAuth } from '../auth';
import { PageHeader } from '../components/PageHeader';
import { PermissionGate } from '../components/PermissionGate';

const SWATCH_KEYS: (keyof ThemeColors)[] = ['background', 'surface', 'primary', 'secondary', 'success', 'warning', 'error', 'nav'];

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

export function ThemesPage() {
  const { token, hasPerm } = useAuth();
  const [themes, setThemes] = useState<SystemTheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());

  const canWrite = hasPerm('themes.write');

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.listThemes(token);
      setThemes(res.themes ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load themes');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  function startCreate() {
    setForm(emptyForm());
    setEditingId('new');
  }

  function startEdit(theme: SystemTheme) {
    setForm({
      slug: theme.slug,
      label: theme.label,
      sortOrder: theme.sort_order,
      colors: { ...DEFAULT_THEME_COLORS, ...theme.colors },
    });
    setEditingId(theme.id);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  function setColor(key: keyof ThemeColors, value: string) {
    setForm((f) => ({ ...f, colors: { ...f.colors, [key]: value } }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token || !form.label.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (editingId === 'new') {
        const slug = form.slug.trim() ? slugify(form.slug) : slugify(form.label);
        await api.createTheme(token, {
          slug,
          label: form.label.trim(),
          colors: form.colors,
          sort_order: form.sortOrder,
        });
      } else if (editingId) {
        await api.updateTheme(token, editingId, {
          label: form.label.trim(),
          colors: form.colors,
          sort_order: form.sortOrder,
        });
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

  return (
    <div className="page">
      <PageHeader
        icon={Palette}
        title="Themes"
        subtitle="System themes available to mobile users"
        actions={
          canWrite ? (
            <button type="button" className="btn btn-primary" onClick={startCreate}>
              <Plus size={14} strokeWidth={2} /> New theme
            </button>
          ) : undefined
        }
      />

      {error ? (
        <div className="alert alert-error">
          <AlertTriangle size={16} strokeWidth={2} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className={editingId ? 'themes-layout' : undefined}>
        <div className="theme-grid">
          {loading ? (
            <p className="muted">Loading themes…</p>
          ) : themes.length === 0 ? (
            <div className="card data-table-empty">
              <Palette size={26} strokeWidth={1.5} />
              <p>No themes yet. Create the first one.</p>
            </div>
          ) : (
            themes.map((theme) => (
              <div key={theme.id} className={`card theme-card${theme.active ? ' theme-card-active' : ''}`}>
                <div className="theme-swatch-row">
                  {SWATCH_KEYS.map((key) => (
                    <span key={key} className="theme-swatch" style={{ background: theme.colors[key] || '#ccc' }} title={key} />
                  ))}
                </div>
                <div className="theme-card-body">
                  <strong>{theme.label}</strong>
                  <span className="muted mono">{theme.slug}</span>
                </div>
                <div className="theme-card-footer">
                  <span className={`badge badge-${theme.active ? 'success' : 'muted'}`}>{theme.active ? 'active' : 'inactive'}</span>
                  <PermissionGate perm="themes.write">
                    <div className="row-actions">
                      <button type="button" className="btn btn-sm" onClick={() => startEdit(theme)}>
                        Edit
                      </button>
                      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void toggleActive(theme)}>
                        {theme.active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </PermissionGate>
                </div>
              </div>
            ))
          )}
        </div>

        {editingId ? (
          <form className="card theme-editor" onSubmit={onSubmit}>
            <div className="card-title-row">
              <strong>{editingId === 'new' ? 'New theme' : 'Edit theme'}</strong>
              <button type="button" className="icon-btn icon-btn-sm" onClick={cancelEdit} aria-label="Close">
                <X size={14} strokeWidth={2} />
              </button>
            </div>

            <div className="theme-editor-fields">
              <label className="field">
                <span className="field-label">Label</span>
                <input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} required />
              </label>
              {editingId === 'new' ? (
                <label className="field">
                  <span className="field-label">Slug (optional)</span>
                  <input
                    value={form.slug}
                    onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                    placeholder={slugify(form.label) || 'auto from label'}
                  />
                </label>
              ) : null}
              <label className="field">
                <span className="field-label">Sort order</span>
                <input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) || 0 }))}
                />
              </label>
            </div>

            <div className="theme-color-grid">
              {THEME_COLOR_FIELDS.map((field) => (
                <label key={field.key} className="field theme-color-field">
                  <span className="field-label">{field.label}</span>
                  <span className="theme-color-input">
                    <input
                      type="color"
                      value={/^#[0-9a-fA-F]{6}$/.test(form.colors[field.key]) ? form.colors[field.key] : '#1FA8A8'}
                      onChange={(e) => setColor(field.key, e.target.value)}
                    />
                    <input
                      className="mono"
                      value={form.colors[field.key]}
                      onChange={(e) => setColor(field.key, e.target.value)}
                    />
                  </span>
                </label>
              ))}
            </div>

            <div className="theme-editor-actions">
              <button className="btn btn-primary" type="submit" disabled={busy || !form.label.trim()}>
                <Check size={14} strokeWidth={2} /> Save theme
              </button>
              <button className="btn" type="button" onClick={cancelEdit} disabled={busy}>
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
