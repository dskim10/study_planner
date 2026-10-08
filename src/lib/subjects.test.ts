import { describe, expect, it } from 'vitest';
import { DEFAULT_SUBJECTS } from '../types';
import { createDemoState, createEmptyState, getStudyPlanSummary, getWeekSummary } from './planner';
import { isPlannerState, readPlannerState } from './storage';
import { addSubject, getSubjectError, getSubjects, isSubjectCategory, normalizeSubjectName, removeSubject, renameSubject, syncSubjectCategories } from './subjects';
import { getCategoryError, removeCategory } from './categories';

describe('registered subjects', () => {
  it('synchronizes missing categories deterministically and idempotently, keeping inputs unchanged', () => {
    const original = { ...createEmptyState(), categories: [], subjects: ['수학', 'Reading', '\ud800'] };
    const before = structuredClone(original);
    const first = syncSubjectCategories(original);
    const second = syncSubjectCategories(structuredClone(original));
    expect(first.categories).toEqual(second.categories);
    expect(first.categories.map((category) => category.label)).toEqual(original.subjects);
    expect(new Set(first.categories.map((category) => category.id)).size).toBe(3);
    expect(first.categories.every((category) => /^#[a-f\d]{6}$/i.test(category.color))).toBe(true);
    expect(syncSubjectCategories(first)).toBe(first);
    expect(first.events).toBe(original.events);
    expect(first.goals).toBe(original.goals);
    expect(first).not.toHaveProperty('hiddenCategoryIds');
    expect(original).toEqual(before);
  });

  it('reuses normalized matching categories with their colors and filters and avoids unrelated ID collisions', () => {
    const empty = { ...createEmptyState(), categories: [], subjects: ['Reading', '수학'], hiddenCategoryIds: [] as string[] };
    const generatedMath = syncSubjectCategories({ ...empty, subjects: ['수학'] }).categories[0];
    const existing = { id: 'user-reading', label: ' ＲＥＡＤＩＮＧ ', color: '#123ABC' };
    const other = { id: generatedMath.id, label: '운동', color: '#654321' };
    const state = { ...empty, categories: [existing, other], hiddenCategoryIds: [existing.id, other.id] };
    const synced = syncSubjectCategories(state);
    expect(synced.categories.slice(0, 2)).toEqual([existing, other]);
    expect(synced.categories.filter((category) => normalizeSubjectName(category.label) === 'reading')).toHaveLength(1);
    expect(synced.categories[2]).toMatchObject({ id: `${generatedMath.id}-2`, label: '수학' });
    expect(synced.hiddenCategoryIds).toEqual([existing.id, other.id]);
    expect(syncSubjectCategories(structuredClone(state))).toEqual(synced);
    expect(isSubjectCategory(existing, ['reading'])).toBe(true);
    expect(() => removeCategory(synced, existing.id)).toThrow('과목 관리');
  });

  it('leaves explicit empty subjects/categories empty and makes a newly added subject visible', () => {
    const state = { ...createEmptyState(), subjects: [], categories: [], hiddenCategoryIds: [] };
    expect(syncSubjectCategories(state)).toBe(state);
    const added = addSubject(state, ' 독서 ');
    expect(added.categories).toHaveLength(1);
    expect(added.categories[0].label).toBe('독서');
    expect(added.hiddenCategoryIds).toEqual([]);
    const removed = removeSubject(added, '독서');
    expect(removed.categories).toBe(added.categories);
    expect(isSubjectCategory(removed.categories[0], getSubjects(removed))).toBe(false);
    expect(syncSubjectCategories(removed)).toBe(removed);
    expect(removeCategory(removed, removed.categories[0].id).categories).toEqual([]);
  });

  it('preserves 40-character subject categories after unlinking without widening manual creation', () => {
    const name = '가'.repeat(40);
    const state = addSubject(createEmptyState(), name);
    const category = state.categories.find((item) => item.label === name)!;
    expect(getCategoryError(category, [])).toContain('30자');
    expect(getCategoryError(category, [], 40)).toBeNull();
    expect(readPlannerState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    const unlinked = removeSubject(state, name);
    expect(readPlannerState(JSON.parse(JSON.stringify(unlinked)))).toEqual(unlinked);
    expect(removeCategory(unlinked, category.id).categories).not.toContainEqual(category);
    expect(addSubject(unlinked, name).categories).toEqual(state.categories);
  });

  it.each([[false, false], [false, true], [true, false], [true, true]])('merges renamed category collisions safely with source hidden=%s and target hidden=%s', (sourceHidden, targetHidden) => {
    const state = createDemoState('2026-10-05');
    const source = state.categories.find((category) => category.label === '수학')!;
    const destination = { id: 'existing-advanced', label: '미적분', color: '#123456' };
    state.categories.push(destination);
    state.events.push({ ...state.events[0], id: 'target-event', type: destination.id, allDay: true });
    state.hiddenCategoryIds = ['school', ...(sourceHidden ? [source.id] : []), ...(targetHidden ? [destination.id] : [])];
    const before = structuredClone(state);
    const renamed = renameSubject(state, '수학', '미적분');
    expect(renamed.categories).toEqual(state.categories.filter((category) => category.id !== source.id));
    expect(renamed.categories.find((category) => category.id === destination.id)).toEqual(destination);
    expect(renamed.events).toEqual(state.events.map((event) => event.type === source.id ? { ...event, type: destination.id } : event));
    expect(renamed.events).toHaveLength(state.events.length);
    expect(renamed.hiddenCategoryIds).toEqual(['school', ...(sourceHidden && targetHidden ? [destination.id] : [])]);
    expect(renamed.goals).toEqual(state.goals.map((goal) => goal.subject === '수학' ? { ...goal, subject: '미적분' } : goal));
    expect(readPlannerState(JSON.parse(JSON.stringify(renamed)))).toEqual(renamed);
    expect(state).toEqual(before);
  });

  it('renames a legacy unsynchronized subject and handles case-only renames without duplicate categories', () => {
    const state = { ...createEmptyState(), subjects: ['Reading'], categories: [] };
    const synced = syncSubjectCategories(state);
    const renamed = renameSubject(state, 'reading', 'ＲＥＡＤＩＮＧ');
    expect(renamed.categories).toEqual([{ ...synced.categories[0], label: 'ＲＥＡＤＩＮＧ' }]);
    expect(renamed.subjects).toEqual(['ＲＥＡＤＩＮＧ']);
    expect(syncSubjectCategories(renamed)).toBe(renamed);
  });

  it('normalizes whitespace, Unicode compatibility and case for matching', () => {
    expect(normalizeSubjectName('  ＭＡＴＨ  ')).toBe('math');
    expect(getSubjectError(' math ', ['Ｍａｔｈ'])).not.toBeNull();
    expect(getSubjectError(' math ', ['Ｍａｔｈ'], 'Math')).toBeNull();
    for (const name of ['', '   ', '가'.repeat(41)]) expect(getSubjectError(name, [])).not.toBeNull();
  });

  it('preserves explicit empty lists and derives legacy subjects from all weeks without mutating inputs', () => {
    const state = createDemoState('2026-10-05');
    delete state.subjects;
    state.goals.push({ ...state.goals[0], id: 'extra', weekStart: '2026-10-12', subject: ' Reading ' });
    state.goals.push({ ...state.goals[0], id: 'duplicate', subject: 'ＲＥＡＤＩＮＧ' });
    const before = structuredClone(state);
    expect(getSubjects(state)).toEqual([...DEFAULT_SUBJECTS, 'Reading']);
    expect(state).toEqual(before);
    expect(getSubjects({ ...state, subjects: [] })).toEqual([]);
  });

  it('adds a trimmed subject to a planner whose final subject was deleted', () => {
    const empty = { ...createEmptyState(), subjects: [] };
    const added = addSubject(empty, '  독서  ');
    expect(added.subjects).toEqual(['독서']);
    expect(empty.subjects).toEqual([]);
    expect(readPlannerState(JSON.parse(JSON.stringify(added)))).toEqual(added);
    expect(() => addSubject(added, '독서')).toThrow();
    expect(() => addSubject(added, ' ')).toThrow();
  });

  it('renames all matching goals and the linked category while preserving schedules and category identity', () => {
    const state = createDemoState('2026-10-05');
    state.goals.push({ ...state.goals[0], id: 'next', weekStart: '2026-10-12', subject: ' 수학 ', estimatedMinutes: 53 });
    const before = structuredClone(state);
    state.hiddenCategoryIds = ['study-math'];
    const renamed = renameSubject(state, '수학', ' 수학 심화 ');
    expect(renamed.subjects).toContain('수학 심화');
    expect(renamed.subjects).not.toContain('수학');
    expect(renamed.goals.filter((goal) => normalizeSubjectName(goal.subject) === '수학')).toEqual([]);
    expect(renamed.goals.find((goal) => goal.id === 'next')).toMatchObject({ subject: '수학 심화', estimatedMinutes: 53 });
    expect(renamed.events).toBe(state.events);
    expect(renamed.categories).toEqual(state.categories.map((category) => category.id === 'study-math' ? { ...category, label: '수학 심화' } : category));
    expect(renamed.hiddenCategoryIds).toEqual(['study-math']);
    expect(state).toEqual({ ...before, hiddenCategoryIds: ['study-math'] });
    expect(isPlannerState(renamed)).toBe(true);
    const summary = getStudyPlanSummary(getWeekSummary('2026-10-05', renamed.events), renamed.categories, renamed.subjects!);
    expect(summary.subjects.find((item) => item.subject === '수학 심화')?.plannedMinutes).toBe(180);
  });

  it('transfers all matching goals to an existing subject without changing unrelated fields', () => {
    const state = createDemoState('2026-10-05');
    const moved = removeSubject(state, '수학', ' 영어 ');
    expect(moved.goals).toEqual(state.goals.map((goal) => goal.subject === '수학' ? { ...goal, subject: '영어' } : goal));
    expect(moved.subjects).not.toContain('수학');
    expect(moved.events).toBe(state.events);
    expect(moved.categories).toBe(state.categories);
    expect(isPlannerState(moved)).toBe(true);
  });

  it('deletes subject goals explicitly while preserving calendar schedules through the final subject deletion', () => {
    const state = createDemoState('2026-10-05');
    const removed = removeSubject(state, '수학');
    expect(removed.goals).toEqual(state.goals.filter((goal) => goal.subject !== '수학'));
    const empty = getSubjects(state).reduce((current, subject) => removeSubject(current, subject), state);
    expect(empty.subjects).toEqual([]);
    expect(empty.goals).toEqual([]);
    expect(empty.events).toBe(state.events);
    expect(empty.categories).toBe(state.categories);
    expect(readPlannerState(JSON.parse(JSON.stringify(empty)))).toEqual(empty);
  });

  it('rejects missing subjects, duplicate renames and invalid transfers before changing data', () => {
    const state = createDemoState('2026-10-05');
    const before = structuredClone(state);
    for (const change of [
      () => renameSubject(state, '미등록', '독서'), () => renameSubject(state, '수학', '영어'),
      () => renameSubject(state, '수학', ''), () => removeSubject(state, '미등록'),
      () => removeSubject(state, '수학', '미등록'), () => removeSubject(state, '수학', ' 수학 '),
    ]) expect(change).toThrow();
    expect(state).toEqual(before);
  });
});
