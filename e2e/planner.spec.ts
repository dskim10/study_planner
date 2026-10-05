import { expect, test, type Page } from '@playwright/test';

const empty = { version: 2, events: [], goals: [], isDemo: false };
const defaultCategories = [
  { id: 'school', label: '학교 수업', color: '#6d8ec7' },
  { id: 'academy', label: '학원', color: '#9b79cf' },
  { id: 'academic', label: '학사일정', color: '#db9b4c' },
  { id: 'personal', label: '개인 일정', color: '#809387' },
];

async function openEmpty(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-05T10:00:00+09:00'));
  await page.addInitScript(value => { if (!localStorage.getItem('chagok-planner-v1')) localStorage.setItem('chagok-planner-v1', JSON.stringify(value)); }, empty);
  await page.goto('/');
}

async function newEvent(page: Page, title: string, start = '08:00', end = '16:00') {
  await page.getByRole('button', { name: '일정 추가', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('일정 이름', { exact: true }).fill(title);
  await dialog.getByLabel('시작 시간', { exact: true }).fill(start);
  await dialog.getByLabel('종료 시간', { exact: true }).fill(end);
  return dialog;
}

test('repeating schedules, overlapping intervals, both pages and reload share the same budget', async ({ page }) => {
  await openEmpty(page);
  await expect(page.locator('.available-stat .stat-value')).toContainText('168시간');
  let dialog = await newEvent(page, '학교 정규수업');
  await dialog.getByLabel('반복', { exact: true }).selectOption('weekly');
  for (const day of ['화', '수', '목', '금']) await dialog.getByRole('button', { name: `${day}요일`, exact: true }).click();
  await dialog.getByRole('button', { name: '일정 추가', exact: true }).click();
  await expect(page.locator('.available-stat .stat-value')).toContainText('128시간');
  dialog = await newEvent(page, '겹치는 학사일정', '10:00', '12:00');
  await dialog.getByRole('button', { name: '일정 추가', exact: true }).click();
  await expect(page.locator('.available-stat .stat-value')).toContainText('128시간');
  await page.getByRole('link', { name: '주간 학습 계획', exact: true }).click();
  await expect(page.locator('.available-stat .stat-value')).toContainText('128시간');
  await page.reload();
  await expect(page.locator('.available-stat .stat-value')).toContainText('128시간');
  await page.getByRole('button', { name: '다음 주', exact: true }).click();
  await expect(page.locator('.available-stat .stat-value')).toContainText('128시간');
});

test('all-day event removes a day and edit/delete restore capacity', async ({ page }) => {
  await openEmpty(page);
  const dialog = await newEvent(page, '중간고사');
  await dialog.getByRole('button', { name: '학사일정', exact: true }).click();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: '일정 추가', exact: true }).click();
  await expect(page.locator('.available-stat .stat-value')).toContainText('144시간');
  await page.getByRole('button', { name: /중간고사, 종일/ }).click();
  await page.getByRole('dialog').getByRole('checkbox').uncheck();
  await page.getByRole('dialog').getByRole('button', { name: '변경사항 저장' }).click();
  await expect(page.locator('.available-stat .stat-value')).toContainText('160시간');
  await page.getByRole('button', { name: /중간고사, 08:00/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: '삭제', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '삭제하기' }).click();
  await expect(page.locator('.available-stat .stat-value')).toContainText('168시간');
});

