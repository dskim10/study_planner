import type { DaySummary, EventCategory, PlannerState, ScheduleEvent, StudyGoal, StudyPlanSummary } from '../types';
import { DEFAULT_EVENT_CATEGORIES, DEFAULT_SUBJECTS } from '../types';
import { occursOn } from './recurrence';
import { isSubjectCategory, normalizeSubjectName, syncSubjectCategories } from './subjects';

export { occursOn } from './recurrence';

export const MINUTES_PER_DAY = 1440;

/** Date keys are local calendar dates, never UTC timestamps. */
export function toDateKey(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new Error('유효한 날짜를 입력해 주세요.');
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Noon keeps calendar arithmetic clear of most daylight-saving transitions. */
export function parseDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('날짜는 YYYY-MM-DD 형식으로 입력해 주세요.');
  const [, year, month, day] = match;
  const date = new Date(2000, 0, 1, 12);
  date.setFullYear(Number(year), Number(month) - 1, Number(day));
  if (toDateKey(date) !== value) throw new Error('존재하지 않는 날짜입니다.');
  return date;
}

export function addDays(value: string, days: number): string {
  if (!Number.isInteger(days)) throw new Error('날짜 이동은 정수로 입력해 주세요.');
  const date = parseDate(value);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

export function startOfWeek(value: string): string {
  const weekday = parseDate(value).getDay();
  return addDays(value, -((weekday + 6) % 7));
}

export function getWeekDays(weekStart: string): string[] {
  const monday = startOfWeek(weekStart);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

export function timeToMinutes(time: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) throw new Error('시간은 HH:MM 형식으로 입력해 주세요.');
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes !== 0)) {
    throw new Error('유효한 시간을 입력해 주세요.');
  }
  return hours * 60 + minutes;
}

export function minutesToTime(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) {
    throw new Error('시간은 0분에서 1440분 사이의 정수여야 합니다.');
  }
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function formatDuration(minutes: number): string {
  const total = Math.round(Math.abs(minutes));
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  const label = hours ? `${hours}시간${remainder ? ` ${remainder}분` : ''}` : `${remainder}분`;
  return minutes < 0 && total > 0 ? `-${label}` : label;
}

/** Subject schedules use study capacity without reducing it; free slots exclude every schedule. */
export function getDaySummary(date: string, events: ScheduleEvent[], categories: EventCategory[] = [], subjects: string[] = []): DaySummary {
  const start = 0;
  const end = MINUTES_PER_DAY;
  const dayEvents = events.filter((event) => occursOn(event, date)).sort((a, b) =>
    Number(b.allDay) - Number(a.allDay) || a.startTime.localeCompare(b.startTime) || a.title.localeCompare(b.title, 'ko'),
  );
  const totalMinutes = end - start;
  const subjectCategoryIds = new Set(categories.filter((category) => isSubjectCategory(category, subjects)).map((category) => category.id));
  const intervals = dayEvents.map((event) => ({
    start: event.allDay ? start : Math.max(start, timeToMinutes(event.startTime)),
    end: event.allDay ? end : Math.min(end, timeToMinutes(event.endTime)),
    fixed: !subjectCategoryIds.has(event.type),
  })).filter((interval) => interval.end > interval.start).sort((a, b) => a.start - b.start);
  const busyMinutes = mergedMinutes(intervals.filter((interval) => interval.fixed));

  const merged: { start: number; end: number }[] = [];
  for (const interval of intervals) {
    const previous = merged[merged.length - 1];
    if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
    else merged.push({ start: interval.start, end: interval.end });
  }

  const freeSlots: DaySummary['freeSlots'] = [];
  let cursor = start;
  for (const interval of merged) {
    if (interval.start > cursor) freeSlots.push({ start: cursor, end: interval.start });
    cursor = interval.end;
  }
  if (cursor < end) freeSlots.push({ start: cursor, end });
  return { date, availableMinutes: totalMinutes - busyMinutes, busyMinutes, events: dayEvents, freeSlots };
}

export function getWeekSummary(weekStart: string, events: ScheduleEvent[], categories: EventCategory[] = [], subjects: string[] = []): DaySummary[] {
  return getWeekDays(weekStart).map((date) => getDaySummary(date, events, categories, subjects));
}

export function getGoalSummary(goals: StudyGoal[], weekStart: string) {
  const weekGoals = goals.filter((goal) => goal.weekStart === startOfWeek(weekStart));
  return {
    completedCount: weekGoals.filter((goal) => goal.completed).length,
    totalCount: weekGoals.length,
  };
}

function mergedMinutes(intervals: { start: number; end: number }[]): number {
  const ordered = [...intervals].sort((left, right) => left.start - right.start);
  let total = 0;
  let end = 0;
  for (const interval of ordered) {
    total += Math.max(0, interval.end - Math.max(end, interval.start));
    end = Math.max(end, interval.end);
  }
  return total;
}

