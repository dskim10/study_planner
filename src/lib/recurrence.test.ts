import { describe, expect, it } from 'vitest';
import type { CustomRecurrence, ScheduleEvent } from '../types';
import { createCustomRecurrence, getRecurrenceSummary, occursOn, validateCustomRecurrence } from './recurrence';

const event = (overrides: Partial<ScheduleEvent> = {}): ScheduleEvent => ({
  id: 'repeat', title: '자율 학습', type: 'personal', date: '2026-10-05', startTime: '18:00', endTime: '19:00',
  allDay: false, recurrence: 'none', weekdays: [], ...overrides,
});

const custom = (date: string, rule: Partial<CustomRecurrence> = {}): ScheduleEvent => event({
  date, recurrence: 'custom', customRecurrence: { ...createCustomRecurrence(date), ...rule },
});

describe('recurrence presets', () => {
  it('matches every day, including weekends, only within inclusive boundaries', () => {
    const daily = event({ recurrence: 'daily', repeatUntil: '2026-10-11' });
    expect(occursOn(daily, '2026-10-04')).toBe(false);
    expect(occursOn(daily, '2026-10-05')).toBe(true);
    expect(occursOn(daily, '2026-10-10')).toBe(true);
    expect(occursOn(daily, '2026-10-11')).toBe(true);
    expect(occursOn(daily, '2026-10-12')).toBe(false);
  });

  it('matches weekdays and does not force a Saturday start to occur', () => {
    const weekdays = event({ recurrence: 'weekdays', date: '2026-10-03', repeatUntil: '2026-10-09' });
    expect(occursOn(weekdays, '2026-10-03')).toBe(false);
    expect(occursOn(weekdays, '2026-10-04')).toBe(false);
    expect(occursOn(weekdays, '2026-10-05')).toBe(true);
    expect(occursOn(weekdays, '2026-10-09')).toBe(true);
    expect(occursOn(weekdays, '2026-10-12')).toBe(false);
  });

  it('keeps legacy weekly weekdays and their inclusive end date unchanged', () => {
    const weekly = event({ recurrence: 'weekly', weekdays: [1, 0], repeatUntil: '2026-10-11' });
    expect(occursOn(weekly, '2026-10-05')).toBe(true);
    expect(occursOn(weekly, '2026-10-06')).toBe(false);
    expect(occursOn(weekly, '2026-10-11')).toBe(true);
    expect(occursOn(weekly, '2026-10-12')).toBe(false);
  });

  it('skips missing monthly dates instead of overflowing or clamping them', () => {
    const monthly = event({ date: '2026-01-31', recurrence: 'monthly' });
    expect(occursOn(monthly, '2026-01-31')).toBe(true);
    expect(occursOn(monthly, '2026-02-28')).toBe(false);
    expect(occursOn(monthly, '2026-03-03')).toBe(false);
    expect(occursOn(monthly, '2026-03-31')).toBe(true);
    expect(occursOn(monthly, '2026-04-30')).toBe(false);
    expect(occursOn(monthly, '2027-01-31')).toBe(true);
  });

  it('does not interpret invalid stored date keys as rolled-over calendar dates', () => {
    expect(occursOn(event({ recurrence: 'daily' }), '2026-02-30')).toBe(false);
    expect(occursOn(event({ date: '2026-13-01', recurrence: 'daily' }), '2027-01-01')).toBe(false);
    expect(occursOn(event({ recurrence: 'daily', repeatUntil: 'invalid' }), '2026-10-05')).toBe(false);
  });
});

