import { expect, test } from '@playwright/test';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { EXTERNAL_URL, STORAGE_DIR } from '../settings.ts';
import {
  api,
  createTask,
  createWorkbook,
  downloadRows,
  signUp,
  waitForSync,
} from './support/app.ts';

test.skip(Boolean(EXTERNAL_URL), 'needs access to the workbook files of the API server');

test('an Excel write failure never loses a task; the workbook recovers with a resync', async ({
  page,
}) => {
  const user = await signUp(page, 'sync-failure');
  const workbookId = await createWorkbook(page, 'Main');
  await createTask(page, { name: 'Before the failure' });
  await waitForSync(page, workbookId);

  // Make the file unwritable for the API: a directory where the .xlsx file must go.
  const file = path.join(STORAGE_DIR, user.id, `${workbookId}.xlsx`);
  await rm(file, { force: true });
  await mkdir(file);
  try {
    const started = Date.now();
    await createTask(page, { name: 'During the failure' });
    expect(Date.now() - started).toBeLessThan(3000); // the API does not wait for Excel

    await page.goto('/workbooks');
    const card = page.getByRole('listitem', { name: 'Main' });
    await expect(card.getByText('Excel update retrying')).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText('Your tasks are saved');
    // Users see a safe description, never server paths.
    await expect(card).not.toContainText(STORAGE_DIR);
    await expect(card).not.toContainText('.xlsx');
  } finally {
    await rm(file, { recursive: true, force: true });
  }

  // The task saved during the failure is in the task list.
  const list = (await (await api(page).get('/api/tasks')).json()) as { items: { name: string }[] };
  expect(list.items.map((t) => t.name)).toContain('During the failure');

  await page.goto('/workbooks');
  const card = page.getByRole('listitem', { name: 'Main' });
  await card.getByRole('button', { name: 'Resync now' }).click();
  await expect(card.getByText(/Excel update|Updating Excel/)).toHaveCount(0, { timeout: 20_000 });

  await waitForSync(page, workbookId);
  const { rows } = await downloadRows(page, 'Main');
  expect(rows.map((r) => r.name).sort()).toEqual(['Before the failure', 'During the failure']);
  expect(new Set(rows.map((r) => r.updateId)).size).toBe(rows.length);
});