test('weekly subject goals can be added, edited, completed, isolated by week and deleted', async ({ page }) => {
  await openEmpty(page);
  await page.getByRole('link', { name: '주간 학습 계획', exact: true }).click();
  await page.getByRole('button', { name: '학습 목표 추가', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: '과목 *', exact: true }).fill('수학');
  await dialog.getByLabel('학습자료', { exact: false }).fill('수학 개념서');
  await dialog.getByLabel('학습 범위', { exact: false }).fill('2단원 p. 20–35');
  await dialog.getByLabel('예상 소요 시간', { exact: false }).fill('90');
  await dialog.getByRole('button', { name: '목표 저장' }).click();
  await expect(page.locator('.stat-card').nth(1)).toContainText('1시간 30분');
  await expect(page.locator('.stat-card').nth(2)).toContainText('166시간 30분');
  await page.getByRole('checkbox', { name: /수학 개념서/ }).check();
  await expect(page.getByRole('progressbar', { name: '주간 학습 목표 완료율' })).toHaveAttribute('aria-valuenow', '100');
  await expect(page.locator('.stat-card').nth(1)).toContainText('1시간 30분');
  await page.getByRole('button', { name: '수학 개념서 수정' }).click();
  await page.getByRole('dialog').getByLabel('예상 소요 시간', { exact: false }).fill('120');
  await page.getByRole('button', { name: '목표 저장' }).click();
  await expect(page.locator('.stat-card').nth(1)).toContainText('2시간');
  await page.getByRole('button', { name: '다음 주', exact: true }).click();
  await expect(page.getByText('나만의 이번 주 목표를 세워 볼까요?')).toBeVisible();
  await page.getByRole('button', { name: '이전 주', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /수학 개념서/ })).toBeChecked();
  await page.reload();
  await expect(page.getByRole('checkbox', { name: /수학 개념서/ })).toBeChecked();
  await page.getByRole('button', { name: '수학 개념서 삭제' }).click();
  await page.getByRole('button', { name: '목표 삭제', exact: true }).click();
  await expect(page.locator('.stat-card').nth(1)).toContainText('0분');
});

test('calendar always covers 24 hours and midnight schedules persist through editing and deletion', async ({ page }) => {
  await openEmpty(page);
  const ruler = page.locator('.cal-time-ruler > span');
  await expect(ruler).toHaveCount(25);
  await expect(ruler.first()).toHaveText('00:00');
  await expect(ruler.last()).toHaveText('24:00');
  await page.getByRole('button', { name: '데이터 관리', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '내 데이터 관리' })).toBeVisible();
  await expect(page.getByLabel('활동 시작', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('활동 종료', { exact: true })).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: '확인', exact: true }).click();

  let dialog = await newEvent(page, '새벽 일정', '00:00', '01:00');
  await dialog.getByRole('button', { name: '일정 추가', exact: true }).click();
  dialog = await newEvent(page, '밤 일정', '23:00', '00:00');
  await dialog.getByRole('button', { name: '일정 추가', exact: true }).click();
  await expect(page.locator('.available-stat .stat-value')).toContainText('166시간');
  await expect(page.getByRole('button', { name: /새벽 일정, 00:00부터 01:00까지/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /밤 일정, 23:00부터 24:00까지/ })).toBeVisible();
  await page.reload();
  await expect(ruler.first()).toHaveText('00:00');
  await expect(ruler.last()).toHaveText('24:00');
  await expect(page.locator('.available-stat .stat-value')).toContainText('166시간');
  await page.getByRole('button', { name: /밤 일정, 23:00부터 24:00까지/ }).click();
  await expect(page.getByRole('dialog').getByLabel('종료 시간', { exact: true })).toHaveValue('00:00');
  await page.getByRole('dialog').getByLabel('시작 시간', { exact: true }).fill('22:00');
  await page.getByRole('dialog').getByRole('button', { name: '변경사항 저장' }).click();
  await expect(page.locator('.available-stat .stat-value')).toContainText('165시간');
  await page.getByRole('link', { name: '주간 학습 계획', exact: true }).click();
  await expect(page.locator('.available-stat .stat-value')).toContainText('165시간');
  await page.getByRole('link', { name: '캘린더', exact: true }).click();
  await page.getByRole('button', { name: /밤 일정, 22:00부터 24:00까지/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: '삭제', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '삭제하기' }).click();
  await expect(page.locator('.available-stat .stat-value')).toContainText('167시간');

  dialog = await newEvent(page, '잘못된 시간', '18:00', '09:00');
  await dialog.getByRole('button', { name: '일정 추가', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('종료 시간은 시작 시간보다 늦어야');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.available-stat .stat-value')).toContainText('167시간');
});

