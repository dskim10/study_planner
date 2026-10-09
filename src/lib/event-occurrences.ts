import type { ScheduleEvent } from '../types';
import { occursOn } from './recurrence';

export interface EventOccurrence {
  eventId: string;
  date: string;
}

function findOccurrence(events: ScheduleEvent[], id: string, date: string): ScheduleEvent {
  const event = events.find((item) => item.id === id);
  if (!event || event.recurrence === 'none' || !occursOn(event, date)) {
    throw new Error('선택한 반복 일정을 찾을 수 없어요. 캘린더에서 다시 선택해 주세요.');
  }
  return event;
}

function excludeOccurrence(event: ScheduleEvent, date: string): ScheduleEvent {
  return { ...event, excludedDates: [...new Set([...(event.excludedDates ?? []), date])].sort() };
}

function standaloneEvent(event: ScheduleEvent): ScheduleEvent {
  const result: ScheduleEvent = { ...event, recurrence: 'none', weekdays: [] };
  delete result.repeatUntil;
  delete result.customRecurrence;
  delete result.excludedDates;
  return result;
}

/** Selected edits omit the original date and create an independent, one-time event. */
export function saveEvent(events: ScheduleEvent[], event: ScheduleEvent, occurrence?: EventOccurrence): ScheduleEvent[] {
  if (occurrence) {
    if (event.id !== occurrence.eventId) throw new Error('수정할 반복 일정이 일치하지 않아요. 다시 선택해 주세요.');
    const original = findOccurrence(events, occurrence.eventId, occurrence.date);
    const replacement = standaloneEvent(event);
    do { replacement.id = crypto.randomUUID(); } while (events.some((item) => item.id === replacement.id));
    return [
      ...events.map((item) => item.id === original.id ? excludeOccurrence(original, occurrence.date) : item),
      replacement,
    ];
  }

  const original = events.find((item) => item.id === event.id);
  let saved: ScheduleEvent;
  if (event.recurrence === 'none') {
    saved = standaloneEvent(event);
  } else {
    saved = { ...event };
    // A form may omit this internal field. Preserve prior omissions when editing the series.
    const exclusions = [...new Set([...(original?.excludedDates ?? []), ...(event.excludedDates ?? [])])]
      .filter((date) => date >= event.date).sort();
    if (exclusions.length) saved.excludedDates = exclusions;
    else delete saved.excludedDates;
  }
  return original ? events.map((item) => item.id === event.id ? saved : item) : [...events, saved];
}

/** A supplied date deletes only that occurrence; omitting it removes the full event. */
export function deleteEvent(events: ScheduleEvent[], id: string, occurrenceDate?: string): ScheduleEvent[] {
  if (occurrenceDate === undefined) return events.filter((event) => event.id !== id);
  const original = findOccurrence(events, id, occurrenceDate);
  return events.map((event) => event.id === id ? excludeOccurrence(original, occurrenceDate) : event);
}
