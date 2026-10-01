import { toJalaali, toGregorian } from "jalaali-js";

export function gregorianToJalali(date: Date): { year: number; month: number; day: number } {
  const j = toJalaali(date.getFullYear(), date.getMonth() + 1, date.getDate());
  return { year: j.jy, month: j.jm, day: j.jd };
}

export function formatJalali(date: Date): string {
  const j = gregorianToJalali(date);
  return `${j.year}/${String(j.month).padStart(2, "0")}/${String(j.day).padStart(2, "0")}`;
}

/**
 * Jalali label for a stored calendar date. Uses the UTC components, because
 * `expenseDate` holds a calendar date (UTC midnight) rather than an instant.
 */
export function formatJalaliUtc(date: Date): string {
  const j = toJalaali(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  return `${j.jy}/${String(j.jm).padStart(2, "0")}/${String(j.jd).padStart(2, "0")}`;
}

export type DateRange = { from: Date; to: Date };

/**
 * `expenseDate` is a calendar date: the API stores what the client sends
 * (a date-only string becomes UTC midnight). Every range helper below therefore
 * builds UTC-midnight boundaries, so filtering by day/week/month is stable no
 * matter which timezone the server runs in.
 */
function startOfUtcDay(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function endOfUtcDay(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
}

/** The calendar day of `ref` in the server's local timezone. */
export function getDayRange(ref: Date = new Date()): DateRange {
  const y = ref.getFullYear();
  const m = ref.getMonth() + 1;
  const d = ref.getDate();
  return { from: startOfUtcDay(y, m, d), to: endOfUtcDay(y, m, d) };
}

/**
 * Iranian week: Saturday through Friday.
 * `Date#getDay()` is 0=Sunday..6=Saturday, so the distance back to the most
 * recent Saturday is `(day + 1) % 7`.
 */
export function getIranWeekRange(ref: Date = new Date()): DateRange {
  const back = (ref.getDay() + 1) % 7;
  const saturday = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - back);

  const sy = saturday.getFullYear();
  const sm = saturday.getMonth() + 1;
  const sd = saturday.getDate();

  return { from: startOfUtcDay(sy, sm, sd), to: endOfUtcDay(sy, sm, sd + 6) };
}

/** The current Jalali month, from its 1st day up to (but excluding) the next. */
export function getJalaliMonthRange(ref: Date = new Date()): DateRange {
  const { year, month } = gregorianToJalali(ref);

  const start = toGregorian(year, month, 1);
  const nextStart =
    month === 12 ? toGregorian(year + 1, 1, 1) : toGregorian(year, month + 1, 1);

  return {
    from: startOfUtcDay(start.gy, start.gm, start.gd),
    // Day 0 of the next month is the last day of this one; Date.UTC rolls over.
    to: endOfUtcDay(nextStart.gy, nextStart.gm, nextStart.gd - 1),
  };
}

/** Caps a period at the end of the current day, so ranges read "so far". */
export function clampToToday(range: DateRange, ref: Date = new Date()): DateRange {
  const endOfToday = getDayRange(ref).to;
  return range.to > endOfToday ? { from: range.from, to: endOfToday } : range;
}
