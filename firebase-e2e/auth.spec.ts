import { expect, test, type Page } from '@playwright/test';
import { createEmptyState } from '../src/lib/planner';
import { addSubject } from '../src/lib/subjects';

async function skipOptionalEmulatorAssets(page: Page) {
  // These files only decorate the emulator's account picker. Keep the real
  // Firebase popup, auth exchange and Firestore requests, without a CDN dependency.
  await page.context().route('https://unpkg.com/**', route => route.fulfill({ contentType: route.request().resourceType() === 'stylesheet' ? 'text/css' : 'application/javascript', body: '' }));
}

const guest = {
  ...addSubject(createEmptyState(), '코딩'),
  events: [{ id: 'local-class', title: '나의 수학 수업', type: 'school', date: '2026-10-05', startTime: '09:00', endTime: '11:00', allDay: false, recurrence: 'weekly', weekdays: [1, 3] }],
  goals: [
    { id: 'local-goal', weekStart: '2026-10-05', subject: '수학', material: '개념서', range: '2단원', completed: false },
    { id: 'coding-goal', weekStart: '2026-10-05', subject: '코딩', material: '프로그래밍 노트', range: '첫 프로그램', completed: false },
  ],
};

async function open(page: Page, seed = true) {
  await skipOptionalEmulatorAssets(page);
  await page.clock.setFixedTime(new Date('2026-10-05T10:00:00+09:00'));
  if (seed) await page.addInitScript(data => {
    if (!localStorage.getItem('chagok-planner-v1')) localStorage.setItem('chagok-planner-v1', JSON.stringify(data));
  }, guest);
  await page.goto('/');
  await expect(page.locator('.planner-content')).toHaveAttribute('aria-busy', 'false');
}