test('legacy activity settings migrate to a full day while preserving schedules and goals', async ({ page }) => {
  const legacy = {
    version: 1,
    settings: { dayStart: '09:00', dayEnd: '18:00' },
    isDemo: false,
    events: [{ id: 'legacy-school', title: '기존 학교 수업', type: 'school', date: '2026-10-05', startTime: '08:00', endTime: '16:00', allDay: false, recurrence: 'none', weekdays: [] }],
    goals: [{ id: 'legacy-goal', weekStart: '2026-10-05', subject: '수학', material: '기존 수학 교재', range: 'p. 10–20', estimatedMinutes: 90, completed: true }],
  };
  await page.clock.setFixedTime(new Date('2026-10-05T10:00:00+09:00'));
  await page.addInitScript(value => { if (!localStorage.getItem('chagok-planner-v1')) localStorage.setItem('chagok-planner-v1', JSON.stringify(value)); }, legacy);
  await page.goto('/');
  await expect(page.locator('.cal-time-ruler > span').first()).toHaveText('00:00');
  await expect(page.locator('.cal-time-ruler > span').last()).toHaveText('24:00');
  await expect(page.getByRole('button', { name: /기존 학교 수업, 08:00부터 16:00까지/ })).toBeVisible();
  await expect(page.locator('.available-stat .stat-value')).toContainText('160시간');
  await page.getByRole('link', { name: '주간 학습 계획', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /기존 수학 교재/ })).toBeChecked();
  await expect(page.locator('.stat-card').nth(2)).toContainText('158시간 30분');
  await page.reload();
  await expect(page.locator('.available-stat .stat-value')).toContainText('160시간');
  await expect(page.getByRole('checkbox', { name: /기존 수학 교재/ })).toBeChecked();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('chagok-planner-v1')!))).toEqual({
    version: 3, categories: defaultCategories, events: legacy.events, goals: legacy.goals, isDemo: false,
  });
});

test('custom categories can be created without an event and reused after reload', async ({ page }) => {
  await openEmpty(page);
  await page.locator('.cal-card').getByRole('button', { name: '일정 종류 추가', exact: true }).click();
  const categoryDialog = page.getByRole('dialog', { name: '새 일정 종류', exact: true });
  await categoryDialog.getByLabel('종류 이름', { exact: true }).fill('운동');
  await categoryDialog.getByLabel('종류 색상', { exact: true }).fill('#e16d79');
  await categoryDialog.getByRole('button', { name: '종류 추가', exact: true }).click();
  await expect(categoryDialog).not.toBeVisible();
  await expect(page.locator('.cal-legend')).toContainText('운동');
  await expect(page.locator('.available-stat .stat-value')).toContainText('168시간');
  await page.reload();
  await expect(page.locator('.cal-legend')).toContainText('운동');
  await expect(page.locator('.cal-legend > span').filter({ hasText: '운동' }).locator('i')).toHaveCSS('background-color', 'rgb(225, 109, 121)');
  const dialog = await newEvent(page, '수영 연습', '18:00', '19:00');
  await dialog.getByRole('button', { name: '운동', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '운동', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: '일정 추가', exact: true }).click();
  await expect(page.getByRole('button', { name: /운동, 수영 연습, 18:00부터 19:00까지/ })).toBeVisible();
  await expect(page.locator('.available-stat .stat-value')).toContainText('167시간');
});

