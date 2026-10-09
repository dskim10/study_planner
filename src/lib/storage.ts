import type { EventCategory, PlannerState, ScheduleEvent, StudyGoal } from '../types';
import { DEFAULT_EVENT_CATEGORIES } from '../types';
import { getCategoryError } from './categories';
import { validateCustomRecurrence } from './recurrence';
import { isCalendarPrintRange } from './calendar-print-range';
import { getSubjectError, normalizeSubjectName, syncSubjectCategories } from './subjects';

// Keep the legacy key across app renames and schema migrations to preserve existing plans.
export const STORAGE_KEY = 'chagok-planner-v1';
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const time = (value: unknown): value is string => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
function date(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00`);
  return !Number.isNaN(parsed.getTime()) && parsed.getFullYear() === Number(value.slice(0, 4)) && parsed.getMonth() + 1 === Number(value.slice(5, 7)) && parsed.getDate() === Number(value.slice(8, 10));
}
function validEvent(value: unknown, categoryIds: Set<string>): value is ScheduleEvent {
  if (!object(value)) return false;
  if (!(text(value.id) && text(value.title) && value.title.length <= 80 && typeof value.type === 'string' && categoryIds.has(value.type) && date(value.date) && time(value.startTime) && (time(value.endTime) || value.endTime === '24:00') && typeof value.allDay === 'boolean' && (value.allDay || value.startTime < value.endTime))) return false;
  if (typeof value.recurrence !== 'string' || !['none', 'daily', 'weekly', 'monthly', 'weekdays', 'custom'].includes(value.recurrence)) return false;
  if (!Array.isArray(value.weekdays) || !value.weekdays.every(day => Number.isInteger(day) && day >= 0 && day <= 6) || new Set(value.weekdays).size !== value.weekdays.length) return false;
  if (value.recurrence === 'weekly' && value.weekdays.length === 0) return false;
  if (value.repeatUntil !== undefined && (!date(value.repeatUntil) || value.repeatUntil < value.date)) return false;
  if ((value.recurrence === 'custom' || value.customRecurrence !== undefined) && validateCustomRecurrence(value.customRecurrence, value.date)) return false;
  const startDate = value.date;
  if (value.excludedDates !== undefined && (value.recurrence === 'none' || !Array.isArray(value.excludedDates)
    || !value.excludedDates.every((excluded) => date(excluded) && excluded >= startDate)
    || new Set(value.excludedDates).size !== value.excludedDates.length)) return false;
  return true;
}
function validGoal(value: unknown): value is StudyGoal {
  if (!object(value)) return false;
  return text(value.id) && date(value.weekStart) && new Date(`${value.weekStart}T12:00:00`).getDay() === 1 && text(value.subject) && value.subject.length <= 40 && text(value.material) && value.material.length <= 120 && text(value.range) && value.range.length <= 200 && (value.estimatedMinutes === undefined || (typeof value.estimatedMinutes === 'number' && Number.isSafeInteger(value.estimatedMinutes) && value.estimatedMinutes > 0 && value.estimatedMinutes <= 10080)) && typeof value.completed === 'boolean';
}
export function isPlannerState(value: unknown): value is PlannerState {
  if (!object(value) || value.version !== 3 || typeof value.isDemo !== 'boolean') return false;
  if (value.calendarPrintRange !== undefined && !isCalendarPrintRange(value.calendarPrintRange)) return false;
  if (!Array.isArray(value.categories)) return false;
  const categories: EventCategory[] = [];
  for (const category of value.categories) {
    if (!object(category) || typeof category.id !== 'string' || typeof category.label !== 'string' || typeof category.color !== 'string') return false;
    const candidate = { id: category.id, label: category.label, color: category.color };
    // Synced 40-character subjects remain valid categories even after subject removal.
    // Manual category creation still uses the default 30-character input limit.
    if (getCategoryError(candidate, categories, 40)) return false;
    categories.push(candidate);
  }
  const categoryIds = new Set(categories.map((category) => category.id));
  if (value.hiddenCategoryIds !== undefined && (!Array.isArray(value.hiddenCategoryIds) || !value.hiddenCategoryIds.every((id) => typeof id === 'string' && categoryIds.has(id)) || new Set(value.hiddenCategoryIds).size !== value.hiddenCategoryIds.length)) return false;
  if (!Array.isArray(value.events) || !value.events.every((event): event is ScheduleEvent => validEvent(event, categoryIds)) || new Set(value.events.map(event => event.id)).size !== value.events.length || !Array.isArray(value.goals) || !value.goals.every(validGoal) || new Set(value.goals.map(goal => goal.id)).size !== value.goals.length) return false;
  if (value.subjects !== undefined) {
    if (!Array.isArray(value.subjects)) return false;
    const subjects: string[] = [];
    for (const subject of value.subjects) {
      if (typeof subject !== 'string' || subject !== subject.trim() || getSubjectError(subject, subjects)) return false;
      subjects.push(subject);
    }
    const names = new Set(subjects.map(normalizeSubjectName));
    if (value.goals.some((goal) => !names.has(normalizeSubjectName(goal.subject)))) return false;
  }
  return true;
}

/** Preserve legacy plans, initialize missing categories/subjects, and discard activity hours. */
export function readPlannerState(value: unknown): PlannerState | null {
  if (!object(value) || (value.version !== 1 && value.version !== 2 && value.version !== 3)) return null;
  const categories = value.version === 3 ? value.categories : DEFAULT_EVENT_CATEGORIES.map((category) => ({ ...category }));
  const state = {
    version: 3, categories, events: value.events, goals: value.goals, isDemo: value.isDemo,
    ...(value.version === 3 && value.hiddenCategoryIds !== undefined ? { hiddenCategoryIds: value.hiddenCategoryIds } : {}),
    ...(value.version === 3 && value.calendarPrintRange !== undefined ? { calendarPrintRange: value.calendarPrintRange } : {}),
    ...(value.subjects !== undefined ? { subjects: value.subjects } : {}),
  };
  return isPlannerState(state) ? syncSubjectCategories(state) : null;
}
