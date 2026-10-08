import { expect, test, type Page } from '@playwright/test';
import { createEmptyState } from '../src/lib/planner';
import type { PlannerState, StudyGoal } from '../src/types';

const subjects = ['국어', '수학', '영어', '과학', '사회'];
const makeGoal = (subject: string, weekStart = '2026-10-05', completed = false): StudyGoal => ({
  id: `${weekStart}-${subject}`, weekStart, subject, material: `${subject} 교재`, range: '1단원', completed,
});
const fixture: PlannerState = {
  ...createEmptyState(), subjects, hiddenCategoryIds: ['school'],
  events: [
    { id: 'korean-study', title: '국어 공부', type: createEmptyState().categories.find(item => item.label === '국어')!.id, date: '2026-10-05', startTime: '09:00', endTime: '10:00', allDay: false, recurrence: 'weekly', weekdays: [1] },
    { id: 'math-study', title: '수학 공부', type: createEmptyState().categories.find(item => item.label === '수학')!.id, date: '2026-10-05', startTime: '10:00', endTime: '12:00', allDay: false, recurrence: 'weekly', weekdays: [1] },
  ],
  goals: [makeGoal('국어'), makeGoal('수학', '2026-10-05', true), makeGoal('영어'), makeGoal('사회'), ...subjects.map(subject => makeGoal(subject, '2026-10-12'))],
};
const handle = (page: Page, name: string) => page.getByRole('button', { name: `${name} 순서 이동`, exact: true });
const card = (page: Page, name: string) => page.locator('.goal-subject-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
const cardNames = (page: Page) => page.locator('.goal-subject-name h3');
const stored = (page: Page): Promise<PlannerState> => page.evaluate(() => JSON.parse(localStorage.getItem('chagok-planner-v1')!));

async function open(page: Page, desktop = true) {
  if (desktop) await page.setViewportSize({ width: 1440, height: 1100 });
  await page.clock.setFixedTime(new Date('2026-10-05T10:00:00+09:00'));
  await page.addInitScript(value => {
    if (!localStorage.getItem('chagok-planner-v1')) localStorage.setItem('chagok-planner-v1', JSON.stringify(value));
    window.print = () => {};
  }, fixture);
  await page.goto('/#plan');
  await expect(cardNames(page)).toHaveText(['국어', '수학', '영어', '사회']);
}

async function dragPoints(page: Page, from: string, to: string) {
  await handle(page, from).evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  const source = await handle(page, from).boundingBox();
  const target = await card(page, to).boundingBox();
  expect(source).not.toBeNull();
  expect(target).not.toBeNull();
  return {
    start: { x: source!.x + source!.width / 2, y: source!.y + source!.height / 2 },
    end: { x: target!.x + target!.width / 2, y: target!.y + target!.height / 2 },
  };
}

async function beginDrag(page: Page, from: string, to: string) {
  const { start, end } = await dragPoints(page, from, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await expect(card(page, from)).toHaveClass(/goal-subject-dragging/);
}

async function expectOrderOnly(page: Page, order: string[], original = fixture) {
  await expect.poll(async () => (await stored(page)).subjects).toEqual(order);
  const data = await stored(page);
  expect({ ...data, subjects: original.subjects }).toEqual(original);
  await expect(page.locator('.planned-stat .stat-value')).toContainText('3시간');
  await expect(page.locator('.available-stat .stat-value')).toContainText('165시간');
  await expect(page.locator('.remaining-stat .stat-value')).toContainText('165시간');
}

test('mouse card reorder persists across reload, weeks, goal selection and print order without changing planner contents', async ({ page }) => {
  await open(page);
  const original = await stored(page);
  await beginDrag(page, '국어', '영어');
  expect(await stored(page)).toEqual(original);
  await page.mouse.up();
  const order = ['수학', '영어', '국어', '과학', '사회'];
  await expect(cardNames(page)).toHaveText(['수학', '영어', '국어', '사회']);
  await expectOrderOnly(page, order, original);
  await page.reload();
  await expect(cardNames(page)).toHaveText(['수학', '영어', '국어', '사회']);
  await page.getByRole('button', { name: '학습 목표 추가', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '새 학습 목표', exact: true }).locator('#goal-subject option')).toHaveText(order);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '프린트', exact: true }).click();
  const printPreview = page.getByRole('dialog', { name: '학습 목표 인쇄 미리보기', exact: true });
  await expect(printPreview.getByRole('button', { name: '인쇄하기', exact: true })).toBeEnabled();
  await expect(page.locator('.goal-print-page tbody .goal-print-subject')).toHaveText(['수학', '영어', '국어', '사회']);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '다음 주', exact: true }).click();
  await expect(cardNames(page)).toHaveText(order);
  await expectOrderOnly(page, order, original);
});

