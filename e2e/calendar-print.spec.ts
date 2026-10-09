import { expect, test, type Page } from '@playwright/test';
import type { PlannerState, ScheduleEvent } from '../src/types';

const week = '2026-10-05';
const nextWeek = '2026-10-12';
const literalTitle = '<img src=x onerror="window.calendarPrintInjected=true"> 한글 & <공부>';
const event = (id: string, changes: Partial<ScheduleEvent> = {}): ScheduleEvent => ({
  id, title: id, type: 'math', date: week, startTime: '09:00', endTime: '10:00',
  allDay: false, recurrence: 'none', weekdays: [], ...changes,
});
const fixture: PlannerState = {
  version: 3, isDemo: false, subjects: ['수학'], hiddenCategoryIds: ['hidden'],
  categories: [
    { id: 'math', label: '수학', color: '#D81B60' },
    { id: 'personal', label: '개인 일정', color: '#0B8043' },
    { id: 'hidden', label: '숨긴 종류', color: '#6D8EC7' },
  ],
  events: [
    event('repeating', { title: '월수 반복 수학', date: '2026-09-28', startTime: '18:00', endTime: '19:00', recurrence: 'weekly', weekdays: [1, 3], repeatUntil: nextWeek }),
    event('midnight-start', { title: '자정 시작', startTime: '00:00', endTime: '00:15' }),
    event('midnight-end', { title: '일요일 마지막 공부', date: '2026-10-11', startTime: '23:45', endTime: '24:00' }),
    event('literal', { title: literalTitle, date: '2026-10-06', startTime: '15:00', endTime: '16:00' }),
    event('saturday-all-day', { title: '토요일 종일 일정', type: 'personal', date: '2026-10-10', allDay: true }),
    ...Array.from({ length: 12 }, (_, index) => event(`all-day-${index}`, { title: `종일 ${index + 1} `.padEnd(80, '긴'), type: 'personal', allDay: true })),
    ...Array.from({ length: 6 }, (_, index) => event(`overlap-${index}`, { title: `겹친 학습 ${index + 1} `.padEnd(80, '나'), date: '2026-10-06', endTime: '12:00' })),
    event('hidden-timed', { type: 'hidden' }),
    event('hidden-all-day', { type: 'hidden', allDay: true }),
    event('other-week', { title: '다음 주 전용 일정', date: nextWeek }),
    event('previous-week', { title: '지난 주 전용 일정', date: '2026-10-04' }),
  ],
  goals: [{ id: 'goal', weekStart: week, subject: '수학', material: '인쇄 비교용 수학 교재', range: '1–10쪽', completed: true }],
};
const rangeFixture: PlannerState = {
  ...fixture,
  events: [
    event('before-range', { startTime: '08:00', endTime: '09:15' }),
    event('crosses-start', { title: '시작 경계 공부', startTime: '08:30', endTime: '10:00' }),
    event('inside-range', { title: '범위 안 공부', startTime: '10:30', endTime: '11:30' }),
    event('crosses-end', { title: '종료 경계 공부', startTime: '18:00', endTime: '20:00' }),
    event('starts-at-end', { date: '2026-10-06', startTime: '18:45', endTime: '20:00' }),
    event('range-repeat', {
      title: '수금 반복 공부', date: '2026-09-30', startTime: '14:00', endTime: '15:00',
      recurrence: 'weekly', weekdays: [3, 5], repeatUntil: '2026-10-16', excludedDates: ['2026-10-09'],
    }),
    event('range-all-day', { title: '토요일 종일', date: '2026-10-10', type: 'personal', allDay: true }),
    event('range-hidden', { type: 'hidden', startTime: '11:00', endTime: '16:00' }),
    event('range-hidden-all-day', { type: 'hidden', allDay: true }),
    event('range-next-week', { date: nextWeek, startTime: '11:00', endTime: '12:00' }),
  ],
};

const preview = (page: Page) => page.getByRole('dialog', { name: '주간 시간표 인쇄 미리보기', exact: true });
const sheet = (page: Page) => page.locator('.calendar-print-page');
const printedEvents = (page: Page) => sheet(page).locator('[data-print-event-id]');
const trigger = (page: Page) => page.locator('.cal-toolbar').getByRole('button', { name: '프린트', exact: true });
const stored = (page: Page) => page.evaluate(() => localStorage.getItem('chagok-planner-v1'));
const printCalls = (page: Page) => page.evaluate(() => (window as Window & { calendarPrintCalls: number }).calendarPrintCalls);
const rangeStart = (page: Page) => preview(page).getByLabel('일과 시작 시간', { exact: true });
const rangeEnd = (page: Page) => preview(page).getByLabel('일과 종료 시간', { exact: true });

