import { describe, expect, it } from 'vitest';
import type { ScheduleEvent, StudyGoal } from '../types';
import { DEFAULT_EVENT_CATEGORIES, DEFAULT_SUBJECTS } from '../types';
import {
  addDays, createDemoState, createEmptyState, formatDuration, getDaySummary,
  getGoalSummary, getStudyPlanSummary, getWeekDays, getWeekSummary, minutesToTime, occursOn, parseDate, startOfWeek,
  timeToMinutes, toDateKey,
} from './planner';

const monday = '2026-10-05';
const event = (overrides: Partial<ScheduleEvent> = {}): ScheduleEvent => ({
  id: 'event', title: '수업', type: 'school', date: monday, startTime: '09:00', endTime: '10:00',
  allDay: false, recurrence: 'none', weekdays: [], ...overrides,
});
const goal = (overrides: Partial<StudyGoal> = {}): StudyGoal => ({
  id: 'goal', weekStart: monday, subject: '수학', material: '개념서', range: '1단원', estimatedMinutes: 90,
  completed: false, ...overrides,
});

describe('local calendar dates', () => {
  it('round-trips a local date at noon without UTC conversion', () => {
    const date = parseDate('2026-10-05');
    expect(date.getHours()).toBe(12);
    expect(date.getMonth()).toBe(9);
    expect(date.getDate()).toBe(5);
    expect(toDateKey(date)).toBe('2026-10-05');
    expect(toDateKey(new Date(2026, 9, 5, 0, 10))).toBe('2026-10-05');
  });

  it('rejects nonexistent dates rather than allowing Date to roll into the next month', () => {
    for (const date of ['2026-02-29', '2026-13-01', '2026-00-01', '2026-10-00', '2026-10-32', '2026-1-1', 'invalid']) {
      expect(() => parseDate(date)).toThrow();
    }
    expect(toDateKey(parseDate('2024-02-29'))).toBe('2024-02-29');
  });

  it('moves across month, leap day and year boundaries in both directions', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('uses Monday through Sunday and preserves a cross-year week', () => {
    expect(startOfWeek(monday)).toBe(monday);
    expect(startOfWeek('2026-10-11')).toBe(monday);
    expect(startOfWeek('2027-01-01')).toBe('2026-12-28');
    expect(getWeekDays('2027-01-01')).toEqual([
      '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03',
    ]);
    expect(startOfWeek(addDays(monday, 7))).toBe('2026-10-12');
    expect(startOfWeek(addDays(monday, -7))).toBe('2026-09-28');
  });
});

describe('minute values and labels', () => {
  it('keeps durations in integer minutes and renders Korean labels', () => {
    expect(timeToMinutes('07:30')).toBe(450);
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('24:00')).toBe(1440);
    expect(minutesToTime(1439)).toBe('23:59');
    expect(minutesToTime(0)).toBe('00:00');
    expect(minutesToTime(1440)).toBe('24:00');
    expect(formatDuration(0)).toBe('0분');
    expect(formatDuration(30)).toBe('30분');
    expect(formatDuration(120)).toBe('2시간');
    expect(formatDuration(150)).toBe('2시간 30분');
    expect(formatDuration(-30)).toBe('-30분');
  });

  it('rejects malformed times and invalid minute values', () => {
    for (const time of ['9:30', '12:60', '25:00', '24:01', '-1:00', 'NaN']) expect(() => timeToMinutes(time)).toThrow();
    for (const minutes of [-1, 1441, 10.5, Number.NaN]) expect(() => minutesToTime(minutes)).toThrow();
  });
});

