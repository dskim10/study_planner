import type { CalendarPrintRange } from '../types';

export const DEFAULT_CALENDAR_PRINT_RANGE: CalendarPrintRange = { startMinute: 0, endMinute: 1440 };

export function isCalendarPrintRange(value: unknown): value is CalendarPrintRange {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const range = value as Record<string, unknown>;
  const keys = Object.keys(range);
  return keys.length === 2 && keys.includes('startMinute') && keys.includes('endMinute')
    && typeof range.startMinute === 'number' && Number.isInteger(range.startMinute)
    && typeof range.endMinute === 'number' && Number.isInteger(range.endMinute)
    && range.startMinute >= 0 && range.endMinute <= 1440
    && range.startMinute < range.endMinute;
}

/** Keep both range boundaries labeled without crowding nearby full-hour labels. */
export function getCalendarPrintTicks(range: CalendarPrintRange = DEFAULT_CALENDAR_PRINT_RANGE): number[] {
  if (!isCalendarPrintRange(range)) throw new RangeError('인쇄 종료 시간은 시작 시간보다 늦은 24:00 이내의 시간이어야 해요.');
  const ticks = [range.startMinute];
  for (let minute = Math.ceil(range.startMinute / 60) * 60; minute < range.endMinute; minute += 60) {
    if (minute - range.startMinute >= 30 && range.endMinute - minute >= 30) ticks.push(minute);
  }
  ticks.push(range.endMinute);
  return ticks;
}
