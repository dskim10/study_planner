import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_EVENT_CATEGORIES, DEFAULT_SUBJECTS, type PlannerState, type ScheduleEvent } from '../src/types';
import { syncSubjectCategories } from '../src/lib/subjects';

const schedule = (id: string, type: string, startTime: string, endTime: string, changes: Partial<ScheduleEvent> = {}): ScheduleEvent => ({
  id, title: id, type, date: '2026-10-05', startTime, endTime, allDay: false, recurrence: 'none', weekdays: [], ...changes,
});
const fixture: PlannerState = syncSubjectCategories({
  version: 3, isDemo: false, subjects: DEFAULT_SUBJECTS,
  categories: [
    { id: 'math', label: '수학', color: '#6d8ec7' },
    { id: 'english', label: '영어', color: '#9b79cf' },
    { id: 'personal', label: '개인 일정', color: '#809387' },
  ],
  events: [
    schedule('수학 개념', 'math', '09:00', '11:00'),
    schedule('수학 문제', 'math', '10:00', '12:00'),
    schedule('영어 독해', 'english', '11:00', '13:00'),
    schedule('점심과 이동', 'personal', '12:00', '14:00'),
    schedule('화요일 수학', 'math', '09:00', '10:00', { date: '2026-10-06', recurrence: 'weekly', weekdays: [2] }),
  ],
  goals: [
    { id: 'this-week', weekStart: '2026-10-05', subject: '수학', material: '이번 주 교재', range: '1장', estimatedMinutes: 120, completed: false },
    { id: 'next-week', weekStart: '2026-10-12', subject: '수학', material: '다음 주 교재', range: '2장', completed: true },
  ],
});

async function open(page: Page, data: PlannerState = fixture) {
  await page.clock.setFixedTime(new Date('2026-10-05T10:00:00+09:00'));
  await page.addInitScript(value => {
    if (!localStorage.getItem('chagok-planner-v1')) localStorage.setItem('chagok-planner-v1', JSON.stringify(value));
  }, data);
  await page.goto('/');
}
const stored = (page: Page): Promise<PlannerState> => page.evaluate(() => JSON.parse(localStorage.getItem('chagok-planner-v1')!));
const summary = (page: Page) => page.getByRole('region', { name: '과목별 계획한 학습 시간', exact: true });
const subjectTime = (page: Page, name: string) => summary(page).locator('dl > div').filter({ has: page.getByText(name, { exact: true }) }).locator('dd');
const manager = (page: Page) => page.getByRole('dialog', { name: '과목 관리', exact: true });
const sidebar = (page: Page) => page.getByRole('region', { name: '내 캘린더', exact: true });

async function expectTotals(page: Page, planned: string, available: string, remaining = available) {
  await expect(page.locator('.planned-stat .stat-value')).toContainText(planned);
  await expect(page.locator('.available-stat .stat-value')).toContainText(available);
  await expect(page.locator('.remaining-stat .stat-value')).toContainText(remaining);
}

async function addFromManager(page: Page, name: string) {
  await page.getByRole('button', { name: '과목 관리', exact: true }).click();
  await manager(page).getByRole('button', { name: '과목 추가', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '과목 추가', exact: true });
  await dialog.getByRole('textbox', { name: '과목 이름', exact: true }).fill(name);
  await dialog.getByRole('button', { name: '과목 추가', exact: true }).click();
  await manager(page).getByRole('button', { name: '완료', exact: true }).click();
}

