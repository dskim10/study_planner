import { expect, test, type Page } from '@playwright/test';
import type { PlannerState, ScheduleEvent } from '../src/types';

const monday = '2026-10-05';
const tuesday = '2026-10-06';
const wednesday = '2026-10-07';
const thursday = '2026-10-08';
const friday = '2026-10-09';
const event = (changes: Partial<ScheduleEvent> = {}): ScheduleEvent => ({
  id: 'moving', title: '옮길 수학 공부', type: 'math', date: monday,
  startTime: '09:00', endTime: '10:30', allDay: false, recurrence: 'none', weekdays: [], ...changes,
});
const fixture = (events: ScheduleEvent[] = [event()]): PlannerState => ({
  version: 3, isDemo: false, subjects: ['수학'],
  categories: [{ id: 'math', label: '수학', color: '#D81B60' }, { id: 'personal', label: '개인 일정', color: '#0B8043' }],
  events,
  goals: [{ id: 'goal', weekStart: monday, subject: '수학', material: '개념서', range: '1단원', completed: false }],
});
const column = (page: Page, date = monday) => page.locator(`.cal-day-column[data-date="${date}"]`);
const timed = (page: Page, date = monday, id = 'moving') => column(page, date).locator(`.cal-event[data-event-id="${id}"]`);
const preview = (page: Page) => page.locator('.cal-event-move-preview');
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

async function dragPoints(page: Page, from: string, to: string, startMinute: number, id = 'moving') {
  const source = timed(page, from, id);
  await source.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center' }));
  const sourceBounds = await source.boundingBox();
  const targetBounds = await column(page, to).boundingBox();
  expect(sourceBounds).not.toBeNull();
  expect(targetBounds).not.toBeNull();
  const original = (await stored(page)).events.find(item => item.id === id)!;
  // Grab the middle of the block: moving must preserve the pointer offset within the event.
  const start = { x: sourceBounds!.x + sourceBounds!.width / 2, y: sourceBounds!.y + sourceBounds!.height / 2 };
  return {
    start,
    end: { x: targetBounds!.x + targetBounds!.width / 2, y: start.y + (startMinute - minutes(original.startTime)) / 1440 * targetBounds!.height },
  };
}

async function beginDrag(page: Page, from: string, to: string, startMinute: number, id = 'moving') {
  const points = await dragPoints(page, from, to, startMinute, id);
  await page.mouse.move(points.start.x, points.start.y);
  await page.mouse.down();
  await page.mouse.move(points.end.x, points.end.y, { steps: 8 });
  return points;
}

async function expectPreview(page: Page, date: string, start: number, end: number) {
  await expect(column(page, date).locator('.cal-event-move-preview')).toBeVisible();
  await expect(preview(page)).toHaveAttribute('data-move-start', String(start));
  await expect(preview(page)).toHaveAttribute('data-move-end', String(end));
}

async function expectTimes(page: Page, planned: string, remaining: string) {
  await expect(page.locator('.available-stat .stat-value')).toContainText('167시간');
  await expect(page.locator('.planned-stat .stat-value')).toContainText(planned);
  await expect(page.locator('.remaining-stat .stat-value')).toContainText(remaining);
}

test('mouse moves retain duration, preview without saving and persist overlapping and cross-day study totals', async ({ page }) => {
  const data = fixture([
    event(),
    event({ id: 'other-study', title: '다른 수학 공부', startTime: '11:00', endTime: '12:00' }),
    event({ id: 'fixed', title: '개인 일정', type: 'personal', startTime: '11:00', endTime: '12:00' }),
  ]);
  await open(page, data);
  const original = await stored(page);
  await expectTimes(page, '2시간 30분', '165시간 30분');
  await beginDrag(page, monday, monday, 10 * 60 + 47);
  await expectPreview(page, monday, 645, 735);
  await expect(preview(page)).toContainText('옮길 수학 공부');
  expect(await stored(page)).toEqual(original);
  await expectTimes(page, '2시간 30분', '165시간 30분');
  await page.mouse.up();
  await expect(preview(page)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async () => (await stored(page)).events[0]).toEqual({ ...original.events[0], startTime: '10:45', endTime: '12:15' });
  await expectTimes(page, '1시간 30분', '166시간 30분');

  await beginDrag(page, monday, tuesday, 10 * 60 + 15);
  await expectPreview(page, tuesday, 615, 705);
  await page.mouse.up();
  await expect(timed(page, monday)).toHaveCount(0);
  await expect(timed(page, tuesday)).toContainText('10:15 – 11:45');
  await expectTimes(page, '2시간 30분', '165시간 30분');
  const expected = { ...original, events: [{ ...original.events[0], date: tuesday, startTime: '10:15', endTime: '11:45' }, ...original.events.slice(1)] };
  await expect.poll(() => stored(page)).toEqual(expected);
  await page.reload();
  await expect(timed(page, tuesday)).toContainText('10:15 – 11:45');
  await page.getByRole('link', { name: '주간 학습 계획', exact: true }).click();
  await expectTimes(page, '2시간 30분', '165시간 30분');
  expect(await stored(page)).toEqual(expected);
});

