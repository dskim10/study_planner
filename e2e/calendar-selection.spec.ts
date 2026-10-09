import { expect, test, type Page } from '@playwright/test';
import { createEmptyState } from '../src/lib/planner';
import type { PlannerState } from '../src/types';

const monday = '2026-10-05';
const tuesday = '2026-10-06';
const column = (page: Page, date = monday) => page.locator(`.cal-day-column[data-date="${date}"]`);
const slot = (page: Page, date: string, minute: number) => page.locator(`.cal-empty-slot[data-slot-date="${date}"][data-slot-minute="${minute}"]`);
const preview = (page: Page) => page.locator('.cal-selection-preview');
const editor = (page: Page) => page.getByRole('dialog', { name: '새 일정 추가', exact: true });
const stored = (page: Page): Promise<PlannerState> => page.evaluate(() => JSON.parse(localStorage.getItem('chagok-planner-v1')!));

async function open(page: Page, data = createEmptyState(), desktop = true) {
  if (desktop) await page.setViewportSize({ width: 1440, height: 1000 });
  await page.clock.setFixedTime(new Date('2026-10-05T10:00:00+09:00'));
  await page.addInitScript(value => {
    if (!localStorage.getItem('chagok-planner-v1')) localStorage.setItem('chagok-planner-v1', JSON.stringify(value));
  }, data);
  await page.goto('/');
}

async function point(page: Page, date: string, minute: number, scroll = false) {
  if (scroll) {
    const quarter = Math.min(1425, Math.floor(minute / 15) * 15);
    await slot(page, date, quarter).evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center' }));
  }
  const bounds = await column(page, date).boundingBox();
  expect(bounds).not.toBeNull();
  return { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height * minute / 1440 + 0.25 };
}

async function startDrag(page: Page, date: string, startMinute: number, endMinute: number, endDate = date) {
  const start = await point(page, date, startMinute, true);
  const end = await point(page, endDate, endMinute);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
}

async function expectRange(page: Page, start: string, end: string, date = monday) {
  await expect(editor(page)).toBeVisible();
  await expect(editor(page).getByLabel('날짜', { exact: true })).toHaveValue(date);
  await expect(editor(page).getByLabel('시작 시간', { exact: true })).toHaveValue(start);
  await expect(editor(page).getByLabel('종료 시간', { exact: true })).toHaveValue(end);
}

test('click snaps to a quarter hour and dragging previews and saves the selected time range', async ({ page }) => {
  await open(page);
  const click = await point(page, monday, 9 * 60 + 37, true);
  await page.mouse.click(click.x, click.y);
  await expectRange(page, '09:30', '10:30');
  await editor(page).getByRole('button', { name: '취소', exact: true }).click();

  await startDrag(page, monday, 9 * 60 + 15, 11 * 60 + 45);
  await expect(preview(page)).toBeVisible();
  await expect(preview(page)).toContainText('(제목 없음)');
  await expect(preview(page)).toContainText('9:15');
  await expect(preview(page)).toContainText('11:45');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.mouse.up();
  await expect(preview(page)).toHaveCount(0);
  await expectRange(page, '09:15', '11:45');
  await editor(page).getByLabel('일정 이름', { exact: true }).fill('드래그로 정한 공부');
  await editor(page).getByRole('button', { name: '수학', exact: true }).click();
  await editor(page).getByRole('button', { name: '일정 추가', exact: true }).click();
  await expect(page.getByRole('button', { name: /드래그로 정한 공부, 09:15부터 11:45까지/ })).toBeVisible();
  await expect(page.locator('.planned-stat .stat-value')).toContainText('2시간 30분');
  await expect(page.locator('.available-stat .stat-value')).toContainText('168시간');
  await page.reload();
  expect((await stored(page)).events).toEqual([expect.objectContaining({ date: monday, startTime: '09:15', endTime: '11:45', title: '드래그로 정한 공부' })]);
  await expect(page.getByRole('button', { name: /드래그로 정한 공부, 09:15부터 11:45까지/ })).toBeVisible();
});

