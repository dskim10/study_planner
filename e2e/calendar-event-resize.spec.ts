import { expect, test, type Page } from '@playwright/test';
import type { PlannerState, ScheduleEvent } from '../src/types';

const monday = '2026-10-05';
const tuesday = '2026-10-06';
const wednesday = '2026-10-07';
const friday = '2026-10-09';
const event = (changes: Partial<ScheduleEvent> = {}): ScheduleEvent => ({
  id: 'resizing', title: '길이를 바꿀 수학 공부', type: 'math', date: monday,
  startTime: '09:00', endTime: '10:00', allDay: false, recurrence: 'none', weekdays: [], ...changes,
});
const fixture = (events: ScheduleEvent[] = [event()]): PlannerState => ({
  version: 3, isDemo: false, subjects: ['수학'],
  categories: [{ id: 'math', label: '수학', color: '#D81B60' }, { id: 'personal', label: '개인 일정', color: '#0B8043' }],
  events,
  goals: [{ id: 'goal', weekStart: monday, subject: '수학', material: '개념서', range: '1단원', completed: false }],
});
const column = (page: Page, date = monday) => page.locator(`.cal-day-column[data-date="${date}"]`);
const timed = (page: Page, date = monday, id = 'resizing') => column(page, date).locator(`.cal-event[data-event-id="${id}"]`);
const edge = (page: Page, date = monday, id = 'resizing') => timed(page, date, id).locator('.cal-event-resize-edge');
const preview = (page: Page) => page.locator('.cal-event-resize-preview');
const editor = (page: Page) => page.getByRole('dialog', { name: '일정 수정', exact: true });
const stored = (page: Page): Promise<PlannerState> => page.evaluate(() => JSON.parse(localStorage.getItem('chagok-planner-v1')!));
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

async function open(page: Page, data = fixture(), desktop = true) {
  if (desktop) await page.setViewportSize({ width: 1440, height: 1100 });
  await page.clock.setFixedTime(new Date('2026-10-05T10:00:00+09:00'));
  await page.addInitScript(value => {
    if (!localStorage.getItem('chagok-planner-v1')) localStorage.setItem('chagok-planner-v1', JSON.stringify(value));
  }, data);
  await page.goto('/');
  await expect(page.locator('.planner-content')).toHaveAttribute('aria-busy', 'false');
}

async function resizePoints(page: Page, endMinute: number, date = monday, destinationDate = date, id = 'resizing') {
  await timed(page, date, id).evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center' }));
  const bounds = await edge(page, date, id).boundingBox();
  const target = await column(page, destinationDate).boundingBox();
  expect(bounds).not.toBeNull();
  expect(target).not.toBeNull();
  const original = (await stored(page)).events.find(item => item.id === id)!;
  const start = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };
  return {
    start,
    end: { x: target!.x + target!.width / 2, y: start.y + (endMinute - minutes(original.endTime)) / 1440 * target!.height },
  };
}

async function beginResize(page: Page, endMinute: number, date = monday, destinationDate = date, id = 'resizing') {
  const points = await resizePoints(page, endMinute, date, destinationDate, id);
  await page.mouse.move(points.start.x, points.start.y);
  await page.mouse.down();
  await page.mouse.move(points.end.x, points.end.y, { steps: 8 });
  return points;
}

async function expectPreview(page: Page, start: number, end: number, date = monday) {
  await expect(column(page, date).locator('.cal-event-resize-preview')).toBeVisible();
  await expect(preview(page)).toHaveAttribute('data-resize-start', String(start));
  await expect(preview(page)).toHaveAttribute('data-resize-end', String(end));
  await expect(page.locator('.cal-event-move-preview')).toHaveCount(0);
}

test('the bottom edge resizes the end in quarter-hours with a preview, overlap totals and reload persistence', async ({ page }) => {
  await open(page, fixture([
    event(),
    event({ id: 'fixed', title: '개인 일정', type: 'personal', startTime: '10:00', endTime: '11:00' }),
  ]));
  const original = await stored(page);
  await timed(page).hover();
  await expect(timed(page)).toHaveCSS('cursor', 'grab');
  await edge(page).hover();
  await expect(edge(page)).toHaveCSS('cursor', 'ns-resize');
  await beginResize(page, 10 * 60 + 32);
  await expectPreview(page, 540, 630);
  expect(await stored(page)).toEqual(original);
  await expect(page.locator('.planned-stat .stat-value')).toContainText('1시간');
  await expect(page.locator('.remaining-stat .stat-value')).toContainText('166시간');
  await page.mouse.up();
  await expect(preview(page)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async () => (await stored(page)).events[0]).toEqual({ ...original.events[0], endTime: '10:30' });
  await expect(page.locator('.planned-stat .stat-value')).toContainText('1시간 30분');
  await expect(page.locator('.available-stat .stat-value')).toContainText('167시간');
  await expect(page.locator('.remaining-stat .stat-value')).toContainText('166시간');

  await beginResize(page, 9 * 60 + 30);
  await expectPreview(page, 540, 570);
  await page.mouse.up();
  const expected = { ...original, events: [{ ...original.events[0], endTime: '09:30' }, original.events[1]] };
  await expect.poll(() => stored(page)).toEqual(expected);
  await expect(page.locator('.planned-stat .stat-value')).toContainText('30분');
  await expect(page.locator('.remaining-stat .stat-value')).toContainText('166시간 30분');
  await page.reload();
  await expect(timed(page)).toContainText('09:00 – 09:30');
  await page.getByRole('link', { name: '주간 학습 계획', exact: true }).click();
  await expect(page.locator('.planned-stat .stat-value')).toContainText('30분');
  expect(await stored(page)).toEqual(expected);
});

