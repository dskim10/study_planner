import { CALENDAR_STEP_MINUTES } from './calendar-selection';

const DAY_MINUTES = 1440;

export interface EventMoveTarget {
  date: string;
  startTime: string;
  endTime: string;
}

/** Move an event to the nearest quarter hour without changing its duration or crossing midnight. */
export function getEventMoveRange(start: number, end: number, requestedStart: number): { start: number; end: number } {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= end || end > DAY_MINUTES || !Number.isFinite(requestedStart)) {
    throw new RangeError('Event movement requires a valid same-day minute range and a finite destination.');
  }

  const duration = end - start;
  const lastStart = Math.floor((DAY_MINUTES - duration) / CALENDAR_STEP_MINUTES) * CALENDAR_STEP_MINUTES;
  const snappedStart = Math.round(requestedStart / CALENDAR_STEP_MINUTES) * CALENDAR_STEP_MINUTES;
  const nextStart = Math.max(0, Math.min(lastStart, snappedStart));
  return { start: nextStart, end: nextStart + duration };
}

/** Resize only the end, keeping a quarter-hour minimum unless midnight leaves less room. */
export function getEventResizeRange(start: number, end: number, requestedEnd: number): { start: number; end: number } {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= end || end > DAY_MINUTES || !Number.isFinite(requestedEnd)) {
    throw new RangeError('Event resizing requires a valid same-day minute range and a finite destination.');
  }

  const minimumEnd = Math.min(DAY_MINUTES, Math.ceil((start + CALENDAR_STEP_MINUTES) / CALENDAR_STEP_MINUTES) * CALENDAR_STEP_MINUTES);
  const snappedEnd = Math.round(requestedEnd / CALENDAR_STEP_MINUTES) * CALENDAR_STEP_MINUTES;
  return { start, end: Math.max(minimumEnd, Math.min(DAY_MINUTES, snappedEnd)) };
}