/** Calendar category names match registered subjects; overlaps count once per day. */
export function getStudyPlanSummary(days: DaySummary[], categories: EventCategory[], subjects: string[]): StudyPlanSummary {
  const categoryNames = new Map(categories.map((category) => [category.id, normalizeSubjectName(category.label)]));
  const subjectIndexes = new Map(subjects.map((subject, index) => [normalizeSubjectName(subject), index]));
  const subjectTotals = subjects.map((subject) => ({ subject, plannedMinutes: 0 }));
  const dayTotals = days.map((day) => {
    const intervals: { start: number; end: number }[] = [];
    const perSubject = subjects.map(() => [] as { start: number; end: number }[]);
    for (const event of day.events) {
      const subject = subjectIndexes.get(categoryNames.get(event.type) ?? '');
      if (subject === undefined) continue;
      const interval = event.allDay ? { start: 0, end: MINUTES_PER_DAY } : { start: timeToMinutes(event.startTime), end: timeToMinutes(event.endTime) };
      intervals.push(interval);
      perSubject[subject].push(interval);
    }
    perSubject.forEach((intervalsForSubject, index) => { subjectTotals[index].plannedMinutes += mergedMinutes(intervalsForSubject); });
    return { date: day.date, plannedMinutes: mergedMinutes(intervals) };
  });
  return { plannedMinutes: dayTotals.reduce((total, day) => total + day.plannedMinutes, 0), subjects: subjectTotals, days: dayTotals };
}

export function createEmptyState(): PlannerState {
  return syncSubjectCategories({ version: 3, categories: DEFAULT_EVENT_CATEGORIES.map((category) => ({ ...category })), subjects: [...DEFAULT_SUBJECTS], events: [], goals: [], isDemo: false });
}

/** Fictional example data is relative to the student's current local week. */
export function createDemoState(today: string): PlannerState {
  const weekStart = startOfWeek(today);
  const repeatUntil = addDays(weekStart, 83);
  const weekly = (
    id: string, title: string, type: ScheduleEvent['type'], startTime: string, endTime: string, weekdays: number[],
  ): ScheduleEvent => ({
    id, title, type, date: weekStart, startTime, endTime, allDay: false, recurrence: 'weekly', weekdays, repeatUntil,
  });
  const events: ScheduleEvent[] = [
    weekly('demo-school', '학교 수업', 'school', '08:30', '16:00', [1, 2, 3, 4, 5]),
    weekly('demo-math', '수학 학원', 'academy', '19:00', '21:00', [1, 3]),
    weekly('demo-english', '영어 학원', 'academy', '19:00', '20:30', [2, 4]),
    weekly('demo-science', '과학 탐구 수업', 'academy', '10:00', '12:00', [6]),
    weekly('demo-breakfast', '아침 식사 · 하루 준비', 'personal', '07:00', '07:30', [0, 1, 2, 3, 4, 5, 6]),
    weekly('demo-commute', '등교', 'personal', '08:00', '08:30', [1, 2, 3, 4, 5]),
    weekly('demo-dinner', '저녁 식사 · 휴식', 'personal', '18:00', '19:00', [0, 1, 2, 3, 4, 5, 6]),
    weekly('demo-study-math', '수학 문제 풀이', 'study-math', '21:00', '22:00', [1, 3, 5]),
    weekly('demo-study-english', '영어 단어와 독해', 'study-english', '21:00', '22:00', [2, 4]),
    weekly('demo-study-korean', '국어 작품 정리', 'study-korean', '14:00', '15:30', [6]),
    weekly('demo-study-science', '과학 개념 복습', 'study-science', '14:00', '15:30', [0]),
    {
      id: 'demo-exam', title: '전국 모의고사', type: 'academic', date: addDays(weekStart, 9),
      startTime: '08:00', endTime: '18:00', allDay: true, recurrence: 'none', weekdays: [],
    },
  ];
  const goals: StudyGoal[] = [
    { id: 'demo-goal-math-1', weekStart, subject: '수학', material: '수학 개념서', range: '수열 개념 정리 · p. 42–61', completed: true },
    { id: 'demo-goal-math-2', weekStart, subject: '수학', material: '유형별 문제집', range: '등차수열 · 기본 문제 1–40번', completed: false },
    { id: 'demo-goal-english-1', weekStart, subject: '영어', material: '영어 단어장', range: 'Day 11–15 · 매일 30개 복습', completed: false },
    { id: 'demo-goal-english-2', weekStart, subject: '영어', material: '독해 기출 모음', range: '빈칸 추론 3개년 · 12지문', completed: false },
    { id: 'demo-goal-korean', weekStart, subject: '국어', material: '문학 작품집', range: '현대시 4작품 · 핵심 내용 정리', completed: false },
    { id: 'demo-goal-science', weekStart, subject: '과학', material: '통합과학 개념 노트', range: '생명 시스템 · 2단원 복습', completed: false },
  ];
  const categories = [...DEFAULT_EVENT_CATEGORIES.map((category) => ({ ...category })),
    { id: 'study-math', label: '수학', color: '#647DBB' },
    { id: 'study-english', label: '영어', color: '#9B79CF' },
    { id: 'study-korean', label: '국어', color: '#D39365' },
    { id: 'study-science', label: '과학', color: '#5B9984' },
  ];
  return syncSubjectCategories({ ...createEmptyState(), categories, events, goals, isDemo: true });
}