describe('custom daily and weekly recurrence', () => {
  it('counts the starting date as occurrence one and stops after the specified total', () => {
    const everyOtherDay = custom('2026-10-05', { unit: 'day', interval: 2, end: { type: 'count', count: 3 } });
    expect(occursOn(everyOtherDay, '2026-10-03')).toBe(false);
    expect(occursOn(everyOtherDay, '2026-10-05')).toBe(true);
    expect(occursOn(everyOtherDay, '2026-10-06')).toBe(false);
    expect(occursOn(everyOtherDay, '2026-10-07')).toBe(true);
    expect(occursOn(everyOtherDay, '2026-10-09')).toBe(true);
    expect(occursOn(everyOtherDay, '2026-10-11')).toBe(false);
    expect(occursOn(custom('2026-10-05', { unit: 'day', end: { type: 'count', count: 1 } }), '2026-10-06')).toBe(false);
  });

  it('anchors weeks to Monday and counts a partial starting week correctly', () => {
    const alternatingWeeks = custom('2026-10-07', { interval: 2, weekdays: [5, 1, 3], end: { type: 'count', count: 4 } });
    expect(occursOn(alternatingWeeks, '2026-10-05')).toBe(false);
    expect(occursOn(alternatingWeeks, '2026-10-07')).toBe(true);
    expect(occursOn(alternatingWeeks, '2026-10-09')).toBe(true);
    expect(occursOn(alternatingWeeks, '2026-10-12')).toBe(false);
    expect(occursOn(alternatingWeeks, '2026-10-14')).toBe(false);
    expect(occursOn(alternatingWeeks, '2026-10-19')).toBe(true);
    expect(occursOn(alternatingWeeks, '2026-10-21')).toBe(true);
    expect(occursOn(alternatingWeeks, '2026-10-23')).toBe(false);
  });

  it('counts from the first matching weekday when no starting-week date matches', () => {
    const mondayOnly = custom('2026-10-07', { interval: 2, weekdays: [1], end: { type: 'count', count: 1 } });
    expect(occursOn(mondayOnly, '2026-10-07')).toBe(false);
    expect(occursOn(mondayOnly, '2026-10-12')).toBe(false);
    expect(occursOn(mondayOnly, '2026-10-19')).toBe(true);
    expect(occursOn(mondayOnly, '2026-11-02')).toBe(false);
  });

  it('treats Sunday as the final day of the week when counting', () => {
    const sundayStart = custom('2026-10-11', { weekdays: [0, 1], end: { type: 'count', count: 2 } });
    expect(occursOn(sundayStart, '2026-10-11')).toBe(true);
    expect(occursOn(sundayStart, '2026-10-12')).toBe(true);
    expect(occursOn(sundayStart, '2026-10-18')).toBe(false);
  });

  it('honors the custom inclusive end date independently from a stale legacy end date', () => {
    const until = { ...custom('2026-10-05', { unit: 'day', end: { type: 'until', date: '2026-10-07' } }), repeatUntil: '2026-10-05' };
    expect(occursOn(until, '2026-10-07')).toBe(true);
    expect(occursOn(until, '2026-10-08')).toBe(false);
  });

  it('uses calendar days across both daylight-saving boundaries and a leap day', () => {
    const spring = custom('2026-03-07', { unit: 'day', interval: 2 });
    const autumn = custom('2026-10-31', { unit: 'day', interval: 2 });
    expect(occursOn(spring, '2026-03-08')).toBe(false);
    expect(occursOn(spring, '2026-03-09')).toBe(true);
    expect(occursOn(autumn, '2026-11-01')).toBe(false);
    expect(occursOn(autumn, '2026-11-02')).toBe(true);
    expect(occursOn(custom('2024-02-28', { unit: 'day', interval: 2 }), '2024-03-01')).toBe(true);
  });
});