test('cancelled and outside drags do not save, and filtered moves retain hidden subjects in the global list', async ({ page }) => {
  await open(page);
  const original = await stored(page);
  await beginDrag(page, '국어', '영어');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.goal-subject-dragging')).toHaveCount(0);
  expect(await stored(page)).toEqual(original);
  await beginDrag(page, '국어', '수학');
  await page.mouse.move(10, 10);
  await page.mouse.up();
  await expect(page.locator('.goal-subject-dragging')).toHaveCount(0);
  expect(await stored(page)).toEqual(original);
  await beginDrag(page, '국어', '영어');
  await handle(page, '국어').dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', isPrimary: true });
  await page.mouse.up();
  await expect(page.locator('.goal-subject-dragging')).toHaveCount(0);
  expect(await stored(page)).toEqual(original);

  await page.locator('.goal-filters').getByRole('button', { name: /^진행 중/ }).click();
  await expect(cardNames(page)).toHaveText(['국어', '영어', '사회']);
  await beginDrag(page, '사회', '국어');
  expect(await stored(page)).toEqual(original);
  await page.mouse.up();
  const order = ['사회', '국어', '수학', '영어', '과학'];
  await expect(cardNames(page)).toHaveText(['사회', '국어', '영어']);
  await expectOrderOnly(page, order, original);
  await page.locator('.goal-filters').getByRole('button', { name: /^전체 목표/ }).click();
  await expect(cardNames(page)).toHaveText(['사회', '국어', '수학', '영어']);
  await expect(page.getByRole('checkbox', { name: /수학 수학 교재/ })).toBeChecked();
});

test('keyboard pickup, movement, boundaries and cancellation keep focus on the moved subject', async ({ page }) => {
  await open(page);
  const original = await stored(page);
  await handle(page, '국어').focus();
  await page.keyboard.press('Space');
  await expect(handle(page, '국어')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowUp');
  expect(await stored(page)).toEqual(original);
  await page.keyboard.press('Enter');
  await expect(handle(page, '국어')).toBeFocused();
  expect(await stored(page)).toEqual(original);
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  expect(await stored(page)).toEqual(original);
  await page.keyboard.press('Enter');
  const order = ['수학', '국어', '영어', '과학', '사회'];
  await expectOrderOnly(page, order, original);
  await expect(handle(page, '국어')).toBeFocused();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(handle(page, '국어')).toBeFocused();
  await expect(handle(page, '국어')).toHaveAttribute('aria-pressed', 'false');
  await expectOrderOnly(page, order, original);
  await handle(page, '사회').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await expect(handle(page, '사회')).toBeFocused();
  await expectOrderOnly(page, order, original);
});

test.describe('touch card order', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('touch handle dragging reorders cards while swiping the card body keeps native scrolling', async ({ page }) => {
    await open(page, false);
    const original = await stored(page);
    const { start, end } = await dragPoints(page, '국어', '수학');
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    for (let step = 1; step <= 6; step++) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + (end.x - start.x) * step / 6, y: start.y + (end.y - start.y) * step / 6 }] });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    expect(await stored(page)).toEqual(original);
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const order = ['수학', '국어', '영어', '과학', '사회'];
    await expect(cardNames(page)).toHaveText(['수학', '국어', '영어', '사회']);
    await expectOrderOnly(page, order, original);

    const body = card(page, '국어').locator('.goal-item-content');
    await body.evaluate(element => element.scrollIntoView({ block: 'center' }));
    const bounds = await body.boundingBox();
    const point = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };
    const beforeScroll = await page.evaluate(() => window.scrollY);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    for (let step = 1; step <= 5; step++) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y - step * 30 }] });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(beforeScroll);
    await expect(page.locator('.goal-subject-dragging')).toHaveCount(0);
    await expectOrderOnly(page, order, original);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await session.detach();
  });
});
