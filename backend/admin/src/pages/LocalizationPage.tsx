import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Download,
  FileJson,
  Gauge,
  KeyRound,
  Languages,
  Plus,
  Save,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { api, type AppCalendar, type AppLocale, type LocalePack } from '../api';
import { useAuth } from '../auth';
import { PageHeader } from '../components/PageHeader';
import { PermissionGate } from '../components/PermissionGate';
import { Button } from '../components/Button';
import { IconButton } from '../components/IconButton';
import { Modal } from '../components/Modal';
import { Drawer } from '../components/Drawer';
import { StatCard } from '../components/StatCard';

type LocTab = 'languages' | 'calendars';

export function parseLocaleCSV(
  text: string,
  meta?: { locale?: string; name?: string; dir?: string },
): LocalePack {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (lines.length < 2) {
    throw new Error('CSV needs a header row and at least one data row');
  }

  function splitCSVLine(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        out.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  }

  const header = splitCSVLine(lines[0]).map((h) => h.toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const keyI = idx('key');
  const valueI = idx('value');
  if (keyI < 0 || valueI < 0) {
    throw new Error('CSV must include key and value columns');
  }
  const localeI = idx('locale');
  const nameI = idx('name');
  const dirI = idx('dir');

  const messages: Record<string, string> = {};
  let locale = (meta?.locale || '').trim();
  let name = (meta?.name || '').trim();
  let dir = (meta?.dir || 'ltr').trim().toLowerCase();

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i]);
    const key = cols[keyI]?.trim();
    const value = cols[valueI] ?? '';
    if (!key) continue;
    messages[key] = value;
    if (localeI >= 0 && cols[localeI]?.trim()) locale = cols[localeI].trim();
    if (nameI >= 0 && cols[nameI]?.trim()) name = cols[nameI].trim();
    if (dirI >= 0 && cols[dirI]?.trim()) dir = cols[dirI].trim().toLowerCase();
  }

  if (!locale) throw new Error('locale is required (CSV column or form field)');
  if (!name) name = locale;
  if (dir !== 'rtl') dir = 'ltr';
  if (Object.keys(messages).length === 0) throw new Error('No message rows found');

  return { locale, name, dir, messages };
}

function parseLocalePayload(
  text: string,
  format: 'json' | 'csv',
  meta?: { locale?: string; name?: string; dir?: string },
): LocalePack {
  if (format === 'csv') return parseLocaleCSV(text, meta);
  const pack = JSON.parse(text) as LocalePack;
  if (!pack.locale || !pack.messages || typeof pack.messages !== 'object') {
    throw new Error('JSON must include locale and messages');
  }
  if (!pack.name) pack.name = pack.locale;
  if (!pack.dir) pack.dir = 'ltr';
  return pack;
}

