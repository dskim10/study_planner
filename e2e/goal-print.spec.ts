import { inflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { createEmptyState } from '../src/lib/planner';
import type { PlannerState, StudyGoal } from '../src/types';

const week = '2026-10-05';
const nextWeek = '2026-10-12';
const literalMaterial = '<img src=x onerror="window.printInjected=true">';
const literalRange = '<script>window.printInjected=true</script> p. 1 > 3 & 5';
const goal = (id: string, subject: string, material: string, changes: Partial<StudyGoal> = {}): StudyGoal => ({
  id, weekStart: week, subject, material, range: `${id} 학습 범위`, completed: false, ...changes,
});
const fixture: PlannerState = {
  ...createEmptyState(), subjects: ['수학', '영어'],
  goals: [
    goal('english', '영어', '영어 단어장'),
    goal('math-literal', '수학', literalMaterial, { range: literalRange }),
    goal('math-completed', '수학', '완료한 수학 교재', { completed: true }),
    goal('other-week', '수학', '다음 주 전용 교재', { weekStart: nextWeek }),
  ],
};
const preview = (page: Page) => page.getByRole('dialog', { name: '학습 목표 인쇄 미리보기', exact: true });
const pages = (page: Page) => page.locator('.goal-print-page[data-page-number]');
const rows = (page: Page) => pages(page).locator('tbody tr[data-goal-id]');
const printCalls = (page: Page) => page.evaluate(() => (window as Window & { printCalls: number }).printCalls);
const stored = (page: Page) => page.evaluate(() => localStorage.getItem('chagok-planner-v1'));

async function open(page: Page, data = fixture) {
  await page.clock.setFixedTime(new Date('2026-10-05T10:00:00+09:00'));
  await page.addInitScript(value => {
    if (!localStorage.getItem('chagok-planner-v1')) localStorage.setItem('chagok-planner-v1', JSON.stringify(value));
    const state = window as Window & { printCalls: number; printInjected: boolean };
    state.printCalls = 0;
    state.printInjected = false;
    window.print = () => { state.printCalls += 1; };
  }, data);
  await page.goto('/#plan');
  await expect(page.getByRole('button', { name: '프린트', exact: true })).toBeVisible();
}

async function openPreview(page: Page) {
  await page.getByRole('button', { name: '프린트', exact: true }).click();
  await expect(preview(page)).toBeVisible();
  await expect(preview(page).getByRole('button', { name: '인쇄하기', exact: true })).toBeEnabled();
}

async function expectMergedSubjects(page: Page, goals: StudyGoal[]) {
  const subjectsById = new Map(goals.map(item => [item.id, item.subject]));
  const sheets = await pages(page).all();
  for (const sheet of sheets) {
    const ids = await sheet.locator('tbody tr[data-goal-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-goal-id')!));
    const groups: { subject: string; count: number; firstId: string }[] = [];
    for (const id of ids) {
      const subject = subjectsById.get(id)!;
      const previous = groups.at(-1);
      if (previous?.subject === subject) previous.count += 1;
      else groups.push({ subject, count: 1, firstId: id });
    }
    const cells = sheet.locator('tbody .goal-print-subject');
    await expect(cells).toHaveText(groups.map(group => group.subject));
    const spans = await cells.evaluateAll(elements => elements.map(element => (element as HTMLTableCellElement).rowSpan));
    expect(spans).toEqual(groups.map(group => group.count));
    expect(spans.reduce((sum, span) => sum + span, 0)).toBe(ids.length);
    for (const group of groups) await expect(sheet.locator(`tr[data-goal-id="${group.firstId}"] .goal-print-subject`)).toHaveCount(1);
  }
}