describe('weekly recurrence', () => {
  it('matches a single event only on its calendar date', () => {
    expect(occursOn(event(), monday)).toBe(true);
    expect(occursOn(event(), '2026-10-12')).toBe(false);
  });

  it('honors both inclusive date boundaries and selected weekdays', () => {
    const recurring = event({ recurrence: 'weekly', weekdays: [1, 3], repeatUntil: '2026-10-14' });
    expect(occursOn(recurring, '2026-09-28')).toBe(false);
    expect(occursOn(recurring, monday)).toBe(true);
    expect(occursOn(recurring, '2026-10-06')).toBe(false);
    expect(occursOn(recurring, '2026-10-07')).toBe(true);
    expect(occursOn(recurring, '2026-10-14')).toBe(true);
    expect(occursOn(recurring, '2026-10-19')).toBe(false);
  });

  it('supports an indefinite recurrence and Sunday index zero', () => {
    const recurring = event({ recurrence: 'weekly', weekdays: [0] });
    expect(occursOn(recurring, '2026-10-11')).toBe(true);
    expect(occursOn(recurring, '2027-10-10')).toBe(true);
    expect(occursOn(recurring, monday)).toBe(false);
  });

  it('does not force an occurrence on an unselected starting weekday', () => {
    expect(occursOn(event({ recurrence: 'weekly', weekdays: [3] }), monday)).toBe(false);
  });
});

