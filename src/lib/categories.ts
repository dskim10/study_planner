import type { EventCategory, PlannerState } from '../types';
import { getSubjects, isSubjectCategory } from './subjects';

export function normalizeCategoryLabel(label: string): string {
  return label.trim().normalize('NFKC').toLowerCase();
}

/** Shared validation for category creation and stored data. */
export function getCategoryError(category: EventCategory, existing: EventCategory[], maxLabelLength = 30): string | null {
  if (!category.id.trim()) return '일정 종류의 ID가 필요해요.';
  if (existing.some((item) => item.id === category.id)) return '이미 사용 중인 일정 종류의 ID예요.';
  if (!category.label.trim()) return '일정 종류 이름을 입력해 주세요.';
  if (category.label.trim().length > maxLabelLength) return `일정 종류 이름은 ${maxLabelLength}자 이내로 입력해 주세요.`;
  if (existing.some((item) => normalizeCategoryLabel(item.label) === normalizeCategoryLabel(category.label))) {
    return '이미 있는 일정 종류 이름이에요. 다른 이름을 입력해 주세요.';
  }
  if (category.color.length !== 7 || !/^#[\da-f]{6}$/i.test(category.color)) return '올바른 색상을 선택해 주세요.';
  return null;
}

/** Display colors are editable for every category, including subject-linked ones. */
export function updateCategoryColor(state: PlannerState, categoryId: string, color: string): PlannerState {
  if (!state.categories.some((category) => category.id === categoryId)) {
    throw new Error('색상을 변경할 일정 종류를 찾을 수 없어요.');
  }
  if (typeof color !== 'string' || color.length !== 7 || !/^#[\da-f]{6}$/i.test(color)) {
    throw new Error('올바른 색상을 선택해 주세요.');
  }
  return {
    ...state,
    categories: state.categories.map((category) => category.id === categoryId ? { ...category, color: color.toLowerCase() } : category),
    isDemo: false,
  };
}

/** Remove a category and either move its schedules or explicitly delete the full series. */
export function removeCategory(state: PlannerState, categoryId: string, replacementId?: string): PlannerState {
  const category = state.categories.find((item) => item.id === categoryId);
  if (!category) {
    throw new Error('삭제할 일정 종류를 찾을 수 없어요.');
  }
  if (isSubjectCategory(category, getSubjects(state))) {
    throw new Error('과목에 연결된 일정 종류는 과목 관리에서 먼저 과목을 삭제해 주세요.');
  }
  if (replacementId !== undefined && (replacementId === categoryId || !state.categories.some((category) => category.id === replacementId))) {
    throw new Error('일정을 옮길 다른 종류를 선택해 주세요.');
  }
  return {
    ...state,
    categories: state.categories.filter((category) => category.id !== categoryId),
    events: replacementId === undefined
      ? state.events.filter((event) => event.type !== categoryId)
      : state.events.map((event) => event.type === categoryId ? { ...event, type: replacementId } : event),
    ...(state.hiddenCategoryIds === undefined ? {} : { hiddenCategoryIds: state.hiddenCategoryIds.filter((id) => id !== categoryId) }),
    isDemo: false,
  };
}
