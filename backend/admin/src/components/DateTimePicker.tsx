import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';

/** Values are local "YYYY-MM-DDTHH:mm" strings (the same shape as <input type="datetime-local">). */
type Preset = { label: string; value: () => string };

const pad = (n: number) => String(n).padStart(2, '0');

export function toLocalValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parse(v: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatWhen(v: string): string {
  const d = parse(v);
  if (!d) return '';
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay(d, now)) return `Today, ${time}`;
  if (sameDay(d, tomorrow)) return `Tomorrow, ${time}`;
  const date = d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
  return `${date}, ${time}`;
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

/**
 * A date + time picker: a button that shows the chosen moment in words and opens a
 * calendar with a time row and quick presets. `min` greys out earlier days.
 */
export function DateTimePicker({
  value,
  onChange,
  placeholder = 'Pick a date',
  min,
  presets = [],
  disabled,
  clearLabel = 'Clear',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  min?: string;
  presets?: Preset[];
  disabled?: boolean;
  clearLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = parse(value);
  const minDate = parse(min ?? '');
  const [view, setView] = useState(() => {
    const base = selected ?? minDate ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const base = parse(value) ?? parse(min ?? '') ?? new Date();
    setView(new Date(base.getFullYear(), base.getMonth(), 1));
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
    // Re-centre the calendar only when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const days = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7; // Monday first
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - lead);
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [view]);

  const today = new Date();
  const minDay = minDate ? new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate()) : null;

  function pickDay(d: Date) {
    const base = selected ?? (() => {
      // New pick: default to the min time on that day if it is the min day, else 09:00.
      const t = new Date(d);
      if (minDate && sameDay(d, minDate)) {
        t.setHours(minDate.getHours() + 1, 0, 0, 0);
      } else t.setHours(9, 0, 0, 0);
      return t;
    })();
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), base.getHours(), base.getMinutes());
    onChange(toLocalValue(next));
  }

  function setTime(h: number, m: number) {
    const base = selected ?? new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const next = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m);
    onChange(toLocalValue(next));
  }

  const invalid = Boolean(selected && minDate && selected.getTime() <= minDate.getTime());
  const minute = selected ? selected.getMinutes() : 0;
  const minuteOptions = MINUTES.includes(minute) ? MINUTES : [...MINUTES, minute].sort((a, b) => a - b);

  return (
    <div className={`dtp${open ? ' open' : ''}`} ref={ref}>
      <button
        type="button"
        className={`dtp-trigger${selected ? '' : ' empty'}${invalid ? ' invalid' : ''}`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <CalendarDays size={15} />
        <span className="dtp-value">{selected ? formatWhen(value) : placeholder}</span>
        {selected && !disabled ? (
          <span
            role="button"
            tabIndex={0}
            className="dtp-clear"
            aria-label={clearLabel}
            title={clearLabel}
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onChange('');
              }
            }}
          >
            <X size={13} />
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="dtp-pop" role="dialog" aria-label="Choose date and time">
          {presets.length ? (
            <div className="dtp-presets">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className="dtp-preset"
                  onClick={() => {
                    onChange(p.value());
                    setOpen(false);
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          ) : null}

          <div className="dtp-cal">
            <div className="dtp-nav">
              <button type="button" className="dtp-nav-btn" aria-label="Previous month" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}>
                <ChevronLeft size={16} />
              </button>
              <strong>{view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong>
              <button type="button" className="dtp-nav-btn" aria-label="Next month" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}>
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="dtp-grid">
              {WEEKDAYS.map((w) => (
                <span key={w} className="dtp-wd">
                  {w}
                </span>
              ))}
              {days.map((d) => {
                const out = d.getMonth() !== view.getMonth();
                const before = minDay ? d < minDay : false;
                const isSel = selected ? sameDay(d, selected) : false;
                const isToday = sameDay(d, today);
                return (
                  <button
                    key={d.toISOString()}
                    type="button"
                    disabled={before}
                    className={['dtp-day', out ? 'out' : '', isSel ? 'sel' : '', isToday ? 'today' : ''].filter(Boolean).join(' ')}
                    onClick={() => pickDay(d)}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="dtp-time">
            <span className="dtp-time-label">Time</span>
            <select
              aria-label="Hour"
              value={selected ? selected.getHours() : ''}
              onChange={(e) => setTime(Number(e.target.value), minute)}
            >
              {!selected ? <option value="">--</option> : null}
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {pad(h)}
                </option>
              ))}
            </select>
            <span className="dtp-colon">:</span>
            <select
              aria-label="Minute"
              value={selected ? minute : ''}
              onChange={(e) => setTime(selected ? selected.getHours() : 9, Number(e.target.value))}
            >
              {!selected ? <option value="">--</option> : null}
              {minuteOptions.map((m) => (
                <option key={m} value={m}>
                  {pad(m)}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-primary btn-sm dtp-done" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
          {invalid ? <p className="dtp-error">Must be after the start time.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