describe('available self-study time', () => {
  it('uses expanded recurrences and their count limits in shared daily and weekly availability', () => {
    const events = [
      event({ id: 'daily', recurrence: 'daily', startTime: '09:00', endTime: '10:00' }),
      event({ id: 'weekdays', recurrence: 'weekdays', startTime: '09:30', endTime: '10:30' }),
      event({ id: 'custom', recurrence: 'custom', startTime: '10:30', endTime: '11:30', customRecurrence: {
        interval: 2, unit: 'day', weekdays: [], monthPattern: 'dayOfMonth', end: { type: 'count', count: 2 },
      } }),
    ];
    const week = getWeekSummary(monday, events);
    expect(week.map((day) => day.busyMinutes)).toEqual([150, 90, 150, 90, 90, 60, 60]);
    expect(week.reduce((sum, day) => sum + day.availableMinutes, 0)).toBe(168 * 60 - 690);
    expect(getDaySummary('2026-10-09', events).events.map((item) => item.id)).toEqual(['daily', 'weekdays']);
    expect(getWeekSummary('2026-10-12', events).map((day) => day.busyMinutes)).toEqual([90, 90, 90, 90, 90, 60, 60]);
  });

  it('subtracts recurring all-day dates only while the custom occurrence count remains', () => {
    const repeated = event({ allDay: true, recurrence: 'custom', customRecurrence: {
      interval: 1, unit: 'month', weekdays: [], monthPattern: 'dayOfMonth', end: { type: 'count', count: 2 },
    } });
    expect(getDaySummary('2026-11-05', [repeated]).availableMinutes).toBe(0);
    expect(getDaySummary('2026-12-05', [repeated]).availableMinutes).toBe(1440);
  });

  it('makes all 24 hours available on an empty day', () => {
    expect(getDaySummary(monday, [])).toEqual({
      date: monday, availableMinutes: 1440, busyMinutes: 0, events: [], freeSlots: [{ start: 0, end: 1440 }],
    });
  });

  it('makes all 168 hours available on an empty week', () => {
    const week = getWeekSummary(monday, []);
    expect(week).toHaveLength(7);
    expect(week.reduce((sum, day) => sum + day.availableMinutes, 0)).toBe(168 * 60);
  });

  it('deduplicates nested, overlapping and touching schedules without mutating inputs', () => {
    const events = [
      event({ id: 'a', startTime: '09:00', endTime: '12:00' }),
      event({ id: 'b', startTime: '10:00', endTime: '11:00' }),
      event({ id: 'c', startTime: '11:00', endTime: '13:00' }),
      event({ id: 'd', startTime: '13:00', endTime: '14:00' }),
      event({ id: 'e', startTime: '16:00', endTime: '17:00' }),
    ];
    const original = structuredClone(events);
    const summary = getDaySummary(monday, events);
    expect(summary.busyMinutes).toBe(360);
    expect(summary.availableMinutes).toBe(1080);
    expect(summary.freeSlots).toEqual([{ start: 0, end: 540 }, { start: 840, end: 960 }, { start: 1020, end: 1440 }]);
    expect(events).toEqual(original);
  });

  it('counts early and late events, merging overlaps through the midnight boundaries', () => {
    const summary = getDaySummary(monday, [
      event({ id: 'early', startTime: '05:00', endTime: '08:00' }),
      event({ id: 'late', startTime: '22:30', endTime: '23:59' }),
      event({ id: 'before', startTime: '00:00', endTime: '07:00' }),
      event({ id: 'after', startTime: '23:00', endTime: '24:00' }),
    ]);
    expect(summary.busyMinutes).toBe(570);
    expect(summary.availableMinutes).toBe(870);
    expect(summary.freeSlots).toEqual([{ start: 480, end: 1350 }]);
  });

  it('subtracts schedules at exact minute boundaries', () => {
    const summary = getDaySummary(monday, [event({ startTime: '08:15', endTime: '10:16' })]);
    expect(summary.busyMinutes).toBe(121);
    expect(summary.availableMinutes).toBe(1319);
    expect(summary.freeSlots).toEqual([{ start: 0, end: 495 }, { start: 616, end: 1440 }]);
    expect(Number.isInteger(summary.availableMinutes)).toBe(true);
  });

  it('blocks the complete 24-hour day for all-day events and never double-counts', () => {
    const events = [event(), event({ id: 'exam', allDay: true }), event({ id: 'exam2', allDay: true })];
    const summary = getDaySummary(monday, events);
    expect(summary.availableMinutes).toBe(0);
    expect(summary.busyMinutes).toBe(1440);
    expect(summary.freeSlots).toEqual([]);
    expect(getDaySummary('2026-10-06', events).availableMinutes).toBe(1440);
  });

  it('accounts for recurring all-day events only on selected weekdays within the date range', () => {
    const events = [event({ allDay: true, recurrence: 'weekly', weekdays: [1], repeatUntil: monday })];
    expect(getDaySummary(monday, events).availableMinutes).toBe(0);
    expect(getDaySummary('2026-10-06', events).availableMinutes).toBe(1440);
    expect(getDaySummary('2026-10-12', events).availableMinutes).toBe(1440);
  });

  it('returns zero available minutes for a timed event from 00:00 to 24:00', () => {
    const summary = getDaySummary(monday, [event({ startTime: '00:00', endTime: '24:00' })]);
    expect(summary.busyMinutes).toBe(1440);
    expect(summary.availableMinutes).toBe(0);
    expect(summary.freeSlots).toEqual([]);
  });

  it('counts the final minute of the day without overflowing into another date', () => {
    const events = [event({ startTime: '23:59', endTime: '24:00' })];
    expect(getDaySummary(monday, events)).toMatchObject({ busyMinutes: 1, availableMinutes: 1439, freeSlots: [{ start: 0, end: 1439 }] });
    expect(getDaySummary('2026-10-06', events).availableMinutes).toBe(1440);
  });

  it('computes all seven days and correctly changes recurrences when moving weeks', () => {
    const events = [event({ recurrence: 'weekly', weekdays: [1, 3, 5], repeatUntil: '2026-10-09' })];
    const week = getWeekSummary(monday, events);
    expect(week).toHaveLength(7);
    expect(week.map((day) => day.busyMinutes)).toEqual([60, 0, 60, 0, 60, 0, 0]);
    expect(week.reduce((sum, day) => sum + day.availableMinutes, 0)).toBe(9900);
    expect(getWeekSummary('2026-10-12', events).every((day) => day.busyMinutes === 0)).toBe(true);
  });
});

