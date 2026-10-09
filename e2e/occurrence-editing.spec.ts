import { expect, test, type Page } from '@playwright/test';
import type { PlannerState, ScheduleEvent } from '../src/types';

const week = '2026-10-05';
const event = (changes: Partial<ScheduleEvent> = {}): ScheduleEvent => ({
  id: 'series', title: '반복 수학 공부', type: 'math', date: '2026-09-28',
  startTime: '09:00', endTime: '10:00', allDay: false,
  recurrence: 'weekly', weekdays: [1, 3, 5], repeatUntil: '2026-10-23', ...changes,
});
const fixture = (events: ScheduleEvent[]): PlannerState => ({
  version: 3, isDemo: false, subjects: ['수학'],
  categories: [
    { id: 'math', label: '수학', color: '#D81B60' },
    { id: 'personal', label: '개인 일정', color: '#0B8043' },
  ],
  events,
  goals: [{ id: 'goal', weekStart: week, subject: '수학', material: '개념서', range: '1단원', completed: false }],
});
const editor = (page: Page) => page.getByRole('dialog', { name: '일정 수정', exact: true });
const stored = (page: Page): Promise<PlannerState> => page.evaluate(() => JSON.parse(localStorage.getItem('chagok-planner-v1')!));
const timed = (page: Page, date: string) => page.locator(`.cal-day-column[data-date="${date}"] .cal-event`);

async function open(page: Page, data = fixture([event()])) {
  await page.clock.setFixedTime(new Date('2026-10-05T10:00:00+09:00'));
  await page.addInitScript(value => {
    if (!localStorage.getItem('chagok-planner-v1')) localStorage.setItem('chagok-planner-v1', JSON.stringify(value));
  }, data);
  await page.goto('/');
  await expect(page.locator('.planner-content')).toHaveAttribute('aria-busy', 'false');
}

async function expectTimes(page: Page, available: string, planned: string) {
  await expect(page.locator('.available-stat .stat-value')).toContainText(available);
  await expect(page.locator('.planned-stat .stat-value')).toContainText(planned);
}

async function singleOccurrence(page: Page, date: string) {
  await expect(editor(page).getByRole('group', { name: '적용 범위', exact: true })).toBeVisible();
  await expect(editor(page).getByRole('radio', { name: '이 일정만', exact: true })).toBeChecked();
  await expect(editor(page).getByRole('radio', { name: '전체 반복 일정', exact: true })).not.toBeChecked();
  await expect(editor(page).getByLabel('날짜', { exact: true })).toHaveValue(date);
  await expect(editor(page).getByLabel('반복', { exact: true })).toHaveCount(0);
}