test('calendar excludes subjects from capacity, unions overlapping ordinary events and preserves totals through filters, goals, months and weeks', async ({ page }) => {
  await open(page, { ...fixture, events: [...fixture.events, schedule('겹친 이동', 'personal', '13:00', '15:00')] });
  await expectTotals(page, '5시간', '165시간', '161시간');
  await expect(subjectTime(page, '수학')).toHaveText('4시간');
  await expect(subjectTime(page, '영어')).toHaveText('2시간');
  await expect(subjectTime(page, '국어')).toHaveText('0분');
  await expect(page.locator('.cal-day-header').nth(0).locator('.cal-planned-time')).toHaveText('계획 4시간');
  await expect(page.locator('.cal-day-header').nth(1).locator('.cal-planned-time')).toHaveText('계획 1시간');
  await expect(page.locator('.cal-day-header').nth(0).locator('.cal-availability')).toHaveText('자습 21시간');
  await expect(page.locator('.cal-day-header').nth(1).locator('.cal-availability')).toHaveText('자습 24시간');

  await page.getByRole('region', { name: '내 캘린더', exact: true }).getByRole('checkbox', { name: '수학', exact: true }).uncheck();
  await expect(page.locator('.cal-event')).toHaveCount(3);
  await expectTotals(page, '5시간', '165시간', '161시간');
  await sidebar(page).getByRole('checkbox', { name: '개인 일정', exact: true }).uncheck();
  await expect(page.locator('.cal-event')).toHaveCount(1);
  await expectTotals(page, '5시간', '165시간', '161시간');
  await page.getByRole('button', { name: '월간', exact: true }).click();
  const monday = page.locator('.cal-month-cell').filter({ has: page.getByRole('button', { name: '10월 5일 월요일 일정 추가', exact: true }) });
  await expect(monday.locator('.cal-planned-time')).toHaveText('계획 4시간');
  await expect(monday.locator('.cal-month-available')).toHaveText('자습 21시간');
  await page.reload();
  await expectTotals(page, '5시간', '165시간', '161시간');
  await expect(page.getByRole('region', { name: '내 캘린더', exact: true }).getByRole('checkbox', { name: '수학', exact: true })).not.toBeChecked();

  await page.getByRole('link', { name: '주간 학습 계획', exact: true }).click();
  await expect(subjectTime(page, '수학')).toHaveText('4시간');
  await expect(page.locator('.goal-day').first().locator('.goal-day-planned')).toContainText('4시간');
  await expect(page.locator('.goal-day').first().locator('strong')).toHaveText('21시간');
  await page.getByRole('checkbox', { name: /이번 주 교재/ }).check();
  await expectTotals(page, '5시간', '165시간', '161시간');
  await page.getByRole('button', { name: '이번 주 교재 삭제', exact: true }).click();
  await page.getByRole('button', { name: '목표 삭제', exact: true }).click();
  await expectTotals(page, '5시간', '165시간', '161시간');
  await page.getByRole('button', { name: '다음 주', exact: true }).click();
  await expectTotals(page, '1시간', '168시간', '167시간');
  await expect(subjectTime(page, '수학')).toHaveText('1시간');
  await expect(subjectTime(page, '영어')).toHaveText('0분');
  await page.getByRole('link', { name: '캘린더', exact: true }).click();
  await expectTotals(page, '1시간', '168시간', '167시간');
  await page.getByRole('button', { name: '이전 주', exact: true }).click();
  await expectTotals(page, '5시간', '165시간', '161시간');
});

