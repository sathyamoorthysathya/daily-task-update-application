import { expect, test } from '@playwright/test';
import { createTask, createWorkbook, downloadRows, signUp, waitForSync } from './support/app.ts';

test.describe('daily tasks and Excel', () => {
  test('creating a task saves it and updates the Excel workbook in the background', async ({
    page,
  }) => {
    await signUp(page, 'create');
    const workbookId = await createWorkbook(page, 'Daily Tasks');

    await page.goto('/tasks/new');
    await page.getByLabel('Task Name').fill('Prepare GST report');
    await page.getByLabel('Task Date').fill('2026-11-05');
    await page.getByLabel('Task Description').fill('Collected invoices for October.');
    await page.getByLabel('Documentation Link / Reference').fill('https://docs.example.com/gst');
    await page.getByLabel('Task Status').selectOption({ label: 'In Progress' });
    await page.getByRole('button', { name: 'Save task' }).click();

    const notice = page.getByText(/Task #1 “Prepare GST report” was added to Daily Tasks/);
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('The Excel workbook is up to date.', { timeout: 15_000 });

    await waitForSync(page, workbookId);
    const { rows, sheet } = await downloadRows(page, 'Daily Tasks');
    expect(rows).toEqual([
      expect.objectContaining({
        number: 1,
        date: '2026-11-05',
        name: 'Prepare GST report',
        description: 'Collected invoices for October.',
        status: 'In Progress',
      }),
    ]);
    // Internal row references live in hidden columns G and H.
    expect(sheet.getColumn(7).hidden && sheet.getColumn(8).hidden).toBe(true);
    expect(rows[0]!.updateId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('a duplicate task name opens the dialog; both choices keep one row per entry', async ({
    page,
  }) => {
    await signUp(page, 'duplicate');
    const workbookId = await createWorkbook(page, 'Daily Tasks');
    await createTask(page, { name: 'Prepare GST report', entryDate: '2026-11-05' });

    // Same task on a new day: "Create New Daily Task Entry".
    await page.goto('/tasks/new');
    await page.getByLabel('Task Name').fill('  prepare gst REPORT ');
    await page.getByLabel('Task Date').fill('2026-11-06');
    await page.getByLabel('Task Description').fill('Filed the return.');
    await page.getByRole('button', { name: 'Save task' }).click();
    const dialog = page.getByRole('dialog', {
      name: 'This task already exists. What would you like to do?',
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /Create New Daily Task Entry/ }).click();
    await expect(page.getByText(/Task #1: a new entry for .* was added/)).toBeVisible();

    // Same task and day again: "Update Existing Task" edits that entry.
    await page.getByLabel('Task Name').fill('Prepare GST report');
    await page.getByLabel('Task Date').fill('2026-11-06');
    await page.getByLabel('Task Description').fill('Filed and paid.');
    await page.getByLabel('Task Status').selectOption({ label: 'Completed' });
    await page.getByRole('button', { name: 'Save task' }).click();
    await dialog.getByRole('button', { name: /Update Existing Task/ }).click();
    await expect(page.getByText(/Task #1: the entry from .* was updated/)).toBeVisible();

    // Cancel leaves everything as it is.
    await page.getByLabel('Task Name').fill('Prepare GST report');
    await page.getByLabel('Task Description').fill('Should not be saved');
    await page.getByRole('button', { name: 'Save task' }).click();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();

    await waitForSync(page, workbookId);
    const { rows } = await downloadRows(page, 'Daily Tasks');
    expect(rows.map((r) => [r.number, r.date, r.description, r.status])).toEqual([
      [1, '2026-11-05', 'Prepare GST report work', 'In Progress'],
      [1, '2026-11-06', 'Filed and paid.', 'Completed'],
    ]);
    expect(new Set(rows.map((r) => r.updateId)).size).toBe(2);
  });

  test('simultaneous submissions from two tabs are all saved and appear once each', async ({
    page,
    context,
  }) => {
    await signUp(page, 'tabs');
    const workbookId = await createWorkbook(page, 'Daily Tasks');
    const second = await context.newPage();

    const fill = async (tab: typeof page, name: string) => {
      await tab.goto('/tasks/new');
      await tab.getByLabel('Task Name').fill(name);
      await tab.getByLabel('Task Description').fill(`${name} description`);
    };
    await fill(page, 'From tab A');
    await fill(second, 'From tab B');
    await Promise.all([
      page.getByRole('button', { name: 'Save task' }).click(),
      second.getByRole('button', { name: 'Save task' }).click(),
    ]);
    await expect(page.getByText(/“From tab A” was added/)).toBeVisible();
    await expect(second.getByText(/“From tab B” was added/)).toBeVisible();

    await waitForSync(page, workbookId);
    const { rows } = await downloadRows(page, 'Daily Tasks');
    expect(rows.map((r) => r.number).sort()).toEqual([1, 2]);
    expect(rows.map((r) => r.name).sort()).toEqual(['From tab A', 'From tab B']);
  });

  test('form validation blocks unsafe links and missing fields', async ({ page }) => {
    await signUp(page, 'validation');
    await createWorkbook(page, 'Daily Tasks');
    await page.goto('/tasks/new');
    await page.getByLabel('Documentation Link / Reference').fill('javascript:alert(1)');
    await page.getByRole('button', { name: 'Save task' }).click();

    await expect(page.getByText('Task name is required')).toBeVisible();
    await expect(page.getByText('Description is required')).toBeVisible();
    await expect(page.getByText('Links must start with http:// or https://')).toBeVisible();
  });
});
