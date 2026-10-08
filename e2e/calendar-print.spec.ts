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

const preview = (page: Page) => page.getByRole('dialog', { name: '주간 시간표 인쇄 미리보기', exact: true });
const sheet = (page: Page) => page.locator('.calendar-print-page');
const printedEvents = (page: Page) => sheet(page).locator('[data-print-event-id]');
const trigger = (page: Page) => page.locator('.cal-toolbar').getByRole('button', { name: '프린트', exact: true });
const stored = (page: Page) => page.evaluate(() => localStorage.getItem('chagok-planner-v1'));
const printCalls = (page: Page) => page.evaluate(() => (window as Window & { calendarPrintCalls: number }).calendarPrintCalls);

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