function downloadFile(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function pct(n: number, d: number) {
  return d ? Math.min(100, Math.round((n / d) * 100)) : 0;
}

export function LocalizationPage() {
  const { token, hasPerm } = useAuth();
  const canManage = hasPerm('localization.manage');
  const [tab, setTab] = useState<LocTab>('languages');
  const [locales, setLocales] = useState<AppLocale[]>([]);
  const [calendars, setCalendars] = useState<AppCalendar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<AppLocale | null>(null);

  // upload drawer
  const [format, setFormat] = useState<'json' | 'csv'>('json');
  const [packText, setPackText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvLocale, setCsvLocale] = useState('');
  const [csvName, setCsvName] = useState('');
  const [csvDir, setCsvDir] = useState<'ltr' | 'rtl'>('ltr');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const [loc, cal] = await Promise.all([api.listLocalesAdmin(token), api.listCalendarsAdmin(token)]);
      setLocales((loc.locales ?? []).slice().sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code)));
      setCalendars((cal.calendars ?? []).slice().sort((a, b) => a.sort_order - b.sort_order));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load localization');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const english = locales.find((l) => l.code === 'en');
  const baseKeys = useMemo(() => Object.keys(english?.messages ?? {}), [english]);

  function coverage(loc: AppLocale) {
    const msgs = loc.messages ?? {};
    const keys = Object.keys(msgs).length;
    const missing = baseKeys.filter((k) => !(k in msgs) || !String(msgs[k]).trim());
    return { keys, missing, percent: loc.code === 'en' ? 100 : pct(baseKeys.length - missing.length, baseKeys.length) };
  }

  // Parse what's in the upload box so the admin sees what will be saved.
  const preview = useMemo(() => {
    if (!packText.trim()) return null;
    try {
      const pack = parseLocalePayload(packText, format, { locale: csvLocale, name: csvName, dir: csvDir });
      const keys = Object.keys(pack.messages);
      const missing = baseKeys.filter((k) => !(k in pack.messages));
      const extra = baseKeys.length ? keys.filter((k) => !baseKeys.includes(k)) : [];
      const existing = locales.find((l) => l.code === pack.locale);
      return { ok: true as const, pack, keys: keys.length, missing, extra, existing };
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : 'Could not read pack' };
    }
  }, [packText, format, csvLocale, csvName, csvDir, baseKeys, locales]);

  async function loadEnglishTemplate(as: 'json' | 'csv') {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const pack = await api.downloadLocaleCatalog(token);
      if (as === 'json') {
        setFormat('json');
        setPackText(JSON.stringify(pack, null, 2));
        setFileName('en.json');
      } else {
        setFormat('csv');
        setPackText(toCSV(pack));
        setFileName('en.csv');
        setCsvLocale(pack.locale || 'en');
        setCsvName(pack.name || 'English');
        setCsvDir((pack.dir as 'ltr' | 'rtl') || 'ltr');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setBusy(false);
    }
  }

  function onPickFile(file: File | null) {
    if (!file) return;
    setFormat(file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'json');
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setPackText(String(reader.result || ''));
    reader.readAsText(file);
  }

  async function saveLanguage() {
    if (!token || !canManage || !preview?.ok) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await api.uploadLocale(token, preview.pack);
      setSuccess(`Saved “${res.locale?.name || preview.pack.name}” (${preview.pack.locale}) with ${preview.keys} keys.`);
      setPackText('');
      setFileName(null);
      setUploadOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed — check the pack shape');
    } finally {
      setBusy(false);
    }
  }

  async function toggleLocale(loc: AppLocale) {
    if (!token || !canManage) return;
    setBusy(true);
    try {
      await api.patchLocale(token, loc.code, { enabled: !loc.enabled });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function removeLocale(loc: AppLocale) {
    if (!token || !canManage || loc.code === 'en') return;
    setBusy(true);
    try {
      await api.deleteLocale(token, loc.code);
      setConfirmDelete(null);
      setSuccess(`Removed ${loc.name} (${loc.code}).`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  async function toggleCalendar(cal: AppCalendar) {
    if (!token || !canManage) return;
    setBusy(true);
    try {
      await api.patchCalendar(token, cal.id, { enabled: !cal.enabled });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  function exportPack(loc: AppLocale) {
    const pack: LocalePack = { locale: loc.code, name: loc.name, dir: loc.dir, messages: loc.messages ?? {} };
    downloadFile(`${loc.code}.json`, JSON.stringify(pack, null, 2), 'application/json');
  }

  function exportMissing(loc: AppLocale) {
    const { missing } = coverage(loc);
    const en = english?.messages ?? {};
    const messages = Object.fromEntries(missing.map((k) => [k, en[k] ?? '']));
    const pack: LocalePack = { locale: loc.code, name: loc.name, dir: loc.dir, messages };
    downloadFile(`${loc.code}-missing.json`, JSON.stringify(pack, null, 2), 'application/json');
  }

  const visibleLocales = locales.filter((l) => {
    const q = search.trim().toLowerCase();
    return !q || l.code.toLowerCase().includes(q) || l.name.toLowerCase().includes(q);
  });
  const enabledCount = locales.filter((l) => l.enabled).length;
  const avgCoverage = locales.length
    ? Math.round(locales.filter((l) => l.code !== 'en').reduce((n, l) => n + coverage(l).percent, 0) / Math.max(1, locales.length - 1))
    : 0;
  const enabledCalendars = calendars.filter((c) => c.enabled).length;

  return (
    <PermissionGate perm="localization.manage">
      <div className="page">
        <PageHeader
          icon={Languages}
          title="Localization"
          actions={
            tab === 'languages' && canManage ? (
              <Button variant="primary" icon={<Upload size={15} strokeWidth={2} />} onClick={() => setUploadOpen(true)}>
                Add or update language
              </Button>
            ) : null
          }
        />

        {error ? (
          <div className="alert alert-error">
            <AlertTriangle size={16} strokeWidth={2} />
            <span>{error}</span>
          </div>
        ) : null}
        {success ? (
          <div className="banner banner-success">
            <CheckCircle2 size={16} strokeWidth={2} />
            <span>{success}</span>
          </div>
        ) : null}

        <div className="stat-grid">
          <StatCard icon={Languages} label="Languages installed" value={locales.length} hint={`${enabledCount} visible in the app`} />
          <StatCard icon={KeyRound} label="Base keys (English)" value={baseKeys.length.toLocaleString()} />
          <StatCard
            icon={Gauge}
            label="Average translation coverage"
            value={locales.length > 1 ? `${avgCoverage}%` : '—'}
            tone={locales.length > 1 && avgCoverage < 80 ? 'warning' : 'default'}
          />
          <StatCard icon={CalendarDays} label="Calendars enabled" value={`${enabledCalendars} / ${calendars.length}`} />
        </div>

        <div className="loc-toolbar">
          <div className="seg" role="tablist">
            <button type="button" className={tab === 'languages' ? 'active' : ''} onClick={() => setTab('languages')}>
              <Languages size={14} strokeWidth={2} /> Languages <span className="seg-count">{locales.length}</span>
            </button>
            <button type="button" className={tab === 'calendars' ? 'active' : ''} onClick={() => setTab('calendars')}>
              <CalendarDays size={14} strokeWidth={2} /> Calendars <span className="seg-count">{calendars.length}</span>
            </button>
          </div>
          {tab === 'languages' ? (
            <label className="catalog-search" style={{ maxWidth: 320 }}>
              <Search size={16} strokeWidth={2} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a language…" aria-label="Find a language" />
            </label>
          ) : null}
        </div>

        {tab === 'languages' ? (
          loading ? (
            <div className="skeleton-grid">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="skeleton skeleton-card" />
              ))}
            </div>
          ) : (
            <div className="lang-grid">
              {visibleLocales.map((loc) => {
                const c = coverage(loc);
                const tone = c.percent >= 95 ? 'good' : c.percent >= 70 ? 'mid' : 'low';
                return (
                  <article key={loc.code} className={`card lang-card${loc.enabled ? '' : ' lang-card-off'}`}>
                    <header className="lang-card-head">
                      <span className="lang-code">{loc.code.split('-')[0].toUpperCase()}</span>
                      <div className="lang-title">
                        <strong dir={loc.dir === 'rtl' ? 'rtl' : undefined}>{loc.name}</strong>
                        <span className="muted mono">{loc.code}</span>
                      </div>
                      <Switch
                        checked={loc.enabled}
                        disabled={!canManage || busy || (loc.code === 'en' && loc.enabled)}
                        label={`${loc.name} visible`}
                        onChange={() => void toggleLocale(loc)}
                      />
                    </header>

                    <div className="lang-progress">
                      <div className="lang-progress-top">
                        <span>{loc.code === 'en' ? 'Source language' : 'Translated'}</span>
                        <b>{c.percent}%</b>
                      </div>
                      <div className={`lang-bar lang-bar-${tone}`}>
                        <span style={{ width: `${c.percent}%` }} />
                      </div>
                      <div className="lang-meta">
                        <span>{c.keys.toLocaleString()} keys</span>
                        {loc.code !== 'en' && c.missing.length ? <span className="lang-missing">{c.missing.length} missing</span> : null}
                        {loc.dir === 'rtl' ? <span className="badge badge-muted">RTL</span> : null}
                        {!loc.enabled ? <span className="badge badge-muted">hidden</span> : null}
                      </div>
                    </div>

                    <footer className="lang-actions">
                      <Button size="sm" variant="ghost" icon={<Download size={14} strokeWidth={2} />} onClick={() => exportPack(loc)}>
                        Pack
                      </Button>
                      {loc.code !== 'en' && c.missing.length ? (
                        <Button size="sm" variant="ghost" icon={<FileJson size={14} strokeWidth={2} />} onClick={() => exportMissing(loc)}>
                          Missing keys
                        </Button>
                      ) : null}
                      {loc.code !== 'en' && canManage ? (
                        <IconButton icon={Trash2} label="Remove language" variant="danger" size="sm" disabled={busy} onClick={() => setConfirmDelete(loc)} />
                      ) : null}
                    </footer>
                  </article>
                );
              })}
              {canManage ? (
                <button type="button" className="lang-add" onClick={() => setUploadOpen(true)}>
                  <Plus size={22} strokeWidth={2} />
                  <strong>Add a language</strong>
                  <span className="muted">Upload a JSON or CSV pack</span>
                </button>
              ) : null}
            </div>
          )
        ) : (
          <div className="cal-grid">
            {calendars.map((cal) => {
              const lastOn = cal.enabled && enabledCalendars <= 1;
              return (
                <div key={cal.id} className={`card cal-card${cal.enabled ? ' on' : ''}`}>
                  <span className="cal-icon">
                    <CalendarDays size={20} strokeWidth={2} />
                  </span>
                  <div className="cell-stack" style={{ flex: 1 }}>
                    <strong>{cal.name}</strong>
                    <span className="muted mono" style={{ fontSize: 12 }}>
                      {cal.id}
                    </span>
                    {lastOn ? <span className="muted" style={{ fontSize: 12 }}>At least one calendar must stay on</span> : null}
                  </div>
                  <Switch checked={cal.enabled} disabled={!canManage || busy || lastOn} label={`${cal.name} enabled`} onChange={() => void toggleCalendar(cal)} />
                </div>
              );
            })}
            {calendars.length === 0 && !loading ? <p className="muted">No calendars available.</p> : null}
          </div>
        )}

        <Drawer
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          eyebrow="Language pack"
          title="Add or update a language"
          width={600}
          icon={
            <span className="settings-panel-icon">
              <Upload size={18} strokeWidth={2} />
            </span>
          }
          footer={
            <>
              <Button variant="ghost" onClick={() => setUploadOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" busy={busy} disabled={!preview?.ok} icon={<Save size={15} strokeWidth={2} />} onClick={() => void saveLanguage()}>
                {preview?.ok && preview.existing ? `Update ${preview.pack.locale}` : 'Save language'}
              </Button>
            </>
          }
        >
          <ol className="steps">
            <li>
              <b>Start from English</b>
              <span className="muted">Load the current English keys, translate the values, and paste them back.</span>
              <div className="btn-group" style={{ marginTop: 8 }}>
                <Button size="sm" variant="secondary" icon={<Download size={14} />} busy={busy} onClick={() => void loadEnglishTemplate('json')}>
                  English JSON
                </Button>
                <Button size="sm" variant="secondary" icon={<Download size={14} />} busy={busy} onClick={() => void loadEnglishTemplate('csv')}>
                  English CSV
                </Button>
              </div>
            </li>
            <li>
              <b>Load your pack</b>
              <span className="muted">Drop in a file or paste below.</span>
              <button
                type="button"
                className="dropzone"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  onPickFile(e.dataTransfer.files?.[0] ?? null);
                }}
              >
                <FileJson size={22} strokeWidth={1.8} />
                <span>{fileName ? <b>{fileName}</b> : 'Drop a .json or .csv file, or click to browse'}</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,.csv,application/json,text/csv"
                style={{ display: 'none' }}
                onChange={(e) => {
                  onPickFile(e.target.files?.[0] ?? null);
                  e.target.value = '';
                }}
              />
            </li>
          </ol>

          <div className="seg" role="tablist" style={{ alignSelf: 'flex-start' }}>
            <button type="button" className={format === 'json' ? 'active' : ''} onClick={() => setFormat('json')}>
              JSON
            </button>
            <button type="button" className={format === 'csv' ? 'active' : ''} onClick={() => setFormat('csv')}>
              CSV
            </button>
          </div>

          {format === 'csv' ? (
            <div className="loc-csv-meta">
              <input placeholder="Locale code (e.g. am-ET)" value={csvLocale} onChange={(e) => setCsvLocale(e.target.value)} />
              <input placeholder="Display name" value={csvName} onChange={(e) => setCsvName(e.target.value)} />
              <select value={csvDir} onChange={(e) => setCsvDir(e.target.value as 'ltr' | 'rtl')}>
                <option value="ltr">Left to right</option>
                <option value="rtl">Right to left</option>
              </select>
            </div>
          ) : null}

          <textarea
            className="ops-notes"
            value={packText}
            onChange={(e) => setPackText(e.target.value)}
            placeholder={
              format === 'json'
                ? '{ "locale": "am-ET", "name": "አማርኛ", "dir": "ltr", "messages": { "settings.save": "…" } }'
                : 'locale,name,dir,key,value\nam-ET,አማርኛ,ltr,settings.save,አስቀምጥ'
            }
            rows={10}
          />

          {preview ? (
            preview.ok ? (
              <div className="pack-preview">
                <div className="pack-preview-head">
                  <CheckCircle2 size={18} strokeWidth={2} />
                  <strong>
                    {preview.pack.name} <span className="muted mono">{preview.pack.locale}</span>
                  </strong>
                  <span className="badge badge-muted">{preview.existing ? 'updates existing' : 'new language'}</span>
                </div>
                <div className="mini-tiles">
                  <div className="mini-tile">
                    <small>Keys in pack</small>
                    <strong>{preview.keys.toLocaleString()}</strong>
                  </div>
                  <div className="mini-tile">
                    <small>Coverage of English</small>
                    <strong>{baseKeys.length ? `${pct(baseKeys.length - preview.missing.length, baseKeys.length)}%` : '—'}</strong>
                  </div>
                  <div className={`mini-tile${preview.missing.length ? ' mini-tile-warn' : ''}`}>
                    <small>Missing keys</small>
                    <strong>{preview.missing.length}</strong>
                  </div>
                  <div className="mini-tile">
                    <small>Unknown keys</small>
                    <strong>{preview.extra.length}</strong>
                  </div>
                </div>
                {preview.missing.length ? (
                  <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
                    Missing keys fall back to English in the app. First few: <code>{preview.missing.slice(0, 4).join(', ')}</code>
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="alert alert-error">
                <AlertTriangle size={16} strokeWidth={2} />
                <span>{preview.message}</span>
              </div>
            )
          ) : null}
        </Drawer>

        <Modal
          open={Boolean(confirmDelete)}
          title={`Remove ${confirmDelete?.name ?? 'language'}?`}
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
              <Button variant="danger" busy={busy} icon={<Trash2 size={15} />} onClick={() => confirmDelete && void removeLocale(confirmDelete)}>
                Remove
              </Button>
            </>
          }
        >
          <p style={{ margin: 0, lineHeight: 1.6 }}>
            People using <b>{confirmDelete?.code}</b> fall back to English. Download the pack first if you may want it back.
          </p>
        </Modal>
      </div>
    </PermissionGate>
  );
}

function toCSV(pack: LocalePack) {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = ['locale,name,dir,key,value'];
  for (const [k, v] of Object.entries(pack.messages || {})) {
    rows.push([pack.locale || 'en', pack.name || 'English', pack.dir || 'ltr', k, String(v)].map(esc).join(','));
  }
  return rows.join('\n');
}

function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: () => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`switch${checked ? ' on' : ''}`} disabled={disabled} onClick={onChange}>
      <span />
    </button>
  );
}