test('recurring drops preview the clicked occurrence and preserve the original rule for single and whole-series saves', async ({ page }) => {
  const recurring = event({
    id: 'series', date: '2026-09-28', endTime: '10:00', recurrence: 'custom', weekdays: [1, 3, 5],
    customRecurrence: { interval: 1, unit: 'week', weekdays: [1, 3, 5], monthPattern: 'dayOfMonth', end: { type: 'count', count: 9 } },
  });
  await open(page, fixture([recurring]));
  const original = await stored(page);
  await beginDrag(page, wednesday, thursday, 11 * 60, 'series');
  await page.mouse.up();
  await expect(editor(page)).toBeVisible();
  await expect(editor(page).getByRole('radio', { name: '이 일정만', exact: true })).toBeChecked();
  await expect(editor(page).getByLabel('날짜', { exact: true })).toHaveValue(thursday);
  await expect(editor(page).getByLabel('시작 시간', { exact: true })).toHaveValue('11:00');
  await expect(editor(page).getByLabel('종료 시간', { exact: true })).toHaveValue('12:00');
  expect(await stored(page)).toEqual(original);
  await editor(page).getByRole('button', { name: '취소', exact: true }).click();
  expect(await stored(page)).toEqual(original);

  await beginDrag(page, wednesday, thursday, 11 * 60, 'series');
  await page.mouse.up();
  await editor(page).getByRole('button', { name: '변경사항 저장', exact: true }).click();
  await expect.poll(async () => (await stored(page)).events.length).toBe(2);
  const singleSaved = await stored(page);
  expect(singleSaved.events[0]).toEqual({ ...recurring, excludedDates: [wednesday] });
  const detached = singleSaved.events[1];
  expect(detached).toMatchObject({ date: thursday, startTime: '11:00', endTime: '12:00', recurrence: 'none', weekdays: [] });
  expect(detached.id).not.toBe('series');
  expect(detached.customRecurrence).toBeUndefined();
  expect(detached.excludedDates).toBeUndefined();
  await expect(timed(page, wednesday, 'series')).toHaveCount(0);

  await beginDrag(page, friday, tuesday, 10 * 60 + 15, 'series');
  await page.mouse.up();
  await expect(editor(page).getByLabel('날짜', { exact: true })).toHaveValue(tuesday);
  await editor(page).getByRole('radio', { name: '전체 반복 일정', exact: true }).check();
  await expect(editor(page).getByLabel('반복 시작일', { exact: true })).toHaveValue('2026-09-28');
  await expect(editor(page).getByLabel('시작 시간', { exact: true })).toHaveValue('10:15');
  await editor(page).getByRole('button', { name: '변경사항 저장', exact: true }).click();
  await expect.poll(async () => (await stored(page)).events[0]).toEqual({ ...recurring, startTime: '10:15', endTime: '11:15', excludedDates: [wednesday] });
  expect((await stored(page)).events[1]).toEqual(detached);
  await expect(timed(page, tuesday, 'series')).toHaveCount(0);
  await expect(timed(page, friday, 'series')).toContainText('10:15 – 11:15');
  await page.reload();
  await expect(timed(page, wednesday, 'series')).toHaveCount(0);
  await expect(timed(page, thursday, detached.id)).toContainText('11:00 – 12:00');
  expect((await stored(page)).goals).toEqual(original.goals);
});

