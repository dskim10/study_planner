import { describe, expect, it } from 'vitest';
import type { StudyGoal } from '../types';
import { buildPrintableGoals, paginateGoalRows } from './goal-print';

const weekStart = '2026-10-05';
function goal(id: string, subject: string, overrides: Partial<StudyGoal> = {}): StudyGoal {
  return { id, weekStart, subject, material: `자료 ${id}`, range: `범위 ${id}`, completed: false, ...overrides };
}

describe('printable weekly goals', () => {
  it('includes completed goals for only the selected week in stable registered subject order', () => {
    const goals = [
      goal('english-first', '영어', { completed: true }),
      goal('math-first', '수학'),
      goal('last-week', '수학', { weekStart: '2026-09-28' }),
      goal('english-second', '영어'),
      goal('math-second', '수학', { completed: true, estimatedMinutes: 45 }),
      goal('next-week', '수학', { weekStart: '2026-10-12' }),
    ];
    const printed = buildPrintableGoals(goals, weekStart, ['수학', '국어', '영어']);
    expect(printed.map((item) => item.id)).toEqual(['math-first', 'math-second', 'english-first', 'english-second']);
    expect(printed.filter((item) => item.completed).map((item) => item.id)).toEqual(['math-second', 'english-first']);
    expect(printed[1]).toEqual(goals[4]);
  });

  it('uses canonical subject labels for normalized matches without modifying saved goals or subject order', () => {
    const goals = [goal('english', '  ｅｎｇｌｉｓｈ  '), goal('math', ' 수학 ')];
    const subjects = ['수학', 'English'];
    const before = structuredClone(goals);
    const printed = buildPrintableGoals(goals, weekStart, subjects);
    expect(printed.map(({ id, subject }) => ({ id, subject }))).toEqual([
      { id: 'math', subject: '수학' }, { id: 'english', subject: 'English' },
    ]);
    printed[0].range = '인쇄용 수정';
    expect(goals).toEqual(before);
    expect(subjects).toEqual(['수학', 'English']);
  });

  it('preserves unknown legacy subjects after registered groups without omitting or duplicating rows', () => {
    const goals = [goal('unknown-1', '철학'), goal('english', 'English'), goal('unknown-2', '  논술  '), goal('math', '수학'), goal('unknown-3', '철학')];
    const printed = buildPrintableGoals(goals, weekStart, ['수학', 'English', 'ＥＮＧＬＩＳＨ']);
    expect(printed.map((item) => item.id)).toEqual(['math', 'english', 'unknown-1', 'unknown-2', 'unknown-3']);
    expect(printed[1].subject).toBe('English');
    expect(printed[3].subject).toBe('  논술  ');
    expect(buildPrintableGoals(goals, weekStart, [])).toEqual(goals);
  });

  it('has no rows for an empty week', () => {
    expect(buildPrintableGoals([], weekStart, ['수학'])).toEqual([]);
    expect(buildPrintableGoals([goal('other', '수학')], '2026-10-12', ['수학'])).toEqual([]);
  });
});

describe('measured goal row pagination', () => {
  it('packs exact boundaries and fractional heights greedily while keeping every row in order', () => {
    const rows = ['a', 'b', 'c', 'd', 'e'];
    const heights = [30.25, 69.75, 60, 40.01, 20];
    expect(paginateGoalRows(rows, heights, 100)).toEqual([['a', 'b'], ['c'], ['d', 'e']]);
    expect(rows).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(heights).toEqual([30.25, 69.75, 60, 40.01, 20]);
  });

  it('places oversized rows on their own page without inserting empty pages or consuming later rows', () => {
    const rows = ['large-first', 'small', 'large-middle', 'large-next', 'last', 'large-last'];
    const pages = paginateGoalRows(rows, [101, 20, 200, 150, 30, 101], 100);
    expect(pages).toEqual(rows.map((row) => [row]));
    expect(pages.flat()).toEqual(rows);
    expect(pages.every((page) => page.length > 0)).toBe(true);
  });

  it('preserves row identity and repeated values across multiple page boundaries', () => {
    const sameRow = { id: 'repeated' };
    const rows = [sameRow, { id: 'middle' }, sameRow, { id: 'last' }];
    const pages = paginateGoalRows(rows, [50, 50, 50, 50], 100);
    expect(pages).toEqual([[rows[0], rows[1]], [rows[2], rows[3]]]);
    pages.flat().forEach((row, index) => expect(row).toBe(rows[index]));
  });

  it('returns no blank page for no goals', () => {
    expect(paginateGoalRows([], [], 100)).toEqual([]);
  });

  it('rejects invalid measurements explicitly before returning a partial printout', () => {
    for (const capacity of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => paginateGoalRows(['a'], [10], capacity)).toThrow(RangeError);
    }
    for (const height of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => paginateGoalRows(['a', 'b'], [10, height], 100)).toThrow(RangeError);
    }
    expect(() => paginateGoalRows(['a', 'b'], [10], 100)).toThrow(RangeError);
    expect(() => paginateGoalRows(['a'], [10, 10], 100)).toThrow(RangeError);
  });
});