test('resizing keeps at least fifteen minutes and never extends beyond the same-day midnight', async ({ page }) => {
  await open(page, fixture([
    event(),
    event({ id: 'odd', date: tuesday, startTime: '09:02' }),
    event({ id: 'late', startTime: '22:00', endTime: '23:00' }),
  ]));
  await beginResize(page, 8 * 60 + 45);
  await expectPreview(page, 540, 555);
  await page.mouse.up();
  await expect.poll(async () => (await stored(page)).events[0]).toMatchObject({ startTime: '09:00', endTime: '09:15' });

  await beginResize(page, 9 * 60, tuesday, tuesday, 'odd');
  await expectPreview(page, 542, 570, tuesday);
  await page.mouse.up();
  await expect.poll(async () => (await stored(page)).events[1]).toMatchObject({ startTime: '09:02', endTime: '09:30' });

  await beginResize(page, 1440, monday, monday, 'late');
  await expectPreview(page, 1320, 1440);
  await page.mouse.up();
  await expect.poll(async () => (await stored(page)).events[2]).toMatchObject({ date: monday, startTime: '22:00', endTime: '24:00' });
  await page.reload();
  await expect(timed(page, monday, 'late')).toContainText('22:00 – 24:00');
});

test('a recurring resize keeps the selected occurrence date and whole-series rules while allowing scope selection', async ({ page }) => {
  const recurring = event({
    id: 'series', date: '2026-09-28', recurrence: 'custom', weekdays: [1, 3, 5],
    customRecurrence: { interval: 1, unit: 'week', weekdays: [1, 3, 5], monthPattern: 'dayOfMonth', end: { type: 'count', count: 9 } },
  });
  await open(page, fixture([recurring]));
  const original = await stored(page);
  await beginResize(page, 11 * 60 + 15, wednesday, wednesday, 'series');
  await page.mouse.up();
  await expect(editor(page).getByRole('radio', { name: '이 일정만', exact: true })).toBeChecked();
  await expect(editor(page).getByLabel('날짜', { exact: true })).toHaveValue(wednesday);
  await expect(editor(page).getByLabel('시작 시간', { exact: true })).toHaveValue('09:00');
  await expect(editor(page).getByLabel('종료 시간', { exact: true })).toHaveValue('11:15');
  expect(await stored(page)).toEqual(original);
  await editor(page).getByRole('button', { name: '취소', exact: true }).click();
  expect(await stored(page)).toEqual(original);

  await beginResize(page, 11 * 60 + 15, wednesday, wednesday, 'series');
  await page.mouse.up();
  await editor(page).getByRole('button', { name: '변경사항 저장', exact: true }).click();
  await expect.poll(async () => (await stored(page)).events.length).toBe(2);
  const singleSaved = await stored(page);
  expect(singleSaved.events[0]).toEqual({ ...recurring, excludedDates: [wednesday] });
  const detached = singleSaved.events[1];
  expect(detached).toMatchObject({ date: wednesday, startTime: '09:00', endTime: '11:15', recurrence: 'none', weekdays: [] });
  expect(detached.customRecurrence).toBeUndefined();
  expect(detached.excludedDates).toBeUndefined();
  await expect(timed(page, wednesday, 'series')).toHaveCount(0);

  await beginResize(page, 10 * 60 + 30, friday, friday, 'series');
  await page.mouse.up();
  await editor(page).getByRole('radio', { name: '전체 반복 일정', exact: true }).check();
  await expect(editor(page).getByLabel('반복 시작일', { exact: true })).toHaveValue('2026-09-28');
  await expect(editor(page).getByLabel('시작 시간', { exact: true })).toHaveValue('09:00');
  await expect(editor(page).getByLabel('종료 시간', { exact: true })).toHaveValue('10:30');
  await editor(page).getByRole('button', { name: '변경사항 저장', exact: true }).click();
  await expect.poll(async () => (await stored(page)).events[0]).toEqual({ ...recurring, endTime: '10:30', excludedDates: [wednesday] });
  expect((await stored(page)).events[1]).toEqual(detached);
  expect((await stored(page)).goals).toEqual(original.goals);
  await page.reload();
  await expect(timed(page, friday, 'series')).toContainText('09:00 – 10:30');
  await expect(timed(page, wednesday, detached.id)).toContainText('09:00 – 11:15');
});