test('editing a clicked weekly occurrence moves only that date and keeps the detached event independent of whole-series edits', async ({ page }) => {
  const data = fixture([event()]);
  await open(page, data);
  await expectTimes(page, '168시간', '3시간');
  await timed(page, '2026-10-07').click();
  await singleOccurrence(page, '2026-10-07');
  await editor(page).getByLabel('일정 이름', { exact: true }).fill('목요일 보충 공부');
  await editor(page).getByLabel('날짜', { exact: true }).fill('2026-10-08');
  await editor(page).getByLabel('시작 시간', { exact: true }).fill('10:00');
  await editor(page).getByLabel('종료 시간', { exact: true }).fill('12:00');
  await editor(page).getByRole('button', { name: '변경사항 저장', exact: true }).click();
  await expect(timed(page, '2026-10-07')).toHaveCount(0);
  await expect(timed(page, '2026-10-08')).toContainText('목요일 보충 공부');
  await expect(timed(page, week)).toContainText('반복 수학 공부');
  await expect(timed(page, '2026-10-09')).toContainText('반복 수학 공부');
  await expectTimes(page, '168시간', '4시간');
  await expect.poll(async () => (await stored(page)).events.length).toBe(2);
  const afterEdit = await stored(page);
  expect(afterEdit.events.find(item => item.id === 'series')).toEqual({ ...data.events[0], excludedDates: ['2026-10-07'] });
  const detached = afterEdit.events.find(item => item.id !== 'series')!;
  expect(detached).toMatchObject({ title: '목요일 보충 공부', date: '2026-10-08', startTime: '10:00', endTime: '12:00', recurrence: 'none', weekdays: [] });
  expect(detached.repeatUntil).toBeUndefined();
  expect(detached.customRecurrence).toBeUndefined();
  expect(detached.excludedDates).toBeUndefined();
  expect(afterEdit.goals).toEqual(data.goals);

  await page.reload();
  await expectTimes(page, '168시간', '4시간');
  await expect(timed(page, '2026-10-07')).toHaveCount(0);
  await page.getByRole('link', { name: '주간 학습 계획', exact: true }).click();
  await expectTimes(page, '168시간', '4시간');
  await page.getByRole('link', { name: '캘린더', exact: true }).click();
  await page.getByRole('button', { name: '다음 주', exact: true }).click();
  await expect(page.locator('.cal-event')).toHaveCount(3);
  await expectTimes(page, '168시간', '3시간');
  await page.getByRole('button', { name: '이전 주', exact: true }).click();

  await timed(page, week).click();
  await singleOccurrence(page, week);
  await editor(page).getByRole('radio', { name: '전체 반복 일정', exact: true }).check();
  await expect(editor(page).getByLabel('반복 시작일', { exact: true })).toHaveValue('2026-09-28');
  await editor(page).getByLabel('일정 이름', { exact: true }).fill('반복 제목 변경');
  await editor(page).getByRole('button', { name: '변경사항 저장', exact: true }).click();
  await expect(timed(page, week)).toContainText('반복 제목 변경');
  await expect(timed(page, '2026-10-09')).toContainText('반복 제목 변경');
  await expect(timed(page, '2026-10-07')).toHaveCount(0);
  await expect(timed(page, '2026-10-08')).toContainText('목요일 보충 공부');
  await timed(page, '2026-10-09').click();
  await singleOccurrence(page, '2026-10-09');
  await editor(page).getByRole('radio', { name: '전체 반복 일정', exact: true }).check();
  await editor(page).getByRole('button', { name: '삭제', exact: true }).click();
  await editor(page).getByRole('button', { name: '삭제하기', exact: true }).click();
  await expect(page.locator('.cal-event')).toHaveCount(1);
  await expect(page.locator('.cal-event')).toContainText('목요일 보충 공부');
  await expectTimes(page, '168시간', '2시간');
  await page.getByRole('button', { name: '다음 주', exact: true }).click();
  await expect(page.locator('.cal-event')).toHaveCount(0);
  await expectTimes(page, '168시간', '0분');
});