async function expectPrintedRange(page: Page, start: string, end: string) {
  await expect(preview(page).getByRole('button', { name: '인쇄하기', exact: true })).toBeEnabled();
  const ticks = sheet(page).locator('.calendar-print-time-ruler > span');
  await expect(ticks.first()).toHaveText(start);
  await expect(ticks.last()).toHaveText(end);
}

async function open(page: Page, data = fixture) {
  await page.clock.setFixedTime(new Date('2026-10-05T10:00:00+09:00'));
  await page.addInitScript(value => {
    if (!localStorage.getItem('chagok-planner-v1')) localStorage.setItem('chagok-planner-v1', JSON.stringify(value));
    const state = window as Window & { calendarPrintCalls: number; calendarPrintInjected: boolean };
    state.calendarPrintCalls = 0;
    state.calendarPrintInjected = false;
    window.print = () => { state.calendarPrintCalls += 1; };
  }, data);
  await page.goto('/');
  await expect(page.locator('.planner-content')).toHaveAttribute('aria-busy', 'false');
  await expect(trigger(page)).toBeVisible();
}

async function openPreview(page: Page) {
  await trigger(page).click();
  await expect(preview(page)).toBeVisible();
  await expect(preview(page).getByRole('button', { name: '인쇄하기', exact: true })).toBeEnabled();
  await expect(preview(page).getByText('A4 가로 · 1페이지', { exact: true })).toBeVisible();
  await expect(sheet(page)).toHaveCount(1);
  await expect(sheet(page).getByRole('heading', { name: '번호별 일정 상세', exact: true })).toHaveCount(0);
  await expect(sheet(page).locator('.calendar-print-details, [data-detail-event-id]')).toHaveCount(0);
  await expect(sheet(page).locator('.calendar-print-paper-footer')).toHaveCount(0);
  await expect(sheet(page)).not.toContainText(/현재 표시한 일정|1\s*\/\s*1\s*페이지/);
  const header = await sheet(page).evaluate(element => {
    const bounds = element.querySelector('.calendar-print-content-frame')!.getBoundingClientRect();
    const parts = [element.querySelector('.calendar-print-paper-header h2')!, element.querySelector('.calendar-print-paper-header p')!];
    const legend = element.querySelector('.calendar-print-legend');
    if (legend) parts.push(legend);
    const boxes = parts.map(part => part.getBoundingClientRect());
    return {
      oneRow: Math.max(...boxes.map(box => box.top)) < Math.min(...boxes.map(box => box.bottom)),
      fits: boxes.every(box => box.left >= bounds.left - 1 && box.right <= bounds.right + 1),
    };
  });
  expect(header.oneRow && header.fits).toBe(true);
}

function expectA4Pdf(pdf: Buffer, orientation: 'landscape' | 'portrait') {
  const pages = [...pdf.toString('latin1').matchAll(/\d+\s+0\s+obj\b([\s\S]*?)endobj/g)]
    .map(match => match[1]).filter(object => /\/Type\s*\/Page\b/.test(object));
  expect(pages).toHaveLength(1);
  const box = pages[0].match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
  expect(box).not.toBeNull();
  expect(Number(box![3]) - Number(box![1])).toBeCloseTo(orientation === 'landscape' ? 842 : 595, 0);
  expect(Number(box![4]) - Number(box![2])).toBeCloseTo(orientation === 'landscape' ? 595 : 842, 0);
}

