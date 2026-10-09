import { expect, test, type Page } from '@playwright/test';
import type { PlannerState } from '../src/types';

const fixture: PlannerState = {
  version: 3, subjects: ['수학'], isDemo: false, hiddenCategoryIds: ['club'],
  categories: [
    { id: 'school', label: '학교 수업', color: '#6d8ec7' },
    { id: 'math', label: '수학', color: '#9b79cf' },
    { id: 'club', label: '동아리', color: '#2d8c72' },
  ],
  events: [
    { id: 'school-series', title: '정규 수업', type: 'school', date: '2026-10-05', startTime: '09:00', endTime: '11:00', allDay: false, recurrence: 'weekly', weekdays: [1, 3] },
    { id: 'math-session', title: '수학 공부', type: 'math', date: '2026-10-05', startTime: '10:00', endTime: '12:00', allDay: false, recurrence: 'none', weekdays: [] },
    { id: 'club-session', title: '독서 모임', type: 'club', date: '2026-10-06', startTime: '18:00', endTime: '19:00', allDay: false, recurrence: 'none', weekdays: [] },
    { id: 'school-day', title: '현장 학습', type: 'school', date: '2026-10-08', startTime: '09:00', endTime: '10:00', allDay: true, recurrence: 'none', weekdays: [] },
  ],
  goals: [{ id: 'goal', weekStart: '2026-10-05', subject: '수학', material: '개념서', range: '1장', completed: false }],
};
const sidebar = (page: Page) => page.getByRole('region', { name: '내 캘린더', exact: true });
const options = (page: Page, label: string) => page.getByRole('dialog', { name: `${label} 옵션`, exact: true });
const stored = (page: Page): Promise<PlannerState> => page.evaluate(() => JSON.parse(localStorage.getItem('chagok-planner-v1')!));

async function open(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-05T10:00:00+09:00'));
  await page.addInitScript(value => {
    if (!localStorage.getItem('chagok-planner-v1')) localStorage.setItem('chagok-planner-v1', JSON.stringify(value));
  }, fixture);
  await page.goto('/');
}

async function expectBudget(page: Page) {
  await expect(page.locator('.available-stat .stat-value')).toContainText('139시간');
  await expect(page.locator('.remaining-stat .stat-value')).toContainText('138시간');
  await expect(page.locator('.planned-stat .stat-value')).toContainText('2시간');
}