test('reverse and cross-column drags keep the starting day, enforce fifteen minutes and stop at midnight', async ({ page }) => {
  await open(page);
  await startDrag(page, monday, 13 * 60 + 30, 12 * 60 + 15, tuesday);
  await expect(column(page, monday).locator('.cal-selection-preview')).toBeVisible();
  await expect(column(page, tuesday).locator('.cal-selection-preview')).toHaveCount(0);
  await page.mouse.up();
  await expectRange(page, '12:15', '13:30');
  await page.keyboard.press('Escape');

  const start = await point(page, monday, 9 * 60 + 37, true);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 12, start.y + 1, { steps: 3 });
  await expect(preview(page)).toBeVisible();
  await page.mouse.up();
  await expectRange(page, '09:30', '09:45');
  await page.keyboard.press('Escape');

  await startDrag(page, monday, 23 * 60 + 45, 1440);
  await page.mouse.up();
  await expectRange(page, '23:45', '00:00');
  await editor(page).getByLabel('일정 이름', { exact: true }).fill('자정까지 공부');
  await editor(page).getByRole('button', { name: '일정 추가', exact: true }).click();
  await page.reload();
  expect((await stored(page)).events).toEqual([expect.objectContaining({ date: monday, startTime: '23:45', endTime: '24:00' })]);
  await expect(page.locator('.available-stat .stat-value')).toContainText('167시간 45분');
});

test('Escape and pointer cancellation discard selection while existing events still open their editor', async ({ page }) => {
  const data = createEmptyState();
  data.events.push({ id: 'existing', title: '기존 일정', type: 'school', date: monday, startTime: '14:00', endTime: '15:00', allDay: false, recurrence: 'none', weekdays: [] });
  await open(page, data);
  await startDrag(page, monday, 9 * 60 + 15, 10 * 60 + 45);
  await expect(preview(page)).toBeVisible();
  await page.keyboard.press('Escape');
  // Model a user continuing to hold the mouse after cancelling, beyond the former 700 ms deadline.
  await page.waitForTimeout(800);
  await page.mouse.up();
  await expect(preview(page)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const event = page.getByRole('button', { name: /기존 일정, 14:00부터 15:00까지/ });
  await event.click();
  await expect(page.getByRole('dialog', { name: '일정 수정', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  await startDrag(page, monday, 11 * 60, 12 * 60);
  await column(page).dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', isPrimary: true });
  await page.mouse.up();
  await expect(preview(page)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await stored(page)).events).toEqual(data.events);

  await event.scrollIntoViewIfNeeded();
  const bounds = await event.boundingBox();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width / 2 + 8, bounds!.y + bounds!.height / 2 + 5);
  await expect(preview(page)).toHaveCount(0);
  await page.mouse.up();
  await expect(page.getByRole('dialog', { name: '일정 수정', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByLabel('시작 시간', { exact: true })).toHaveValue('14:00');
  await expect(page.getByRole('dialog').getByLabel('종료 시간', { exact: true })).toHaveValue('15:00');
});

test('keyboard navigation advances fifteen minutes and Enter or Space opens a one-hour range', async ({ page }) => {
  await open(page);
  await slot(page, monday, 9 * 60).focus();
  await page.keyboard.press('ArrowDown');
  await expect(slot(page, monday, 9 * 60 + 15)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(slot(page, tuesday, 9 * 60 + 15)).toBeFocused();
  await page.keyboard.press('Enter');
  await expectRange(page, '09:15', '10:15', tuesday);
  await page.keyboard.press('Escape');
  await slot(page, monday, 9 * 60).focus();
  await page.keyboard.press('End');
  await expect(slot(page, monday, 23 * 60 + 45)).toBeFocused();
  await page.keyboard.press('Space');
  await expectRange(page, '23:45', '00:00');
});

test.describe('touch selection', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('touch gestures scroll without creating an event and a tap still selects a quarter hour', async ({ page }) => {
    await open(page, createEmptyState(), false);
    const start = await point(page, monday, 9 * 60 + 37, true);
    const beforeScroll = await page.evaluate(() => window.scrollY);
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x, y: start.y }] });
    for (let step = 1; step <= 5; step++) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x, y: start.y - step * 35 }] });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(beforeScroll);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(preview(page)).toHaveCount(0);
    expect((await stored(page)).events).toEqual([]);
    // A tap during native momentum scrolling only stops the fling; wait for it to finish before targeting a slot.
    await page.evaluate(() => new Promise<void>(resolve => {
      let previousOffset = window.scrollY;
      let stableFrames = 0;
      const observe = () => {
        const currentOffset = window.scrollY;
        stableFrames = currentOffset === previousOffset ? stableFrames + 1 : 0;
        previousOffset = currentOffset;
        if (stableFrames >= 8) resolve();
        else requestAnimationFrame(observe);
      };
      requestAnimationFrame(observe);
    }));
    const tap = await point(page, monday, 9 * 60 + 37, true);
    await page.touchscreen.tap(tap.x, tap.y);
    await expectRange(page, '09:30', '10:30');
    await session.detach();
  });
});