test('cancelled edits and deletes preserve data, while deleting one custom occurrence neither extends its count nor appears in print', async ({ page }) => {
  const data = fixture([event({
    date: week, recurrence: 'custom', weekdays: [], repeatUntil: undefined,
    customRecurrence: { interval: 1, unit: 'day', weekdays: [], monthPattern: 'dayOfMonth', end: { type: 'count', count: 3 } },
  })]);
  await open(page, data);
  const before = await stored(page);
  await timed(page, '2026-10-06').click();
  await singleOccurrence(page, '2026-10-06');
  await editor(page).getByLabel('일정 이름', { exact: true }).fill('저장하지 않을 수정');
  await editor(page).getByRole('button', { name: '삭제', exact: true }).click();
  await editor(page).getByRole('button', { name: '돌아가기', exact: true }).click();
  await editor(page).getByRole('button', { name: '취소', exact: true }).click();
  expect(await stored(page)).toEqual(before);
  await expectTimes(page, '168시간', '3시간');

  await timed(page, '2026-10-06').click();
  await singleOccurrence(page, '2026-10-06');
  await editor(page).getByRole('button', { name: '삭제', exact: true }).click();
  await editor(page).getByRole('button', { name: '삭제하기', exact: true }).click();
  await expect(timed(page, week)).toHaveCount(1);
  await expect(timed(page, '2026-10-06')).toHaveCount(0);
  await expect(timed(page, '2026-10-07')).toHaveCount(1);
  await expect(timed(page, '2026-10-08')).toHaveCount(0);
  await expectTimes(page, '168시간', '2시간');
  await expect.poll(async () => (await stored(page)).events[0].excludedDates).toEqual(['2026-10-06']);
  expect((await stored(page)).events[0].customRecurrence).toEqual(data.events[0].customRecurrence);
  await page.locator('.cal-toolbar').getByRole('button', { name: '프린트', exact: true }).click();
  const printed = page.locator('.calendar-print-page [data-print-event-id="series"]');
  await expect(printed).toHaveCount(2);
  expect(await printed.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-print-date')))).toEqual([week, '2026-10-07']);
  await page.keyboard.press('Escape');
  await page.reload();
  await expectTimes(page, '168시간', '2시간');
  await expect(timed(page, '2026-10-06')).toHaveCount(0);
  await page.getByRole('button', { name: '다음 주', exact: true }).click();
  await expectTimes(page, '168시간', '0분');
  await expect(page.locator('.cal-event')).toHaveCount(0);
});

test('month view edits the visible all-day occurrence into a single timed event without changing later months', async ({ page }) => {
  await open(page, fixture([event({ title: '월간 종일 공부', date: '2026-09-06', recurrence: 'monthly', weekdays: [], repeatUntil: undefined, allDay: true })]));
  await expectTimes(page, '168시간', '24시간');
  await page.getByRole('button', { name: '월간', exact: true }).click();
  await page.getByRole('button', { name: /10월 6일.*월간 종일 공부.*일정 수정/ }).click();
  await singleOccurrence(page, '2026-10-06');
  await editor(page).getByLabel('일정 이름', { exact: true }).fill('이번 달 개인 일정');
  await editor(page).getByRole('button', { name: '개인 일정', exact: true }).click();
  await editor(page).getByRole('checkbox').uncheck();
  await editor(page).getByLabel('시작 시간', { exact: true }).fill('13:00');
  await editor(page).getByLabel('종료 시간', { exact: true }).fill('14:30');
  await editor(page).getByRole('button', { name: '변경사항 저장', exact: true }).click();
  await expect(page.getByRole('button', { name: /10월 6일.*이번 달 개인 일정.*일정 수정/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /10월 6일.*월간 종일 공부.*일정 수정/ })).toHaveCount(0);
  await expectTimes(page, '166시간 30분', '0분');
  await page.getByRole('button', { name: '다음 달', exact: true }).click();
  await expect(page.getByRole('button', { name: /11월 6일.*월간 종일 공부.*일정 수정/ })).toBeVisible();
  await page.reload();
  await expect(page.locator('.cal-all-day-event')).toHaveCount(0);
  await expect(timed(page, '2026-10-06')).toContainText('이번 달 개인 일정');
  await expectTimes(page, '166시간 30분', '0분');
  const result = await stored(page);
  expect(result.events.find(item => item.id === 'series')).toMatchObject({ date: '2026-09-06', recurrence: 'monthly', allDay: true, excludedDates: ['2026-10-06'] });
  expect(result.events.find(item => item.id !== 'series')).toMatchObject({ date: '2026-10-06', type: 'personal', recurrence: 'none', allDay: false });
});

test('mobile weekly all-day deletion uses the clicked day and preserves other repeats after reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, fixture([event({ allDay: true, weekdays: [1, 3] })]));
  await expectTimes(page, '168시간', '48시간');
  await page.getByRole('button', { name: /10월 7일.*반복 수학 공부.*일정 수정/ }).click();
  await singleOccurrence(page, '2026-10-07');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await editor(page).getByRole('button', { name: '삭제', exact: true }).click();
  await editor(page).getByRole('button', { name: '삭제하기', exact: true }).click();
  await expect(page.locator('.cal-all-day-event')).toHaveCount(1);
  await expect(page.locator('.cal-all-day-event')).toHaveAttribute('aria-label', /10월 5일/);
  await expectTimes(page, '168시간', '24시간');
  await page.reload();
  await expect(page.locator('.cal-all-day-event')).toHaveCount(1);
  await expectTimes(page, '168시간', '24시간');
  await page.getByRole('button', { name: '다음 주', exact: true }).click();
  await expect(page.locator('.cal-all-day-event')).toHaveCount(2);
  await expectTimes(page, '168시간', '48시간');
});