test('preset and custom colors update all calendar surfaces and persist without changing schedules or filters', async ({ page }) => {
  await open(page);
  await expectBudget(page);
  await sidebar(page).getByRole('button', { name: '학교 수업 옵션', exact: true }).click();
  await options(page, '학교 수업').getByRole('button', { name: '빨강 색상 #D50000', exact: true }).click();
  await expect(options(page, '학교 수업').getByRole('button', { name: '빨강 색상 #D50000', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await options(page, '학교 수업').getByRole('button', { name: '옵션 닫기', exact: true }).click();
  await expect(sidebar(page).getByRole('checkbox', { name: '학교 수업', exact: true })).toHaveCSS('accent-color', 'rgb(213, 0, 0)');
  await expect(page.locator('.cal-legend').getByRole('checkbox', { name: '학교 수업', exact: true })).toHaveCSS('accent-color', 'rgb(213, 0, 0)');
  await expect(page.locator('.cal-event').filter({ hasText: '정규 수업' }).first()).toHaveCSS('border-left-color', 'rgb(213, 0, 0)');
  await expect(page.locator('.cal-all-day-event')).toHaveCSS('border-left-color', 'rgb(213, 0, 0)');

  await sidebar(page).getByRole('button', { name: '수학 옵션', exact: true }).click();
  await expect(options(page, '수학').getByRole('button', { name: '일정 종류 삭제', exact: true })).toHaveCount(0);
  await options(page, '수학').getByRole('button', { name: '사용자 지정 색상', exact: true }).click();
  await options(page, '수학').getByRole('textbox', { name: '색상 코드', exact: true }).fill('#zzzzzz');
  await options(page, '수학').getByRole('button', { name: '색상 적용', exact: true }).click();
  await expect(options(page, '수학').getByRole('alert')).toBeVisible();
  expect((await stored(page)).categories.find(item => item.id === 'math')?.color).toBe('#9b79cf');
  await options(page, '수학').getByRole('textbox', { name: '색상 코드', exact: true }).fill('#123ABC');
  await options(page, '수학').getByRole('button', { name: '색상 적용', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.cal-event').filter({ hasText: '수학 공부' })).toHaveCSS('border-left-color', 'rgb(18, 58, 188)');
  await sidebar(page).getByRole('button', { name: '동아리 옵션', exact: true }).click();
  await options(page, '동아리').getByRole('button', { name: '빨강 색상 #D50000', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(sidebar(page).getByRole('checkbox', { name: '동아리', exact: true })).not.toBeChecked();
  await expect(page.locator('.cal-event')).toHaveCount(3);
  await expectBudget(page);

  await page.getByRole('button', { name: '월간', exact: true }).click();
  await expect(page.locator('.cal-month-event').filter({ hasText: '정규 수업' }).first().locator('.cal-event-dot')).toHaveCSS('background-color', 'rgb(213, 0, 0)');
  await expect(page.locator('.cal-month-event').filter({ hasText: '수학 공부' }).locator('.cal-event-dot')).toHaveCSS('background-color', 'rgb(18, 58, 188)');
  await page.getByRole('button', { name: '일정 추가', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '새 일정 추가', exact: true });
  await expect(editor.getByRole('button', { name: '학교 수업', exact: true }).locator('.color-dot')).toHaveCSS('background-color', 'rgb(213, 0, 0)');
  await expect(editor.getByRole('button', { name: '수학', exact: true }).locator('.color-dot')).toHaveCSS('background-color', 'rgb(18, 58, 188)');
  await page.keyboard.press('Escape');
  await page.reload();
  const data = await stored(page);
  expect(data.categories).toEqual(fixture.categories.map(item => ({ ...item, color: item.id === 'math' ? '#123abc' : '#d50000' })));
  expect(data.events).toEqual(fixture.events);
  expect(data.goals).toEqual(fixture.goals);
  expect(data.subjects).toEqual(fixture.subjects);
  expect(data.hiddenCategoryIds).toEqual(fixture.hiddenCategoryIds);
  await expectBudget(page);
});

test('color options support keyboard selection, Escape, outside focus and switching categories', async ({ page }) => {
  await open(page);
  const trigger = sidebar(page).getByRole('button', { name: '학교 수업 옵션', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const palette = options(page, '학교 수업').getByRole('group', { name: '색상 선택', exact: true });
  const red = palette.getByRole('button', { name: '빨강 색상 #D50000', exact: true });
  await red.focus();
  await page.keyboard.press('ArrowRight');
  await expect(red).not.toBeFocused();
  await page.keyboard.press('Home');
  await expect(palette.getByRole('button').first()).toBeFocused();
  await page.keyboard.press('End');
  const last = palette.getByRole('button').last();
  await expect(last).toBeFocused();
  await page.keyboard.press('Space');
  await expect(last).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(options(page, '학교 수업')).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.getByRole('heading', { level: 1 }).click();
  await expect(options(page, '학교 수업')).toHaveCount(0);
  await trigger.click();
  const outside = sidebar(page).getByRole('checkbox', { name: '수학', exact: true });
  await outside.focus();
  await expect(options(page, '학교 수업')).toHaveCount(0);
  await expect(outside).toBeFocused();
  await trigger.click();
  await sidebar(page).getByRole('button', { name: '수학 옵션', exact: true }).click();
  await expect(options(page, '학교 수업')).toHaveCount(0);
  await expect(options(page, '수학')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await options(page, '수학').getByRole('button', { name: '옵션 닫기', exact: true }).click();
  await expect(sidebar(page).getByRole('button', { name: '수학 옵션', exact: true })).toBeFocused();
});

test('mobile legend exposes color options and ordinary deletion without overflowing or changing hidden schedules', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const legend = page.locator('.cal-legend');
  await legend.getByRole('button', { name: '수학 옵션', exact: true }).click();
  const panel = options(page, '수학');
  await expect(panel).toBeVisible();
  const bounds = await panel.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  await expect(panel.getByRole('button', { name: '일정 종류 삭제', exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: '빨강 색상 #D50000', exact: true }).click();
  await panel.getByRole('button', { name: '옵션 닫기', exact: true }).click();
  await legend.getByRole('checkbox', { name: '수학', exact: true }).uncheck();
  await expect(page.locator('.cal-event')).toHaveCount(2);
  await expectBudget(page);

  await legend.getByRole('button', { name: '동아리 옵션', exact: true }).click();
  await options(page, '동아리').getByRole('button', { name: '일정 종류 삭제', exact: true }).click();
  const deletion = page.getByRole('dialog', { name: '일정 종류 삭제', exact: true });
  await expect(deletion).toContainText('등록된 일정은 1개');
  await deletion.getByRole('button', { name: '취소', exact: true }).click();
  await page.reload();
  expect((await stored(page)).events).toEqual(fixture.events);
  expect((await stored(page)).categories.find(item => item.id === 'math')?.color).toBe('#d50000');
  await expect(legend.getByRole('checkbox', { name: '수학', exact: true })).not.toBeChecked();
  await expect(legend.getByRole('checkbox', { name: '동아리', exact: true })).not.toBeChecked();
  await expectBudget(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