async function login(page: Page, email: string) {
  await page.getByRole('button', { name: 'Google 로그인', exact: true }).click();
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Google로 계속하기', exact: true }).click();
  const popup = await popupPromise;
  await expect(popup.locator('#add-account-button')).toBeVisible();
  await popup.waitForLoadState('domcontentloaded');
  const existing = popup.getByText(email, { exact: true });
  if (await existing.count()) await existing.click();
  else {
    await popup.locator('#add-account-button').click();
    await popup.locator('#email-input').fill(email);
    await popup.locator('#display-name-input').fill(email.startsWith('rocky-a') ? '로키 학생' : '다른 학생');
    await popup.locator('#sign-in').click();
  }
  await expect(page.getByRole('button', { name: '내 계정', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.planner-content')).toHaveAttribute('aria-busy', 'false');
}

async function logout(page: Page) {
  await page.getByRole('button', { name: '내 계정', exact: true }).click();
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Google 로그인', exact: true })).toBeVisible();
  await expect(page.locator('.planner-content')).toHaveAttribute('aria-busy', 'false');
}

test('Google popup, guest import, logout, account isolation and a fresh browser restore the cloud planner', async ({ page, browser }) => {
  const suffix = Date.now();
  const email = `rocky-a-${suffix}@example.test`;
  await open(page);
  await expect(page.locator('.cal-event')).toHaveCount(2);
  await login(page, email);
  await expect(page.locator('.cal-event')).toHaveCount(0);
  await page.getByRole('button', { name: '브라우저 데이터 가져오기', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('계정에 저장됨');
  await expect(page.locator('.cal-event')).toHaveCount(2);
  await page.getByRole('region', { name: '내 캘린더', exact: true }).getByRole('checkbox', { name: '학교 수업', exact: true }).uncheck();
  await expect(page.locator('.cal-event')).toHaveCount(0);
  await expect(page.locator('.save-status')).toHaveText('계정에 저장됨');
  await page.getByRole('region', { name: '내 캘린더', exact: true }).getByRole('button', { name: '수학 옵션', exact: true }).click();
  const colorOptions = page.getByRole('dialog', { name: '수학 옵션', exact: true });
  await colorOptions.getByRole('button', { name: '빨강 색상 #D50000', exact: true }).click();
  await colorOptions.getByRole('button', { name: '옵션 닫기', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('계정에 저장됨');
  await page.getByRole('link', { name: '주간 학습 계획', exact: true }).click();
  await page.getByRole('checkbox', { name: /개념서/ }).check();
  await expect(page.locator('.save-status')).toHaveText('계정에 저장됨');
  await logout(page);
  await expect(page.getByRole('checkbox', { name: /개념서/ })).not.toBeChecked();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('chagok-planner-v1')!))).toEqual(guest);
  await login(page, `rocky-b-${suffix}@example.test`);
  await expect(page.getByRole('checkbox', { name: /개념서/ })).toHaveCount(0);
  await expect(page.locator('.available-stat .stat-value')).toContainText('168시간');
  await logout(page);
  await login(page, email);
  await expect(page.getByRole('checkbox', { name: /개념서/ })).toBeChecked();
  await page.reload();
  await expect(page.getByRole('button', { name: '내 계정', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /개념서/ })).toBeChecked();

  const freshContext = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport: { width: 390, height: 844 } });
  try {
    const fresh = await freshContext.newPage();
    await skipOptionalEmulatorAssets(fresh);
    await fresh.clock.setFixedTime(new Date('2026-10-05T10:00:00+09:00'));
    await fresh.goto('http://127.0.0.1:5174');
    await expect(fresh.locator('.planner-content')).toHaveAttribute('aria-busy', 'false');
    await login(fresh, email);
    await expect(fresh.locator('.cal-legend').getByRole('checkbox', { name: '학교 수업', exact: true })).not.toBeChecked();
    await expect(fresh.locator('.cal-legend').getByRole('checkbox', { name: '수학', exact: true })).toHaveCSS('accent-color', 'rgb(213, 0, 0)');
    await expect(fresh.locator('.cal-legend').getByRole('img', { name: '코딩: 이름과 삭제는 과목 관리에서 변경', exact: true })).toBeVisible();
    await expect(fresh.locator('.available-stat .stat-value')).toContainText('164시간');
    await fresh.getByRole('link', { name: '주간 학습 계획', exact: true }).click();
    await expect(fresh.getByRole('checkbox', { name: /개념서/ })).toBeChecked();
    await expect(fresh.getByRole('checkbox', { name: /코딩 프로그래밍 노트 첫 프로그램 완료/ })).not.toBeChecked();
    await expect(fresh.getByRole('region', { name: '과목별 계획한 학습 시간', exact: true }).getByText('코딩', { exact: true })).toBeVisible();
    await expect(fresh.locator('.planned-stat .stat-value')).toContainText('0분');
    await expect(fresh.locator('.remaining-stat .stat-value')).toContainText('164시간');
    expect(await fresh.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await fresh.getByRole('button', { name: '내 계정', exact: true }).click();
    await fresh.screenshot({ path: 'test-results-firebase/firebase-account-mobile.png', animations: 'disabled' });
  } finally { await freshContext.close(); }
});

test('cancelled Google login leaves the guest planner untouched', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Google 로그인', exact: true }).click();
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Google로 계속하기', exact: true }).click();
  const popup = await popupPromise;
  await expect(popup.locator('#add-account-button')).toBeVisible();
  await popup.waitForLoadState('domcontentloaded');
  await popup.close();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('취소', { timeout: 15_000 });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('chagok-planner-v1')!))).toEqual(guest);
});

test('logging out in another tab closes the previous account goal editor', async ({ page }) => {
  await open(page);
  await login(page, `rocky-a-tabs-${Date.now()}@example.test`);
  await page.getByRole('button', { name: '브라우저 데이터 가져오기', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('계정에 저장됨');
  await page.getByRole('link', { name: '주간 학습 계획', exact: true }).click();
  await page.getByRole('button', { name: '개념서 수정', exact: true }).click();
  await page.getByRole('dialog').getByLabel('학습 범위', { exact: false }).fill('이전 계정의 작성 중 내용');
  const otherTab = await page.context().newPage();
  await otherTab.goto('/');
  await expect(otherTab.getByRole('button', { name: '내 계정', exact: true })).toBeVisible();
  await expect(otherTab.locator('.planner-content')).toHaveAttribute('aria-busy', 'false');
  await logout(otherTab);
  await expect(page.getByRole('button', { name: 'Google 로그인', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /개념서/ })).not.toBeChecked();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('chagok-planner-v1')!))).toEqual(guest);
});
