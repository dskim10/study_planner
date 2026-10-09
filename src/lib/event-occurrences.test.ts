import { describe, expect, it } from 'vitest';
import type { ScheduleEvent } from '../types';
import { deleteEvent, saveEvent } from './event-occurrences';
import { getStudyPlanSummary, getWeekSummary } from './planner';
import { createCustomRecurrence, occursOn } from './recurrence';

const series = (overrides: Partial<ScheduleEvent> = {}): ScheduleEvent => ({
  id: 'series', title: '수학 학습', type: 'math', date: '2026-10-05', startTime: '18:00', endTime: '19:00',
  allDay: false, recurrence: 'weekly', weekdays: [1, 3, 5], repeatUntil: '2026-11-30', ...overrides,
});

describe('individual recurring event changes', () => {
  it('deletes the first and later occurrences without changing the series rule or other events', () => {
    const original = series({ recurrence: 'custom', customRecurrence: {
      ...createCustomRecurrence('2026-10-05'), weekdays: [1, 3, 5], end: { type: 'count', count: 4 },
    } });
    const other = series({ id: 'other' });
    const input = [original, other];
    const snapshot = structuredClone(input);
    const deleted = deleteEvent(deleteEvent(input, original.id, '2026-10-05'), original.id, '2026-10-09');
    expect(deleted).toEqual([{ ...original, excludedDates: ['2026-10-05', '2026-10-09'] }, other]);
    expect(deleted[1]).toBe(other);
    expect(input).toEqual(snapshot);
    expect(occursOn(deleted[0], '2026-10-05')).toBe(false);
    expect(occursOn(deleted[0], '2026-10-07')).toBe(true);
    expect(occursOn(deleted[0], '2026-10-12')).toBe(true);
    expect(occursOn(deleted[0], '2026-10-14')).toBe(false);
  });

  it('splits a moved and resized occurrence into a standalone while retaining the original anchor', () => {
    const original = series({ excludedDates: ['2026-10-09'] });
    const other = series({ id: 'other' });
    const draft = { ...original, title: '보충 학습', date: '2026-10-08', startTime: '20:00', endTime: '22:00',
      customRecurrence: createCustomRecurrence('2026-10-08') };
    const input = [original, other];
    const snapshot = structuredClone(input);
    const saved = saveEvent(input, draft, { eventId: original.id, date: '2026-10-07' });
    expect(saved).toHaveLength(3);
    expect(saved[0]).toEqual({ ...original, excludedDates: ['2026-10-07', '2026-10-09'] });
    expect(saved[1]).toBe(other);
    expect(saved[2]).toEqual({
      id: expect.any(String), title: '보충 학습', type: 'math', date: '2026-10-08',
      startTime: '20:00', endTime: '22:00', allDay: false, recurrence: 'none', weekdays: [],
    });
    expect(saved[2].id).not.toBe(original.id);
    expect(occursOn(saved[0], '2026-10-07')).toBe(false);
    expect(occursOn(saved[0], '2026-10-12')).toBe(true);
    expect(occursOn(saved[2], '2026-10-08')).toBe(true);
    expect(occursOn(saved[2], '2026-10-15')).toBe(false);
    expect(input).toEqual(snapshot);
    expect(draft.customRecurrence).toBeDefined();
    expect(draft.excludedDates).toEqual(['2026-10-09']);
  });

  it('keeps the split occurrence independent of subsequent series updates or deletion', () => {
    const original = series();
    const saved = saveEvent([original], { ...original, date: '2026-10-07', title: '개별 일정' }, { eventId: original.id, date: '2026-10-07' });
    const changed = saveEvent(saved, { ...original, title: '전체 이름 변경' });
    expect(changed[0].excludedDates).toEqual(['2026-10-07']);
    expect(changed[1]).toEqual(saved[1]);
    expect(deleteEvent(changed, original.id)).toEqual([saved[1]]);
    expect(deleteEvent(saved, saved[1].id)).toEqual([saved[0]]);
  });

  it('rejects stale, non-recurring, mismatched or non-occurring selections without changing inputs', () => {
    const original = series({ excludedDates: ['2026-10-07'] });
    const input = [original];
    const snapshot = structuredClone(input);
    for (const date of ['2026-10-07', '2026-10-06', '2026-10-04', '2026-12-02', 'invalid']) {
      expect(() => deleteEvent(input, original.id, date)).toThrow();
      expect(() => saveEvent(input, original, { eventId: original.id, date })).toThrow();
    }
    expect(() => deleteEvent(input, 'missing', '2026-10-05')).toThrow();
    expect(() => saveEvent(input, { ...original, id: 'wrong' }, { eventId: original.id, date: '2026-10-05' })).toThrow();
    expect(() => saveEvent([], original, { eventId: original.id, date: '2026-10-05' })).toThrow();
    expect(() => deleteEvent([series({ recurrence: 'none' })], original.id, '2026-10-05')).toThrow();
    expect(input).toEqual(snapshot);
  });

  it('preserves and deduplicates series exclusions, discarding only dates before a changed anchor', () => {
    const original = series({ excludedDates: ['2026-10-07', '2026-10-09'] });
    const saved = saveEvent([original], { ...original, date: '2026-10-08', excludedDates: ['2026-10-09', '2026-10-12'] });
    expect(saved[0].excludedDates).toEqual(['2026-10-09', '2026-10-12']);
    expect(original.excludedDates).toEqual(['2026-10-07', '2026-10-09']);
  });

  it('clears recurrence-only fields when the entire series is changed into a single event', () => {
    const original = series({ excludedDates: ['2026-10-07'], customRecurrence: createCustomRecurrence('2026-10-05') });
    const saved = saveEvent([original], { ...original, recurrence: 'none' });
    expect(saved[0]).toEqual({
      id: original.id, title: original.title, type: original.type, date: original.date,
      startTime: original.startTime, endTime: original.endTime, allDay: false, recurrence: 'none', weekdays: [],
    });
    expect(occursOn(saved[0], '2026-10-05')).toBe(true);
    expect(occursOn(saved[0], '2026-10-07')).toBe(false);
  });

  it('supports ordinary event creation, editing and deletion', () => {
    const single = series({ recurrence: 'none', weekdays: [], repeatUntil: undefined });
    const added = saveEvent([], single);
    expect(added).toHaveLength(1);
    const edited = saveEvent(added, { ...added[0], title: '새 제목' });
    expect(edited[0].title).toBe('새 제목');
    expect(deleteEvent(edited, single.id)).toEqual([]);
  });
});