test('weekly preview respects filters, recurrence and selected dates without changing schedules or opening print automatically', async ({ page }) => {
  await open(page);
  const before = await stored(page);
  await openPreview(page);
  expect(await printCalls(page)).toBe(0);
  await expect(sheet(page).locator('.calendar-print-legend-items > span')).toHaveCount(2);
  expect(await sheet(page).locator('.calendar-print-day-header[data-print-date]').evaluateAll(elements => elements.map(element => element.getAttribute('data-print-date'))))
    .toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
  const expected = fixture.events.filter(item => item.type !== 'hidden' && item.id !== 'other-week' && item.id !== 'previous-week')
    .flatMap(item => (item.id === 'repeating' ? [week, '2026-10-07'] : [item.date]).map(date => `${date}/${item.id}`)).sort();
  expect(await printedEvents(page).evaluateAll(elements => elements.map(element => `${element.getAttribute('data-print-date')}/${element.getAttribute('data-print-event-id')}`).sort())).toEqual(expected);
  for (const item of fixture.events.filter(item => expected.some(key => key.endsWith(`/${item.id}`)))) {
    const occurrences = sheet(page).locator(`[data-print-event-id="${item.id}"]`);
    for (const occurrence of await occurrences.all()) {
      await expect(occurrence).toContainText(item.title);
      const description = await occurrence.getAttribute('aria-label');
      expect(description).toContain(item.title);
      expect(description).toContain(fixture.categories.find(category => category.id === item.type)!.label);
      if (!item.allDay) {
        expect(description).toContain(item.startTime);
        expect(description).toContain(item.endTime);
        await expect(occurrence.locator('.calendar-print-event-line, .calendar-print-event-time'))
          .toHaveText(new RegExp(`^${item.startTime}–${item.endTime}(?:\\s|$)`));
      } else expect(description).toContain('종일');
    }
  }
  await expect(sheet(page).locator('.calendar-print-all-day-event')).toHaveCount(13);
  await expect(sheet(page).locator('img, script, button, input')).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { calendarPrintInjected: boolean }).calendarPrintInjected)).toBe(false);
  for (let hour = 0; hour <= 24; hour += 1) await expect(sheet(page).getByText(`${String(hour).padStart(2, '0')}:00`, { exact: true })).toBeVisible();
  expect(await stored(page)).toBe(before);
  await preview(page).getByRole('button', { name: '인쇄하기', exact: true }).click();
  expect(await printCalls(page)).toBe(1);
  await page.keyboard.press('Escape');
  await expect(preview(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
  await page.getByRole('button', { name: '다음 주', exact: true }).click();
  await openPreview(page);
  expect(await printedEvents(page).evaluateAll(elements => elements.map(element => `${element.getAttribute('data-print-date')}/${element.getAttribute('data-print-event-id')}`).sort()))
    .toEqual([`${nextWeek}/other-week`, `${nextWeek}/repeating`]);
  expect(await printCalls(page)).toBe(1);
  await preview(page).getByRole('button', { name: '미리보기 닫기', exact: true }).click();
  await expect(trigger(page)).toBeFocused();
  await page.getByRole('button', { name: '월간', exact: true }).click();
  await expect(trigger(page)).toHaveCount(0);
  await page.getByRole('button', { name: '주간', exact: true }).click();
  await expect(trigger(page)).toBeVisible();
  expect(await stored(page)).toBe(before);
});