describe('custom monthly and yearly recurrence', () => {
  it('counts actual monthly occurrences and skips February and April for a 31st', () => {
    const thirtyFirst = custom('2026-01-31', { unit: 'month', end: { type: 'count', count: 3 } });
    expect(occursOn(thirtyFirst, '2026-01-31')).toBe(true);
    expect(occursOn(thirtyFirst, '2026-02-28')).toBe(false);
    expect(occursOn(thirtyFirst, '2026-03-31')).toBe(true);
    expect(occursOn(thirtyFirst, '2026-04-30')).toBe(false);
    expect(occursOn(thirtyFirst, '2026-05-31')).toBe(true);
    expect(occursOn(thirtyFirst, '2026-07-31')).toBe(false);
  });

  it('applies multi-month intervals across years', () => {
    const quarterly = custom('2026-10-05', { unit: 'month', interval: 3, end: { type: 'count', count: 2 } });
    expect(occursOn(quarterly, '2026-10-05')).toBe(true);
    expect(occursOn(quarterly, '2026-11-05')).toBe(false);
    expect(occursOn(quarterly, '2027-01-05')).toBe(true);
    expect(occursOn(quarterly, '2027-04-05')).toBe(false);
  });

  it('matches the same ordinal weekday instead of the day of month', () => {
    const secondMonday = custom('2026-10-12', { unit: 'month', monthPattern: 'nthWeekday', end: { type: 'count', count: 2 } });
    expect(occursOn(secondMonday, '2026-10-12')).toBe(true);
    expect(occursOn(secondMonday, '2026-11-09')).toBe(true);
    expect(occursOn(secondMonday, '2026-11-12')).toBe(false);
    expect(occursOn(secondMonday, '2026-12-14')).toBe(false);
  });

  it('skips months without a fifth weekday without consuming the count', () => {
    const fifthMonday = custom('2026-03-30', { unit: 'month', monthPattern: 'nthWeekday', end: { type: 'count', count: 3 } });
    expect(occursOn(fifthMonday, '2026-03-30')).toBe(true);
    expect(occursOn(fifthMonday, '2026-04-27')).toBe(false);
    expect(occursOn(fifthMonday, '2026-05-25')).toBe(false);
    expect(occursOn(fifthMonday, '2026-06-29')).toBe(true);
    expect(occursOn(fifthMonday, '2026-08-31')).toBe(true);
    expect(occursOn(fifthMonday, '2026-11-30')).toBe(false);
  });

  it('matches each last weekday even if the start date is earlier in its month', () => {
    const lastMonday = custom('2026-10-05', { unit: 'month', monthPattern: 'lastWeekday', end: { type: 'count', count: 3 } });
    expect(occursOn(lastMonday, '2026-10-05')).toBe(false);
    expect(occursOn(lastMonday, '2026-10-26')).toBe(true);
    expect(occursOn(lastMonday, '2026-11-23')).toBe(false);
    expect(occursOn(lastMonday, '2026-11-30')).toBe(true);
    expect(occursOn(lastMonday, '2026-12-28')).toBe(true);
    expect(occursOn(lastMonday, '2027-01-25')).toBe(false);
  });

  it('skips non-leap years and Gregorian century exceptions without consuming the count', () => {
    const leap = custom('2096-02-29', { unit: 'year', end: { type: 'count', count: 2 } });
    expect(occursOn(leap, '2096-02-29')).toBe(true);
    expect(occursOn(leap, '2097-02-28')).toBe(false);
    expect(occursOn(leap, '2100-02-29')).toBe(false);
    expect(occursOn(leap, '2104-02-29')).toBe(true);
    expect(occursOn(leap, '2108-02-29')).toBe(false);
  });

  it('applies yearly intervals and inclusive end dates', () => {
    const everyTwoYears = custom('2026-10-05', { unit: 'year', interval: 2, end: { type: 'until', date: '2030-10-05' } });
    expect(occursOn(everyTwoYears, '2027-10-05')).toBe(false);
    expect(occursOn(everyTwoYears, '2028-10-05')).toBe(true);
    expect(occursOn(everyTwoYears, '2030-10-05')).toBe(true);
    expect(occursOn(everyTwoYears, '2032-10-05')).toBe(false);
  });

  it('counts Gregorian cycles in distant dates without scanning elapsed days', () => {
    // Every 400 years has 97 leap years. 0000 is itself a leap year.
    expect(occursOn(custom('0000-02-29', { unit: 'year', end: { type: 'count', count: 98 } }), '0400-02-29')).toBe(true);
    expect(occursOn(custom('0000-02-29', { unit: 'year', end: { type: 'count', count: 97 } }), '0400-02-29')).toBe(false);
    // 400 years contain 2,800 months with a 31st, before the first occurrence in year 400.
    expect(occursOn(custom('0000-01-31', { unit: 'month', end: { type: 'count', count: 2801 } }), '0400-01-31')).toBe(true);
    expect(occursOn(custom('0000-01-31', { unit: 'month', end: { type: 'count', count: 2800 } }), '0400-01-31')).toBe(false);
    expect(occursOn(custom('0000-01-01', { unit: 'day', interval: 1 }), '9999-12-31')).toBe(true);
    expect(occursOn(custom('0000-01-01', { unit: 'day', interval: 1, end: { type: 'count', count: 9999 } }), '9999-12-31')).toBe(false);
  });
});