describe('occurrence changes in available and planned study time', () => {
  const categories = [{ id: 'math', label: '수학', color: '#123456' }];

  it('recalculates only affected dates while retaining interval union behavior', () => {
    const original = series();
    const overlap = series({ id: 'overlap', date: '2026-10-08', recurrence: 'none', weekdays: [], startTime: '20:30', endTime: '21:30' });
    const deleted = deleteEvent([original, overlap], original.id, '2026-10-05');
    const saved = saveEvent(deleted, { ...original, date: '2026-10-08', startTime: '20:00', endTime: '22:00' },
      { eventId: original.id, date: '2026-10-07' });
    const days = getWeekSummary('2026-10-05', saved);
    expect(days.map((day) => day.busyMinutes)).toEqual([0, 0, 0, 120, 60, 0, 0]);
    expect(days.reduce((total, day) => total + day.availableMinutes, 0)).toBe(10080 - 180);
    const planned = getStudyPlanSummary(days, categories, ['수학']);
    expect(planned.plannedMinutes).toBe(180);
    expect(planned.subjects).toEqual([{ subject: '수학', plannedMinutes: 180 }]);
  });

  it('omits an all-day occurrence from both summaries and allows a timed replacement', () => {
    const original = series({ allDay: true, recurrence: 'daily', repeatUntil: '2026-10-06' });
    const deleted = deleteEvent([original], original.id, '2026-10-05');
    expect(getWeekSummary('2026-10-05', deleted)[0].availableMinutes).toBe(1440);
    const saved = saveEvent([original], { ...original, allDay: false, startTime: '23:45', endTime: '24:00' },
      { eventId: original.id, date: '2026-10-05' });
    const days = getWeekSummary('2026-10-05', saved);
    expect(days[0].availableMinutes).toBe(1425);
    expect(days[1].availableMinutes).toBe(0);
    expect(getStudyPlanSummary(days, categories, ['수학']).plannedMinutes).toBe(1455);
  });
});
