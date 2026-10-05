import type { EventCategory, PlannerState } from '../types';

export function normalizeCategoryLabel(label: string): string {
  return label.trim().normalize('NFKC').toLowerCase();
}

/** Shared validation for category creation and stored data. */
export function getCategoryError(category: EventCategory, existing: EventCategory[]): string | null {
  if (!category.id.trim()) return '일정 종류의 ID가 필요해요.';
  if (existing.some((item) => item.id === category.id)) return '이미 사용 중인 일정 종류의 ID예요.';
  if (!category.label.trim()) return '일정 종류 이름을 입력해 주세요.';
  if (category.label.trim().length > 30) return '일정 종류 이름은 30자 이내로 입력해 주세요.';
  if (existing.some((item) => normalizeCategoryLabel(item.label) === normalizeCategoryLabel(category.label))) {
    return '이미 있는 일정 종류 이름이에요. 다른 이름을 입력해 주세요.';
  }
  if (category.color.length !== 7 || !/^#[\da-f]{6}$/i.test(category.color)) return '올바른 색상을 선택해 주세요.';
  return null;
}

/** Remove a category and either move its schedules or explicitly delete the full series. */
export function removeCategory(state: PlannerState, categoryId: string, replacementId?: string): PlannerState {
  if (!state.categories.some((category) => category.id === categoryId)) {
    throw new Error('삭제할 일정 종류를 찾을 수 없어요.');
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
