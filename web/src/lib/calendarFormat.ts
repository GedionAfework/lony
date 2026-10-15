/** Display helpers for calendar + hour-cycle preferences. API dates stay ISO Gregorian. */

import {
  formatCalendarPartsLabel,
  getCalendarParts,
} from './calendarMath';

export type CalendarId =
  | 'gregorian'
  | 'islamic'
  | 'hijri'
  | 'hebrew'
  | 'chinese'
  | 'ethiopic'
  | 'ethiopian'
  | 'persian'
  | 'solar_hijri'
  | string;

export type HourCycle = '24h' | '12h' | 'ethiopian_6' | string;

export function intlCalendarOf(calendarId?: CalendarId | null): string {
  const cal = (calendarId || 'gregorian').toLowerCase().trim();
  switch (cal) {
    case 'gregorian':
    case 'gregory':
      return 'gregory';
    case 'islamic':
    case 'hijri':
      return 'islamic';
    case 'hebrew':
      return 'hebrew';
    case 'chinese':
      return 'chinese';
    case 'ethiopic':
    case 'ethiopian':
      return 'ethiopic';
    case 'persian':
    case 'solar_hijri':
    case 'jalali':
      return 'persian';
    default:
      return 'gregory';
  }
}

function asDate(iso: string | Date | null | undefined): Date | null {
  if (!iso) return null;
  if (iso instanceof Date) return Number.isNaN(iso.getTime()) ? null : iso;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).trim());
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Primary label in the user's calendar preference (native month names for that system). */
export function formatDisplayDate(
  iso: string | Date | null | undefined,
  opts?: { locale?: string; calendarId?: CalendarId; timeZone?: string },
): string {
  const d = asDate(iso);
  if (!d) return '—';
  const intlCal = intlCalendarOf(opts?.calendarId);
  if (intlCal !== 'gregory') {
    return formatCalendarPartsLabel(opts?.calendarId, getCalendarParts(d, opts?.calendarId));
  }
  try {
    return new Intl.DateTimeFormat(opts?.locale || 'en', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      ...(opts?.timeZone ? { timeZone: opts.timeZone } : {}),
    }).format(d);
  } catch {
    return d.toLocaleDateString(opts?.locale || 'en', { month: 'long', day: 'numeric', year: 'numeric' });
  }
}

export function formatDisplayTime(
  iso: string | Date | null | undefined,
  opts?: { locale?: string; hourCycle?: HourCycle; timeZone?: string },
): string {
  const d = asDate(iso);
  if (!d) return '—';
  const locale = opts?.locale || 'en';
  const cycle = (opts?.hourCycle || '24h').toLowerCase();
  const timeZone = opts?.timeZone;
  if (cycle === 'ethiopian_6') {
    const h24 = d.getHours();
    const m = d.getMinutes();
    const eth = (h24 + 6) % 12 || 12;
    const period = h24 >= 6 && h24 < 18 ? 'day' : 'night';
    return `${eth}:${String(m).padStart(2, '0')} (${period})`;
  }
  try {
    return d.toLocaleTimeString(locale, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: cycle === '12h',
      ...(timeZone ? { timeZone } : {}),
    });
  } catch {
    return d.toLocaleTimeString();
  }
}

export function formatDisplayDateTime(
  iso: string | Date | null | undefined,
  opts?: { locale?: string; calendarId?: CalendarId; hourCycle?: HourCycle; timeZone?: string },
): string {
  const date = formatDisplayDate(iso, opts);
  if (date === '—') return '—';
  return `${date} · ${formatDisplayTime(iso, opts)}`;
}