test('dense all-day and overlapping schedules fit one landscape A4 PDF while goal printing remains portrait', async ({ page }, testInfo) => {
  await open(page);
  const before = await stored(page);
  await openPreview(page);
  await expect(printedEvents(page)).toHaveCount(24);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.app-shell')).not.toBeVisible();
  await expect(preview(page).getByRole('button', { name: '인쇄하기', exact: true })).not.toBeVisible();
  await expect(page.locator('.calendar-print-measure')).not.toBeVisible();
  const fit = await sheet(page).evaluate(element => {
    const frame = element.querySelector<HTMLElement>('.calendar-print-content-frame')!;
    const content = element.querySelector<HTMLElement>('.calendar-print-content')!;
    const bounds = frame.getBoundingClientRect();
    const contentBounds = content.getBoundingClientRect();
    const inside = (box: DOMRect) => box.left >= bounds.left - 1 && box.top >= bounds.top - 1
      && box.right <= bounds.right + 1 && box.bottom <= bounds.bottom + 1;
    return {
      contentFits: inside(contentBounds),
      eventsFit: [...element.querySelectorAll('[data-print-event-id]')].every(item => inside(item.getBoundingClientRect())),
      contentWidthRatio: contentBounds.width / bounds.width,
      horizontalScale: contentBounds.width / content.offsetWidth,
      verticalScale: contentBounds.height / content.offsetHeight,
      overlapBoxes: [...element.querySelectorAll('[data-print-event-id^="overlap-"]')].map(item => {
        const box = item.getBoundingClientRect();
        return { left: box.left, right: box.right, width: box.width };
      }).sort((a, b) => a.left - b.left),
    };
  });
  expect(fit.contentFits && fit.eventsFit).toBe(true);
  expect(fit.contentWidthRatio).toBeGreaterThan(0.98);
  expect(fit.horizontalScale).toBeGreaterThan(0);
  expect(fit.horizontalScale).toBeLessThan(1);
  expect(fit.horizontalScale).toBeCloseTo(fit.verticalScale, 2);
  expect(fit.overlapBoxes).toHaveLength(6);
  fit.overlapBoxes.forEach((box, index) => {
    expect(box.width).toBeGreaterThan(0);
    if (index) expect(box.left).toBeGreaterThanOrEqual(fit.overlapBoxes[index - 1].right - 1);
  });
  await sheet(page).screenshot({ path: 'test-results/calendar-print-a4.png', animations: 'disabled' });
  const calendarPdf = await page.pdf({ path: 'test-results/calendar-print-a4.pdf', preferCSSPageSize: true, printBackground: true });
  expectA4Pdf(calendarPdf, 'landscape');
  await testInfo.attach('A4 landscape weekly calendar', { body: calendarPdf, contentType: 'application/pdf' });
  await page.emulateMedia({ media: 'screen' });
  await preview(page).getByRole('button', { name: '미리보기 닫기', exact: true }).click();
  await page.getByRole('link', { name: '주간 학습 계획', exact: true }).click();
  await page.getByRole('button', { name: '프린트', exact: true }).click();
  const goalPreview = page.getByRole('dialog', { name: '학습 목표 인쇄 미리보기', exact: true });
  await expect(goalPreview.getByRole('button', { name: '인쇄하기', exact: true })).toBeEnabled();
  await expect(page.locator('.goal-print-page tbody tr[data-goal-id]')).toHaveCount(1);
  await page.emulateMedia({ media: 'print' });
  const goalPdf = await page.pdf({ path: 'test-results/calendar-print-goals-portrait.pdf', preferCSSPageSize: true, printBackground: true });
  expectA4Pdf(goalPdf, 'portrait');
  expect(await printCalls(page)).toBe(0);
  expect(await stored(page)).toBe(before);
  await page.emulateMedia({ media: 'screen' });
});

test('an empty week is printable on mobile and its full landscape page fits without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, { ...fixture, events: [], goals: [] });
  const before = await stored(page);
  await openPreview(page);
  await expect(printedEvents(page)).toHaveCount(0);
  await expect(sheet(page).locator('.calendar-print-grid')).toHaveCount(1);
  await expect(sheet(page).getByText('00:00', { exact: true })).toBeVisible();
  await expect(sheet(page).getByText('24:00', { exact: true })).toBeVisible();
  expect(await printCalls(page)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const bounds = await sheet(page).boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.emulateMedia({ media: 'print' });
  const gridSpace = await sheet(page).evaluate(element => {
    const frame = element.querySelector('.calendar-print-content-frame')!.getBoundingClientRect();
    const grid = element.querySelector('.calendar-print-grid')!.getBoundingClientRect();
    return { heightMm: grid.height * 25.4 / 96, bottomGap: frame.bottom - grid.bottom };
  });
  expect(gridSpace.heightMm).toBeGreaterThan(160);
  expect(gridSpace.bottomGap).toBeGreaterThanOrEqual(-1);
  expect(gridSpace.bottomGap).toBeLessThan(3);
  await page.emulateMedia({ media: 'screen' });
  await expect(preview(page).getByRole('button', { name: '인쇄하기', exact: true })).toBeInViewport({ ratio: 1 });
  await preview(page).getByRole('button', { name: '인쇄하기', exact: true }).click();
  expect(await printCalls(page)).toBe(1);
  expect(await stored(page)).toBe(before);
  await preview(page).getByRole('button', { name: '미리보기 닫기', exact: true }).click();
  await expect(trigger(page)).toBeFocused();
  await openPreview(page);
  expect(await printCalls(page)).toBe(1);
  expect(await stored(page)).toBe(before);
});

