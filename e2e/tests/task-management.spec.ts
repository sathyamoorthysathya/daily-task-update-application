import { expect, test } from '@playwright/test';
import { createTask, createWorkbook, downloadRows, signUp, waitForSync } from './support/app.ts';

test.describe('task management page', () => {
  test('searches, filters, edits and deletes tasks; Excel follows every change', async ({
    page,
  }) => {
    await signUp(page, 'manage');
    const workbookId = await createWorkbook(page, 'Main');
    for (let i = 1; i <= 4; i += 1) {
      await createTask(page, {
        name: `Report 0${i}`,
        entryDate: `2026-11-0${i}`,
        status: i % 2 === 0 ? 'COMPLETED' : 'IN_PROGRESS',
      });
    }

    await page.goto('/tasks');
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(4);

    // Search by name, then by exact number.
    await page.getByLabel('Search').fill('report 03');
    await expect(rows).toHaveCount(1);
    await page.getByLabel('Search').fill('#4');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Report 04');
    await page.getByLabel('Search').fill('');

    // Filter by status.
    await page.getByLabel('Status').selectOption({ label: 'Completed' });
    await expect(rows).toHaveCount(2);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(rows).toHaveCount(4);

    // Edit task #3 from its detail page.
    await page.getByRole('link', { name: 'Report 03' }).click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByLabel('Task Name').fill('Report 03 (final)');
    await page.getByLabel('Task Description').fill('Final version sent.');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText(/Task #3 was updated/)).toBeVisible();
    await expect(page.getByRole('heading', { name: /Report 03 \(final\)/ })).toBeVisible();

    // Delete task #4 (after confirmation).
    await page.goto('/tasks');
    await page.getByRole('link', { name: 'Report 04' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page
      .getByRole('dialog', { name: 'Delete task #4?' })
      .getByRole('button', { name: 'Delete task' })
      .click();
    await expect(page.getByText(/Task #4 “Report 04” was deleted/)).toBeVisible();
    await expect(rows).toHaveCount(3);

    await waitForSync(page, workbookId);
    const excel = await downloadRows(page, 'Main');
    expect(excel.rows.map((r) => [r.number, r.name])).toEqual([
      [1, 'Report 01'],
      [2, 'Report 02'],
      [3, 'Report 03 (final)'],
    ]);
  });

  test('shows the empty state for a new user', async ({ page }) => {
    await signUp(page, 'empty');
    await createWorkbook(page, 'Main');
    await page.goto('/tasks');
    await expect(page.getByRole('link', { name: 'New task' }).first()).toBeVisible();
    await expect(page.locator('table tbody tr')).toHaveCount(0);
  });
});