test('edge clicks edit, cancelled or no-op resizes preserve data, and a cross-column resize stays on its source date', async ({ page }) => {
  await open(page);
  const original = await stored(page);
  await edge(page).click();
  await expect(editor(page)).toBeVisible();
  await expect(editor(page).getByLabel('종료 시간', { exact: true })).toHaveValue('10:00');
  await page.keyboard.press('Escape');
  await beginResize(page, 11 * 60);
  await expect(preview(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(preview(page)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await stored(page)).toEqual(original);

  await beginResize(page, 11 * 60);
  await timed(page).dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', isPrimary: true });
  await page.mouse.up();
  await expect(preview(page)).toHaveCount(0);
  expect(await stored(page)).toEqual(original);

  await beginResize(page, 11 * 60);
  await page.mouse.move(10, 10);
  await page.mouse.up();
  await expect(preview(page)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await stored(page)).toEqual(original);

  const points = await beginResize(page, 10 * 60 + 30);
  await page.mouse.move(points.start.x, points.start.y, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await stored(page)).toEqual(original);

  await beginResize(page, 10 * 60 + 45, monday, tuesday);
  await expectPreview(page, 540, 645);
  await expect(column(page, tuesday).locator('.cal-event-resize-preview')).toHaveCount(0);
  await page.mouse.up();
  await expect.poll(async () => (await stored(page)).events[0]).toEqual({ ...original.events[0], endTime: '10:45' });
  await expect(timed(page, tuesday)).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.userSelect)).not.toBe('none');
});

test('keyboard resizing changes only the end and supports confirmation and cancellation', async ({ page }) => {
  await open(page);
  const original = await stored(page);
  await page.evaluate(() => {
    history.replaceState({}, '', '/?resize-history=previous');
    history.pushState({}, '', '/?resize-history=current');
  });
  await timed(page).focus();
  await page.keyboard.press('Alt+Shift+ArrowDown');
  await expectPreview(page, 540, 615);
  await page.keyboard.press('Alt+ArrowLeft');
  await expectPreview(page, 540, 615);
  await expect(page).toHaveURL(/\?resize-history=current$/);
  await page.keyboard.press('ArrowDown');
  await expectPreview(page, 540, 630);
  expect(await stored(page)).toEqual(original);
  await page.keyboard.press('Enter');
  await expect(preview(page)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async () => (await stored(page)).events[0]).toEqual({ ...original.events[0], endTime: '10:30' });
  await expect(timed(page)).toBeFocused();
  const resized = await stored(page);
  await page.keyboard.press('Alt+Shift+ArrowUp');
  await expectPreview(page, 540, 615);
  await page.keyboard.press('Escape');
  await expect(preview(page)).toHaveCount(0);
  expect(await stored(page)).toEqual(resized);
  await page.keyboard.press('Alt+Shift+ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await stored(page)).events[0]).toEqual(original.events[0]);
});

test('a short event at midnight keeps a movable body and a separate bottom resize area', async ({ page }) => {
  await open(page, fixture([event({ startTime: '23:55', endTime: '24:00' })]));
  const original = await stored(page);
  await beginResize(page, 23 * 60 + 45);
  await expectPreview(page, 1435, 1440);
  expect(await stored(page)).toEqual(original);
  await page.keyboard.press('Escape');
  await page.mouse.up();

  const bounds = await timed(page).boundingBox();
  const grid = await column(page).boundingBox();
  // The clipped block is only a few pixels tall; its upper body must remain reachable.
  const body = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + Math.min(1, bounds!.height / 4) };
  await page.mouse.move(body.x, body.y);
  await page.mouse.down();
  await page.mouse.move(body.x, body.y - grid!.height * 40 / 1440, { steps: 6 });
  await expect(preview(page)).toHaveCount(0);
  await expect(page.locator('.cal-event-move-preview')).toHaveAttribute('data-move-start', '1395');
  await expect(page.locator('.cal-event-move-preview')).toHaveAttribute('data-move-end', '1400');
  expect(await stored(page)).toEqual(original);
  await page.mouse.up();
  await expect.poll(async () => (await stored(page)).events[0]).toEqual({ ...original.events[0], startTime: '23:15', endTime: '23:20' });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test.describe('touch at the event bottom', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('touching the bottom still moves the full event instead of resizing it', async ({ page }) => {
    await open(page, fixture(), false);
    const original = await stored(page);
    await timed(page).evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center' }));
    const bounds = await edge(page).boundingBox();
    const grid = await column(page).boundingBox();
    const start = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    for (let step = 1; step <= 6; step++) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x, y: start.y + grid!.height / 24 * step / 6 }] });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await expect(preview(page)).toHaveCount(0);
    await expect(page.locator('.cal-event-move-preview')).toHaveAttribute('data-move-start', '600');
    await expect(page.locator('.cal-event-move-preview')).toHaveAttribute('data-move-end', '660');
    expect(await stored(page)).toEqual(original);
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await stored(page)).events[0]).toEqual({ ...original.events[0], startTime: '10:00', endTime: '11:00' });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await session.detach();
  });
});
