import { describe, expect, it } from 'vitest';
import type { EventCategory } from '../types';
import { DEFAULT_EVENT_CATEGORIES } from '../types';
import { getCategoryError, removeCategory } from './categories';
import { createDemoState, getWeekSummary } from './planner';
import { isPlannerState } from './storage';

const category = (changes: Partial<EventCategory> = {}): EventCategory => ({
  id: 'exercise', label: '운동', color: '#2d8c72', ...changes,
});

describe('event category creation', () => {
  it('accepts a custom category name and a six-digit color', () => {
    expect(getCategoryError(category(), DEFAULT_EVENT_CATEGORIES)).toBeNull();
    expect(getCategoryError(category({ label: '가'.repeat(30), color: '#A1B2C3' }), [])).toBeNull();
  });

  it('requires a name within the trimmed 30-character limit', () => {
    expect(getCategoryError(category({ label: '  ' }), [])).toBe('일정 종류 이름을 입력해 주세요.');
    expect(getCategoryError(category({ label: '가'.repeat(31) }), [])).toBe('일정 종류 이름은 30자 이내로 입력해 주세요.');
    expect(getCategoryError(category({ label: ` ${'가'.repeat(30)} ` }), [])).toBeNull();
  });

  it('rejects duplicate names after trimming, Unicode normalization, and case folding', () => {
    const existing = [category({ id: 'sleep', label: '수면' }), category({ id: 'club', label: 'Club' })];
    for (const label of [' 수면 ', '수면', 'club', ' ＣＬＵＢ ']) {
      expect(getCategoryError(category({ label }), existing)).toBe('이미 있는 일정 종류 이름이에요. 다른 이름을 입력해 주세요.');
    }
    expect(getCategoryError(category({ label: ' 학교 수업 ' }), DEFAULT_EVENT_CATEGORIES)).toBeTruthy();
  });

  it('rejects blank or duplicate identities and malformed colors', () => {
    expect(getCategoryError(category({ id: ' ' }), [])).toBeTruthy();
    expect(getCategoryError(category({ id: 'school' }), DEFAULT_EVENT_CATEGORIES)).toBeTruthy();
    for (const color of ['red', '#fff', '#abcdef00', 'abcdef', '#12abgg', '#123456;', '#123456\n']) {
      expect(getCategoryError(category({ color }), [])).toBe('올바른 색상을 선택해 주세요.');
    }
  });
});

function sample() {
  const state = createDemoState('2026-10-05');
  state.categories.push(category());
  state.hiddenCategoryIds = ['school', 'exercise', 'academic'];
  state.events.push({
    id: 'run', title: '달리기', type: 'exercise', date: '2026-10-05', startTime: '06:00', endTime: '06:30',
    allDay: false, recurrence: 'custom', weekdays: [1, 3],
    customRecurrence: { interval: 2, unit: 'week', weekdays: [1, 3], monthPattern: 'dayOfMonth', end: { type: 'count', count: 10 } },
  });
  return state;
}

describe('event category removal', () => {
  it.each(['school', 'academic', 'exercise'])('deletes the %s category and its schedules without changing other data', (categoryId) => {
    const state = sample();
    const original = structuredClone(state);
    const removed = removeCategory(state, categoryId);
    expect(removed.categories).toEqual(state.categories.filter((item) => item.id !== categoryId));
    expect(removed.events).toEqual(state.events.filter((event) => event.type !== categoryId));
    expect(removed.hiddenCategoryIds).toEqual(state.hiddenCategoryIds?.filter((id) => id !== categoryId));
    expect(removed.goals).toEqual(state.goals);
    expect(removed.isDemo).toBe(false);
    expect(isPlannerState(removed)).toBe(true);
    expect(state).toEqual(original);
  });

  it.each(['school', 'academic', 'exercise'])('moves every %s schedule while preserving dates, recurrence, goals, and study time', (categoryId) => {
    const state = sample();
    const original = structuredClone(state);
    const removed = removeCategory(state, categoryId, 'personal');
    expect(removed.categories.some((item) => item.id === categoryId)).toBe(false);
    expect(removed.events).toEqual(state.events.map((event) => event.type === categoryId ? { ...event, type: 'personal' } : event));
    expect(removed.goals).toEqual(state.goals);
    expect(removed.hiddenCategoryIds).toEqual(state.hiddenCategoryIds?.filter((id) => id !== categoryId));
    for (const week of ['2026-10-05', '2026-10-12', '2026-11-02']) {
      expect(getWeekSummary(week, removed.events).map((day) => day.availableMinutes))
        .toEqual(getWeekSummary(week, state.events).map((day) => day.availableMinutes));
    }
    expect(isPlannerState(removed)).toBe(true);
    expect(state).toEqual(original);
  });

  it('keeps the destination category visibility preference when moving events', () => {
    const state = sample();
    const removed = removeCategory(state, 'school', 'exercise');
    expect(removed.hiddenCategoryIds).toEqual(['exercise', 'academic']);
    expect(removed.events.find((event) => event.id === 'demo-school')?.type).toBe('exercise');
  });

  it('allows all default and custom categories to be removed and keeps weekly goals', () => {
    const state = sample();
    const removed = state.categories.reduce((current, item) => removeCategory(current, item.id), state);
    expect(removed).toEqual({ ...state, categories: [], events: [], hiddenCategoryIds: [], isDemo: false });
    expect(getWeekSummary('2026-10-05', removed.events).reduce((sum, day) => sum + day.availableMinutes, 0)).toBe(10080);
    expect(isPlannerState(removed)).toBe(true);
  });

  it('supports existing data without a visibility preference', () => {
    const removed = removeCategory(createDemoState('2026-10-05'), 'school');
    expect(removed).not.toHaveProperty('hiddenCategoryIds');
    expect(isPlannerState(removed)).toBe(true);
  });

  it('rejects missing sources and missing or identical destinations without changing the plan', () => {
    const state = sample();
    const original = structuredClone(state);
    expect(() => removeCategory(state, 'missing')).toThrow('삭제할 일정 종류를 찾을 수 없어요.');
    for (const destination of ['school', 'missing', '']) {
      expect(() => removeCategory(state, 'school', destination)).toThrow('일정을 옮길 다른 종류를 선택해 주세요.');
    }
    expect(state).toEqual(original);
  });
});