test('Escape, pointer cancellation, outside drops, no-op drops and page changes discard temporary moves', async ({ page }) => {
  await open(page);
  const original = await stored(page);
  await beginDrag(page, monday, monday, 10 * 60);
  await expect(preview(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(preview(page)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await stored(page)).toEqual(original);

  await beginDrag(page, monday, tuesday, 10 * 60);
  await timed(page).dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', isPrimary: true });
  await page.mouse.up();
  await expect(preview(page)).toHaveCount(0);
  expect(await stored(page)).toEqual(original);

  await beginDrag(page, monday, monday, 10 * 60);
  await page.mouse.move(10, 10);
  await page.mouse.up();
  await expect(preview(page)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await stored(page)).toEqual(original);

  const points = await beginDrag(page, monday, monday, 10 * 60);
  await page.mouse.move(points.start.x, points.start.y, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await stored(page)).toEqual(original);

  await beginDrag(page, monday, tuesday, 10 * 60);
  await page.evaluate(() => { location.hash = '#plan'; });
  await page.mouse.up();
  await expect(page.locator('.cal-time-grid')).toHaveCount(0);
  expect(await stored(page)).toEqual(original);
  expect(await page.evaluate(() => document.body.style.userSelect)).not.toBe('none');
  await page.getByRole('link', { name: '캘린더', exact: true }).click();
  await timed(page).click();
  await expect(editor(page)).toBeVisible();
  await expect(editor(page).getByLabel('시작 시간', { exact: true })).toHaveValue('09:00');
});

test('keyboard movement uses quarter-hours and day changes, commits once and supports cancellation', async ({ page }) => {
  await open(page);
  const original = await stored(page);
  await timed(page).focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expectPreview(page, monday, 555, 645);
  await page.keyboard.press('Alt+ArrowRight');
  await expectPreview(page, tuesday, 555, 645);
  expect(await stored(page)).toEqual(original);
  await page.keyboard.press('Enter');
  await expect(preview(page)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async () => (await stored(page)).events[0]).toEqual({ ...original.events[0], date: tuesday, startTime: '09:15', endTime: '10:45' });
  await expect(timed(page, tuesday)).toBeFocused();
  const moved = await stored(page);
  await page.keyboard.press('Alt+ArrowUp');
  await expectPreview(page, tuesday, 540, 630);
  await page.keyboard.press('Escape');
  await expect(preview(page)).toHaveCount(0);
  expect(await stored(page)).toEqual(moved);
  await page.keyboard.press('Enter');
  await expect(editor(page)).toBeVisible();
});

test('keyboard moves clamp at midnight without shortening the schedule', async ({ page }) => {
  await open(page, fixture([
    event({ id: 'early', startTime: '00:00', endTime: '01:00' }),
    event({ id: 'late', startTime: '23:00', endTime: '24:00' }),
  ]));
  const original = await stored(page);
  await timed(page, monday, 'early').focus();
  await page.keyboard.press('Alt+ArrowUp');
  await page.keyboard.press('Enter');
  expect(await stored(page)).toEqual(original);
  await timed(page, monday, 'late').focus();
  await page.keyboard.press('Alt+ArrowDown');
  await page.keyboard.press('Enter');
  expect(await stored(page)).toEqual(original);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(timed(page, monday, 'late')).toContainText('23:00 – 24:00');
});

test('holding a drag near the viewport edge scrolls and updates its time preview before a stable drop', async ({ page }) => {
  await open(page);
  const original = await stored(page);
  const { start } = await dragPoints(page, monday, monday, 9 * 60);
  const viewport = page.viewportSize()!;
  const initialScroll = await page.evaluate(() => window.scrollY);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, viewport.height - 30, { steps: 8 });
  await expect(preview(page)).toBeVisible();
  const firstStart = Number(await preview(page).getAttribute('data-move-start'));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(initialScroll + 55);
  // No pointer movement occurred between these reads: scrolling must refresh the target time.
  await expect.poll(async () => Number(await preview(page).getAttribute('data-move-start'))).toBeGreaterThan(firstStart);
  expect(await stored(page)).toEqual(original);

  // Leave the edge before reading the final preview so another animation frame cannot advance it during mouseup.
  await page.mouse.move(start.x, viewport.height - 160);
  await expect(preview(page)).toBeVisible();
  const finalStart = Number(await preview(page).getAttribute('data-move-start'));
  const finalEnd = Number(await preview(page).getAttribute('data-move-end'));
  expect(finalEnd - finalStart).toBe(90);
  await page.screenshot({ path: test.info().outputPath('desktop-moving.png') });
  await page.mouse.up();
  await expect.poll(async () => minutes((await stored(page)).events[0].startTime)).toBe(finalStart);
  expect(minutes((await stored(page)).events[0].endTime)).toBe(finalEnd);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('changing the week, month view or source visibility cancels a held event move', async ({ page }) => {
  await open(page);
  const original = await stored(page);
  await beginDrag(page, monday, tuesday, 10 * 60);
  await expect(preview(page)).toBeVisible();
  await page.getByRole('button', { name: '다음 주', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  await page.mouse.up();
  await expect(preview(page)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await stored(page)).events).toEqual(original.events);
  await page.getByRole('button', { name: '이전 주', exact: true }).click();

  await beginDrag(page, monday, tuesday, 10 * 60);
  await expect(preview(page)).toBeVisible();
  await page.getByRole('button', { name: '월간', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  await page.mouse.up();
  await expect(preview(page)).toHaveCount(0);
  await expect(page.locator('.cal-month')).toBeVisible();
  expect((await stored(page)).events).toEqual(original.events);
  await page.getByRole('button', { name: '주간', exact: true }).click();

  await beginDrag(page, monday, tuesday, 10 * 60);
  await expect(preview(page)).toBeVisible();
  const sourceFilter = page.locator('.calendar-legend').getByRole('checkbox', { name: '수학', exact: true });
  await sourceFilter.evaluate(input => (input as HTMLInputElement).click());
  await page.mouse.up();
  await expect(preview(page)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(timed(page)).toHaveCount(0);
  expect((await stored(page)).events).toEqual(original.events);
  expect(await page.evaluate(() => document.body.style.userSelect)).not.toBe('none');
  await sourceFilter.check();
  await expect(timed(page)).toHaveCount(1);
  expect((await stored(page)).events).toEqual(original.events);
});

test('a physical pointer drop at the last minute keeps the event within midnight', async ({ page }) => {
  await open(page, fixture([event({ startTime: '22:00', endTime: '23:00' })]));
  const { start } = await dragPoints(page, monday, monday, 22 * 60);
  const bounds = await column(page).boundingBox();
  const end = { x: start.x, y: bounds!.y + bounds!.height - 2 };
  expect(end.y).toBeLessThan(page.viewportSize()!.height);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await expectPreview(page, monday, 1380, 1440);
  await page.mouse.up();
  await expect.poll(async () => (await stored(page)).events[0]).toMatchObject({ date: monday, startTime: '23:00', endTime: '24:00' });
  await expect(timed(page)).toContainText('23:00 – 24:00');
});

test.describe('touch event movement', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('touch dragging the event body moves it while empty slots scroll and tapping still edits', async ({ page }) => {
    await open(page, fixture(), false);
    const original = await stored(page);
    const body = timed(page);
    await body.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center' }));
    await page.screenshot({ path: test.info().outputPath('mobile-event-body.png') });
    const bounds = await body.boundingBox();
    const grid = await column(page).boundingBox();
    expect(bounds).not.toBeNull();
    const start = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };
    const shift = grid!.height / 24;
    const beforeMoveScroll = await page.evaluate(() => window.scrollY);
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    for (let step = 1; step <= 6; step++) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x, y: start.y + shift * step / 6 }] });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await expectPreview(page, monday, 600, 690);
    expect(await stored(page)).toEqual(original);
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await stored(page)).events[0]).toEqual({ ...original.events[0], startTime: '10:00', endTime: '11:30' });
    expect(await page.evaluate(() => window.scrollY)).toBe(beforeMoveScroll);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const moved = await stored(page);

    const emptySlot = column(page).locator('.cal-empty-slot[data-slot-minute="840"]');
    await emptySlot.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center' }));
    const emptyBounds = await emptySlot.boundingBox();
    const emptyPoint = { x: emptyBounds!.x + emptyBounds!.width / 2, y: emptyBounds!.y + emptyBounds!.height / 2 };
    const beforeEmptyScroll = await page.evaluate(() => window.scrollY);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [emptyPoint] });
    for (let step = 1; step <= 5; step++) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: emptyPoint.x, y: emptyPoint.y - step * 30 }] });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(beforeEmptyScroll);
    await expect(preview(page)).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await stored(page)).toEqual(moved);
    // Let native momentum finish so the tap reaches the event instead of just stopping the scroll.
    await page.evaluate(() => new Promise<void>(resolve => {
      let previous = window.scrollY;
      let stable = 0;
      const observe = () => {
        const current = window.scrollY;
        stable = current === previous ? stable + 1 : 0;
        previous = current;
        if (stable >= 8) resolve();
        else requestAnimationFrame(observe);
      };
      requestAnimationFrame(observe);
    }));
    await body.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center' }));
    const tapBounds = await body.boundingBox();
    await page.touchscreen.tap(tapBounds!.x + tapBounds!.width / 2, tapBounds!.y + tapBounds!.height / 2);
    await expect(editor(page)).toBeVisible();
    await expect(editor(page).getByLabel('시작 시간', { exact: true })).toHaveValue('10:00');
    expect(await stored(page)).toEqual(moved);
    await session.detach();
  });
});
