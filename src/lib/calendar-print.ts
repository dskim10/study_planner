import type { CalendarPrintRange, DaySummary, EventCategory, ScheduleEvent } from '../types';
import { DEFAULT_CALENDAR_PRINT_RANGE, isCalendarPrintRange } from './calendar-print-range';
import { timeToMinutes } from './planner';

export interface PrintCalendarEvent {
  event: ScheduleEvent;
  category: EventCategory;
}

export interface PrintTimedEvent extends PrintCalendarEvent {
  /** Actual times remain separate from the minimum printable block size. */
  startMinute: number;
  endMinute: number;
  topMinute: number;
  heightMinutes: number;
  /** Zero-based column and shared column count within a collision group. */
  column: number;
  columnCount: number;
}

export interface PrintDay {
  date: string;
  allDay: PrintCalendarEvent[];
  timed: PrintTimedEvent[];
}

const MIN_VISUAL_MINUTES = 30;

function positionGroup(group: PrintTimedEvent[]): void {
  const columnEnds: number[] = [];
  for (const item of group) {
    const reusable = columnEnds.findIndex(end => end <= item.topMinute);
    item.column = reusable < 0 ? columnEnds.length : reusable;
    columnEnds[item.column] = item.topMinute + item.heightMinutes;
  }
  for (const item of group) item.columnCount = columnEnds.length;
}

/**
 * Use the supplied expanded day occurrences without changing schedules or totals.
 * Collision columns use clipped printable intervals with up to 30-minute minimum blocks.
 * A short event near the range end moves upward; its actual times stay intact.
 * Unknown categories retain their schedules with a defensive label/color fallback.
 */
export function buildPrintableWeek(days: DaySummary[], categories: EventCategory[], hiddenIds: string[], range: CalendarPrintRange = DEFAULT_CALENDAR_PRINT_RANGE): PrintDay[] {
  if (!isCalendarPrintRange(range)) throw new RangeError('인쇄 종료 시간은 시작 시간보다 늦은 24:00 이내의 시간이어야 해요.');
  const minimumHeight = Math.min(MIN_VISUAL_MINUTES, range.endMinute - range.startMinute);
  const categoriesById = new Map(categories.map(category => [category.id, category]));
  const hidden = new Set(hiddenIds);
  return days.map(day => {
    const allDay: PrintCalendarEvent[] = [];
    const timed: PrintTimedEvent[] = [];
    for (const event of day.events) {
      if (hidden.has(event.type)) continue;
      const category = categoriesById.get(event.type) ?? { id: event.type, label: '기타 일정', color: '#8a8798' };
      if (event.allDay) {
        allDay.push({ event, category });
        continue;
      }
      const startMinute = timeToMinutes(event.startTime);
      const endMinute = timeToMinutes(event.endTime);
      if (endMinute <= startMinute) throw new RangeError('인쇄할 일정의 종료 시간은 시작 시간보다 늦어야 해요.');
      if (endMinute <= range.startMinute || startMinute >= range.endMinute) continue;
      const clippedStart = Math.max(startMinute, range.startMinute);
      const clippedEnd = Math.min(endMinute, range.endMinute);
      const heightMinutes = Math.max(minimumHeight, clippedEnd - clippedStart);
      const topMinute = Math.min(clippedStart, range.endMinute - heightMinutes);
      timed.push({ event, category, startMinute, endMinute, topMinute, heightMinutes, column: 0, columnCount: 1 });
    }
    timed.sort((a, b) => a.topMinute - b.topMinute || a.startMinute - b.startMinute || b.endMinute - a.endMinute || (a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0));
    let group: PrintTimedEvent[] = [];
    let groupEnd = 0;
    for (const item of timed) {
      if (group.length && item.topMinute >= groupEnd) {
        positionGroup(group);
        group = [];
      }
      group.push(item);
      groupEnd = Math.max(group.length === 1 ? 0 : groupEnd, item.topMinute + item.heightMinutes);
    }
    if (group.length) positionGroup(group);
    return { date: day.date, allDay, timed };
  });
}
