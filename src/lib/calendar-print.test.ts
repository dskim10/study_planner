import { describe, expect, it } from 'vitest';
import type { DaySummary, EventCategory, ScheduleEvent } from '../types';
import { buildPrintableWeek } from './calendar-print';
import { getWeekSummary } from './planner';

const monday = '2026-10-05';
const categories: EventCategory[] = [
  { id: 'math', label: '수학', color: '#1e88e5' },
  { id: 'school', label: '학교 수업', color: '#8e24aa' },
];
function event(id: string, startTime: string, endTime: string, overrides: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return { id, title: `일정 ${id}`, type: 'math', date: monday, startTime, endTime, allDay: false, recurrence: 'none', weekdays: [], ...overrides };
}
function day(events: ScheduleEvent[], date = monday): DaySummary {
  return { date, events, availableMinutes: 1440, busyMinutes: 0, freeSlots: [{ start: 0, end: 1440 }] };
}
const placed = (events: ScheduleEvent[]) => buildPrintableWeek([day(events)], categories, [])[0].timed;

describe('printable weekly calendar', () => {
  it('keeps all seven blank days and also accepts an empty input', () => {
    const days = getWeekSummary(monday, []);
    expect(buildPrintableWeek(days, categories, [])).toEqual(days.map(item => ({ date: item.date, allDay: [], timed: [] })));
    expect(buildPrintableWeek([], categories, [])).toEqual([]);
  });

  it('filters hidden timed and all-day schedules without changing source data or day totals', () => {
    const days = getWeekSummary(monday, [
      event('visible', '09:00', '10:00'),
      event('hidden', '10:00', '11:00', { type: 'school' }),
      event('visible-all-day', '00:00', '24:00', { allDay: true }),
      event('hidden-all-day', '00:00', '24:00', { type: 'school', allDay: true }),
    ]);
    const hiddenIds = ['school'];
    const original = structuredClone({ days, categories, hiddenIds });
    const printed = buildPrintableWeek(days, categories, hiddenIds);
    expect(printed[0].timed.map(item => item.event.id)).toEqual(['visible']);
    expect(printed[0].allDay.map(item => item.event.id)).toEqual(['visible-all-day']);
    expect(printed[0].timed[0].category).toEqual(categories[0]);
    expect(printed[0].allDay[0].category).toEqual(categories[0]);
    expect({ days, categories, hiddenIds }).toEqual(original);
    expect(days[0].availableMinutes).toBe(0);
    expect(buildPrintableWeek(days, categories, categories.map(item => item.id)).every(item => !item.allDay.length && !item.timed.length)).toBe(true);
  });

  it('uses already-expanded recurring occurrences on the supplied dates without reapplying recurrence', () => {
    const recurring = event('weekly', '18:00', '19:00', { date: '2026-09-28', recurrence: 'weekly', weekdays: [1, 3] });
    const allDay = event('daily', '00:00', '24:00', { date: '2026-10-06', allDay: true, recurrence: 'daily', repeatUntil: '2026-10-08' });
    const days = getWeekSummary(monday, [recurring, allDay]);
    const printed = buildPrintableWeek(days, categories, []);
    expect(printed.filter(item => item.timed.length).map(item => item.date)).toEqual(['2026-10-05', '2026-10-07']);
    expect(printed.filter(item => item.allDay.length).map(item => item.date)).toEqual(['2026-10-06', '2026-10-07', '2026-10-08']);
    expect(printed[2].timed[0].event).toEqual(recurring);
    expect(printed[2].timed[0].columnCount).toBe(1);
  });

  it('preserves unknown legacy categories with a fallback unless that ID is hidden', () => {
    const unknown = event('unknown', '09:00', '10:00', { type: 'legacy' });
    expect(placed([unknown])[0]).toMatchObject({ event: unknown, category: { id: 'legacy', label: '기타 일정', color: '#8a8798' } });
    expect(buildPrintableWeek([day([unknown])], categories, ['legacy'])[0].timed).toEqual([]);
  });

  it('shares column width across a connected collision group and reuses a free column', () => {
    const items = placed([
      event('a', '09:00', '10:00'), event('b', '09:30', '10:30'),
      event('c', '10:15', '11:00'), event('d', '11:00', '12:00'),
    ]);
    expect(items.map(item => [item.event.id, item.column, item.columnCount])).toEqual([
      ['a', 0, 2], ['b', 1, 2], ['c', 0, 2], ['d', 0, 1],
    ]);
  });

  it('handles nested overlaps with enough columns and resets columns independently for each day', () => {
    const events = [
      event('long', '09:00', '12:00'), event('nested', '09:15', '09:45'),
      event('third', '09:30', '10:00'), event('later', '10:05', '10:35'),
    ];
    const printed = buildPrintableWeek([day(events), day([event('next', '09:00', '10:00')], '2026-10-06')], categories, []);
    expect(printed[0].timed.map(item => [item.event.id, item.column, item.columnCount])).toEqual([
      ['long', 0, 3], ['nested', 1, 3], ['third', 2, 3], ['later', 1, 3],
    ]);
    expect(printed[1].timed[0]).toMatchObject({ column: 0, columnCount: 1 });
  });

  it('lets visually adjacent blocks share a column', () => {
    const items = placed([event('first', '09:00', '09:30'), event('second', '09:30', '10:00')]);
    expect(items.map(item => [item.column, item.columnCount])).toEqual([[0, 1], [0, 1]]);
  });

  it('uses minimum visual block heights for collisions while retaining actual short-event times', () => {
    const items = placed([
      event('first', '09:00', '09:05'), event('second', '09:15', '09:20'), event('third', '09:30', '09:35'),
    ]);
    expect(items.map(item => [item.startMinute, item.endMinute, item.topMinute, item.heightMinutes, item.column, item.columnCount])).toEqual([
      [540, 545, 540, 30, 0, 2], [555, 560, 555, 30, 1, 2], [570, 575, 570, 30, 0, 2],
    ]);
    expect(items[0].event.endTime).toBe('09:05');
  });

  it('keeps midnight and 24:00 edge blocks within the day and accounts for an upward-shifted late block', () => {
    const items = placed([
      event('midnight', '00:00', '00:01'), event('late', '23:20', '23:40'), event('last-minute', '23:59', '24:00'),
    ]);
    expect(items[0]).toMatchObject({ startMinute: 0, endMinute: 1, topMinute: 0, heightMinutes: 30, columnCount: 1 });
    expect(items[1]).toMatchObject({ startMinute: 1400, endMinute: 1420, topMinute: 1400, heightMinutes: 30, column: 0, columnCount: 2 });
    expect(items[2]).toMatchObject({ startMinute: 1439, endMinute: 1440, topMinute: 1410, heightMinutes: 30, column: 1, columnCount: 2 });
    expect(items.every(item => item.topMinute >= 0 && item.topMinute + item.heightMinutes <= 1440)).toBe(true);
  });

  it('preserves a full 24-hour timed event separately from an all-day event', () => {
    const printed = buildPrintableWeek([day([
      event('full-day-timed', '00:00', '24:00'), event('inside', '12:00', '13:00'),
      event('all-day', '00:00', '24:00', { allDay: true }),
    ])], categories, [])[0];
    expect(printed.timed[0]).toMatchObject({ startMinute: 0, endMinute: 1440, topMinute: 0, heightMinutes: 1440, column: 0, columnCount: 2 });
    expect(printed.timed[1].column).toBe(1);
    expect(printed.allDay.map(item => item.event.id)).toEqual(['all-day']);
  });

  it('sorts ties deterministically by ID and gives each overlapping block its own column', () => {
    const events = ['c', 'a', 'b'].map(id => event(id, '09:00', '10:00'));
    const forward = placed(events);
    expect(forward.map(item => [item.event.id, item.column, item.columnCount])).toEqual([['a', 0, 3], ['b', 1, 3], ['c', 2, 3]]);
    expect(placed([...events].reverse())).toEqual(forward);
  });

  it('rejects invalid timed ranges rather than silently omitting a schedule', () => {
    expect(() => placed([event('backward', '10:00', '09:00')])).toThrow(RangeError);
    expect(() => placed([event('zero', '24:00', '24:00')])).toThrow(RangeError);
    expect(() => placed([event('invalid', '25:00', '26:00')])).toThrow();
  });
});