test('preview includes every selected-week goal in subject order and prints only after an explicit action', async ({ page }) => {
  await open(page);
  await page.locator('.goal-filters').getByRole('button', { name: /^진행 중/ }).click();
  await expect(page.getByRole('checkbox', { name: /완료한 수학 교재/ })).toHaveCount(0);
  const before = await stored(page);
  const trigger = page.getByRole('button', { name: '프린트', exact: true });
  await openPreview(page);
  expect(await printCalls(page)).toBe(0);
  await expect(rows(page)).toHaveCount(3);
  expect(await rows(page).evaluateAll(elements => elements.map(element => element.getAttribute('data-goal-id')))).toEqual(['math-literal', 'math-completed', 'english']);
  await expect(pages(page).locator('tr[data-goal-id="math-literal"] .goal-print-subject')).toHaveAttribute('rowspan', '2');
  await expect(pages(page).locator('tr[data-goal-id="math-completed"] .goal-print-subject')).toHaveCount(0);
  await expect(pages(page).locator('tr[data-goal-id="english"] .goal-print-subject')).toHaveJSProperty('rowSpan', 1);
  await expectMergedSubjects(page, fixture.goals);
  await expect(pages(page).first().getByRole('columnheader')).toHaveText(['과목', '학습 자료', '학습 범위']);
  await expect(pages(page).first().locator('colgroup col')).toHaveCount(3);
  await expect(pages(page).locator('.goal-print-check-cell')).toHaveCount(0);
  for (const item of fixture.goals.filter(item => item.weekStart === week)) {
    const row = pages(page).locator(`tr[data-goal-id="${item.id}"]`);
    const range = row.locator('td.goal-print-range');
    await expect(range).toHaveCount(1);
    await expect(row.locator('.goal-print-check')).toHaveCount(1);
    await expect(range.getByRole('img', { name: item.completed ? '완료' : '미완료', exact: true })).toHaveCount(1);
    await expect(range.locator('.goal-print-range-text')).toHaveText(item.range);
    expect(await range.evaluate(cell => {
      const check = cell.querySelector('.goal-print-check');
      const text = cell.querySelector('.goal-print-range-text');
      return Boolean(check && text && check.nextElementSibling === text);
    })).toBe(true);
  }
  await expect(rows(page).filter({ has: page.getByText(literalMaterial, { exact: true }) })).toHaveCount(1);
  await expect(pages(page).getByText(literalRange, { exact: true })).toBeVisible();
  await expect(pages(page).getByText('다음 주 전용 교재', { exact: true })).toHaveCount(0);
  await expect(pages(page).locator('img, script')).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { printInjected: boolean }).printInjected)).toBe(false);
  await expect(rows(page).filter({ has: page.getByText('완료한 수학 교재', { exact: true }) }).getByRole('img', { name: '완료', exact: true })).toBeVisible();
  await expect(rows(page).getByRole('img', { name: '미완료', exact: true })).toHaveCount(2);
  await expect(pages(page).getByRole('checkbox')).toHaveCount(0);
  expect(await stored(page)).toBe(before);

  await preview(page).getByRole('button', { name: '인쇄하기', exact: true }).click();
  expect(await printCalls(page)).toBe(1);
  expect(await stored(page)).toBe(before);
  await page.keyboard.press('Escape');
  await expect(preview(page)).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.getByRole('button', { name: '다음 주', exact: true }).click();
  await openPreview(page);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText('다음 주 전용 교재');
  expect(await printCalls(page)).toBe(1);
  await preview(page).getByRole('button', { name: '미리보기 닫기', exact: true }).click();
  await expect(trigger).toBeFocused();
  await openPreview(page);
  await expect(rows(page)).toHaveCount(1);
  expect(await stored(page)).toBe(before);
});

