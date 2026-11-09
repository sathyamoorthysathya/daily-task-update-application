import { expect, test } from '@playwright/test';
import { api, createTask, createWorkbook, signUp } from './support/app.ts';

test('users never see or change each other’s tasks and workbooks', async ({ browser }) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();

  await signUp(alice, 'alice', 'Alice');
  const aliceWorkbook = await createWorkbook(alice, 'Alice Tasks');
  const aliceTask = await createTask(alice, { name: 'Confidential audit' });
  await signUp(bob, 'bob', 'Bob');
  await createWorkbook(bob, 'Bob Tasks');

  // In the UI: Bob's list is empty and Alice's task URL is "not found".
  await bob.goto('/tasks');
  await expect(bob.locator('table tbody tr')).toHaveCount(0);
  await expect(bob.getByText('Confidential audit')).toHaveCount(0);
  await bob.goto(`/tasks/${aliceTask.task.id}`);
  await expect(bob.getByRole('heading', { name: 'Task not found' })).toBeVisible();

  // Through the API with Bob's session: reads and writes are refused as "not found".
  const bobApi = api(bob);
  expect((await bobApi.get(`/api/tasks/${aliceTask.task.id}`)).status()).toBe(404);
  expect((await bobApi.get(`/api/workbooks/${aliceWorkbook}/download`)).status()).toBe(404);
  expect((await bobApi.get(`/api/workbooks/${aliceWorkbook}/sync-status`)).status()).toBe(404);
  expect(
    (
      await bobApi.patch(`/api/tasks/${aliceTask.task.id}`, {
        name: 'Hacked',
        version: aliceTask.task.version,
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await bobApi.delete(`/api/tasks/${aliceTask.task.id}?version=${aliceTask.task.version}`)
    ).status(),
  ).toBe(404);
  expect(
    (
      await bobApi.post('/api/tasks', {
        name: 'Intrusion',
        entryDate: '2026-11-05',
        description: 'x',
        status: 'TO_DO',
        workbookId: aliceWorkbook,
      })
    ).status(),
  ).toBe(404);

  // Alice's task is untouched.
  await alice.goto(`/tasks/${aliceTask.task.id}`);
  await expect(alice.getByRole('heading', { name: /Confidential audit/ })).toBeVisible();

  await aliceContext.close();
  await bobContext.close();
});
