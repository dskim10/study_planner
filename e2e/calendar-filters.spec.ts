import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_EVENT_CATEGORIES, type PlannerState, type ScheduleEvent } from '../src/types';

const categories = [...DEFAULT_EVENT_CATEGORIES, { id: 'club', label: '동아리', color: '#2d8c72' }];
const event = (id: string, type: string, startTime: string, endTime: string, changes: Partial<ScheduleEvent> = {}): ScheduleEvent => ({
  id, title: id, type, date: '2026-10-05', startTime, endTime, allDay: false, recurrence: 'none', weekdays: [], ...changes,
});
const fixture: PlannerState = {
  version: 3, categories, isDemo: false,
  events: [
    event('정규 수업', 'school', '09:00', '11:00', { recurrence: 'weekly', weekdays: [1, 3] }),
    event('수학 학원', 'academy', '10:00', '12:00'),
    event('영어 학원', 'academy', '13:00', '14:00'),
    event('독서 모임', 'club', '18:00', '19:00'),
    event('저녁 산책', 'personal', '20:00', '21:00'),
    event('현장 학습', 'academic', '09:00', '10:00', { date: '2026-10-06', allDay: true }),
  ],
  goals: [{ id: 'goal', weekStart: '2026-10-05', subject: '수학', material: '개념서', range: '1단원', estimatedMinutes: 60, completed: false }],
};

async function openCalendar(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-05T10:00:00+09:00'));
  await page.addInitScript(value => {
    if (!localStorage.getItem('chagok-planner-v1')) localStorage.setItem('chagok-planner-v1', JSON.stringify(value));
  }, fixture);
  await page.goto('/');
}

const sidebar = (page: Page) => page.getByRole('region', { name: '내 캘린더', exact: true });
const filter = (page: Page, label: string) => sidebar(page).getByRole('checkbox', { name: label, exact: true });

test('sidebar filters timed, repeating and all-day schedules without changing study capacity', async ({ page }) => {
  await openCalendar(page);
  for (const category of categories) await expect(filter(page, category.label)).toBeChecked();
  await expect(page.locator('.cal-event')).toHaveCount(6);
  await expect(page.locator('.cal-all-day-event')).toHaveCount(1);
  const freeSlots = await page.locator('.cal-free-slot').evaluateAll(nodes => nodes.map(node => node.getAttribute('style')));
  const dailyAvailability = await page.locator('.cal-availability').allTextContents();
  const academy = page.locator('.cal-event').filter({ hasText: '수학 학원' });
  expect(await academy.evaluate(node => (node as HTMLElement).style.width)).toBe('calc(50% - 6px)');

  await filter(page, '학교 수업').focus();
  await page.keyboard.press('Space');
  await expect(filter(page, '학교 수업')).not.toBeChecked();
  await expect(page.locator('.cal-event')).toHaveCount(4);
  await expect(page.locator('.cal-event').filter({ hasText: '정규 수업' })).toHaveCount(0);
  expect(await academy.evaluate(node => (node as HTMLElement).style.width)).toBe('calc(100% - 6px)');
  await filter(page, '학사일정').uncheck();
  await expect(page.locator('.cal-all-day-event')).toHaveCount(0);
  await expect(page.locator('.cal-blocked-day')).toHaveCount(1);
  expect(await page.locator('.cal-free-slot').evaluateAll(nodes => nodes.map(node => node.getAttribute('style')))).toEqual(freeSlots);
  expect(await page.locator('.cal-availability').allTextContents()).toEqual(dailyAvailability);
  await expect(page.locator('.available-stat .stat-value')).toContainText('136시간');

  await filter(page, '학교 수업').check();
  await filter(page, '학사일정').check();
  await expect(page.locator('.cal-event')).toHaveCount(6);
  await expect(page.locator('.cal-all-day-event')).toHaveCount(1);
});

