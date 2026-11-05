import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowDown, ArrowUp, CornerDownLeft, Search, type LucideIcon } from 'lucide-react';

export type Command = {
  id: string;
  label: string;
  group: string;
  icon: LucideIcon;
  hint?: string;
  keywords?: string;
  run: () => void;
};

type Props = {
  open: boolean;
  onClose: () => void;
  commands: Command[];
};

/** Ctrl/⌘ K launcher: fuzzy-ish filter over pages and quick actions. */
export function CommandPalette({ open, onClose, commands }: Props) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setIndex(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 10);
    return () => window.clearTimeout(t);
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => {
      const hay = `${c.label} ${c.group} ${c.keywords ?? ''}`.toLowerCase();
      return q.split(/\s+/).every((part) => hay.includes(part));
    });
  }, [commands, query]);

  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(results.length - 1, 0)));
  }, [results.length]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  if (!open) return null;

  function run(cmd: Command | undefined) {
    if (!cmd) return;
    onClose();
    cmd.run();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(results[index]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  let lastGroup = '';
  return (
    <div className="cmdk-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="cmdk-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="cmdk-input-row">
          <Search size={18} strokeWidth={2} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            placeholder="Jump to a page or run an action…"
            aria-label="Search commands"
          />
          <kbd>esc</kbd>
        </div>
        <div className="cmdk-list" ref={listRef} role="listbox">
          {results.length === 0 ? <div className="cmdk-empty">Nothing matches “{query}”.</div> : null}
          {results.map((cmd, i) => {
            const header = cmd.group !== lastGroup ? cmd.group : null;
            lastGroup = cmd.group;
            return (
              <div key={cmd.id}>
                {header ? <div className="cmdk-group">{header}</div> : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === index}
                  data-idx={i}
                  className={`cmdk-item${i === index ? ' active' : ''}`}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => run(cmd)}
                >
                  <span className="cmdk-item-icon">
                    <cmd.icon size={16} strokeWidth={2} />
                  </span>
                  <span>{cmd.label}</span>
                  {cmd.hint ? <small>{cmd.hint}</small> : null}
                </button>
              </div>
            );
          })}
        </div>
        <div className="cmdk-foot">
          <span>
            <kbd>
              <ArrowUp size={10} />
            </kbd>
            <kbd>
              <ArrowDown size={10} />
            </kbd>
            navigate
          </span>
          <span>
            <kbd>
              <CornerDownLeft size={10} />
            </kbd>
            open
          </span>
        </div>
      </div>
    </div>
  );
}
