import { expect, test } from '@playwright/test';
import { api, createTask, createWorkbook, signUp } from './support/app.ts';

/** The browser's local date, which the dashboard uses as "today". */
function localDate(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() - offsetDays);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

test('the dashboard shows overall figures, activity and recent task updates', async ({ page }) => {
  await signUp(page, 'dashboard', 'Dana Dashboard');
  await createWorkbook(page, 'Main');
  const first = await createTask(page, {
    name: 'Prepare GST report',
    entryDate: localDate(1),
    status: 'IN_PROGRESS',
  });
  await api(page).post(`/api/tasks/${first.task.id}/updates`, {
    entryDate: localDate(0),
    description: 'Filed the return',
    status: 'COMPLETED',
  });
  await createTask(page, { name: 'Vendor payments', entryDate: localDate(0), status: 'PENDING' });

  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: 'Welcome, Dana Dashboard!' })).toBeVisible();
  await expect(
    page.getByText(/You have logged 2 entries today and 3 entries in the last 7 days/),
  ).toBeVisible();
  await expect(page.getByRole('article', { name: 'Total tasks' })).toContainText('2');
  await expect(page.getByRole('article', { name: 'Completed' })).toContainText('50% of all tasks');
  await expect(
    page.getByRole('img', { name: 'Entries per day: 3 in the last 14 days' }),
  ).toBeVisible();
  await expect(
    page.getByRole('progressbar', { name: 'Main: 50% of tasks completed' }),
  ).toBeVisible();

  // Recent updates link to the task.
  await page.getByRole('link', { name: /#2 Vendor payments/ }).click();
  await expect(page.getByRole('heading', { name: /Vendor payments/ })).toBeVisible();

  // Searching from the top bar opens the filtered task list.
  await page.getByRole('searchbox', { name: 'Find tasks' }).fill('gst');
  await page.getByRole('searchbox', { name: 'Find tasks' }).press('Enter');
  await expect(page).toHaveURL(/\/tasks\?search=gst/);
  await expect(page.locator('table tbody tr')).toHaveCount(1);
});

test('the navigation drawer works on a phone-sized screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signUp(page, 'mobile-nav');
  await createWorkbook(page, 'Main');
  await page.goto('/dashboard');

  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav).not.toBeInViewport();
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(nav).toBeInViewport();
  await nav.getByRole('link', { name: 'Workbooks' }).click();
  await expect(page).toHaveURL(/\/workbooks$/);
  await expect(nav).not.toBeInViewport();
  // No horizontal scrolling at phone width.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