test('a selected print range clips visual intervals, enlarges the timetable and persists without changing schedules or totals', async ({ page }) => {
  await open(page, rangeFixture);
  const before = JSON.parse((await stored(page))!) as PlannerState;
  const totals = await page.locator('.stat-card .stat-value').allTextContents();
  await openPreview(page);
  await expect(rangeStart(page)).toHaveValue('00:00');
  await expect(rangeEnd(page)).toHaveValue('00:00');
  const inside = sheet(page).locator('[data-print-event-id="inside-range"]');
  const fullDayHeight = (await inside.boundingBox())!.height;
  await rangeStart(page).fill('09:15');
  await rangeEnd(page).fill('18:45');
  await expectPrintedRange(page, '09:15', '18:45');
  await expect.poll(async () => JSON.parse((await stored(page))!).calendarPrintRange).toEqual({ startMinute: 555, endMinute: 1125 });
  expect(await printedEvents(page).evaluateAll(elements => elements.map(element => `${element.getAttribute('data-print-date')}/${element.getAttribute('data-print-event-id')}`).sort()))
    .toEqual([`${week}/crosses-end`, `${week}/crosses-start`, `${week}/inside-range`, '2026-10-07/range-repeat', '2026-10-10/range-all-day']);
  await expect(sheet(page).locator('.calendar-print-all-day-event')).toHaveCount(1);
  await expect(sheet(page).locator('input, select, button')).toHaveCount(0);
  for (const [id, times] of [['crosses-start', '08:30–10:00'], ['crosses-end', '18:00–20:00']] as const) {
    const block = sheet(page).locator(`[data-print-event-id="${id}"]`);
    await expect(block).toContainText(times);
    await expect(block).toHaveAttribute('aria-label', new RegExp(times));
  }
  const geometry = await sheet(page).evaluate(element => {
    const result: Record<string, { top: number; height: number; bottom: number }> = {};
    for (const id of ['crosses-start', 'inside-range', 'crosses-end']) {
      const item = element.querySelector(`[data-print-event-id="${id}"]`)!;
      const column = item.closest('.calendar-print-day-column')!.getBoundingClientRect();
      const box = item.getBoundingClientRect();
      result[id] = { top: (box.top - column.top) / column.height, height: box.height / column.height, bottom: (box.bottom - column.top) / column.height };
    }
    return result;
  });
  expect(geometry['crosses-start'].top).toBeCloseTo(0, 2);
  expect(geometry['crosses-start'].height).toBeCloseTo(45 / 570, 2);
  expect(geometry['inside-range'].top).toBeCloseTo(75 / 570, 2);
  expect(geometry['inside-range'].height).toBeCloseTo(60 / 570, 2);
  expect(geometry['crosses-end'].top).toBeCloseTo(525 / 570, 2);
  expect(geometry['crosses-end'].bottom).toBeCloseTo(1, 2);
  expect((await inside.boundingBox())!.height).toBeGreaterThan(fullDayHeight * 2);
  expect(await printCalls(page)).toBe(0);
  expect(JSON.parse((await stored(page))!)).toEqual({ ...before, calendarPrintRange: { startMinute: 555, endMinute: 1125 } });
  await preview(page).getByRole('button', { name: '미리보기 닫기', exact: true }).click();
  expect(await page.locator('.stat-card .stat-value').allTextContents()).toEqual(totals);
  await openPreview(page);
  await expect(rangeStart(page)).toHaveValue('09:15');
  await expect(rangeEnd(page)).toHaveValue('18:45');
  await expectPrintedRange(page, '09:15', '18:45');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '다음 주', exact: true }).click();
  await openPreview(page);
  await expectPrintedRange(page, '09:15', '18:45');
  await expect(printedEvents(page)).toHaveCount(3);
  expect(await printedEvents(page).evaluateAll(elements => elements.map(element => element.getAttribute('data-print-date')).sort()))
    .toEqual([nextWeek, '2026-10-14', '2026-10-16']);
  await page.reload();
  await openPreview(page);
  await expect(rangeStart(page)).toHaveValue('09:15');
  await expect(rangeEnd(page)).toHaveValue('18:45');
  await expectPrintedRange(page, '09:15', '18:45');
  expect(JSON.parse((await stored(page))!)).toEqual({ ...before, calendarPrintRange: { startMinute: 555, endMinute: 1125 } });
});

