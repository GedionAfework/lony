import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Download, FileJson, Languages, Save, Trash2 } from 'lucide-react';
import { api, type AppCalendar, type AppLocale, type LocalePack } from '../api';
import { useAuth } from '../auth';
import { PageHeader } from '../components/PageHeader';
import { PermissionGate } from '../components/PermissionGate';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { ButtonGroup } from '../components/ButtonGroup';
import { IconButton } from '../components/IconButton';
import { Table, type TableColumn } from '../components/Table';

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

export function LocalizationPage() {
  const { token, hasPerm } = useAuth();
  const canManage = hasPerm('localization.manage');
  const [tab, setTab] = useState<LocTab>('languages');
  const [locales, setLocales] = useState<AppLocale[]>([]);
  const [calendars, setCalendars] = useState<AppCalendar[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
      setLocales(loc.locales ?? []);
      setCalendars(cal.calendars ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load localization');
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function downloadTemplate(as: 'json' | 'csv') {
    if (!token) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const pack = await api.downloadLocaleCatalog(token);
      if (as === 'json') {
        setFormat('json');
        setPackText(JSON.stringify(pack, null, 2));
        setFileName('en.json');
      } else {
        setFormat('csv');
        const rows = ['locale,name,dir,key,value'];
        const locale = pack.locale || 'en';
        const name = (pack.name || 'English').replace(/"/g, '""');
        const dir = pack.dir || 'ltr';
        for (const [k, v] of Object.entries(pack.messages || {})) {
          const key = k.includes(',') || k.includes('"') ? `"${k.replace(/"/g, '""')}"` : k;
          const val =
            String(v).includes(',') || String(v).includes('"') || String(v).includes('\n')
              ? `"${String(v).replace(/"/g, '""')}"`
              : String(v);
          rows.push(`${locale},"${name}",${dir},${key},${val}`);
        }
        setPackText(rows.join('\n'));
        setFileName('en.csv');
        setCsvLocale(locale);
        setCsvName(pack.name || 'English');
        setCsvDir((pack.dir as 'ltr' | 'rtl') || 'ltr');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveLanguage() {
    if (!token || !canManage) return;
    if (!packText.trim()) {
      setError('Paste or choose a JSON/CSV pack first, then click Save language.');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const pack = parseLocalePayload(packText, format, {
        locale: csvLocale,
        name: csvName,
        dir: csvDir,
      });
      const res = await api.uploadLocale(token, pack);
      setSuccess(`Saved language “${res.locale?.name || pack.name}” (${pack.locale}) with ${Object.keys(pack.messages).length} keys.`);
      setPackText('');
      setFileName(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed — check JSON/CSV shape');
    } finally {
      setBusy(false);
    }
  }

  function onPickFile(file: File | null) {
    if (!file) return;
    const lower = file.name.toLowerCase();
    const nextFormat: 'json' | 'csv' = lower.endsWith('.csv') ? 'csv' : 'json';
    setFormat(nextFormat);
    setFileName(file.name);
    setSuccess(null);
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      setPackText(String(reader.result || ''));
    };
    reader.readAsText(file);
  }

  async function toggleLocale(code: string, enabled: boolean) {
    if (!token || !canManage) return;
    setBusy(true);
    try {
      await api.patchLocale(token, code, { enabled });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function removeLocale(code: string) {
    if (!token || !canManage || code === 'en') return;
    if (!confirm(`Remove language ${code}?`)) return;
    setBusy(true);
    try {
      await api.deleteLocale(token, code);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  async function toggleCalendar(id: string, enabled: boolean) {
    if (!token || !canManage) return;
    setBusy(true);
    try {
      await api.patchCalendar(token, id, { enabled });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  const localeColumns: TableColumn<AppLocale>[] = useMemo(
    () => [
      {
        key: 'code',
        header: 'Code',
        mono: true,
        render: (loc) => loc.code,
      },
      { key: 'name', header: 'Name', render: (loc) => loc.name },
      { key: 'dir', header: 'Dir', muted: true, render: (loc) => loc.dir },
      {
        key: 'keys',
        header: 'Keys',
        muted: true,
        render: (loc) => (loc.messages ? Object.keys(loc.messages).length : 0),
      },
      {
        key: 'visible',
        header: 'Visible',
        render: (loc) => (
          <label className="flex-row" style={{ gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={loc.enabled}
              disabled={!canManage || busy || (loc.code === 'en' && loc.enabled)}
              onChange={(e) => void toggleLocale(loc.code, e.target.checked)}
            />
            {loc.enabled ? 'On' : 'Hidden'}
          </label>
        ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        render: (loc) =>
          loc.code !== 'en' ? (
            <IconButton icon={Trash2} label="Remove language" disabled={!canManage || busy} onClick={() => void removeLocale(loc.code)} />
          ) : null,
      },
    ],
    [busy, canManage],
  );

  const calendarColumns: TableColumn<AppCalendar>[] = useMemo(
    () => [
      { key: 'id', header: 'ID', mono: true, render: (c) => c.id },
      { key: 'name', header: 'Name', render: (c) => c.name },
      {
        key: 'visible',
        header: 'Visible',
        render: (c) => (
          <label className="flex-row" style={{ gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={c.enabled}
              disabled={!canManage || busy}
              onChange={(e) => void toggleCalendar(c.id, e.target.checked)}
            />
            {c.enabled ? 'On' : 'Hidden'}
          </label>
        ),
      },
    ],
    [busy, canManage],
  );

  return (
    <PermissionGate perm="localization.manage">
      <PageHeader title="Localization" subtitle="Manage language packs and display calendars" />
      {error ? <div className="banner banner-error" style={{ marginBottom: 16 }}>{error}</div> : null}
      {success ? <div className="banner banner-success" style={{ marginBottom: 16 }}>{success}</div> : null}

      <div className="segmented" style={{ marginBottom: 16 }}>
        <button type="button" className={`segmented-btn${tab === 'languages' ? ' active' : ''}`} onClick={() => setTab('languages')}>
          <Languages size={15} strokeWidth={2} /> Languages
        </button>
        <button type="button" className={`segmented-btn${tab === 'calendars' ? ' active' : ''}`} onClick={() => setTab('calendars')}>
          <CalendarDays size={15} strokeWidth={2} /> Calendars
        </button>
      </div>

      {tab === 'languages' ? (
        <div className="stack-lg">
          <Card title="Add / update language" subtitle="Load a translated pack, then save it to the database.">
            <div className="segmented segmented-sm" style={{ marginBottom: 12 }}>
              <button type="button" className={`segmented-btn${format === 'json' ? ' active' : ''}`} onClick={() => setFormat('json')}>
                JSON
              </button>
              <button type="button" className={`segmented-btn${format === 'csv' ? ' active' : ''}`} onClick={() => setFormat('csv')}>
                CSV
              </button>
            </div>

            {format === 'csv' ? (
              <div className="flex-row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <input placeholder="Locale code (e.g. am-ET)" value={csvLocale} onChange={(e) => setCsvLocale(e.target.value)} style={{ minWidth: 140 }} />
                <input placeholder="Display name" value={csvName} onChange={(e) => setCsvName(e.target.value)} style={{ minWidth: 160 }} />
                <select value={csvDir} onChange={(e) => setCsvDir(e.target.value as 'ltr' | 'rtl')}>
                  <option value="ltr">ltr</option>
                  <option value="rtl">rtl</option>
                </select>
              </div>
            ) : null}

            <ButtonGroup>
              <Button variant="secondary" icon={<Download size={14} />} onClick={() => void downloadTemplate('json')} busy={busy}>
                English JSON
              </Button>
              <Button variant="secondary" icon={<Download size={14} />} onClick={() => void downloadTemplate('csv')} busy={busy}>
                English CSV
              </Button>
              <Button variant="secondary" icon={<FileJson size={14} />} onClick={() => fileRef.current?.click()} busy={busy}>
                Choose file…
              </Button>
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
              <Button
                variant="primary"
                icon={<Save size={14} />}
                onClick={() => void saveLanguage()}
                busy={busy}
                disabled={!canManage || !packText.trim()}
              >
                Save language
              </Button>
            </ButtonGroup>

            {fileName ? (
              <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
                Loaded file: <code>{fileName}</code> — click <strong>Save language</strong> to publish.
              </p>
            ) : (
              <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
                After pasting or choosing a file, click <strong>Save language</strong> to store it.
              </p>
            )}

            <textarea
              value={packText}
              onChange={(e) => {
                setPackText(e.target.value);
                setSuccess(null);
              }}
              placeholder={
                format === 'json'
                  ? '{ "locale": "am-ET", "name": "አማርኛ", "dir": "ltr", "messages": { "settings.save": "…" } }'
                  : 'locale,name,dir,key,value\nam-ET,አማርኛ,ltr,settings.save,አስቀምጥ'
              }
              rows={12}
              style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
            />
          </Card>

          <Table
            title="Installed languages"
            subtitle="Toggle visibility or remove non-English packs."
            columns={localeColumns}
            rows={locales}
            rowKey={(loc) => loc.code}
            emptyIcon={Languages}
            emptyMessage="No languages installed."
          />
        </div>
      ) : (
        <Table
          title="Calendars"
          subtitle="Seeded calendars for display. Keep at least one enabled."
          columns={calendarColumns}
          rows={calendars}
          rowKey={(c) => c.id}
          emptyIcon={CalendarDays}
          emptyMessage="No calendars available."
        />
      )}
    </PermissionGate>
  );
}