describe('weekly learning goals and state', () => {
  it('counts completed goals independently of legacy durations and excludes other weeks', () => {
    const goals = [goal(), goal({ id: 'done', completed: true, estimatedMinutes: 150 }), goal({ id: 'next', weekStart: '2026-10-12', estimatedMinutes: 300 })];
    expect(getGoalSummary(goals, monday)).toEqual({ completedCount: 1, totalCount: 2 });
    expect(getGoalSummary(goals, '2026-10-12')).toEqual({ completedCount: 0, totalCount: 1 });
    expect(getGoalSummary([], monday)).toEqual({ completedCount: 0, totalCount: 0 });
  });

  it('keeps available time independent of planned goal duration and completion', () => {
    const state = createDemoState(monday);
    const before = getWeekSummary(monday, state.events);
    const plannedBefore = getStudyPlanSummary(before, state.categories, state.subjects!);
    state.goals = [goal({ estimatedMinutes: 20000, completed: true })];
    expect(getWeekSummary(monday, state.events)).toEqual(before);
    expect(getStudyPlanSummary(getWeekSummary(monday, state.events), state.categories, state.subjects!)).toEqual(plannedBefore);
  });

  it('creates isolated empty states and fictional examples anchored to the selected week', () => {
    const empty = createEmptyState();
    empty.events.push(event());
    empty.goals.push(goal());
    empty.categories[0].label = '다른 이름';
    empty.categories.push({ id: 'exercise', label: '운동', color: '#2d8c72' });
    empty.subjects!.push('추가 과목');
    const nextEmpty = createEmptyState();
    expect(nextEmpty).toMatchObject({ version: 3, subjects: DEFAULT_SUBJECTS, events: [], goals: [], isDemo: false });
    expect(nextEmpty.categories.slice(0, DEFAULT_EVENT_CATEGORIES.length)).toEqual(DEFAULT_EVENT_CATEGORIES);
    expect(nextEmpty.categories.slice(DEFAULT_EVENT_CATEGORIES.length).map((category) => category.label)).toEqual(DEFAULT_SUBJECTS);
    const demo = createDemoState('2027-01-01');
    expect(demo.categories.slice(0, DEFAULT_EVENT_CATEGORIES.length)).toEqual(DEFAULT_EVENT_CATEGORIES);
    expect(demo.goals.every((item) => item.estimatedMinutes === undefined)).toBe(true);
    expect(getStudyPlanSummary(getWeekSummary('2026-12-28', demo.events), demo.categories, demo.subjects!).plannedMinutes).toBeGreaterThan(0);
    demo.categories[0].color = '#ffffff';
    expect(createDemoState(monday).categories[0].color).toBe('#6d8ec7');
    expect(demo.isDemo).toBe(true);
    expect(demo.goals.every((item) => item.weekStart === '2026-12-28')).toBe(true);
    const week = getWeekSummary('2026-12-28', demo.events);
    expect(week.every((day) => day.availableMinutes > 0)).toBe(true);
    expect(demo.events.some((item) => item.type === 'academic' && item.date === '2027-01-06')).toBe(true);
  });
});

