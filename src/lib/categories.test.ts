import { describe, expect, it } from 'vitest';
import type { EventCategory } from '../types';
import { DEFAULT_EVENT_CATEGORIES } from '../types';
import { getCategoryError, removeCategory, updateCategoryColor } from './categories';
import { createDemoState, getStudyPlanSummary, getWeekSummary } from './planner';
import { isPlannerState, readPlannerState } from './storage';
import { addSubject, isSubjectCategory, removeSubject, renameSubject, syncSubjectCategories } from './subjects';

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

describe('event category color changes', () => {
  it.each(['school', 'exercise', 'study-math'])('changes only the display color for %s, including protected subject categories', (categoryId) => {
    const state = sample();
    const original = structuredClone(state);
    const updated = updateCategoryColor(state, categoryId, '#A1B2C3');
    expect(updated.categories).toEqual(state.categories.map((category) => category.id === categoryId ? { ...category, color: '#a1b2c3' } : category));
    expect(updated.events).toBe(state.events);
    expect(updated.goals).toBe(state.goals);
    expect(updated.subjects).toBe(state.subjects);
    expect(updated.hiddenCategoryIds).toBe(state.hiddenCategoryIds);
    expect(updated.isDemo).toBe(false);
    expect(readPlannerState(JSON.parse(JSON.stringify(updated)))).toEqual(updated);
    expect(state).toEqual(original);
  });

  it('rejects missing categories and invalid color formats without changing data', () => {
    const state = sample();
    const original = structuredClone(state);
    for (const id of ['missing', '', ' school ']) expect(() => updateCategoryColor(state, id, '#123456')).toThrow('일정 종류를 찾을 수 없어요');
    for (const color of ['', 'red', '#fff', '#12345678', '123456', '#12345g', '#123456\n', ' #123456', '#123456 ']) {
      expect(() => updateCategoryColor(state, 'school', color)).toThrow('올바른 색상');
    }
    expect(state).toEqual(original);
  });

  it('retains a 40-character subject category color through sync, rename, subject removal, and reload', () => {
    const subject = '가'.repeat(40);
    const state = addSubject(sample(), subject);
    const linked = state.categories.find((category) => category.label === subject)!;
    const updated = updateCategoryColor(state, linked.id, '#ABCDEF');
    expect(syncSubjectCategories(updated)).toBe(updated);
    const renamed = renameSubject(updated, subject, '나'.repeat(40));
    expect(renamed.categories.find((category) => category.id === linked.id)).toEqual({ ...linked, label: '나'.repeat(40), color: '#abcdef' });
    const unlinked = removeSubject(renamed, '나'.repeat(40));
    const recolored = updateCategoryColor(unlinked, linked.id, '#123456');
    expect(readPlannerState(JSON.parse(JSON.stringify(recolored)))).toEqual(recolored);
    expect(recolored.categories.find((category) => category.id === linked.id)?.color).toBe('#123456');
    expect(recolored.events).toBe(state.events);
  });

  it('keeps hidden repeating events, all-day schedules, available time, and planned time unchanged', () => {
    const state = sample();
    state.hiddenCategoryIds!.push('study-math');
    const updated = ['exercise', 'academic', 'study-math'].reduce((current, id) => updateCategoryColor(current, id, '#345678'), state);
    expect(updated.hiddenCategoryIds).toEqual(state.hiddenCategoryIds);
    expect(updated.events).toEqual(state.events);
    for (const week of ['2026-10-05', '2026-10-12', '2026-11-02']) {
      const before = getWeekSummary(week, state.events);
      const after = getWeekSummary(week, updated.events);
      expect(after).toEqual(before);
      expect(getStudyPlanSummary(after, updated.categories, updated.subjects!)).toEqual(getStudyPlanSummary(before, state.categories, state.subjects!));
    }
  });
});

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

  it('keeps linked subject categories and goals while allowing all ordinary categories to be removed', () => {
    const state = sample();
    const ordinary = state.categories.filter((category) => !isSubjectCategory(category, state.subjects!));
    const removed = ordinary.reduce((current, item) => removeCategory(current, item.id), state);
    expect(removed.categories).toEqual(state.categories.filter((category) => isSubjectCategory(category, state.subjects!)));
    expect(removed.events).toEqual(state.events.filter((event) => removed.categories.some((category) => category.id === event.type)));
    expect(removed.goals).toEqual(state.goals);
    expect(removed.hiddenCategoryIds).toEqual([]);
    expect(isPlannerState(removed)).toBe(true);
  });

  it('blocks deletion of linked categories even with a transfer destination, then unlocks after subject removal', () => {
    const state = sample();
    const linked = state.categories.find((category) => category.label === '수학')!;
    expect(() => removeCategory(state, linked.id)).toThrow('과목 관리');
    expect(() => removeCategory(state, linked.id, 'school')).toThrow('과목 관리');
    const unlinked = removeSubject(state, '수학', '영어');
    const removed = removeCategory(unlinked, linked.id, 'school');
    expect(removed.events).toEqual(state.events.map((event) => event.type === linked.id ? { ...event, type: 'school' } : event));
    expect(removed.goals).toEqual(unlinked.goals);
    expect(isPlannerState(removed)).toBe(true);
  });

  it('can move an ordinary category into a protected subject category', () => {
    const state = sample();
    const linked = state.categories.find((category) => category.label === '수학')!;
    const removed = removeCategory(state, 'exercise', linked.id);
    expect(removed.events.find((event) => event.id === 'run')?.type).toBe(linked.id);
    expect(removed.categories).toContainEqual(linked);
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