describe('custom rule validation and summaries', () => {
  it('creates independent weekly defaults using the start date weekday', () => {
    const first = createCustomRecurrence('2026-10-11');
    expect(first).toEqual({ interval: 1, unit: 'week', weekdays: [0], monthPattern: 'dayOfMonth', end: { type: 'never' } });
    first.weekdays.push(1);
    expect(createCustomRecurrence('2026-10-11').weekdays).toEqual([0]);
    expect(() => createCustomRecurrence('2026-02-30')).toThrow();
  });

  it('rejects malformed and out-of-range settings, including impossible dates', () => {
    const valid = createCustomRecurrence('2026-10-05');
    const invalid: unknown[] = [
      null, [], {}, { ...valid, interval: 0 }, { ...valid, interval: 1000 }, { ...valid, interval: 1.5 },
      { ...valid, interval: Number.NaN }, { ...valid, interval: '2' }, { ...valid, unit: 'hour' },
      { ...valid, weekdays: [] }, { ...valid, weekdays: [7] }, { ...valid, weekdays: [-1] },
      { ...valid, weekdays: [1, 1] }, { ...valid, weekdays: [1.5] }, { ...valid, weekdays: ['1'] },
      { ...valid, monthPattern: 'other' }, { ...valid, end: null }, { ...valid, end: { type: 'other' } },
      { ...valid, end: { type: 'until', date: '2026-10-04' } }, { ...valid, end: { type: 'until', date: '2027-02-29' } },
      { ...valid, end: { type: 'count', count: 0 } }, { ...valid, end: { type: 'count', count: 10000 } },
      { ...valid, end: { type: 'count', count: 2.5 } }, { ...valid, end: { type: 'count', count: '2' } },
    ];
    for (const rule of invalid) expect(validateCustomRecurrence(rule, '2026-10-05')).not.toBeNull();
    expect(validateCustomRecurrence(valid, '2026-02-30')).not.toBeNull();
    expect(validateCustomRecurrence(valid, '2026-10-05')).toBeNull();
    expect(validateCustomRecurrence({ ...valid, unit: 'day', weekdays: [], interval: 999, end: { type: 'count', count: 9999 } }, '2026-10-05')).toBeNull();
    expect(validateCustomRecurrence({ ...valid, end: { type: 'until', date: '2026-10-05' } }, '2026-10-05')).toBeNull();
  });

  it('makes invalid or missing custom rules non-occurring instead of throwing', () => {
    expect(occursOn(event({ recurrence: 'custom' }), '2026-10-05')).toBe(false);
    expect(occursOn(custom('2026-10-05', { interval: 0 }), '2026-10-05')).toBe(false);
  });

  it('summarizes custom details and sorts Korean weekdays Monday first without mutation', () => {
    const weekly = custom('2026-10-05', { interval: 2, weekdays: [0, 3, 1], end: { type: 'count', count: 13 } });
    expect(getRecurrenceSummary(weekly)).toBe('2주마다 월·수·일 · 총 13회');
    expect(weekly.customRecurrence?.weekdays).toEqual([0, 3, 1]);
    expect(getRecurrenceSummary(custom('2026-10-12', { unit: 'month', monthPattern: 'nthWeekday' }))).toBe('매월 둘째 월요일');
    expect(getRecurrenceSummary(custom('2026-10-05', { unit: 'month', monthPattern: 'lastWeekday' }))).toBe('매월 마지막 월요일');
    expect(getRecurrenceSummary(custom('2026-10-05', { unit: 'day', end: { type: 'until', date: '2027-01-04' } }))).toBe('매일 · 2027-01-04까지');
    expect(getRecurrenceSummary(custom('2026-10-05', { unit: 'year', interval: 2 }))).toBe('2년마다 10월 5일');
    expect(getRecurrenceSummary(event({ recurrence: 'monthly' }))).toBe('매월 5일');
    expect(getRecurrenceSummary(event({ recurrence: 'weekdays' }))).toBe('주중(월~금)');
    expect(getRecurrenceSummary(event())).toBe('반복 안 함');
  });
});