describe('calendar study time by registered subject', () => {
  const categories = [
    { id: 'math', label: ' 수학 ', color: '#112233' },
    { id: 'english', label: 'ＥＮＧＬＩＳＨ', color: '#223344' },
    { id: 'school', label: '학교 수업', color: '#334455' },
  ];
  const subjects = ['수학', 'English', '과학'];

  it('counts normalized category matches only and includes subjects without goals or events', () => {
    const days = getWeekSummary(monday, [event({ type: 'math' }), event({ id: 'other', type: 'school', endTime: '17:00' })]);
    expect(getStudyPlanSummary(days, categories, subjects)).toEqual({
      plannedMinutes: 60,
      subjects: [{ subject: '수학', plannedMinutes: 60 }, { subject: 'English', plannedMinutes: 0 }, { subject: '과학', plannedMinutes: 0 }],
      days: getWeekDays(monday).map((date, index) => ({ date, plannedMinutes: index === 0 ? 60 : 0 })),
    });
    expect(getStudyPlanSummary(days, categories, []).plannedMinutes).toBe(0);
    expect(getStudyPlanSummary(days, [], subjects).plannedMinutes).toBe(0);
  });

  it('merges same-subject and cross-subject overlaps independently', () => {
    const days = getWeekSummary(monday, [
      event({ id: 'a', type: 'math', startTime: '09:00', endTime: '11:00' }),
      event({ id: 'b', type: 'math', startTime: '10:00', endTime: '12:00' }),
      event({ id: 'c', type: 'english', startTime: '11:00', endTime: '13:00' }),
      event({ id: 'd', type: 'english', startTime: '13:00', endTime: '14:00' }),
    ]);
    const original = structuredClone(days);
    expect(getStudyPlanSummary(days, categories, subjects)).toMatchObject({
      plannedMinutes: 300, subjects: [{ subject: '수학', plannedMinutes: 180 }, { subject: 'English', plannedMinutes: 180 }, { subject: '과학', plannedMinutes: 0 }],
    });
    expect(days).toEqual(original);
  });

  it('counts recurring occurrences through their inclusive end and the final midnight minute', () => {
    const events = [event({ type: 'math', recurrence: 'weekly', weekdays: [1, 3, 5], repeatUntil: '2026-10-07', startTime: '23:59', endTime: '24:00' })];
    const summary = getStudyPlanSummary(getWeekSummary(monday, events), categories, subjects);
    expect(summary.plannedMinutes).toBe(2);
    expect(summary.days.map((day) => day.plannedMinutes)).toEqual([1, 0, 1, 0, 0, 0, 0]);
    expect(getStudyPlanSummary(getWeekSummary('2026-10-12', events), categories, subjects).plannedMinutes).toBe(0);
  });

  it('respects actual custom recurrence counts, monthly skips and leap dates', () => {
    const events = [event({ type: 'math', date: '2026-01-31', recurrence: 'custom', customRecurrence: { interval: 1, unit: 'month', weekdays: [], monthPattern: 'dayOfMonth', end: { type: 'count', count: 2 } } })];
    expect(getStudyPlanSummary(getWeekSummary('2026-02-23', events), categories, subjects).plannedMinutes).toBe(0);
    expect(getStudyPlanSummary(getWeekSummary('2026-03-30', events), categories, subjects).plannedMinutes).toBe(60);
    expect(getStudyPlanSummary(getWeekSummary('2026-05-25', events), categories, subjects).plannedMinutes).toBe(0);
    const leap = [event({ type: 'math', date: '2024-02-29', recurrence: 'custom', customRecurrence: { interval: 1, unit: 'year', weekdays: [], monthPattern: 'dayOfMonth', end: { type: 'never' } } })];
    expect(getStudyPlanSummary(getWeekSummary('2025-02-24', leap), categories, subjects).plannedMinutes).toBe(0);
    expect(getStudyPlanSummary(getWeekSummary('2028-02-28', leap), categories, subjects).plannedMinutes).toBe(60);
  });

  it('counts all-day matches as one full day and includes hidden category schedules', () => {
    const state = { ...createEmptyState(), categories, subjects, hiddenCategoryIds: ['math', 'english'], events: [
      event({ type: 'math', allDay: true }), event({ id: 'overlap', type: 'english', startTime: '00:00', endTime: '24:00' }),
    ] };
    const days = getWeekSummary(monday, state.events);
    expect(getStudyPlanSummary(days, state.categories, state.subjects)).toMatchObject({ plannedMinutes: 1440, subjects: [
      { subject: '수학', plannedMinutes: 1440 }, { subject: 'English', plannedMinutes: 1440 }, { subject: '과학', plannedMinutes: 0 },
    ] });
    expect(days[0].availableMinutes).toBe(0);
    expect(getStudyPlanSummary(days, state.categories, state.subjects)).toEqual(getStudyPlanSummary(days, categories, subjects));
  });
});