test('long goals paginate without missing or duplicate rows and export actual A4 pages without blank sheets', async ({ page }, testInfo) => {
  const subjects = ['수학', '영어', '긴 과목 이름'.repeat(4)];
  const longGoals = Array.from({ length: 60 }, (_, index) => goal(`print-${index}`, subjects[index % subjects.length], `PRINT_${String(index).padStart(3, '0')} `.padEnd(120, '가'), {
    range: `RANGE_${String(index).padStart(3, '0')} 학습 범위\n`.padEnd(200, '나'), completed: index % 4 === 0,
  }));
  await open(page, { ...createEmptyState(), subjects, goals: [...longGoals, goal('excluded', '수학', '인쇄 제외 다음 주', { weekStart: nextWeek })] });
  const before = await stored(page);
  await openPreview(page);
  const pageCount = await pages(page).count();
  expect(pageCount).toBeGreaterThan(1);
  const printButton = preview(page).getByRole('button', { name: '인쇄하기', exact: true });
  await expect(printButton).toBeInViewport({ ratio: 1 });
  await preview(page).locator('.goal-print-preview-body').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(printButton).toBeInViewport({ ratio: 1 });
  await preview(page).locator('.goal-print-preview-body').evaluate(element => { element.scrollTop = 0; });
  await expect(rows(page)).toHaveCount(longGoals.length);
  const printedIds = await rows(page).evaluateAll(elements => elements.map(element => element.getAttribute('data-goal-id')));
  expect(printedIds).toEqual(subjects.flatMap(subject => longGoals.filter(item => item.subject === subject).map(item => item.id)));
  expect(new Set(printedIds).size).toBe(longGoals.length);
  for (const item of longGoals) {
    const row = pages(page).locator(`tr[data-goal-id="${item.id}"]`);
    await expect(row).toContainText(item.material);
    await expect(row).toContainText(item.range);
  }
  await expectMergedSubjects(page, longGoals);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.app-shell')).not.toBeVisible();
  await expect(preview(page).getByRole('button', { name: '인쇄하기', exact: true })).not.toBeVisible();
  const layout = await pages(page).evaluateAll(elements => elements.map(element => {
    const pageBounds = element.getBoundingClientRect();
    const bodyRows = [...element.querySelectorAll('tbody tr[data-goal-id]')];
    const footerBounds = element.querySelector('.goal-print-paper-footer')!.getBoundingClientRect();
    return {
      number: element.getAttribute('data-page-number'),
      count: bodyRows.length,
      fits: bodyRows.every(row => { const box = row.getBoundingClientRect(); return box.top >= pageBounds.top - 1 && box.bottom <= pageBounds.bottom + 1 && box.left >= pageBounds.left - 1 && box.right <= pageBounds.right + 1; }),
      noOverflow: element.scrollHeight <= element.clientHeight + 1,
      mergedCellsFit: [...element.querySelectorAll<HTMLElement>('.goal-print-subject')].every(cell => {
        const box = cell.getBoundingClientRect();
        return box.top >= pageBounds.top - 1 && box.bottom <= footerBounds.top + 1 && cell.scrollHeight <= cell.clientHeight + 1;
      }),
    };
  }));
  expect(layout.map(item => item.number)).toEqual(Array.from({ length: pageCount }, (_, index) => String(index + 1)));
  expect(layout.every(item => item.count > 0 && item.fits && item.noOverflow && item.mergedCellsFit)).toBe(true);
  await pages(page).first().screenshot({ path: 'test-results/goal-print-a4.png', animations: 'disabled' });
  const pdf = await page.pdf({ path: 'test-results/goal-print-a4.pdf', preferCSSPageSize: true, printBackground: true });
  const pdfText = pdf.toString('latin1');
  const objects = new Map([...pdfText.matchAll(/(\d+)\s+0\s+obj\b([\s\S]*?)endobj/g)].map(match => [match[1], match[2]]));
  const pdfPages = [...objects.values()].filter(value => /\/Type\s*\/Page\b/.test(value));
  expect(pdfPages).toHaveLength(pageCount);
  pdfPages.forEach((content, index) => {
    const box = content.match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
    expect(box).not.toBeNull();
    expect(Number(box![3]) - Number(box![1])).toBeCloseTo(595, 0);
    expect(Number(box![4]) - Number(box![2])).toBeCloseTo(842, 0);
    const reference = content.match(/\/Contents\s+(\d+)\s+0\s+R/);
    expect(reference).not.toBeNull();
    const streamObject = objects.get(reference![1])!;
    const stream = streamObject.match(/stream\r?\n([\s\S]*?)\r?\nendstream/);
    expect(stream).not.toBeNull();
    const bytes = Buffer.from(stream![1], 'latin1');
    const commands = /\/FlateDecode/.test(streamObject) ? inflateSync(bytes).toString('latin1') : bytes.toString('latin1');
    expect(commands).toMatch(/\bBT\b/);
    expect([...commands.matchAll(/\b(?:Tj|TJ)\b/g)].length).toBeGreaterThan(layout[index].count);
  });
  expect(await stored(page)).toBe(before);
  expect(await printCalls(page)).toBe(0);
  await testInfo.attach('A4 weekly goals PDF', { body: pdf, contentType: 'application/pdf' });
  await page.emulateMedia({ media: 'screen' });
});