test('month counts and all-unchecked selection persist across reload, page and week navigation', async ({ page }) => {
  await openCalendar(page);
  await page.getByRole('button', { name: '월간', exact: true }).click();
  const monday = page.locator('.cal-month-cell').filter({ has: page.getByRole('button', { name: '10월 5일 월요일 일정 추가', exact: true }) });
  await expect(monday.locator('.cal-more-events')).toHaveText('+2개 더 보기');
  const monthAvailability = await page.locator('.cal-month-available').allTextContents();
  await filter(page, '학원').uncheck();
  await expect(monday.locator('.cal-more-events')).toHaveCount(0);
  await expect(monday.locator('.cal-month-event')).toHaveCount(3);
  await expect(page.locator('.cal-month-event').filter({ hasText: '학원' })).toHaveCount(0);
  expect(await page.locator('.cal-month-available').allTextContents()).toEqual(monthAvailability);
  for (const category of categories) await filter(page, category.label).uncheck();
  await expect(page.locator('.cal-month-event')).toHaveCount(0);
  await expect(page.locator('.cal-more-events')).toHaveCount(0);
  await page.reload();
  for (const category of categories) await expect(filter(page, category.label)).not.toBeChecked();
  await expect(page.locator('.cal-event, .cal-all-day-event')).toHaveCount(0);
  await expect(page.getByText('아직 등록한 일정이 없어요. 학교와 학원 시간을 먼저 채워 볼까요?')).toHaveCount(0);
  await expect(page.locator('.available-stat .stat-value')).toContainText('136시간');
  await page.getByRole('link', { name: '주간 학습 계획', exact: true }).click();
  await expect(page.locator('.available-stat .stat-value')).toContainText('136시간');
  await expect(page.locator('.stat-card').nth(1)).toContainText('1시간');
  await page.getByRole('link', { name: '캘린더', exact: true }).click();
  await page.getByRole('button', { name: '다음 주', exact: true }).click();
  await expect(page.locator('.cal-event')).toHaveCount(0);
  await expect(page.locator('.available-stat .stat-value')).toContainText('164시간');
  await filter(page, '학교 수업').check();
  await expect(page.locator('.cal-event')).toHaveCount(2);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('chagok-planner-v1')!));
  expect(stored.events).toEqual(fixture.events);
  expect(stored.goals).toEqual(fixture.goals);
});

test('new custom categories start checked and resetting the planner restores all filters', async ({ page }) => {
  await openCalendar(page);
  for (const category of categories) await filter(page, category.label).uncheck();
  await sidebar(page).getByRole('button', { name: '일정 종류 추가', exact: true }).click();
  const categoryDialog = page.getByRole('dialog', { name: '새 일정 종류', exact: true });
  await categoryDialog.getByLabel('종류 이름', { exact: true }).fill('운동');
  await categoryDialog.getByRole('button', { name: '종류 추가', exact: true }).click();
  await expect(filter(page, '운동')).toBeChecked();
  await page.getByRole('button', { name: '일정 추가', exact: true }).click();
  const editor = page.getByRole('dialog');
  await editor.getByLabel('일정 이름', { exact: true }).fill('아침 달리기');
  await editor.getByRole('button', { name: '운동', exact: true }).click();
  await editor.getByLabel('시작 시간', { exact: true }).fill('07:00');
  await editor.getByLabel('종료 시간', { exact: true }).fill('08:00');
  await editor.getByRole('button', { name: '일정 추가', exact: true }).click();
  await expect(page.locator('.cal-event')).toHaveCount(1);
  await expect(page.locator('.cal-event')).toContainText('아침 달리기');
  await filter(page, '운동').uncheck();
  await expect(page.locator('.cal-event')).toHaveCount(0);
  await page.reload();
  await expect(filter(page, '운동')).not.toBeChecked();
  await filter(page, '운동').check();
  await expect(page.locator('.cal-event')).toHaveCount(1);
  await page.getByRole('button', { name: '데이터 관리', exact: true }).click();
  await page.getByRole('button', { name: '새 플래너 시작', exact: true }).click();
  await page.getByRole('button', { name: '비우고 시작하기', exact: true }).click();
  for (const category of DEFAULT_EVENT_CATEGORIES) await expect(filter(page, category.label)).toBeChecked();
  await expect(filter(page, '운동')).toHaveCount(0);
  await expect(page.locator('.available-stat .stat-value')).toContainText('168시간');
});

test('mobile legend filters share the sidebar selection and retain it after reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCalendar(page);
  const legend = page.locator('.cal-legend');
  await legend.getByRole('checkbox', { name: '학교 수업', exact: true }).uncheck();
  await legend.getByRole('checkbox', { name: '동아리', exact: true }).uncheck();
  await expect(page.locator('.cal-event')).toHaveCount(3);
  await page.reload();
  await expect(legend.getByRole('checkbox', { name: '학교 수업', exact: true })).not.toBeChecked();
  await expect(page.locator('.available-stat .stat-value')).toContainText('136시간');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/filters-mobile.png', animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(filter(page, '학교 수업')).not.toBeChecked();
  await expect(filter(page, '동아리')).not.toBeChecked();
  await legend.getByRole('checkbox', { name: '학교 수업', exact: true }).check();
  await expect(filter(page, '학교 수업')).toBeChecked();
  await expect(page.locator('.cal-event')).toHaveCount(5);
  await page.screenshot({ path: 'test-results/filters-desktop.png', animations: 'disabled' });
});
