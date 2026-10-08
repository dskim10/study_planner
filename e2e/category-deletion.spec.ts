import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_EVENT_CATEGORIES, type PlannerState } from '../src/types';

const fixture: PlannerState = {
  version: 3, categories: [...DEFAULT_EVENT_CATEGORIES, { id: 'math', label: '수학', color: '#6d8ec7' }], subjects: ['수학'], isDemo: false,
  events: [
    { id: 'school-series', title: '정규 수업', type: 'school', date: '2026-10-05', startTime: '09:00', endTime: '11:00', allDay: false, recurrence: 'weekly', weekdays: [1, 3] },
    { id: 'academic-day', title: '현장 학습', type: 'academic', date: '2026-10-06', startTime: '09:00', endTime: '10:00', allDay: true, recurrence: 'none', weekdays: [] },
  ],
  goals: [{ id: 'goal', weekStart: '2026-10-05', subject: '수학', material: '개념서', range: '1단원', estimatedMinutes: 60, completed: false }],
};
async function openCalendar(page: Page, data = fixture) {
  await page.clock.setFixedTime(new Date('2026-10-05T10:00:00+09:00'));
  await page.addInitScript(value => {
    if (!localStorage.getItem('chagok-planner-v1')) localStorage.setItem('chagok-planner-v1', JSON.stringify(value));
  }, data);
  await page.goto('/');
}
const sidebar = (page: Page) => page.getByRole('region', { name: '내 캘린더', exact: true });
const dialog = (page: Page) => page.getByRole('dialog', { name: '일정 종류 삭제', exact: true });
const stored = (page: Page): Promise<PlannerState> => page.evaluate(() => JSON.parse(localStorage.getItem('chagok-planner-v1')!));

async function openDelete(page: Page, name: string) {
  await sidebar(page).getByRole('button', { name: `${name} 옵션`, exact: true }).click();
  await page.getByRole('dialog', { name: `${name} 옵션`, exact: true }).getByRole('button', { name: '일정 종류 삭제', exact: true }).click();
}

test('default categories can be cancelled or deleted with all repeating and all-day schedules', async ({ page }) => {
  await openCalendar(page);
  await expect(page.locator('.available-stat .stat-value')).toContainText('140시간');
  await openDelete(page, '학교 수업');
  await expect(dialog(page)).toContainText('등록된 일정은 1개');
  await expect(dialog(page).getByRole('radio', { name: '일정 유지하고 다른 종류로 이동', exact: true })).toBeChecked();
  await dialog(page).getByRole('button', { name: '취소', exact: true }).click();
  expect(await stored(page)).toEqual(fixture);
  await sidebar(page).getByRole('checkbox', { name: '학교 수업', exact: true }).uncheck();
  for (const name of ['학교 수업', '학사일정']) {
    await openDelete(page, name);
    await dialog(page).getByRole('radio', { name: '이 종류의 일정도 함께 삭제', exact: true }).check();
    await dialog(page).getByRole('button', { name: '종류 삭제', exact: true }).click();
    await expect(sidebar(page).getByRole('checkbox', { name, exact: true })).toHaveCount(0);
  }
  await expect(page.locator('.available-stat .stat-value')).toContainText('168시간');
  await expect(page.locator('.cal-event, .cal-all-day-event')).toHaveCount(0);
  await page.getByRole('button', { name: '월간', exact: true }).click();
  await expect(page.locator('.cal-month-event')).toHaveCount(0);
  await page.getByRole('link', { name: '주간 학습 계획', exact: true }).click();
  await expect(page.locator('.available-stat .stat-value')).toContainText('168시간');
  await expect(page.getByRole('checkbox', { name: /개념서/ })).not.toBeChecked();
  await expect(page.locator('.planned-stat .stat-value')).toContainText('0분');
  await expect(page.locator('.remaining-stat .stat-value')).toContainText('168시간');
  await page.reload();
  const data = await stored(page);
  expect(data.events).toEqual([]);
  expect(data.hiddenCategoryIds).toEqual([]);
  expect(data.categories.map(category => category.id)).toEqual(['academy', 'personal', 'math']);
  expect(data.goals).toEqual(fixture.goals);
  await expect(sidebar(page).getByRole('checkbox', { name: '학교 수업', exact: true })).toHaveCount(0);
});