test('a forty-character subject repeats once on every page and its merged label stays above the footer', async ({ page }) => {
  const subject = '가나다라마바사아자차'.repeat(4);
  expect(subject).toHaveLength(40);
  const shortGoals = Array.from({ length: 32 }, (_, index) => goal(`long-subject-${index}`, subject, `교재 ${index + 1}`, { range: `${index + 1}쪽`, completed: index % 2 === 0 }));
  await open(page, { ...createEmptyState(), subjects: [subject], goals: shortGoals });
  const before = await stored(page);
  await openPreview(page);
  const pageCount = await pages(page).count();
  expect(pageCount).toBeGreaterThan(1);
  await expect(rows(page)).toHaveCount(shortGoals.length);
  expect(await rows(page).evaluateAll(elements => elements.map(element => element.getAttribute('data-goal-id')))).toEqual(shortGoals.map(item => item.id));
  await expectMergedSubjects(page, shortGoals);
  await expect(pages(page).locator('.goal-print-subject')).toHaveCount(pageCount);
  await page.emulateMedia({ media: 'print' });
  const fits = await pages(page).evaluateAll(elements => elements.map(element => {
    const cell = element.querySelector<HTMLElement>('.goal-print-subject')!;
    const cellBounds = cell.getBoundingClientRect();
    const footerBounds = element.querySelector('.goal-print-paper-footer')!.getBoundingClientRect();
    const headerBounds = element.querySelector('thead')!.getBoundingClientRect();
    const tableBounds = element.querySelector('.goal-print-table')!.getBoundingClientRect();
    return cellBounds.top >= headerBounds.bottom - 1 && cellBounds.bottom <= footerBounds.top + 1
      && tableBounds.bottom <= footerBounds.top + 1 && cell.scrollHeight <= cell.clientHeight + 1
      && element.scrollHeight <= element.clientHeight + 1;
  }));
  expect(fits.every(Boolean)).toBe(true);
  const pdf = await page.pdf({ path: 'test-results/goal-print-merged-subject.pdf', preferCSSPageSize: true, printBackground: true });
  expect([...pdf.toString('latin1').matchAll(/\d+\s+0\s+obj\b([\s\S]*?)endobj/g)].filter(match => /\/Type\s*\/Page\b/.test(match[1]))).toHaveLength(pageCount);
  expect(await stored(page)).toBe(before);
  expect(await printCalls(page)).toBe(0);
  await page.emulateMedia({ media: 'screen' });
});

test('empty-week previews cannot print and mobile pages fit without changing saved goals', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, { ...fixture, goals: [fixture.goals[3]] });
  const before = await stored(page);
  await page.getByRole('button', { name: '프린트', exact: true }).click();
  await expect(preview(page).getByText('이번 주에 등록한 학습 목표가 없어요.', { exact: true })).toBeVisible();
  await expect(preview(page).getByRole('button', { name: '인쇄하기', exact: true })).toBeDisabled();
  expect(await printCalls(page)).toBe(0);
  await preview(page).getByRole('button', { name: '미리보기 닫기', exact: true }).click();
  await page.getByRole('button', { name: '다음 주', exact: true }).click();
  await openPreview(page);
  await expect(rows(page)).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const sheet = await pages(page).first().boundingBox();
  expect(sheet).not.toBeNull();
  expect(sheet!.x).toBeGreaterThanOrEqual(0);
  expect(sheet!.x + sheet!.width).toBeLessThanOrEqual(390);
  await preview(page).getByRole('button', { name: '인쇄하기', exact: true }).click();
  expect(await printCalls(page)).toBe(1);
  expect(await stored(page)).toBe(before);
});