test('mobile range controls reject invalid intervals without saving them and treat end midnight as 24:00', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, { ...fixture, events: [], goals: [] });
  await openPreview(page);
  await expect(rangeStart(page)).toHaveAttribute('type', 'time');
  await expect(rangeEnd(page)).toHaveAttribute('type', 'time');
  await rangeStart(page).fill('08:00');
  await rangeEnd(page).fill('18:00');
  await expectPrintedRange(page, '08:00', '18:00');
  await expect.poll(async () => JSON.parse((await stored(page))!).calendarPrintRange).toEqual({ startMinute: 480, endMinute: 1080 });
  const lastValid = await stored(page);
  for (const invalidStart of ['19:00', '18:00', '']) {
    await rangeStart(page).fill(invalidStart);
    await expect(preview(page).getByRole('alert')).toBeVisible();
    await expect(preview(page).getByRole('button', { name: '인쇄하기', exact: true })).toBeDisabled();
    expect(await stored(page)).toBe(lastValid);
    expect(await printCalls(page)).toBe(0);
  }
  await preview(page).getByRole('button', { name: '미리보기 닫기', exact: true }).click();
  await openPreview(page);
  await expect(rangeStart(page)).toHaveValue('08:00');
  await expect(rangeEnd(page)).toHaveValue('18:00');
  await rangeEnd(page).fill('00:00');
  await expectPrintedRange(page, '08:00', '24:00');
  await expect.poll(async () => JSON.parse((await stored(page))!).calendarPrintRange).toEqual({ startMinute: 480, endMinute: 1440 });
  await rangeStart(page).fill('23:45');
  await expectPrintedRange(page, '23:45', '24:00');
  await expect(rangeStart(page)).toBeInViewport({ ratio: 1 });
  await expect(rangeEnd(page)).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const sheetBounds = await sheet(page).boundingBox();
  expect(sheetBounds!.x).toBeGreaterThanOrEqual(0);
  expect(sheetBounds!.x + sheetBounds!.width).toBeLessThanOrEqual(390);
  await preview(page).getByRole('button', { name: '인쇄하기', exact: true }).click();
  expect(await printCalls(page)).toBe(1);
  await expect.poll(async () => JSON.parse((await stored(page))!).calendarPrintRange).toEqual({ startMinute: 1425, endMinute: 1440 });
  await page.reload();
  await openPreview(page);
  await expect(rangeStart(page)).toHaveValue('23:45');
  await expect(rangeEnd(page)).toHaveValue('00:00');
  await expectPrintedRange(page, '23:45', '24:00');
});

test('a saved time range prints one landscape A4 without controls and does not change goal print orientation', async ({ page }, testInfo) => {
  await open(page, { ...rangeFixture, calendarPrintRange: { startMinute: 555, endMinute: 1125 } });
  const before = await stored(page);
  await openPreview(page);
  await expectPrintedRange(page, '09:15', '18:45');
  await expect(printedEvents(page)).toHaveCount(5);
  await page.emulateMedia({ media: 'print' });
  await expect(rangeStart(page)).not.toBeVisible();
  await expect(rangeEnd(page)).not.toBeVisible();
  await expect(page.locator('.app-shell')).not.toBeVisible();
  await expect(sheet(page).locator('input, button, select')).toHaveCount(0);
  const fits = await sheet(page).evaluate(element => {
    const frame = element.querySelector('.calendar-print-content-frame')!.getBoundingClientRect();
    return [...element.querySelectorAll('[data-print-event-id], .calendar-print-grid')].every(item => {
      const bounds = item.getBoundingClientRect();
      return bounds.left >= frame.left - 1 && bounds.top >= frame.top - 1 && bounds.right <= frame.right + 1 && bounds.bottom <= frame.bottom + 1;
    });
  });
  expect(fits).toBe(true);
  const calendarPdf = await page.pdf({ path: 'test-results/calendar-print-range-a4.pdf', preferCSSPageSize: true, printBackground: true });
  expectA4Pdf(calendarPdf, 'landscape');
  await testInfo.attach('A4 landscape with selected time range', { body: calendarPdf, contentType: 'application/pdf' });
  await page.emulateMedia({ media: 'screen' });
  await preview(page).getByRole('button', { name: '미리보기 닫기', exact: true }).click();
  await page.getByRole('link', { name: '주간 학습 계획', exact: true }).click();
  await page.getByRole('button', { name: '프린트', exact: true }).click();
  const goalPreview = page.getByRole('dialog', { name: '학습 목표 인쇄 미리보기', exact: true });
  await expect(goalPreview.getByRole('button', { name: '인쇄하기', exact: true })).toBeEnabled();
  await page.emulateMedia({ media: 'print' });
  expectA4Pdf(await page.pdf({ path: 'test-results/calendar-range-goals-portrait.pdf', preferCSSPageSize: true, printBackground: true }), 'portrait');
  expect(await printCalls(page)).toBe(0);
  expect(await stored(page)).toBe(before);
  await page.emulateMedia({ media: 'screen' });
});