test('subject management validates names and updates goals across weeks while preserving calendar events', async ({ page }) => {
  await open(page);
  await sidebar(page).getByRole('checkbox', { name: '수학', exact: true }).uncheck();
  await page.getByRole('link', { name: '주간 학습 계획', exact: true }).click();
  await page.getByRole('button', { name: '과목 관리', exact: true }).click();
  await manager(page).getByRole('button', { name: '과목 추가', exact: true }).click();
  const add = page.getByRole('dialog', { name: '과목 추가', exact: true });
  await add.getByRole('textbox', { name: '과목 이름', exact: true }).fill(' 수학 ');
  await add.getByRole('button', { name: '과목 추가', exact: true }).click();
  await expect(add.getByRole('alert')).toBeVisible();
  await add.getByRole('textbox', { name: '과목 이름', exact: true }).fill(' 코딩 ');
  await add.getByRole('button', { name: '과목 추가', exact: true }).click();
  await manager(page).getByRole('button', { name: '완료', exact: true }).click();
  await expect(subjectTime(page, '코딩')).toHaveText('0분');

  await page.getByRole('button', { name: '학습 목표 추가', exact: true }).click();
  const goal = page.getByRole('dialog', { name: '새 학습 목표', exact: true });
  await expect(goal.locator('#goal-subject option')).toHaveText([...DEFAULT_SUBJECTS, '코딩']);
  await goal.locator('#goal-subject').selectOption('코딩');
  await expect(goal.getByLabel('예상 소요 시간', { exact: false })).toHaveCount(0);
  await goal.getByLabel('학습자료', { exact: false }).fill('프로그래밍 입문');
  await goal.getByLabel('학습 범위', { exact: false }).fill('첫 프로그램');
  await goal.getByRole('button', { name: '목표 저장', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /코딩 프로그래밍 입문/ })).toBeVisible();
  expect((await stored(page)).goals.find(item => item.material === '프로그래밍 입문')).not.toHaveProperty('estimatedMinutes');
  await expectTotals(page, '5시간', '166시간', '162시간');

  await page.getByRole('button', { name: '과목 관리', exact: true }).click();
  await manager(page).getByRole('button', { name: '수학 과목 수정', exact: true }).click();
  const rename = page.getByRole('dialog', { name: '과목 이름 수정', exact: true });
  await rename.getByRole('textbox', { name: '과목 이름', exact: true }).fill('미적분');
  await rename.getByRole('button', { name: '과목 저장', exact: true }).click();
  await manager(page).getByRole('button', { name: '완료', exact: true }).click();
  expect((await stored(page)).goals.filter(item => item.id.endsWith('week')).map(item => item.subject)).toEqual(['미적분', '미적분']);
  await expect(subjectTime(page, '미적분')).toHaveText('4시간');
  await expectTotals(page, '5시간', '166시간', '162시간');
  expect((await stored(page)).categories.find(item => item.id === 'math')?.label).toBe('미적분');
  expect((await stored(page)).hiddenCategoryIds).toEqual(['math']);
  expect((await stored(page)).events).toEqual(fixture.events);
  await expect(sidebar(page).getByRole('checkbox', { name: '미적분', exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: '다음 주', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /미적분 다음 주 교재/ })).toBeChecked();
  await page.getByRole('button', { name: '이전 주', exact: true }).click();

  await page.getByRole('button', { name: '과목 관리', exact: true }).click();
  await manager(page).getByRole('button', { name: '미적분 과목 삭제', exact: true }).click();
  let deletion = page.getByRole('dialog', { name: '과목 삭제', exact: true });
  await deletion.getByRole('combobox', { name: '이동할 과목', exact: true }).selectOption('코딩');
  await deletion.getByRole('button', { name: '과목 삭제', exact: true }).click();
  expect((await stored(page)).goals.map(item => item.subject)).toEqual(['코딩', '코딩', '코딩']);
  await expectTotals(page, '2시간', '162시간');
  await manager(page).getByRole('button', { name: '코딩 과목 삭제', exact: true }).click();
  deletion = page.getByRole('dialog', { name: '과목 삭제', exact: true });
  await deletion.getByRole('radio', { name: '이 과목의 학습 목표도 함께 삭제', exact: true }).check();
  await expect(deletion.getByRole('button', { name: '과목 삭제', exact: true })).toBeDisabled();
  await deletion.getByRole('checkbox', { name: '모든 주의 학습 목표 3개 삭제에 동의합니다', exact: true }).check();
  await deletion.getByRole('button', { name: '과목 삭제', exact: true }).click();
  await manager(page).getByRole('button', { name: '완료', exact: true }).click();
  await page.reload();
  const data = await stored(page);
  expect(data.goals).toEqual([]);
  expect(data.events).toEqual(fixture.events);
  expect(data.categories.filter(item => item.label !== '코딩')).toEqual(fixture.categories.map(item => item.id === 'math' ? { ...item, label: '미적분' } : item));
  expect(data.categories.filter(item => item.label === '코딩')).toHaveLength(1);
  expect(data.subjects).not.toContain('수학');
  expect(data.subjects).not.toContain('미적분');
  expect(data.subjects).not.toContain('코딩');
  await expectTotals(page, '2시간', '162시간');
  await page.getByRole('link', { name: '캘린더', exact: true }).click();
  await sidebar(page).getByRole('button', { name: '미적분 옵션', exact: true }).click();
  await page.getByRole('dialog', { name: '미적분 옵션', exact: true }).getByRole('button', { name: '일정 종류 삭제', exact: true }).click();
  const deleteCategory = page.getByRole('dialog', { name: '일정 종류 삭제', exact: true });
  await deleteCategory.getByRole('radio', { name: '이 종류의 일정도 함께 삭제', exact: true }).check();
  await deleteCategory.getByRole('button', { name: '종류 삭제', exact: true }).click();
  expect((await stored(page)).events).toEqual(fixture.events.filter(item => item.type !== 'math'));
  await expectTotals(page, '2시간', '166시간', '165시간');
});

