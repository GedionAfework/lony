/** Pure calendar conversions — works without Hermes Intl calendar support. */

export type CalendarId = string;

export type CalParts = { year: number; month: number; day: number };

function intlCalendarOf(calendarId?: CalendarId | null): string {
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

const ETHIOPIC_MONTHS = [
  'መስከረም',
  'ጥቅምት',
  'ኅዳር',
  'ታኅሳስ',
  'ጥር',
  'የካቲት',
  'መጋቢት',
  'ሚያዝያ',
  'ግንቦት',
  'ሰኔ',
  'ሐምሌ',
  'ነሐሴ',
  'ጳጉሜን',
];

const ISLAMIC_MONTHS = [
  'Muharram',
  'Safar',
  "Rabi' I",
  "Rabi' II",
  'Jumada I',
  'Jumada II',
  'Rajab',
  "Sha'ban",
  'Ramadan',
  'Shawwal',
  "Dhu al-Qi'dah",
  'Dhu al-Hijjah',
];

/** Indexed by Hebrew month number 1..13 (Nisan=1 … Adar II=13). */
const HEBREW_MONTH_NAME: Record<number, string> = {
  1: 'Nisan',
  2: 'Iyar',
  3: 'Sivan',
  4: 'Tammuz',
  5: 'Av',
  6: 'Elul',
  7: 'Tishrei',
  8: 'Cheshvan',
  9: 'Kislev',
  10: 'Tevet',
  11: 'Shevat',
  12: 'Adar',
  13: 'Adar II',
};

const PERSIAN_MONTHS = [
  'Farvardin',
  'Ordibehesht',
  'Khordad',
  'Tir',
  'Mordad',
  'Shahrivar',
  'Mehr',
  'Aban',
  'Azar',
  'Dey',
  'Bahman',
  'Esfand',
];

const CHINESE_MONTHS = [
  '正月',
  '二月',
  '三月',
  '四月',
  '五月',
  '六月',
  '七月',
  '八月',
  '九月',
  '十月',
  '十一月',
  '十二月',
];

const GREGORIAN_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function gregorianToJdn(y: number, m: number, d: number): number {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return (
    d +
    Math.floor((153 * mm + 2) / 5) +
    365 * yy +
    Math.floor(yy / 4) -
    Math.floor(yy / 100) +
    Math.floor(yy / 400) -
    32045
  );
}

function jdnToGregorian(jdn: number): Date {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  const day = e - Math.floor((153 * m + 2) / 5) + 1;
  const month = m + 3 - 12 * Math.floor(m / 10);
  const year = 100 * b + d - 4800 + Math.floor(m / 10);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

/* ---- Ethiopic ---- */
export function ethiopicFromGregorian(date: Date): CalParts {
  const jdn = gregorianToJdn(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const r = (jdn - 1723856) % 1461;
  const n = (r % 365) + 365 * Math.floor(r / 1460);
  const year = 4 * Math.floor((jdn - 1723856) / 1461) + Math.floor(r / 365) - Math.floor(r / 1460);
  const month = Math.floor(n / 30) + 1;
  const day = (n % 30) + 1;
  return { year, month, day };
}

export function gregorianFromEthiopic(year: number, month: number, day: number): Date {
  const jdn = 1723856 + 365 * year + Math.floor(year / 4) + 30 * (month - 1) + day - 1;
  return jdnToGregorian(jdn);
}

/* ---- Islamic (Kuwaiti / tabular civil) ---- */
export function islamicFromGregorian(date: Date): CalParts {
  const jdn = gregorianToJdn(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const l = jdn - 1948440 + 10632;
  const n = Math.floor((l - 1) / 10631);
  const l2 = l - 10631 * n + 354;
  const j =
    Math.floor((10985 - l2) / 5316) * Math.floor((50 * l2) / 17719) +
    Math.floor(l2 / 5670) * Math.floor((43 * l2) / 15238);
  const l3 =
    l2 -
    Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) -
    Math.floor(j / 16) * Math.floor((15238 * j) / 43) +
    29;
  const month = Math.floor((24 * l3) / 709);
  const day = l3 - Math.floor((709 * month) / 24);
  const year = 30 * n + j - 30;
  return { year, month, day };
}

export function gregorianFromIslamic(year: number, month: number, day: number): Date {
  const jdn =
    Math.floor((11 * year + 3) / 30) +
    354 * year +
    30 * month -
    Math.floor((month - 1) / 2) +
    day +
    1948440 -
    385;
  return jdnToGregorian(jdn);
}

/* ---- Persian / Solar Hijri ---- */
function persianLeap(year: number): boolean {
  return (((((year - (year > 0 ? 474 : 473)) % 2820) + 474 + 38) * 682) % 2816) < 682;
}

export function persianFromGregorian(date: Date): CalParts {
  const gy = date.getFullYear();
  const gm = date.getMonth() + 1;
  const gd = date.getDate();
  const g_days = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gy - 1600;
  let g_day_no =
    365 * gy2 +
    Math.floor((gy2 + 3) / 4) -
    Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400);
  g_day_no += g_days[gm - 1] + gd - 1;
  if (gm > 2 && ((gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0)) g_day_no++;
  let j_day_no = g_day_no - 79;
  const j_np = Math.floor(j_day_no / 12053);
  j_day_no %= 12053;
  let jy = 979 + 33 * j_np + 4 * Math.floor(j_day_no / 1461);
  j_day_no %= 1461;
  if (j_day_no >= 366) {
    jy += Math.floor((j_day_no - 1) / 365);
    j_day_no = (j_day_no - 1) % 365;
  }
  let jm = 0;
  for (; jm < 11 && j_day_no >= (jm < 6 ? 31 : 30); jm++) {
    j_day_no -= jm < 6 ? 31 : 30;
  }
  return { year: jy, month: jm + 1, day: j_day_no + 1 };
}

export function gregorianFromPersian(year: number, month: number, day: number): Date {
  const jy = year - 979;
  const jm = month - 1;
  const jd = day - 1;
  let j_day_no = 365 * jy + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4);
  for (let i = 0; i < jm; ++i) j_day_no += i < 6 ? 31 : 30;
  j_day_no += jd;
  const g_day_no = j_day_no + 79;
  let gy = 1600 + 400 * Math.floor(g_day_no / 146097);
  let dayNo = g_day_no % 146097;
  let leap = true;
  if (dayNo >= 36525) {
    dayNo--;
    gy += 100 * Math.floor(dayNo / 36524);
    dayNo %= 36524;
    if (dayNo >= 365) dayNo++;
    else leap = false;
  }
  gy += 4 * Math.floor(dayNo / 1461);
  dayNo %= 1461;
  if (dayNo >= 366) {
    leap = false;
    dayNo--;
    gy += Math.floor(dayNo / 365);
    dayNo %= 365;
  }
  const sal_a = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  for (; gm < 13 && dayNo >= sal_a[gm]; gm++) dayNo -= sal_a[gm];
  return new Date(gy, gm - 1, dayNo + 1, 12, 0, 0, 0);
}

/* ---- Hebrew (Hebcal-style absolute day math; invertible) ---- */
function hebrewLeap(year: number): boolean {
  return (1 + year * 7) % 19 < 7;
}

function hebrewMonthsInYear(year: number): number {
  return hebrewLeap(year) ? 13 : 12;
}

/** Elapsed days from Hebrew epoch to before Tishrei 1 of `year` (with postponements). */
function hebrewElapsedDays(year: number): number {
  const monthsElapsed = Math.floor((235 * year - 234) / 19);
  const partsElapsed = 12084 + 13753 * monthsElapsed;
  let day = monthsElapsed * 29 + Math.floor(partsElapsed / 25920);

  // Molad postponement (Gaunt postponement #1)
  if ((3 * (day + 1)) % 7 < 3) day += 1;

  // Year-length postponements
  const last = day;
  const nextMonths = Math.floor((235 * (year + 1) - 234) / 19);
  const nextParts = 12084 + 13753 * nextMonths;
  let next = nextMonths * 29 + Math.floor(nextParts / 25920);
  if ((3 * (next + 1)) % 7 < 3) next += 1;

  const prevMonths = Math.floor((235 * (year - 1) - 234) / 19);
  const prevParts = 12084 + 13753 * prevMonths;
  let prev = prevMonths * 29 + Math.floor(prevParts / 25920);
  if ((3 * (prev + 1)) % 7 < 3) prev += 1;

  if (next - last === 356) return last + 2; // delay 1
  if (last - prev === 382 && last % 7 === 2) return last + 1; // delay 2
  // Also: if molad is Tue at 9h204p+ in common year → Wed (handled by first rule often)
  // Additional classic delay: Mon late molad in leap year
  if (last - prev === 382 && (last + 1) % 7 === 1) return last + 1;
  return last;
}

function hebrewYearLength(year: number): number {
  return hebrewElapsedDays(year + 1) - hebrewElapsedDays(year);
}

function hebrewDaysInMonth(year: number, month: number): number {
  // 29-day fixed months: Iyar, Tammuz, Elul, Tevet, Adar II
  if (month === 2 || month === 4 || month === 6 || month === 10 || month === 13) return 29;
  // Adar (common) = 29; Adar I (leap) = 30
  if (month === 12) return hebrewLeap(year) ? 30 : 29;

  const len = hebrewYearLength(year);
  if (month === 8) {
    // Cheshvan: 29 in deficient years, otherwise 30
    return len === 353 || len === 383 ? 29 : 30;
  }
  if (month === 9) {
    // Kislev: 29 in deficient, 30 otherwise
    return len === 353 || len === 383 ? 29 : 30;
  }
  return 30;
}

function hebrewMonthSeq(year: number): number[] {
  const out: number[] = [];
  for (let m = 7; m <= hebrewMonthsInYear(year); m++) out.push(m);
  for (let m = 1; m <= 6; m++) out.push(m);
  return out;
}

/** JDN of 1 Tishrei AM 1 ≈ 347998 (Julian Day). */
const HEBREW_EPOCH_JDN = 347998;

function hebrewToJdn(year: number, month: number, day: number): number {
  let days = hebrewElapsedDays(year);
  for (const m of hebrewMonthSeq(year)) {
    if (m === month) break;
    days += hebrewDaysInMonth(year, m);
  }
  return HEBREW_EPOCH_JDN + days + (day - 1);
}

export function hebrewFromGregorian(date: Date): CalParts {
  const jdn = gregorianToJdn(date.getFullYear(), date.getMonth() + 1, date.getDate());
  // Estimate year from days since epoch
  let hy = Math.floor((jdn - HEBREW_EPOCH_JDN) / 365.2468222) + 1;
  for (let i = 0; i < 4; i++) {
    const start = HEBREW_EPOCH_JDN + hebrewElapsedDays(hy);
    const next = HEBREW_EPOCH_JDN + hebrewElapsedDays(hy + 1);
    if (jdn < start) hy -= 1;
    else if (jdn >= next) hy += 1;
    else break;
  }
  let rem = jdn - (HEBREW_EPOCH_JDN + hebrewElapsedDays(hy)) + 1;
  for (const m of hebrewMonthSeq(hy)) {
    const dim = hebrewDaysInMonth(hy, m);
    if (rem <= dim) return { year: hy, month: m, day: rem };
    rem -= dim;
  }
  return { year: hy, month: 7, day: 1 };
}

export function gregorianFromHebrew(year: number, month: number, day: number): Date {
  const dim = hebrewDaysInMonth(year, month);
  const d = Math.max(1, Math.min(day, dim));
  // Guard invalid month numbers (e.g. 13 in a common year)
  const seq = hebrewMonthSeq(year);
  const m = seq.includes(month) ? month : seq[0];
  return jdnToGregorian(hebrewToJdn(year, m, d));
}

/* ---- Chinese (invertible mean lunar months from 1900-01-31 CNY approx) ---- */
const CHINESE_EPOCH_JDN = gregorianToJdn(1900, 1, 31);
const SYNODIC = 29.530588853;

function chineseMonthStartJdn(monthsSince: number): number {
  return CHINESE_EPOCH_JDN + Math.floor(monthsSince * SYNODIC);
}

function chineseDaysInMonthIndex(monthsSince: number): number {
  return chineseMonthStartJdn(monthsSince + 1) - chineseMonthStartJdn(monthsSince);
}

export function chineseFromGregorian(date: Date): CalParts {
  const jdn = gregorianToJdn(date.getFullYear(), date.getMonth() + 1, date.getDate());
  let monthsSince = Math.floor((jdn - CHINESE_EPOCH_JDN) / SYNODIC);
  if (monthsSince < 0) monthsSince = 0;
  // Keep monthsSince such that monthStart <= jdn < nextStart
  while (jdn < chineseMonthStartJdn(monthsSince) && monthsSince > 0) monthsSince -= 1;
  while (jdn >= chineseMonthStartJdn(monthsSince + 1)) monthsSince += 1;
  const year = 1900 + Math.floor(monthsSince / 12);
  const month = (monthsSince % 12) + 1;
  const day = jdn - chineseMonthStartJdn(monthsSince) + 1;
  return { year, month, day };
}

export function gregorianFromChinese(year: number, month: number, day: number): Date {
  const y = Math.max(1900, year);
  const m = Math.min(12, Math.max(1, month));
  const monthsSince = (y - 1900) * 12 + (m - 1);
  const dim = chineseDaysInMonthIndex(monthsSince);
  const d = Math.min(dim, Math.max(1, day));
  const jdn = chineseMonthStartJdn(monthsSince) + (d - 1);
  return jdnToGregorian(jdn);
}

export function getCalendarParts(
  date: Date,
  calendarId?: CalendarId | null,
  _locale?: string,
): CalParts {
  const civil = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
  const cal = intlCalendarOf(calendarId);
  switch (cal) {
    case 'ethiopic':
      return ethiopicFromGregorian(civil);
    case 'islamic':
      return islamicFromGregorian(civil);
    case 'persian':
      return persianFromGregorian(civil);
    case 'hebrew':
      return hebrewFromGregorian(civil);
    case 'chinese':
      return chineseFromGregorian(civil);
    default:
      return { year: civil.getFullYear(), month: civil.getMonth() + 1, day: civil.getDate() };
  }
}

export function dateFromCalendarParts(
  calendarId: CalendarId | null | undefined,
  year: number,
  month: number,
  day: number,
  _locale?: string,
): Date | null {
  const cal = intlCalendarOf(calendarId);
  try {
    let d: Date;
    switch (cal) {
      case 'ethiopic':
        d = gregorianFromEthiopic(year, month, day);
        break;
      case 'islamic':
        d = gregorianFromIslamic(year, month, day);
        break;
      case 'persian':
        d = gregorianFromPersian(year, month, day);
        break;
      case 'hebrew':
        d = gregorianFromHebrew(year, month, day);
        break;
      case 'chinese':
        d = gregorianFromChinese(year, month, day);
        break;
      default:
        d = new Date(year, month - 1, day, 12, 0, 0, 0);
    }
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

export function monthLabelsForYear(
  calendarId: CalendarId | null | undefined,
  year: number,
  _locale?: string,
): { month: number; label: string }[] {
  const cal = intlCalendarOf(calendarId);
  if (cal === 'ethiopic') return ETHIOPIC_MONTHS.map((label, i) => ({ month: i + 1, label }));
  if (cal === 'islamic') return ISLAMIC_MONTHS.map((label, i) => ({ month: i + 1, label }));
  if (cal === 'hebrew') {
    // Show in civil order starting Tishrei, with correct month numbers for conversion.
    return hebrewMonthSeq(year).map((month) => ({
      month,
      label: month === 12 && hebrewLeap(year) ? 'Adar I' : HEBREW_MONTH_NAME[month] || String(month),
    }));
  }
  if (cal === 'persian') return PERSIAN_MONTHS.map((label, i) => ({ month: i + 1, label }));
  if (cal === 'chinese') return CHINESE_MONTHS.map((label, i) => ({ month: i + 1, label }));
  return GREGORIAN_MONTHS.map((label, i) => ({ month: i + 1, label }));
}

export function daysInCalendarMonth(
  calendarId: CalendarId | null | undefined,
  year: number,
  month: number,
  _locale?: string,
): number {
  const cal = intlCalendarOf(calendarId);
  if (cal === 'ethiopic') return month === 13 ? (year % 4 === 3 ? 6 : 5) : 30;
  if (cal === 'islamic') {
    if (month % 2 === 1) return 30;
    if (month === 12) return (11 * year + 14) % 30 < 11 ? 30 : 29;
    return 29;
  }
  if (cal === 'persian') {
    if (month <= 6) return 31;
    if (month <= 11) return 30;
    return persianLeap(year) ? 30 : 29;
  }
  if (cal === 'hebrew') return hebrewDaysInMonth(year, month);
  if (cal === 'chinese') {
    const monthsSince = (Math.max(1900, year) - 1900) * 12 + (Math.min(12, Math.max(1, month)) - 1);
    return chineseDaysInMonthIndex(monthsSince);
  }
  return new Date(year, month, 0).getDate();
}

function maxMonth(calendarId: CalendarId | null | undefined, year: number): number {
  const cal = intlCalendarOf(calendarId);
  if (cal === 'ethiopic') return 13;
  if (cal === 'hebrew') return hebrewMonthsInYear(year);
  return 12;
}

export function addCalendarMonths(
  date: Date,
  calendarId: CalendarId | null | undefined,
  delta: number,
): Date {
  const cal = intlCalendarOf(calendarId);
  const p = getCalendarParts(date, calendarId);
  if (cal === 'hebrew') {
    const seq = hebrewMonthSeq(p.year);
    let idx = Math.max(0, seq.indexOf(p.month));
    let y = p.year;
    idx += delta;
    while (idx >= hebrewMonthSeq(y).length) {
      idx -= hebrewMonthSeq(y).length;
      y += 1;
    }
    while (idx < 0) {
      y -= 1;
      idx += hebrewMonthSeq(y).length;
    }
    const month = hebrewMonthSeq(y)[idx];
    const dim = daysInCalendarMonth(calendarId, y, month);
    return dateFromCalendarParts(calendarId, y, month, Math.min(p.day, dim)) ?? date;
  }
  let y = p.year;
  let m = p.month + delta;
  while (m > maxMonth(calendarId, y)) {
    m -= maxMonth(calendarId, y);
    y += 1;
  }
  while (m < 1) {
    y -= 1;
    m += maxMonth(calendarId, y);
  }
  const dim = daysInCalendarMonth(calendarId, y, m);
  return dateFromCalendarParts(calendarId, y, m, Math.min(p.day, dim)) ?? date;
}

export function yearOptions(calendarId: CalendarId | null | undefined, around: number, span = 20): number[] {
  const cal = intlCalendarOf(calendarId);
  // Keep the picker centered on a sensible year for each system.
  let center = around;
  if (!Number.isFinite(center) || center === 0) {
    const now = getCalendarParts(new Date(), calendarId);
    center = now.year;
  }
  if (cal === 'hebrew' && center < 5000) center = getCalendarParts(new Date(), 'hebrew').year;
  if (cal === 'islamic' && center < 1000) center = getCalendarParts(new Date(), 'islamic').year;
  if (cal === 'persian' && center < 1000) center = getCalendarParts(new Date(), 'persian').year;
  if (cal === 'ethiopic' && center > 2100) center = getCalendarParts(new Date(), 'ethiopic').year;
  const start = center - Math.floor(span / 2);
  return Array.from({ length: span + 1 }, (_, i) => start + i);
}

export function toIsoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parseIsoLocal(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatCalendarPartsLabel(calendarId: CalendarId | null | undefined, p: CalParts): string {
  const months = monthLabelsForYear(calendarId, p.year);
  const name = months.find((m) => m.month === p.month)?.label || String(p.month);
  return `${p.day} ${name} ${p.year}`;
}

export function formatCalendarMonthLabel(calendarId: CalendarId | null | undefined, year: number, month: number): string {
  const months = monthLabelsForYear(calendarId, year);
  const name = months.find((m) => m.month === month)?.label || String(month);
  return `${name} ${year}`;
}
