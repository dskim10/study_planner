import { expect, test, type Page } from '@playwright/test';

async function openEmpty(page: Page, today = '2026-10-05') {
  await page.clock.setFixedTime(new Date(`${today}T10:00:00+09:00`));
  await page.addInitScript(() => {
    if (!localStorage.getItem('chagok-planner-v1')) localStorage.setItem('chagok-planner-v1', JSON.stringify({ version: 2, events: [], goals: [], isDemo: false }));
  });
  await page.goto('/');
}

async function newEvent(page: Page, title: string) {
  await page.getByRole('button', { name: '일정 추가', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('일정 이름', { exact: true }).fill(title);
  await dialog.getByLabel('시작 시간', { exact: true }).fill('09:00');
  await dialog.getByLabel('종료 시간', { exact: true }).fill('10:00');
  return dialog;
}

for (const [mode, label, hours, occurrences] of [['daily', '매일', 161, 7], ['weekdays', '주중(월~금)', 163, 5]] as const) {
  test(`${mode} preset persists and applies its inclusive end date to availability`, async ({ page }) => {
    await openEmpty(page);
    let dialog = await newEvent(page, `${label} 복습`);
    await expect(dialog.getByLabel('반복', { exact: true }).locator('option')).toHaveText(['반복 안 함', '매일', '매주', '매월', '주중(월~금)', '맞춤']);
    await dialog.getByLabel('반복', { exact: true }).selectOption(mode);
    await dialog.getByRole('button', { name: '일정 추가', exact: true }).click();
    await expect(page.locator('.cal-event')).toHaveCount(occurrences);
    await expect(page.locator('.available-stat .stat-value')).toContainText(`${hours}시간`);
    await page.reload();
    await page.locator('.cal-event').first().click();
    dialog = page.getByRole('dialog', { name: '일정 수정', exact: true });
    await dialog.getByRole('radio', { name: '전체 반복 일정', exact: true }).check();
    await expect(dialog.getByLabel('반복', { exact: true })).toHaveValue(mode);
    await dialog.getByLabel('반복 종료일', { exact: true }).fill('2026-10-07');
    await dialog.getByRole('button', { name: '변경사항 저장' }).click();
    await expect(page.locator('.cal-event')).toHaveCount(3);
    await expect(page.locator('.available-stat .stat-value')).toContainText('165시간');
    await page.getByRole('button', { name: '다음 주', exact: true }).click();
    await expect(page.locator('.available-stat .stat-value')).toContainText('168시간');
  });
}

test('monthly preset skips nonexistent dates and appears again in March', async ({ page }) => {
  await openEmpty(page, '2026-01-31');
  const dialog = await newEvent(page, '월말 점검');
  await dialog.getByLabel('반복', { exact: true }).selectOption('monthly');
  await dialog.getByRole('button', { name: '일정 추가', exact: true }).click();
  await expect(page.locator('.cal-event')).toHaveCount(1);
  await page.getByRole('button', { name: '월간', exact: true }).click();
  await page.getByRole('button', { name: '다음 달', exact: true }).click();
  await expect(page.locator('.cal-month-toolbar')).toContainText('2026년 2월');
  await expect(page.locator('.cal-month-cell:not(.cal-other-month) .cal-month-event')).toHaveCount(0);
  await page.getByRole('button', { name: '다음 달', exact: true }).click();
  await expect(page.locator('.cal-month-cell:not(.cal-other-month) .cal-month-event')).toHaveCount(1);
  await expect(page.locator('.cal-month-cell:not(.cal-other-month) .cal-month-event')).toHaveAttribute('aria-label', /3월 31일/);
});

test('custom fortnightly weekdays stop after actual occurrences and preserve the draft on cancel', async ({ page }) => {
  await openEmpty(page);
  let editor = await newEvent(page, '격주 스터디');
  await editor.getByLabel('반복', { exact: true }).selectOption('custom');
  let custom = page.getByRole('dialog', { name: '반복 설정', exact: true });
  await expect(custom.getByLabel('반복 간격', { exact: true })).toBeFocused();
  await expect(custom.getByLabel('종료 날짜', { exact: true })).toBeDisabled();
  await expect(custom.getByLabel('반복 횟수', { exact: true })).toBeDisabled();
  await page.screenshot({ path: 'test-results/recurrence-desktop.png', animations: 'disabled' });
  await custom.getByLabel('반복 간격', { exact: true }).fill('2');
  await custom.getByRole('button', { name: '수요일', exact: true }).click();
  await custom.getByRole('radio', { name: '다음', exact: true }).check();
  await custom.getByLabel('반복 횟수', { exact: true }).fill('3');
  await custom.getByRole('button', { name: '완료', exact: true }).click();
  editor = page.getByRole('dialog', { name: '새 일정 추가', exact: true });
  await expect(editor.getByLabel('일정 이름', { exact: true })).toHaveValue('격주 스터디');
  await expect(editor.getByLabel('시작 시간', { exact: true })).toHaveValue('09:00');
  await expect(editor.locator('.event-custom-summary')).toContainText('2주마다');
  await expect(editor.locator('.event-custom-summary')).toContainText('3회');
  await editor.getByRole('button', { name: '맞춤 설정 수정', exact: true }).click();
  custom = page.getByRole('dialog', { name: '반복 설정', exact: true });
  await custom.getByLabel('반복 횟수', { exact: true }).fill('7');
  await page.keyboard.press('Escape');
  await expect(editor.locator('.event-custom-summary')).toContainText('3회');
  await editor.getByRole('button', { name: '일정 추가', exact: true }).click();
  await expect(page.locator('.cal-event')).toHaveCount(2);
  await expect(page.locator('.available-stat .stat-value')).toContainText('166시간');
  await page.reload();
  await expect(page.locator('.cal-event')).toHaveCount(2);
  await page.getByRole('button', { name: '다음 주', exact: true }).click();
  await expect(page.locator('.available-stat .stat-value')).toContainText('168시간');
  await page.getByRole('button', { name: '다음 주', exact: true }).click();
  await expect(page.locator('.cal-event')).toHaveCount(1);
  await expect(page.locator('.available-stat .stat-value')).toContainText('167시간');
  await page.getByRole('link', { name: '주간 학습 계획', exact: true }).click();
  await expect(page.locator('.available-stat .stat-value')).toContainText('167시간');
});

test('mobile custom dialog validates fields, cancels new rules and persists daily all-day endings', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openEmpty(page);
  let editor = await newEvent(page, '집중 캠프');
  await editor.getByLabel('반복', { exact: true }).selectOption('custom');
  let custom = page.getByRole('dialog', { name: '반복 설정', exact: true });
  await page.screenshot({ path: 'test-results/recurrence-mobile.png', animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await custom.getByLabel('반복 간격', { exact: true }).fill('0');
  await custom.getByRole('button', { name: '완료', exact: true }).click();
  await expect(custom.getByRole('alert')).toContainText('정수');
  await custom.getByLabel('반복 간격', { exact: true }).fill('1');
  await custom.getByRole('button', { name: '월요일', exact: true }).click();
  await custom.getByRole('button', { name: '완료', exact: true }).click();
  await expect(custom.getByRole('alert')).toContainText('요일');
  await custom.getByRole('button', { name: '취소', exact: true }).click();
  editor = page.getByRole('dialog', { name: '새 일정 추가', exact: true });
  await expect(editor.getByLabel('반복', { exact: true })).toHaveValue('none');
  await expect(editor.getByLabel('일정 이름', { exact: true })).toHaveValue('집중 캠프');
  await editor.getByRole('checkbox').check();
  await editor.getByLabel('반복', { exact: true }).selectOption('custom');
  custom = page.getByRole('dialog', { name: '반복 설정', exact: true });
  await custom.getByLabel('반복 단위', { exact: true }).selectOption('day');
  await custom.getByRole('radio', { name: '날짜', exact: true }).check();
  await custom.getByLabel('종료 날짜', { exact: true }).fill('2026-10-04');
  await custom.getByRole('button', { name: '완료', exact: true }).click();
  await expect(custom.getByRole('alert')).toBeVisible();
  await custom.getByLabel('종료 날짜', { exact: true }).fill('2026-10-06');
  await custom.getByRole('button', { name: '완료', exact: true }).click();
  await editor.getByRole('button', { name: '일정 추가', exact: true }).click();
  await expect(page.locator('.available-stat .stat-value')).toContainText('120시간');
  await expect(page.locator('.cal-all-day-event')).toHaveCount(2);
  await page.reload();
  await expect(page.locator('.available-stat .stat-value')).toContainText('120시간');
});

test('custom month patterns and yearly units save and reopen without loss', async ({ page }) => {
  await openEmpty(page);
  const editor = await newEvent(page, '마지막 월요일 계획');
  await editor.getByLabel('반복', { exact: true }).selectOption('custom');
  let custom = page.getByRole('dialog', { name: '반복 설정', exact: true });
  await custom.getByLabel('반복 단위', { exact: true }).selectOption('month');
  await custom.getByLabel('월 반복 방식', { exact: true }).selectOption('lastWeekday');
  await custom.getByRole('button', { name: '완료', exact: true }).click();
  await expect(editor.locator('.event-custom-summary')).toContainText('마지막 월요일');
  await editor.getByRole('button', { name: '일정 추가', exact: true }).click();
  await page.getByRole('button', { name: '월간', exact: true }).click();
  await expect(page.getByRole('button', { name: /10월 26일.*마지막 월요일 계획.*일정 수정/ })).toBeVisible();
  await page.getByRole('button', { name: /10월 26일.*마지막 월요일 계획.*일정 수정/ }).click();
  await page.getByRole('dialog', { name: '일정 수정', exact: true }).getByRole('radio', { name: '전체 반복 일정', exact: true }).check();
  await page.getByRole('button', { name: '맞춤 설정 수정', exact: true }).click();
  custom = page.getByRole('dialog', { name: '반복 설정', exact: true });
  await expect(custom.getByLabel('월 반복 방식', { exact: true })).toHaveValue('lastWeekday');
  await custom.getByLabel('반복 단위', { exact: true }).selectOption('year');
  await custom.getByLabel('반복 간격', { exact: true }).fill('2');
  await custom.getByRole('button', { name: '완료', exact: true }).click();
  await page.getByRole('button', { name: '변경사항 저장' }).click();
  await page.reload();
  await page.locator('.cal-event').first().click();
  await page.getByRole('dialog', { name: '일정 수정', exact: true }).getByRole('radio', { name: '전체 반복 일정', exact: true }).check();
  await page.getByRole('button', { name: '맞춤 설정 수정', exact: true }).click();
  await expect(custom.getByLabel('반복 단위', { exact: true })).toHaveValue('year');
  await expect(custom.getByLabel('반복 간격', { exact: true })).toHaveValue('2');
});