test('the last subject can be deleted and restored from a new goal on mobile without restoring defaults', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, { ...fixture, subjects: ['수학'] });
  await expectTotals(page, '4시간', '165시간', '162시간');
  await page.getByRole('link', { name: '주간 학습 계획', exact: true }).click();
  await page.getByRole('button', { name: '과목 관리', exact: true }).click();
  await manager(page).getByRole('button', { name: '수학 과목 삭제', exact: true }).click();
  const deletion = page.getByRole('dialog', { name: '과목 삭제', exact: true });
  await expect(deletion.getByRole('button', { name: '과목 삭제', exact: true })).toBeDisabled();
  await deletion.getByRole('checkbox', { name: '모든 주의 학습 목표 2개 삭제에 동의합니다', exact: true }).check();
  await deletion.getByRole('button', { name: '과목 삭제', exact: true }).click();
  await manager(page).getByRole('button', { name: '완료', exact: true }).click();
  await page.reload();
  await expectTotals(page, '0분', '162시간');
  expect((await stored(page)).subjects).toEqual([]);
  expect((await stored(page)).goals).toEqual([]);
  expect((await stored(page)).events).toEqual(fixture.events);
  await page.getByRole('button', { name: '학습 목표 추가', exact: true }).click();
  const add = page.getByRole('dialog', { name: '과목 추가', exact: true });
  await add.getByRole('textbox', { name: '과목 이름', exact: true }).fill('수학');
  await add.getByRole('button', { name: '과목 추가', exact: true }).click();
  const goal = page.getByRole('dialog', { name: '새 학습 목표', exact: true });
  await expect(goal.locator('#goal-subject')).toHaveValue('수학');
  await expect(goal.locator('#goal-subject option')).toHaveCount(1);
  await goal.getByLabel('학습자료', { exact: false }).fill('다시 시작하는 교재');
  await goal.getByLabel('학습 범위', { exact: false }).fill('1장');
  await goal.getByRole('button', { name: '목표 저장', exact: true }).click();
  await expectTotals(page, '4시간', '165시간', '162시간');
  await page.reload();
  expect((await stored(page)).subjects).toEqual(['수학']);
  await expect(page.getByRole('checkbox', { name: /수학 다시 시작하는 교재/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('normalized subject all-day and midnight events preserve capacity while ordinary all-day events block the day', async ({ page }) => {
  await open(page, {
    version: 3, isDemo: false, subjects: ['math'], goals: [],
    categories: [{ id: 'math', label: 'Ｍａｔｈ', color: '#6d8ec7' }, { id: 'school', label: '학교', color: '#809387' }],
    events: [
      schedule('종일 수학', 'math', '09:00', '10:00', { allDay: true }),
      schedule('겹친 수학', 'math', '10:00', '11:00'),
      schedule('자정까지 공부', 'math', '23:00', '24:00', { date: '2026-10-06' }),
      schedule('math', 'school', '12:00', '13:00', { date: '2026-10-07' }),
      schedule('종일 학교', 'school', '09:00', '10:00', { date: '2026-10-08', allDay: true }),
      schedule('학교와 겹친 종일 수학', 'math', '09:00', '10:00', { date: '2026-10-08', allDay: true }),
    ],
  });
  await expectTotals(page, '49시간', '143시간', '118시간');
  await expect(subjectTime(page, 'math')).toHaveText('49시간');
  await expect(page.locator('.cal-day-header').nth(0).locator('.cal-planned-time')).toHaveText('계획 24시간');
  await expect(page.locator('.cal-day-header').nth(1).locator('.cal-planned-time')).toHaveText('계획 1시간');
  await expect(page.locator('.cal-day-header').nth(2).locator('.cal-planned-time')).toHaveText('계획 0분');
  await expect(page.locator('.cal-day-header').nth(0).locator('.cal-availability')).toHaveText('자습 24시간');
  await expect(page.locator('.cal-day-header').nth(1).locator('.cal-availability')).toHaveText('자습 24시간');
  await expect(page.locator('.cal-day-header').nth(2).locator('.cal-availability')).toHaveText('자습 23시간');
  await expect(page.locator('.cal-day-header').nth(3).locator('.cal-availability')).toHaveText('자습 0분');
  await page.getByRole('region', { name: '내 캘린더', exact: true }).getByRole('checkbox', { name: 'Ｍａｔｈ', exact: true }).uncheck();
  await expect(page.locator('.cal-all-day-event')).toHaveCount(1);
  await expectTotals(page, '49시간', '143시간', '118시간');
  await page.getByRole('button', { name: '월간', exact: true }).click();
  const monday = page.locator('.cal-month-cell').filter({ has: page.getByRole('button', { name: '10월 5일 월요일 일정 추가', exact: true }) });
  const thursday = page.locator('.cal-month-cell').filter({ has: page.getByRole('button', { name: '10월 8일 목요일 일정 추가', exact: true }) });
  await expect(monday.locator('.cal-month-available')).toHaveText('자습 24시간');
  await expect(thursday.locator('.cal-month-available')).toHaveText('자습 0분');
  await page.getByRole('link', { name: '주간 학습 계획', exact: true }).click();
  await expect(page.locator('.goal-day').nth(0).locator('strong')).toHaveText('24시간');
  await expect(page.locator('.goal-day').nth(3).locator('strong')).toHaveText('0분');
  await page.reload();
  await expectTotals(page, '49시간', '143시간', '118시간');
});

test('default and custom subjects create protected real categories, reuse existing names and accept forty-character mobile events', async ({ page }) => {
  const existing = { id: 'existing-coding', label: 'Ｃｏｄｉｎｇ', color: '#123456' };
  await open(page, { version: 3, isDemo: false, subjects: DEFAULT_SUBJECTS, categories: [...DEFAULT_EVENT_CATEGORIES, existing], events: [], goals: [], hiddenCategoryIds: [existing.id] });
  for (const name of DEFAULT_SUBJECTS) {
    await expect(sidebar(page).getByRole('checkbox', { name, exact: true })).toBeChecked();
    await expect(sidebar(page).getByRole('img', { name: `${name}: 이름과 삭제는 과목 관리에서 변경`, exact: true })).toBeVisible();
    await sidebar(page).getByRole('button', { name: `${name} 옵션`, exact: true }).click();
    await expect(page.getByRole('dialog', { name: `${name} 옵션`, exact: true }).getByRole('button', { name: '일정 종류 삭제', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
  }
  const initial = await stored(page);
  expect(initial.categories).toHaveLength(DEFAULT_EVENT_CATEGORIES.length + DEFAULT_SUBJECTS.length + 1);
  await page.getByRole('link', { name: '주간 학습 계획', exact: true }).click();
  await addFromManager(page, 'coding');
  expect((await stored(page)).categories).toEqual(initial.categories);
  expect((await stored(page)).hiddenCategoryIds).toEqual([existing.id]);
  await expect(sidebar(page).getByRole('img', { name: `${existing.label}: 이름과 삭제는 과목 관리에서 변경`, exact: true })).toBeVisible();
  await expect(sidebar(page).getByRole('button', { name: `${existing.label} 옵션`, exact: true })).toBeVisible();

  const longName = '가'.repeat(40);
  await addFromManager(page, longName);
  const linked = (await stored(page)).categories.find(item => item.label === longName)!;
  expect(linked.id).toBeTruthy();
  expect(linked.color).toMatch(/^#[\da-f]{6}$/i);
  await page.reload();
  expect((await stored(page)).categories.find(item => item.label === longName)).toEqual(linked);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('link', { name: '캘린더', exact: true }).click();
  const legend = page.locator('.cal-legend');
  await expect(legend.getByRole('img', { name: `${longName}: 이름과 삭제는 과목 관리에서 변경`, exact: true })).toBeVisible();
  await expect(legend.getByRole('button', { name: /종류 삭제|종류 수정/ })).toHaveCount(0);
  await page.getByRole('button', { name: '일정 추가', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '새 일정 추가', exact: true });
  await editor.getByLabel('일정 이름', { exact: true }).fill('긴 과목으로 공부');
  await editor.getByRole('button', { name: longName, exact: true }).click();
  await editor.getByLabel('시작 시간', { exact: true }).fill('18:00');
  await editor.getByLabel('종료 시간', { exact: true }).fill('19:00');
  await editor.getByRole('button', { name: '일정 추가', exact: true }).click();
  await expect(page.locator('.cal-event')).toHaveCount(1);
  await expectTotals(page, '1시간', '168시간', '167시간');
  await page.locator('.cal-event').click();
  await page.getByRole('dialog').getByLabel('일정 이름', { exact: true }).fill('수정한 과목 공부');
  await page.getByRole('dialog').getByRole('button', { name: '변경사항 저장', exact: true }).click();
  await expect(page.locator('.cal-event')).toContainText('수정한 과목 공부');
  await legend.getByRole('checkbox', { name: longName, exact: true }).uncheck();
  await expect(page.locator('.cal-event')).toHaveCount(0);
  await expectTotals(page, '1시간', '168시간', '167시간');
  await page.reload();
  expect((await stored(page)).events[0].type).toBe(linked.id);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('renaming a subject into an existing category merges all schedules and keeps a visible destination', async ({ page }) => {
  const target = { id: 'reading', label: '독서', color: '#123456' };
  const events = [...fixture.events, schedule('독서 모임', target.id, '14:00', '15:00')];
  await open(page, { ...fixture, subjects: ['수학'], categories: [...fixture.categories, target], events, hiddenCategoryIds: ['math'] });
  await expectTotals(page, '4시간', '164시간', '161시간');
  await page.getByRole('link', { name: '주간 학습 계획', exact: true }).click();
  await page.getByRole('button', { name: '과목 관리', exact: true }).click();
  await manager(page).getByRole('button', { name: '수학 과목 수정', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '과목 이름 수정', exact: true });
  await dialog.getByRole('textbox', { name: '과목 이름', exact: true }).fill('독서');
  await dialog.getByRole('button', { name: '과목 저장', exact: true }).click();
  await manager(page).getByRole('button', { name: '완료', exact: true }).click();
  const data = await stored(page);
  expect(data.categories.filter(item => item.label === '독서')).toEqual([target]);
  expect(data.categories.some(item => item.id === 'math')).toBe(false);
  expect(data.events).toEqual(events.map(item => item.type === 'math' ? { ...item, type: target.id } : item));
  expect(data.goals).toEqual(fixture.goals.map(item => ({ ...item, subject: '독서' })));
  expect(data.hiddenCategoryIds).toEqual([]);
  await expectTotals(page, '5시간', '165시간', '161시간');
  await page.getByRole('link', { name: '캘린더', exact: true }).click();
  await expect(sidebar(page).getByRole('checkbox', { name: '독서', exact: true })).toBeChecked();
  await sidebar(page).getByRole('button', { name: '독서 옵션', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '독서 옵션', exact: true }).getByRole('button', { name: '일정 종류 삭제', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.cal-event')).toHaveCount(6);
  await page.reload();
  expect((await stored(page)).events).toEqual(data.events);
  await expectTotals(page, '5시간', '165시간', '161시간');
  await page.getByRole('button', { name: '다음 주', exact: true }).click();
  await expect(page.locator('.cal-event')).toHaveCount(1);
  await expect(page.locator('.cal-event-kind')).toHaveText('독서');
  await expectTotals(page, '1시간', '168시간', '167시간');
});
