import type { CustomRecurrence, ScheduleEvent } from '../types';

const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const ORDINAL_NAMES = ['첫째', '둘째', '셋째', '넷째', '다섯째'];

interface CalendarDate {
  year: number;
  month: number;
  day: number;
  ordinal: number;
  weekday: number;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Calendar-only arithmetic: elapsed hours and UTC conversions never affect recurrence. */
function calendarOrdinal(year: number, month: number, day: number): number {
  let result = year * 365 + Math.floor((year + 3) / 4) - Math.floor((year + 99) / 100) + Math.floor((year + 399) / 400);
  for (let index = 1; index < month; index += 1) result += daysInMonth(year, index);
  return result + day - 1;
}

function weekdayOf(year: number, month: number, day: number): number {
  // The proleptic Gregorian date 0000-01-01 is a Saturday.
  return (calendarOrdinal(year, month, day) + 6) % 7;
}

function readDate(value: unknown): CalendarDate | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  const ordinal = calendarOrdinal(year, month, day);
  return { year, month, day, ordinal, weekday: (ordinal + 6) % 7 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateCustomRecurrence(rule: unknown, startDate: string): string | null {
  if (!readDate(startDate)) return '올바른 시작 날짜를 입력해 주세요.';
  if (!isRecord(rule)) return '맞춤 반복 설정을 확인해 주세요.';
  if (!Number.isInteger(rule.interval) || (rule.interval as number) < 1 || (rule.interval as number) > 999) {
    return '반복 주기는 1~999 사이의 정수로 입력해 주세요.';
  }
  if (!['day', 'week', 'month', 'year'].includes(rule.unit as string)) return '반복 단위를 선택해 주세요.';
  if (!Array.isArray(rule.weekdays) || rule.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
    || new Set(rule.weekdays).size !== rule.weekdays.length) {
    return '반복 요일을 확인해 주세요.';
  }
  if (rule.unit === 'week' && rule.weekdays.length === 0) return '반복할 요일을 하나 이상 선택해 주세요.';
  if (!['dayOfMonth', 'nthWeekday', 'lastWeekday'].includes(rule.monthPattern as string)) {
    return '월별 반복 방식을 선택해 주세요.';
  }
  if (!isRecord(rule.end)) return '반복 종료 방식을 선택해 주세요.';
  if (rule.end.type === 'never') return null;
  if (rule.end.type === 'until') {
    if (!readDate(rule.end.date)) return '올바른 반복 종료 날짜를 입력해 주세요.';
    return (rule.end.date as string) < startDate ? '반복 종료일은 시작일보다 빠를 수 없어요.' : null;
  }
  if (rule.end.type === 'count') {
    return Number.isInteger(rule.end.count) && (rule.end.count as number) >= 1 && (rule.end.count as number) <= 9999
      ? null : '반복 횟수는 1~9999 사이의 정수로 입력해 주세요.';
  }
  return '반복 종료 방식을 선택해 주세요.';
}

export function createCustomRecurrence(startDate: string): CustomRecurrence {
  const date = readDate(startDate);
  if (!date) throw new Error('올바른 시작 날짜를 입력해 주세요.');
  return { interval: 1, unit: 'week', weekdays: [date.weekday], monthPattern: 'dayOfMonth', end: { type: 'never' } };
}

function monthlyOccurrenceDay(start: CalendarDate, year: number, month: number, pattern: CustomRecurrence['monthPattern']): number | null {
  const lastDay = daysInMonth(year, month);
  if (pattern === 'dayOfMonth') return start.day <= lastDay ? start.day : null;
  if (pattern === 'lastWeekday') return lastDay - ((weekdayOf(year, month, lastDay) - start.weekday + 7) % 7);
  const day = 1 + ((start.weekday - weekdayOf(year, month, 1) + 7) % 7) + Math.floor((start.day - 1) / 7) * 7;
  return day <= lastDay ? day : null;
}

function greatestCommonDivisor(first: number, second: number): number {
  let left = first;
  let right = second;
  while (right) [left, right] = [right, left % right];
  return left;
}

/** Gregorian patterns repeat every 400 years, bounding work even for distant dates. */
function countValidPeriods(lastIndex: number, cycleLength: number, valid: (index: number) => boolean): number {
  const total = lastIndex + 1;
  if (total < cycleLength) {
    let count = 0;
    for (let index = 0; index < total; index += 1) if (valid(index)) count += 1;
    return count;
  }
  let perCycle = 0;
  let remainder = 0;
  const remainderLength = total % cycleLength;
  for (let index = 0; index < cycleLength; index += 1) {
    if (valid(index)) {
      perCycle += 1;
      if (index < remainderLength) remainder += 1;
    }
  }
  return Math.floor(total / cycleLength) * perCycle + remainder;
}

/** Returns the one-based occurrence number, or zero when this date does not match. */
function customOccurrenceNumber(start: CalendarDate, date: CalendarDate, rule: CustomRecurrence): number {
  const needsCount = rule.end.type === 'count';
  if (rule.unit === 'day') {
    const elapsed = date.ordinal - start.ordinal;
    return elapsed % rule.interval === 0 ? elapsed / rule.interval + 1 : 0;
  }
  if (rule.unit === 'week') {
    const firstOffset = (start.weekday + 6) % 7;
    const dayOffset = (date.weekday + 6) % 7;
    const elapsedWeeks = Math.floor((date.ordinal - (start.ordinal - firstOffset)) / 7);
    if (elapsedWeeks % rule.interval !== 0 || !rule.weekdays.includes(date.weekday)) return 0;
    if (!needsCount) return 1;
    const activeWeek = elapsedWeeks / rule.interval;
    const offsets = rule.weekdays.map((weekday) => (weekday + 6) % 7);
    if (activeWeek === 0) return offsets.filter((offset) => offset >= firstOffset && offset <= dayOffset).length;
    const firstWeek = offsets.filter((offset) => offset >= firstOffset).length;
    return firstWeek + (activeWeek - 1) * offsets.length + offsets.filter((offset) => offset <= dayOffset).length;
  }
  if (rule.unit === 'month') {
    const elapsedMonths = (date.year - start.year) * 12 + date.month - start.month;
    if (elapsedMonths % rule.interval !== 0 || monthlyOccurrenceDay(start, date.year, date.month, rule.monthPattern) !== date.day) return 0;
    if (!needsCount) return 1;
    const lastIndex = elapsedMonths / rule.interval;
    if (rule.monthPattern === 'lastWeekday' || (rule.monthPattern === 'dayOfMonth' && start.day <= 28)
      || (rule.monthPattern === 'nthWeekday' && start.day <= 28)) return lastIndex + 1;
    return countValidPeriods(lastIndex, 4800 / greatestCommonDivisor(rule.interval, 4800), (index) => {
      const monthIndex = start.year * 12 + start.month - 1 + index * rule.interval;
      return monthlyOccurrenceDay(start, Math.floor(monthIndex / 12), monthIndex % 12 + 1, rule.monthPattern) !== null;
    });
  }
  const elapsedYears = date.year - start.year;
  if (elapsedYears % rule.interval !== 0 || date.month !== start.month || date.day !== start.day) return 0;
  if (!needsCount) return 1;
  const lastIndex = elapsedYears / rule.interval;
  if (start.month !== 2 || start.day !== 29) return lastIndex + 1;
  return countValidPeriods(lastIndex, 400 / greatestCommonDivisor(rule.interval, 400), (index) => isLeapYear(start.year + index * rule.interval));
}

export function occursOn(event: ScheduleEvent, dateKey: string): boolean {
  const start = readDate(event.date);
  const date = readDate(dateKey);
  if (!start || !date) return false;
  if (event.recurrence === 'none') return event.date === dateKey;
  if (dateKey < event.date) return false;
  // Omission never changes the original rule's occurrence numbers or end date.
  if (event.excludedDates?.includes(dateKey)) return false;
  if (event.recurrence === 'custom') {
    const rule = event.customRecurrence;
    if (!rule || validateCustomRecurrence(rule, event.date)) return false;
    if (rule.end.type === 'until' && dateKey > rule.end.date) return false;
    const occurrence = customOccurrenceNumber(start, date, rule);
    return occurrence > 0 && (rule.end.type !== 'count' || occurrence <= rule.end.count);
  }
  if (event.repeatUntil && (!readDate(event.repeatUntil) || dateKey > event.repeatUntil)) return false;
  if (event.recurrence === 'daily') return true;
  if (event.recurrence === 'weekly') return event.weekdays.includes(date.weekday);
  if (event.recurrence === 'monthly') return date.day === start.day;
  if (event.recurrence === 'weekdays') return date.weekday >= 1 && date.weekday <= 5;
  return false;
}

function weekdayLabel(weekdays: number[]): string {
  return [...weekdays].sort((left, right) => ((left + 6) % 7) - ((right + 6) % 7)).map((weekday) => WEEKDAY_NAMES[weekday]).join('·');
}

function endLabel(rule: CustomRecurrence): string {
  if (rule.end.type === 'until') return ` · ${rule.end.date}까지`;
  if (rule.end.type === 'count') return ` · 총 ${rule.end.count}회`;
  return '';
}

export function getRecurrenceSummary(event: ScheduleEvent): string {
  if (event.recurrence === 'none') return '반복 안 함';
  const start = readDate(event.date);
  if (!start) return '반복 설정 확인 필요';
  let label: string;
  if (event.recurrence === 'custom') {
    const rule = event.customRecurrence;
    if (!rule || validateCustomRecurrence(rule, event.date)) return '맞춤 반복 설정 확인 필요';
    if (rule.unit === 'day') label = rule.interval === 1 ? '매일' : `${rule.interval}일마다`;
    else if (rule.unit === 'week') label = `${rule.interval === 1 ? '매주' : `${rule.interval}주마다`} ${weekdayLabel(rule.weekdays)}`;
    else if (rule.unit === 'month') {
      const pattern = rule.monthPattern === 'dayOfMonth' ? `${start.day}일`
        : `${rule.monthPattern === 'lastWeekday' ? '마지막' : ORDINAL_NAMES[Math.floor((start.day - 1) / 7)]} ${WEEKDAY_NAMES[start.weekday]}요일`;
      label = `${rule.interval === 1 ? '매월' : `${rule.interval}개월마다`} ${pattern}`;
    } else label = `${rule.interval === 1 ? '매년' : `${rule.interval}년마다`} ${start.month}월 ${start.day}일`;
    return label + endLabel(rule);
  }
  if (event.recurrence === 'daily') label = '매일';
  else if (event.recurrence === 'weekly') label = `매주 ${weekdayLabel(event.weekdays)}`.trim();
  else if (event.recurrence === 'monthly') label = `매월 ${start.day}일`;
  else label = '주중(월~금)';
  return label + (event.repeatUntil ? ` · ${event.repeatUntil}까지` : '');
}
