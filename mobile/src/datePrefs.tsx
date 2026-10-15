import { createContext, useContext, type ReactNode } from 'react';
import {
  formatDisplayDate,
  formatDisplayDateTime,
  formatDisplayTime,
  type CalendarId,
  type HourCycle,
} from './calendarFormat';

export type DatePrefs = {
  locale: string;
  calendarId: CalendarId;
  hourCycle: HourCycle;
  timeZone: string;
};

const defaults: DatePrefs = {
  locale: 'en',
  calendarId: 'gregorian',
  hourCycle: '24h',
  timeZone: 'UTC',
};

const Ctx = createContext<DatePrefs>(defaults);

export function DatePrefsProvider({
  value,
  children,
}: {
  value: Partial<DatePrefs> | null | undefined;
  children: ReactNode;
}) {
  const merged: DatePrefs = {
    locale: value?.locale || defaults.locale,
    calendarId: value?.calendarId || defaults.calendarId,
    hourCycle: value?.hourCycle || defaults.hourCycle,
    timeZone: value?.timeZone || defaults.timeZone,
  };
  return <Ctx.Provider value={merged}>{children}</Ctx.Provider>;
}

export function useDatePrefs(): DatePrefs {
  return useContext(Ctx);
}

export function useFormatDate() {
  const prefs = useDatePrefs();
  return (iso: string | Date | null | undefined) =>
    formatDisplayDate(iso, {
      locale: prefs.locale,
      calendarId: prefs.calendarId,
      timeZone: prefs.timeZone,
    });
}

export function useFormatTime() {
  const prefs = useDatePrefs();
  return (iso: string | Date | null | undefined) =>
    formatDisplayTime(iso, {
      locale: prefs.locale,
      hourCycle: prefs.hourCycle,
      timeZone: prefs.timeZone,
    });
}

export function useFormatDateTime() {
  const prefs = useDatePrefs();
  return (iso: string | Date | null | undefined) =>
    formatDisplayDateTime(iso, {
      locale: prefs.locale,
      calendarId: prefs.calendarId,
      hourCycle: prefs.hourCycle,
      timeZone: prefs.timeZone,
    });
}
