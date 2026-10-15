import { useRef, useState } from 'react';
import { FileJson, Upload } from 'lucide-react';
import { Button } from './Button';
import { ButtonGroup } from './ButtonGroup';

type Props = {
  title?: string;
  example: string;
  hint?: string;
  disabled?: boolean;
  busy?: boolean;
  onImport: (parsed: unknown) => Promise<void> | void;
};

/** Paste or choose a JSON file, then import via onImport. */
export function BulkJsonUpload({ title = 'Bulk upload JSON', example, hint, disabled, busy, onImport }: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [localBusy, setLocalBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const working = busy || localBusy;

  async function runImport() {
    setError(null);
    setLocalBusy(true);
    try {
      const parsed = JSON.parse(text) as unknown;
      await onImport(parsed);
      setText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON');
    } finally {
      setLocalBusy(false);
    }
  }

  function onPickFile(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setText(String(reader.result || ''));
      setError(null);
    };
    reader.onerror = () => setError('Could not read file');
    reader.readAsText(file);
  }

  return (
    <div className="card" style={{ borderStyle: 'dashed' }}>
      <div className="card-title-row">
        <strong>{title}</strong>
        <span className="muted" style={{ fontSize: 12 }}>
          JSON file or paste
        </span>
      </div>
      {hint ? <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>{hint}</p> : null}
      {error ? (
        <div className="alert alert-error" style={{ marginBottom: 8 }}>
          {error}
        </div>
      ) : null}
      <ButtonGroup className="bulk-upload-actions">
        <Button
          type="button"
          variant="secondary"
          disabled={disabled || working}
          icon={<FileJson size={14} strokeWidth={2} />}
          onClick={() => fileRef.current?.click()}
        >
          Choose JSON…
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            onPickFile(e.target.files?.[0] ?? null);
            e.target.value = '';
          }}
        />
        <Button
          type="button"
          variant="primary"
          disabled={disabled || working || !text.trim()}
          busy={working}
          icon={<Upload size={14} strokeWidth={2} />}
          onClick={() => void runImport()}
        >
          Import
        </Button>
      </ButtonGroup>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={example}
        rows={6}
        disabled={disabled || working}
        style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
      />
    </div>
  );
}

/** Normalize bulk JSON into a list of objects. Accepts array, { items }, { types }, etc. */
export function asBulkArray(parsed: unknown, keys: string[] = ['items', 'types', 'institutions', 'categories', 'rows']): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    for (const k of keys) {
      if (Array.isArray(obj[k])) return obj[k] as unknown[];
    }
  }
  throw new Error('JSON must be an array (or { items: [...] })');
}
