export type EventType = string;

export interface EventCategory {
  id: string;
  label: string;
  color: string;
}

export type RecurrenceMode = 'none' | 'daily' | 'weekly' | 'monthly' | 'weekdays' | 'custom';
export type RecurrenceUnit = 'day' | 'week' | 'month' | 'year';
export type RecurrenceEnd =
  | { type: 'never' }
  | { type: 'until'; date: string }
  | { type: 'count'; count: number };

export interface CustomRecurrence {
  interval: number;
  unit: RecurrenceUnit;
  weekdays: number[];
  monthPattern: 'dayOfMonth' | 'nthWeekday' | 'lastWeekday';
  end: RecurrenceEnd;
}

export interface ScheduleEvent {
  id: string;
  title: string;
  type: EventType;
  date: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  recurrence: RecurrenceMode;
  weekdays: number[];
  repeatUntil?: string;
  customRecurrence?: CustomRecurrence;
}

export interface StudyGoal {
  id: string;
  weekStart: string;
  subject: string;
  material: string;
  range: string;
  /** Kept only for older saved goals; calendar events now determine study time. */
  estimatedMinutes?: number;
  completed: boolean;
}

export interface PlannerState {
  version: 3;
  categories: EventCategory[];
  hiddenCategoryIds?: string[];
  subjects?: string[];
  events: ScheduleEvent[];
  goals: StudyGoal[];
  isDemo: boolean;
}

export interface DaySummary {
  date: string;
  availableMinutes: number;
  busyMinutes: number;
  events: ScheduleEvent[];
  freeSlots: { start: number; end: number }[];
}

export interface StudyPlanSummary {
  plannedMinutes: number;
  subjects: { subject: string; plannedMinutes: number }[];
  days: { date: string; plannedMinutes: number }[];
}

export const DEFAULT_SUBJECTS: string[] = ['국어', '수학', '영어', '과학', '사회', '한국사'];

export const DEFAULT_EVENT_CATEGORIES: EventCategory[] = [
  { id: 'school', label: '학교 수업', color: '#6d8ec7' },
  { id: 'academy', label: '학원', color: '#9b79cf' },
  { id: 'academic', label: '학사일정', color: '#db9b4c' },
  { id: 'personal', label: '개인 일정', color: '#809387' },
];