test('adding a category inside an event keeps the draft and displays it in week and month views', async ({ page }) => {
  await openEmpty(page);
  const dialog = await newEvent(page, '독서 모임', '18:00', '19:30');
  await dialog.getByRole('button', { name: '종류 추가', exact: true }).click();
  await dialog.getByLabel('종류 이름', { exact: true }).fill('동아리');
  await dialog.getByLabel('종류 색상', { exact: true }).fill('#359c8a');
  await dialog.getByRole('button', { name: '종류 추가', exact: true }).click();
  await expect(dialog.getByLabel('일정 이름', { exact: true })).toHaveValue('독서 모임');
  await expect(dialog.getByLabel('시작 시간', { exact: true })).toHaveValue('18:00');
  await expect(dialog.getByLabel('종료 시간', { exact: true })).toHaveValue('19:30');
  await expect(dialog.getByRole('button', { name: '동아리', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: '일정 추가', exact: true }).click();
  const timedEvent = page.getByRole('button', { name: /동아리, 독서 모임, 18:00부터 19:30까지/ });
  await expect(timedEvent.locator('.cal-event-kind')).toHaveText('동아리');
  await expect(page.locator('.available-stat .stat-value')).toContainText('166시간 30분');
  await page.getByRole('link', { name: '주간 학습 계획', exact: true }).click();
  await expect(page.locator('.available-stat .stat-value')).toContainText('166시간 30분');
  await page.getByRole('link', { name: '캘린더', exact: true }).click();
  await page.reload();
  await timedEvent.click();
  await expect(dialog.getByRole('button', { name: '동아리', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: '변경사항 저장', exact: true }).click();
  await expect(page.getByRole('button', { name: /동아리, 독서 모임, 종일/ })).toHaveClass(/cal-all-day-event/);
  await expect(page.locator('.available-stat .stat-value')).toContainText('144시간');
  await page.getByRole('button', { name: '월간', exact: true }).click();
  await expect(page.getByRole('button', { name: /동아리, 독서 모임, 종일/ })).toHaveClass(/cal-month-event/);
});

test('category creation validates names and is usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openEmpty(page);
  await page.locator('.cal-card').getByRole('button', { name: '일정 종류 추가', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '새 일정 종류', exact: true });
  await dialog.getByLabel('종류 이름', { exact: true }).fill('   ');
  await dialog.getByRole('button', { name: '종류 추가', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await dialog.getByLabel('종류 이름', { exact: true }).fill(' 학교 수업 ');
  await dialog.getByRole('button', { name: '종류 추가', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(page.locator('.cal-legend > span').filter({ hasText: '학교 수업' })).toHaveCount(1);
  await dialog.getByLabel('종류 이름', { exact: true }).fill('수면과 휴식');
  await dialog.getByRole('button', { name: '종류 추가', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.cal-legend')).toContainText('수면과 휴식');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/categories-mobile.png', fullPage: true });
});

test('demo, month view and mobile layout stay usable', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-10-05T10:00:00+09:00'));
  await page.goto('/');
  await expect(page.getByText('예시 플래너', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/calendar-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '월간', exact: true }).click();
  await expect(page.locator('.cal-month-grid')).toBeVisible();
  await page.getByRole('button', { name: '다음 달', exact: true }).click();
  await expect(page.locator('.cal-month-toolbar')).toContainText('2026년 11월');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '주간', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: '데이터 관리', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: '닫기', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'test-results/calendar-mobile.png', fullPage: true });
  await page.getByRole('link', { name: '주간 학습 계획', exact: true }).click();
  await page.getByRole('button', { name: '오늘', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/goals-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/goals-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '새 플래너 시작', exact: true }).click();
  await page.getByRole('button', { name: '비우고 시작하기' }).click();
  await expect(page.locator('.available-stat .stat-value')).toContainText('168시간');
  await expect(page.getByText('예시 플래너', { exact: true })).not.toBeVisible();
  await page.reload();
  await expect(page.locator('.stat-card').nth(1)).toContainText('0분');
  expect(errors).toEqual([]);
});

test('corrupted stored data is not overwritten automatically', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('chagok-planner-v1', '{broken'));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('자동 저장을 멈췄습니다');
  expect(await page.evaluate(() => localStorage.getItem('chagok-planner-v1'))).toBe('{broken');
});
