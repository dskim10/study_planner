import { describe, expect, it } from 'vitest';
import { createDemoState, createEmptyState, getWeekSummary } from './planner';
import { isPlannerState, readPlannerState, STORAGE_KEY } from './storage';
import { DEFAULT_EVENT_CATEGORIES, DEFAULT_SUBJECTS } from '../types';
import { createCustomRecurrence } from './recurrence';
import { removeCategory } from './categories';
import { isSubjectCategory, syncSubjectCategories } from './subjects';

const sample = () => {
  const state = createDemoState('2026-10-05');
  // Keep this fixture readable by legacy versions, which only knew default categories.
  state.categories = DEFAULT_EVENT_CATEGORIES.map((category) => ({ ...category }));
  state.events = state.events.filter((event) => state.categories.some((category) => category.id === event.type));
  return syncSubjectCategories(state);
};

describe('stored planner data validation', () => {
  it('accepts a JSON round trip of both the fictional example and empty state', () => {
    for (const state of [sample(), createDemoState('2026-10-05'), createEmptyState()]) {
      const restored: unknown = JSON.parse(JSON.stringify(state));
      expect(isPlannerState(restored)).toBe(true);
    }
  });

  it('rejects wrong versions, missing fields, arrays and malformed root values', () => {
    for (const value of [null, undefined, [], 'planner', 1, {}, { ...sample(), version: 1 }, { ...sample(), version: 2 }, { ...sample(), version: 4 }, { ...sample(), isDemo: 'true' }, { ...sample(), events: {} }, { ...sample(), goals: null }]) {
      expect(isPlannerState(value)).toBe(false);
    }
  });

  it('accepts 24:00 as an event end while keeping start times inside the day', () => {
    const state = sample();
    expect(isPlannerState({ ...state, events: [{ ...state.events[0], startTime: '23:59', endTime: '24:00' }] })).toBe(true);
    expect(isPlannerState({ ...state, events: [{ ...state.events[0], startTime: '00:00', endTime: '24:00' }] })).toBe(true);
    expect(isPlannerState({ ...state, events: [{ ...state.events[0], startTime: '24:00', endTime: '24:00' }] })).toBe(false);
  });

  it('rejects nonexistent dates, malformed times and overnight timed events', () => {
    const state = sample();
    for (const change of [
      { date: '2026-02-29' }, { date: '2026-04-31' }, { date: '2026-13-01' }, { date: '2026-10-00' },
      { startTime: '09:60' }, { endTime: '24:01' }, { endTime: '24:30' }, { startTime: '23:00', endTime: '07:00' },
      { startTime: '09:00', endTime: '09:00' },
    ]) expect(isPlannerState({ ...state, events: [{ ...state.events[0], ...change }] })).toBe(false);
  });

  it('requires supported event types and actual booleans', () => {
    const state = sample();
    for (const change of [{ type: 'unknown' }, { type: 'toString' }, { id: '' }, { title: '  ' }, { allDay: 'false' }]) {
      expect(isPlannerState({ ...state, events: [{ ...state.events[0], ...change }] })).toBe(false);
    }
  });

  it('preserves custom categories and event references through a JSON save and reload', () => {
    const state = sample();
    state.categories.push({ id: 'exercise', label: '운동', color: '#2D8C72' });
    state.events.push({ ...state.events[0], id: 'run', title: '달리기', type: 'exercise' });
    const restored = readPlannerState(JSON.parse(JSON.stringify(state)));
    expect(restored).toEqual(state);
    expect(isPlannerState(restored)).toBe(true);
    expect(getWeekSummary('2026-10-05', restored!.events)).toEqual(getWeekSummary('2026-10-05', state.events));
  });

  it('keeps deleted default categories absent after saving and reloading version 3', () => {
    const original = sample();
    const removed = removeCategory(removeCategory(original, 'school', 'academy'), 'academic');
    expect(readPlannerState(JSON.parse(JSON.stringify(removed)))).toEqual(removed);
    expect(removed.categories.filter((item) => !isSubjectCategory(item, removed.subjects!)).map((item) => item.id)).toEqual(['academy', 'personal']);
    expect(removed.goals).toEqual(original.goals);
  });

  it('round-trips a planner with no categories or events without resurrecting defaults', () => {
    const original = sample();
    original.subjects = [];
    original.goals = [];
    original.hiddenCategoryIds = original.categories.map((item) => item.id);
    const removed = original.categories.reduce((current, item) => removeCategory(current, item.id), original);
    const restored = readPlannerState(JSON.parse(JSON.stringify(removed)));
    expect(isPlannerState(removed)).toBe(true);
    expect(restored).toEqual(removed);
    expect(restored?.categories).toEqual([]);
    expect(restored?.hiddenCategoryIds).toEqual([]);
    expect(restored?.goals).toEqual(original.goals);
    expect(isPlannerState({ ...removed, events: [original.events[0]] })).toBe(false);
    expect(isPlannerState({ ...removed, hiddenCategoryIds: ['school'] })).toBe(false);
  });

  it('rejects missing, malformed, duplicate, and invalid categories without repairing current data', () => {
    const state = sample();
    for (const categories of [
      undefined, null, {}, [], [null], [{ id: 'school', label: 3, color: '#6d8ec7' }],
      [...state.categories, { id: 'exercise', label: '운동', color: 'red' }],
      [...state.categories, { id: 'exercise', label: '  ', color: '#2d8c72' }],
      [...state.categories, { id: 'exercise', label: '가'.repeat(41), color: '#2d8c72' }],
      [...state.categories, { id: ' ', label: '운동', color: '#2d8c72' }],
      [...state.categories, { id: 'school', label: '운동', color: '#2d8c72' }],
      [...state.categories, { id: 'duplicate', label: ' 학교 수업 ', color: '#2d8c72' }],
      [...state.categories, { id: 'club', label: 'Club', color: '#2d8c72' }, { id: 'club2', label: 'ＣＬＵＢ', color: '#2d8c72' }],
    ]) {
      expect(isPlannerState({ ...state, categories })).toBe(false);
      expect(readPlannerState({ ...state, categories })).toBeNull();
    }
    expect(readPlannerState({ ...state, categories: state.categories.filter((category) => category.id !== 'school') })).toBeNull();
  });

  it('preserves hidden categories, including custom categories and hiding every category, on reload', () => {
    const state = sample();
    state.categories.push({ id: 'exercise', label: '운동', color: '#2D8C72' });
    for (const hiddenCategoryIds of [[], ['school'], ['exercise', 'academy'], state.categories.map((category) => category.id)]) {
      const saved = { ...state, hiddenCategoryIds };
      const restored = readPlannerState(JSON.parse(JSON.stringify(saved)));
      expect(isPlannerState(saved)).toBe(true);
      expect(restored).toEqual(saved);
      expect(getWeekSummary('2026-10-05', restored!.events)).toEqual(getWeekSummary('2026-10-05', state.events));
    }
  });

  it('rejects malformed, duplicate, and unknown hidden category IDs without discarding the preference', () => {
    const state = sample();
    for (const hiddenCategoryIds of [null, {}, 'school', [null], [1], [''], [' school '], ['missing'], ['school', 'school']]) {
      const saved = { ...state, hiddenCategoryIds };
      expect(isPlannerState(saved)).toBe(false);
      expect(readPlannerState(saved)).toBeNull();
    }
  });

  it('requires weekday selections and an inclusive, correctly ordered repeat end', () => {
    const state = sample();
    for (const change of [
      { recurrence: 'unsupported' }, { weekdays: [] }, { weekdays: [7] }, { weekdays: [-1] }, { weekdays: [1, 1] },
      { weekdays: [1.5] }, { weekdays: ['1'] }, { repeatUntil: '2026-10-04' }, { repeatUntil: '2026-02-30' },
    ]) expect(isPlannerState({ ...state, events: [{ ...state.events[0], ...change }] })).toBe(false);
    expect(isPlannerState({ ...state, events: [{ ...state.events[0], repeatUntil: '2026-10-05' }] })).toBe(true);
    expect(isPlannerState({ ...state, events: [{ ...state.events[0], repeatUntil: undefined }] })).toBe(true);
  });

  it('restores every preset and custom end condition without changing saved rules', () => {
    const state = sample();
    for (const recurrence of ['none', 'daily', 'weekly', 'monthly', 'weekdays'] as const) {
      const saved = { ...state, events: [{ ...state.events[0], recurrence }] };
      expect(readPlannerState(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    }
    for (const end of [{ type: 'never' }, { type: 'until', date: '2027-01-04' }, { type: 'count', count: 13 }] as const) {
      const saved = { ...state, events: [{ ...state.events[0], recurrence: 'custom', repeatUntil: undefined, customRecurrence: { ...createCustomRecurrence('2026-10-05'), interval: 2, weekdays: [1, 3], end } }] };
      expect(readPlannerState(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    }
  });

  it('rejects missing and invalid custom rules before they reach calendar calculations', () => {
    const state = sample();
    const rule = createCustomRecurrence('2026-10-05');
    for (const customRecurrence of [
      undefined, null, {}, { ...rule, interval: 0 }, { ...rule, interval: 1.5 }, { ...rule, interval: 1000 },
      { ...rule, unit: 'hour' }, { ...rule, weekdays: [] }, { ...rule, weekdays: [8] }, { ...rule, weekdays: [1, 1] },
      { ...rule, monthPattern: 'unknown' }, { ...rule, end: { type: 'count', count: 0 } },
      { ...rule, end: { type: 'count', count: 10000 } }, { ...rule, end: { type: 'until', date: '2026-10-04' } },
      { ...rule, end: { type: 'until', date: '2026-02-30' } },
    ]) {
      const saved = { ...state, events: [{ ...state.events[0], recurrence: 'custom', customRecurrence }] };
      expect(isPlannerState(saved)).toBe(false);
      expect(readPlannerState(saved)).toBeNull();
    }
  });

  it('accepts overlapping schedules and all-day events as valid inputs to the calculation layer', () => {
    const state = sample();
    state.events = [
      { ...state.events[0], id: 'first', startTime: '09:00', endTime: '12:00' },
      { ...state.events[0], id: 'overlap', startTime: '11:00', endTime: '13:00' },
      { ...state.events[0], id: 'all-day', allDay: true },
    ];
    expect(isPlannerState(state)).toBe(true);
  });

  it('rejects duplicate identities that would make edits or deletes ambiguous', () => {
    const state = sample();
    expect(isPlannerState({ ...state, events: [state.events[0], state.events[0]] })).toBe(false);
    expect(isPlannerState({ ...state, goals: [state.goals[0], state.goals[0]] })).toBe(false);
  });

  it('requires goals to belong to Monday-based weeks and keep all required text', () => {
    const state = sample();
    for (const change of [
      { weekStart: '2026-10-06' }, { weekStart: '2026-02-30' }, { id: '' }, { subject: '' },
      { material: '   ' }, { range: null }, { completed: 'true' },
      { subject: '가'.repeat(41) }, { material: '가'.repeat(121) }, { range: '가'.repeat(201) },
    ]) expect(isPlannerState({ ...state, goals: [{ ...state.goals[0], ...change }] })).toBe(false);
  });

  it('requires positive, safe integer minute values, including for completed goals', () => {
    const state = sample();
    for (const estimatedMinutes of [0, -1, 30.5, '60', 10081, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(isPlannerState({ ...state, goals: [{ ...state.goals[0], completed: true, estimatedMinutes }] })).toBe(false);
    }
    expect(isPlannerState({ ...state, goals: [{ ...state.goals[0], completed: true, estimatedMinutes: 1 }] })).toBe(true);
  });
});

describe('stored planner data migration', () => {
  it('keeps every category visible when existing versions have no visibility preference', () => {
    const state = sample();
    for (const version of [1, 2, 3]) {
      const restored = readPlannerState({ ...state, version });
      expect(restored).toEqual(state);
      expect(restored?.hiddenCategoryIds ?? []).toEqual([]);
    }
  });

  it('reads current data without requiring or retaining activity settings', () => {
    const state = sample();
    expect(readPlannerState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(readPlannerState({ ...state, settings: { dayStart: '09:00', dayEnd: '10:00' } })).toEqual(state);
  });

  it('keeps the legacy storage key so existing plans remain discoverable', () => {
    expect(STORAGE_KEY).toBe('chagok-planner-v1');
  });

  it('preserves legacy schedules and goals while removing a narrow activity window', () => {
    const state = sample();
    state.isDemo = false;
    state.events = [
      { ...state.events[0], id: 'saved-early', startTime: '00:30', endTime: '01:30' },
      { ...state.events[0], id: 'saved-late', startTime: '23:00', endTime: '23:59' },
    ];
    const legacy = { ...state, version: 1, settings: { dayStart: '09:00', dayEnd: '10:00' } };
    const original = structuredClone(legacy);
    const restored = readPlannerState(legacy);
    expect(restored).toEqual(state);
    expect(restored).not.toHaveProperty('settings');
    expect(legacy).toEqual(original);
    expect(isPlannerState(legacy)).toBe(false);
    const monday = getWeekSummary('2026-10-05', restored!.events)[0];
    expect(monday.busyMinutes).toBe(119);
    expect(monday.availableMinutes).toBe(1321);
  });

  it('preserves an empty legacy planner with a full 168-hour week', () => {
    const restored = readPlannerState({ version: 1, events: [], goals: [], isDemo: false, settings: { dayStart: '07:00', dayEnd: '23:00' } });
    expect(restored).toEqual(createEmptyState());
    expect(getWeekSummary('2026-10-05', restored!.events).reduce((sum, day) => sum + day.availableMinutes, 0)).toBe(10080);
  });

  it('upgrades version 2 plans with default categories and preserves every existing schedule and goal', () => {
    const { events, goals, isDemo } = sample();
    const legacy = { version: 2, events, goals, isDemo };
    const original = structuredClone(legacy);
    const restored = readPlannerState(legacy);
    expect(restored).toEqual({ ...createEmptyState(), events, goals, isDemo });
    expect(legacy).toEqual(original);
    restored!.categories[0].label = '다른 이름';
    expect(readPlannerState(legacy)!.categories[0].label).toBe('학교 수업');
    expect(createEmptyState().categories[0].label).toBe('학교 수업');
  });

  it('rejects unknown legacy event types instead of inventing category data', () => {
    const state = sample();
    for (const version of [1, 2]) {
      expect(readPlannerState({ ...state, version, events: [{ ...state.events[0], type: 'unregistered' }] })).toBeNull();
    }
  });

  it('rejects corrupt records and unsupported versions during migration', () => {
    const legacy = { ...sample(), version: 1, settings: { dayStart: '07:00', dayEnd: '23:00' } };
    for (const value of [
      null, undefined, [], 'planner', 1, {}, { ...legacy, version: 0 }, { ...legacy, version: 4 },
      { ...legacy, events: null }, { ...legacy, goals: {} }, { ...legacy, isDemo: 'false' },
      { ...legacy, events: [{ ...legacy.events[0], endTime: '24:01' }] },
      { ...legacy, goals: [{ ...legacy.goals[0], material: '' }] },
    ]) expect(readPlannerState(value)).toBeNull();
  });
});

describe('saved subjects and legacy goal estimates', () => {
  it('adds only subject categories to an old empty category list and keeps intentionally removed defaults absent', () => {
    const state = { ...createEmptyState(), categories: [], subjects: ['수학'] };
    const original = structuredClone(state);
    const restored = readPlannerState(state)!;
    expect(restored.categories.map((category) => category.label)).toEqual(['수학']);
    expect(restored.categories.some((category) => category.id === 'school')).toBe(false);
    expect(readPlannerState(JSON.parse(JSON.stringify(restored)))).toEqual(restored);
    expect(state).toEqual(original);
  });

  it('validates raw event references before adding missing categories', () => {
    const state = { ...createEmptyState(), categories: [], subjects: ['수학'] };
    const generated = syncSubjectCategories(state).categories[0];
    expect(readPlannerState({ ...state, events: [{ ...sample().events[0], type: generated.id }] })).toBeNull();
  });

  it('adds default and normalized-unique existing goal subjects when the list is missing in every supported version', () => {
    const state = sample();
    const goals = [
      { ...state.goals[0], id: 'first', subject: '  Reading  ', estimatedMinutes: 75 },
      { ...state.goals[0], id: 'second', weekStart: '2026-10-12', subject: 'ＲＥＡＤＩＮＧ', estimatedMinutes: 30 },
      { ...state.goals[0], id: 'default', subject: '수학' },
    ];
    for (const version of [1, 2, 3]) {
      const legacy = { ...state, version, subjects: undefined, goals };
      const original = structuredClone(legacy);
      const restored = readPlannerState(legacy);
      expect(restored?.subjects).toEqual([...DEFAULT_SUBJECTS, 'Reading']);
      expect(restored?.goals).toEqual(goals);
      expect(restored?.events).toEqual(state.events);
      expect(legacy).toEqual(original);
    }
  });

  it('round-trips explicit empty subjects without resurrecting defaults and rejects orphaned goals', () => {
    const state = { ...createEmptyState(), subjects: [] };
    expect(readPlannerState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(isPlannerState({ ...state, goals: [sample().goals[0]] })).toBe(false);
    expect(readPlannerState({ ...state, goals: [sample().goals[0]] })).toBeNull();
  });

  it('rejects malformed and untrimmed subject lists and normalized duplicates without repairing data', () => {
    for (const subjects of [null, {}, '수학', [null], [1], [''], ['  '], [' 수학'], ['수학 '], ['가'.repeat(41)], ['수학', '수학'], ['Reading', 'ＲＥＡＤＩＮＧ']]) {
      const state = { ...createEmptyState(), subjects };
      expect(isPlannerState(state)).toBe(false);
      expect(readPlannerState(state)).toBeNull();
    }
  });

  it('requires goal subjects to match registered names after normalization', () => {
    const state = { ...sample(), subjects: ['Reading'], goals: [{ ...sample().goals[0], subject: ' ｒｅａｄｉｎｇ ' }] };
    expect(readPlannerState(state)).toEqual(syncSubjectCategories(state));
    expect(readPlannerState({ ...state, subjects: ['국어'] })).toBeNull();
  });

  it('accepts new goals without estimates while retaining valid old estimates exactly', () => {
    const state = sample();
    expect(state.goals.every((goal) => !Object.hasOwn(goal, 'estimatedMinutes'))).toBe(true);
    expect(readPlannerState(state)).toEqual(state);
    const legacy = { ...state, goals: state.goals.map((goal) => ({ ...goal, estimatedMinutes: 121 })) };
    expect(readPlannerState(legacy)?.goals).toEqual(legacy.goals);
    expect(readPlannerState({ ...state, goals: [{ ...state.goals[0], estimatedMinutes: null }] })).toBeNull();
  });
});
