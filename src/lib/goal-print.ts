import type { StudyGoal } from '../types';
import { normalizeSubjectName } from './subjects';

/** Include every goal for the week, grouped by the registered subject order. */
export function buildPrintableGoals(goals: StudyGoal[], weekStart: string, subjects: string[]): StudyGoal[] {
  const groups = new Map<string, { subject: string; goals: StudyGoal[] }>();
  for (const subject of subjects) {
    const normalized = normalizeSubjectName(subject);
    // Keep the first spelling/order if defensive legacy input contains duplicates.
    if (!groups.has(normalized)) groups.set(normalized, { subject, goals: [] });
  }

  const unknown: StudyGoal[] = [];
  for (const goal of goals) {
    if (goal.weekStart !== weekStart) continue;
    const group = groups.get(normalizeSubjectName(goal.subject));
    if (group) group.goals.push({ ...goal, subject: group.subject });
    else unknown.push({ ...goal });
  }
  return [...Array.from(groups.values()).flatMap((group) => group.goals), ...unknown];
}

/**
 * Pack measured row heights into the available body height, using the same units.
 * Measurements must be finite and positive, with exactly one height per row;
 * invalid measurements throw RangeError instead of silently losing print content.
 * An oversized row occupies its own page so pagination always makes progress.
 */
export function paginateGoalRows<T>(rows: T[], heights: number[], capacity: number): T[][] {
  if (!Number.isFinite(capacity) || capacity <= 0) throw new RangeError('인쇄 영역의 높이는 양수여야 해요.');
  if (heights.length !== rows.length) throw new RangeError('인쇄할 행과 측정한 높이의 개수가 달라요.');
  if (heights.some((height) => !Number.isFinite(height) || height <= 0)) {
    throw new RangeError('인쇄할 행의 높이를 올바르게 측정하지 못했어요.');
  }

  const pages: T[][] = [];
  let page: T[] = [];
  let used = 0;
  rows.forEach((row, index) => {
    const height = heights[index];
    if (page.length && used + height > capacity) {
      pages.push(page);
      page = [];
      used = 0;
    }
    page.push(row);
    used += height;
    if (height > capacity) {
      pages.push(page);
      page = [];
      used = 0;
    }
  });
  if (page.length) pages.push(page);
  return pages;
}
