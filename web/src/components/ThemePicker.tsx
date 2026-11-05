import { useEffect, useState, type CSSProperties } from 'react';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { THEME_COLOR_FIELDS, useTheme, type ThemeColors, type ThemePreset } from '../lib/theme';
import { Button } from './Button';
import { Field } from './Field';

/** A tiny app window painted with a palette, like the phone previews on mobile. */
function Preview({ c }: { c: ThemeColors }) {
  const v = {
    '--pv-bg': c.background,
    '--pv-surface': c.surface,
    '--pv-muted': c.surfaceMuted,
    '--pv-text': c.text,
    '--pv-sub': c.muted,
    '--pv-border': c.border,
    '--pv-primary': c.primary,
    '--pv-nav': c.nav,
  } as CSSProperties;
  return (
    <div className="pv" style={v} aria-hidden>
      <div className="pv-rail">
        <i className="on" />
        <i />
        <i />
      </div>
      <div className="pv-main">
        <div className="pv-line w70" />
        <div className="pv-line sub w45" />
        <div className="pv-card" />
        <div className="pv-btn" />
      </div>
    </div>
  );
}

function Tile({ theme, active, onPick, onEdit, onDelete }: { theme: ThemePreset; active: boolean; onPick: () => void; onEdit?: () => void; onDelete?: () => void }) {
  return (
    <div className={`theme-tile ${active ? 'active' : ''}`}>
      <button type="button" className="theme-tile-pick" onClick={onPick} aria-pressed={active}>
        <Preview c={theme.colors} />
        <span className="theme-tile-name">
          {active ? <Check size={14} /> : null}
          {theme.name}
        </span>
      </button>
      {onEdit || onDelete ? (
        <div className="theme-tile-tools">
          {onEdit ? (
            <button type="button" className="icon-btn sm ghost" aria-label={`Edit ${theme.name}`} onClick={onEdit}>
              <Pencil size={14} />
            </button>
          ) : null}
          {onDelete ? (
            <button type="button" className="icon-btn sm ghost" aria-label={`Delete ${theme.name}`} onClick={onDelete}>
              <Trash2 size={14} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const HEX = /^#[0-9a-f]{6}$/i;

export function ThemePicker() {
  const { colors, themeId, presets, customThemes, setThemeId, saveCustomTheme, deleteCustomTheme, refreshSystemThemes } = useTheme();
  const [editing, setEditing] = useState<{ id: string | null; name: string; colors: ThemeColors } | null>(null);

  useEffect(() => {
    refreshSystemThemes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (editing) {
    return (
      <div className="set-group">
        <div className="set-group-title">{editing.id ? 'Edit theme' : 'New theme'}</div>
        <div className="set-group-body">
          <div className="set-inset">
            <div className="theme-editor-head">
              <Preview c={editing.colors} />
              <Field label="Name" value={editing.name} onChange={(name) => setEditing({ ...editing, name })} />
            </div>
            <div className="theme-colors">
              {THEME_COLOR_FIELDS.map((f) => {
                const val = editing.colors[f.key];
                return (
                  <label key={f.key} className="theme-color">
                    <input
                      type="color"
                      value={HEX.test(val) ? val : '#000000'}
                      onChange={(e) => setEditing({ ...editing, colors: { ...editing.colors, [f.key]: e.target.value } })}
                    />
                    <span>
                      <strong>{f.label}</strong>
                      <input
                        className="mono"
                        value={val}
                        onChange={(e) => setEditing({ ...editing, colors: { ...editing.colors, [f.key]: e.target.value.trim() } })}
                      />
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="set-actions" style={{ gap: 8 }}>
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  saveCustomTheme({
                    id: editing.id || `custom_${Date.now()}`,
                    name: editing.name.trim() || 'Custom theme',
                    kind: 'custom',
                    colors: editing.colors,
                  });
                  setEditing(null);
                }}
              >
                Save theme
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="set-group">
        <div className="set-group-title">Themes</div>
        <div className="set-group-body">
          <div className="theme-grid">
            {presets.map((t) => (
              <Tile key={t.id} theme={t} active={themeId === t.id} onPick={() => setThemeId(t.id)} />
            ))}
          </div>
        </div>
      </div>

      <div className="set-group">
        <div className="set-group-title">Your themes</div>
        <div className="set-group-body">
          <div className="theme-grid">
            {customThemes.map((t) => (
              <Tile
                key={t.id}
                theme={t}
                active={themeId === t.id}
                onPick={() => setThemeId(t.id)}
                onEdit={() => setEditing({ id: t.id, name: t.name, colors: { ...t.colors } })}
                onDelete={() => deleteCustomTheme(t.id)}
              />
            ))}
            <button type="button" className="theme-tile theme-new" onClick={() => setEditing({ id: null, name: 'My theme', colors: { ...colors } })}>
              <span className="theme-new-icon">
                <Plus size={20} />
              </span>
              <span className="theme-tile-name">Create theme</span>
            </button>
          </div>
        </div>
        <div className="set-group-foot">Your themes are saved in this browser.</div>
      </div>
    </>
  );
}