test('moving schedules retains recurrence and availability and respects the destination filter', async ({ page }) => {
  await openCalendar(page, { ...fixture, hiddenCategoryIds: ['school', 'academy'] });
  await openDelete(page, '학교 수업');
  await dialog(page).getByLabel('이동할 일정 종류', { exact: true }).selectOption('academy');
  await dialog(page).getByRole('button', { name: '종류 삭제', exact: true }).click();
  await expect(page.locator('.cal-event')).toHaveCount(0);
  await expect(page.locator('.available-stat .stat-value')).toContainText('140시간');
  await sidebar(page).getByRole('checkbox', { name: '학원', exact: true }).check();
  await expect(page.locator('.cal-event')).toHaveCount(2);
  await expect(page.locator('.cal-event-kind').first()).toHaveText('학원');
  await page.reload();
  const data = await stored(page);
  expect(data.events).toEqual(fixture.events.map(event => event.type === 'school' ? { ...event, type: 'academy' } : event));
  expect(data.goals).toEqual(fixture.goals);
  await page.getByRole('button', { name: '다음 주', exact: true }).click();
  await expect(page.locator('.cal-event')).toHaveCount(2);
  await expect(page.locator('.available-stat .stat-value')).toContainText('164시간');
});

test('all default categories may be removed and an event can recreate a category after reload', async ({ page }) => {
  await openCalendar(page, { ...fixture, categories: DEFAULT_EVENT_CATEGORIES, subjects: [], goals: [], events: [fixture.events[0]] });
  for (const name of ['학원', '학사일정', '개인 일정']) {
    await openDelete(page, name);
    await expect(dialog(page)).toContainText('등록된 일정은 0개');
    await dialog(page).getByRole('button', { name: '종류 삭제', exact: true }).click();
  }
  await openDelete(page, '학교 수업');
  const confirm = dialog(page).getByRole('button', { name: '종류 삭제', exact: true });
  await expect(confirm).toBeDisabled();
  await dialog(page).getByRole('checkbox', { name: '등록된 일정 1개와 모든 반복 일정 삭제에 동의합니다', exact: true }).check();
  await confirm.click();
  await page.reload();
  await expect(sidebar(page).getByRole('checkbox')).toHaveCount(0);
  await expect(page.locator('.available-stat .stat-value')).toContainText('168시간');
  expect((await stored(page)).categories).toEqual([]);
  expect((await stored(page)).goals).toEqual([]);

  await page.getByRole('button', { name: '일정 추가', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '새 일정 추가', exact: true });
  await expect(editor.getByRole('button', { name: '일정 추가', exact: true })).toBeDisabled();
  await editor.getByLabel('일정 이름', { exact: true }).fill('다시 시작하는 공부');
  await editor.getByLabel('종류 이름', { exact: true }).fill('나의 공부');
  await editor.getByRole('button', { name: '종류 추가', exact: true }).click();
  await expect(editor.getByRole('button', { name: '나의 공부', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await editor.getByRole('button', { name: '일정 추가', exact: true }).click();
  await expect(page.locator('.cal-event')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.cal-event')).toContainText('다시 시작하는 공부');
  await expect(page.locator('.available-stat .stat-value')).toContainText('167시간');
});

test('category options retain cancellation and deletion while mobile legend offers filters and category creation', async ({ page }) => {
  await openCalendar(page, { ...fixture, categories: [...fixture.categories, { id: 'club', label: '동아리', color: '#2d8c72' }] });
  const trigger = sidebar(page).getByRole('button', { name: '동아리 옵션', exact: true });
  await openDelete(page, '동아리');
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await openDelete(page, '동아리');
  await dialog(page).getByRole('button', { name: '종류 삭제', exact: true }).click();
  await expect(trigger).toHaveCount(0);
  await page.reload();
  await expect(trigger).toHaveCount(0);
  expect((await stored(page)).events).toEqual(fixture.events);
  await page.setViewportSize({ width: 390, height: 844 });
  const legend = page.locator('.cal-legend');
  await expect(legend.getByRole('button', { name: /종류 삭제/ })).toHaveCount(0);
  const schoolFilter = legend.getByRole('checkbox', { name: '학교 수업', exact: true });
  await expect(schoolFilter).toBeChecked();
  await schoolFilter.uncheck();
  await expect(page.locator('.cal-event')).toHaveCount(0);
  await schoolFilter.check();
  await expect(page.locator('.cal-event')).toHaveCount(2);
  await legend.getByRole('button', { name: '일정 종류 추가', exact: true }).click();
  const creator = page.getByRole('dialog', { name: '새 일정 종류', exact: true });
  await expect(creator.getByLabel('종류 이름', { exact: true })).toBeVisible();
  await creator.getByRole('button', { name: '취소', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
