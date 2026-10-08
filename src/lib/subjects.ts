import type { EventCategory, PlannerState } from '../types';
import { DEFAULT_SUBJECTS } from '../types';

export function normalizeSubjectName(name: string): string {
  return name.trim().normalize('NFKC').toLowerCase();
}

/** A saved empty list is intentional. Only older planners acquire default subjects. */
export function getSubjects(state: Pick<PlannerState, 'subjects' | 'goals'>): string[] {
  if (state.subjects !== undefined) return [...state.subjects];
  const subjects = [...DEFAULT_SUBJECTS];
  const names = new Set(subjects.map(normalizeSubjectName));
  for (const goal of state.goals) {
    const name = goal.subject.trim();
    const normalized = normalizeSubjectName(name);
    if (!names.has(normalized)) {
      names.add(normalized);
      subjects.push(name);
    }
  }
  return subjects;
}

export function isSubjectCategory(category: EventCategory, subjects: string[]): boolean {
  const label = normalizeSubjectName(category.label);
  return subjects.some((subject) => normalizeSubjectName(subject) === label);
}

const SUBJECT_CATEGORY_COLORS = ['#647dbb', '#9b79cf', '#d39365', '#5b9984', '#db9b4c', '#809387'];

/** Add only missing links. IDs must agree across independent reads of old server/cache data. */
export function syncSubjectCategories(state: PlannerState): PlannerState {
  const subjects = getSubjects(state);
  const names = new Set(state.categories.map((category) => normalizeSubjectName(category.label)));
  const ids = new Set(state.categories.map((category) => category.id));
  const additions: EventCategory[] = [];
  for (const subject of subjects) {
    const normalized = normalizeSubjectName(subject);
    if (names.has(normalized)) continue;
    // Hex code points also handle lone UTF-16 surrogates without URI-encoding errors.
    const points = Array.from(normalized, (character) => character.codePointAt(0)!);
    const baseId = `subject-${points.map((point) => point.toString(16)).join('-')}`;
    let id = baseId;
    let suffix = 2;
    while (ids.has(id)) id = `${baseId}-${suffix++}`;
    const colorIndex = points.reduce((hash, point) => (Math.imul(hash, 31) + point) >>> 0, 0) % SUBJECT_CATEGORY_COLORS.length;
    additions.push({ id, label: subject, color: SUBJECT_CATEGORY_COLORS[colorIndex] });
    names.add(normalized);
    ids.add(id);
  }
  if (state.subjects !== undefined && !additions.length) return state;
  return { ...state, subjects, ...(additions.length ? { categories: [...state.categories, ...additions] } : {}) };
}

export function getSubjectError(name: string, existing: string[], excludeName?: string): string | null {
  if (!name.trim()) return '과목 이름을 입력해 주세요.';
  if (name.trim().length > 40) return '과목 이름은 40자 이내로 입력해 주세요.';
  const normalized = normalizeSubjectName(name);
  const excluded = excludeName === undefined ? undefined : normalizeSubjectName(excludeName);
  if (existing.some((item) => normalizeSubjectName(item) !== excluded && normalizeSubjectName(item) === normalized)) {
    return '이미 있는 과목 이름이에요. 다른 이름을 입력해 주세요.';
  }
  return null;
}

export function addSubject(state: PlannerState, name: string): PlannerState {
  const subjects = getSubjects(state);
  const error = getSubjectError(name, subjects);
  if (error) throw new Error(error);
  return syncSubjectCategories({ ...state, subjects: [...subjects, name.trim()], isDemo: false });
}

/** Move within the complete list so filtered or other-week subjects are preserved. */
export function moveSubject(state: PlannerState, sourceName: string, targetName: string): PlannerState {
  const subjects = getSubjects(state);
  const source = subjects.findIndex(subject => normalizeSubjectName(subject) === normalizeSubjectName(sourceName));
  const target = subjects.findIndex(subject => normalizeSubjectName(subject) === normalizeSubjectName(targetName));
  if (source < 0 || target < 0) throw new Error('과목 목록이 변경되었어요. 이동할 과목을 다시 선택해 주세요.');
  if (source === target) return state;
  const [subject] = subjects.splice(source, 1);
  subjects.splice(target, 0, subject);
  return { ...state, subjects, isDemo: false };
}

/** Preserve the linked category's identity, or merge schedules into an existing destination. */
export function renameSubject(state: PlannerState, oldName: string, newName: string): PlannerState {
  const subjects = getSubjects(state);
  const oldNormalized = normalizeSubjectName(oldName);
  if (!subjects.some((subject) => normalizeSubjectName(subject) === oldNormalized)) throw new Error('수정할 과목을 찾을 수 없어요.');
  const error = getSubjectError(newName, subjects, oldName);
  if (error) throw new Error(error);
  const name = newName.trim();
  const synced = syncSubjectCategories(state);
  const source = synced.categories.find((category) => normalizeSubjectName(category.label) === oldNormalized)!;
  const destination = synced.categories.find((category) => category.id !== source.id && normalizeSubjectName(category.label) === normalizeSubjectName(name));
  let categories: EventCategory[];
  let events = synced.events;
  let hiddenCategoryIds = synced.hiddenCategoryIds;
  if (destination) {
    categories = synced.categories.filter((category) => category.id !== source.id).map((category) => category.id === destination.id ? { ...category, label: name } : category);
    events = synced.events.map((event) => event.type === source.id ? { ...event, type: destination.id } : event);
    if (hiddenCategoryIds !== undefined) {
      const bothHidden = hiddenCategoryIds.includes(source.id) && hiddenCategoryIds.includes(destination.id);
      hiddenCategoryIds = hiddenCategoryIds.filter((id) => id !== source.id && (id !== destination.id || bothHidden));
    }
  } else {
    categories = synced.categories.map((category) => category.id === source.id ? { ...category, label: name } : category);
  }
  return {
    ...synced,
    categories,
    events,
    ...(hiddenCategoryIds === undefined ? {} : { hiddenCategoryIds }),
    subjects: subjects.map((subject) => normalizeSubjectName(subject) === oldNormalized ? name : subject),
    goals: state.goals.map((goal) => normalizeSubjectName(goal.subject) === oldNormalized ? { ...goal, subject: name } : goal),
    isDemo: false,
  };
}

export function removeSubject(state: PlannerState, name: string, replacement?: string): PlannerState {
  const subjects = getSubjects(state);
  const normalized = normalizeSubjectName(name);
  if (!subjects.some((subject) => normalizeSubjectName(subject) === normalized)) throw new Error('삭제할 과목을 찾을 수 없어요.');
  const replacementName = replacement === undefined ? undefined : subjects.find((subject) => normalizeSubjectName(subject) === normalizeSubjectName(replacement));
  if (replacement !== undefined && (replacementName === undefined || normalizeSubjectName(replacementName) === normalized)) {
    throw new Error('목표를 옮길 다른 과목을 선택해 주세요.');
  }
  return {
    ...state,
    subjects: subjects.filter((subject) => normalizeSubjectName(subject) !== normalized),
    goals: replacementName === undefined
      ? state.goals.filter((goal) => normalizeSubjectName(goal.subject) !== normalized)
      : state.goals.map((goal) => normalizeSubjectName(goal.subject) === normalized ? { ...goal, subject: replacementName } : goal),
    isDemo: false,
  };
}
