import { type APIRequestContext, type BrowserContext, expect, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { EMAIL_DOMAIN } from '../../settings.ts';

export const PASSWORD = 'Playwright-pass-1';

let counter = 0;
export function uniqueEmail(label: string): string {
  counter += 1;
  return `${label}.${Date.now()}.${process.pid}.${counter}@${EMAIL_DOMAIN}`;
}

export interface TestUser {
  email: string;
  name: string;
  id: string;
}

/** The CSRF token (double-submit cookie) of a browser context, as the SPA sends it. */
async function csrfToken(context: BrowserContext): Promise<string> {
  const cookie = (await context.cookies()).find((c) => c.name === 'csrf_token');
  return cookie ? decodeURIComponent(cookie.value) : '';
}

/**
 * JSON API calls in the page's browser context: same cookies and CSRF handling as the web
 * client. Used for fast test setup; the behaviour under test goes through the UI.
 */
export function api(page: Page) {
  const request: APIRequestContext = page.request;
  const send = async (method: string, url: string, data?: unknown) => {
    if (!(await csrfToken(page.context()))) {
      await request.get('/api/auth/csrf');
    }
    return request.fetch(url, {
      method,
      data,
      headers: { 'X-CSRF-Token': await csrfToken(page.context()) },
    });
  };
  return {
    get: (url: string) => request.get(url),
    post: (url: string, data?: unknown) => send('POST', url, data),
    patch: (url: string, data?: unknown) => send('PATCH', url, data),
    delete: (url: string) => send('DELETE', url),
  };
}

/** Registers through the API (fast) and returns the signed-in user. */
export async function signUp(
  page: Page,
  label: string,
  name = 'Pat Playwright',
): Promise<TestUser> {
  const email = uniqueEmail(label);
  const res = await api(page).post('/api/auth/register', { name, email, password: PASSWORD });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { user: { id: string } };
  return { email, name, id: body.user.id };
}

/** Creates a workbook through the API and returns its ID. */
export async function createWorkbook(page: Page, name: string, makeDefault = false) {
  const res = await api(page).post('/api/workbooks', { name, makeDefault });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

export interface NewTask {
  name: string;
  entryDate?: string;
  description?: string;
  reference?: string;
  status?: string;
  workbookId?: string;
}

/** Creates a task through the API. */
export async function createTask(page: Page, task: NewTask) {
  const res = await api(page).post('/api/tasks', {
    entryDate: '2026-11-05',
    description: `${task.name} work`,
    status: 'IN_PROGRESS',
    ...task,
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as {
    task: { id: string; taskNumber: number; version: number };
    update: { id: string };
  };
}

/** Waits until the background Excel synchronisation of a workbook has caught up. */
export async function waitForSync(page: Page, workbookId: string) {
  await expect
    .poll(
      async () =>
        (
          (await (await api(page).get(`/api/workbooks/${workbookId}/sync-status`)).json()) as {
            state: string;
          }
        ).state,
      { timeout: 15_000 },
    )
    .toBe('synced');
}

export interface ExcelRow {
  number: number;
  date: string;
  name: string;
  description: string;
  status: string;
  taskId: string;
  updateId: string;
}

/** Downloads a workbook with the Download button and reads its rows (incl. hidden IDs). */
export async function downloadRows(page: Page, workbookName: string) {
  await page.goto('/workbooks');
  const download = page.waitForEvent('download');
  await page
    .getByRole('listitem', { name: workbookName })
    .getByRole('button', { name: 'Download' })
    .click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`${workbookName}.xlsx`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile((await file.path())!);
  const sheet = workbook.getWorksheet('Daily Tasks')!;
  const rows: ExcelRow[] = [];
  sheet.eachRow((row, index) => {
    if (index > 1) {
      const date = row.getCell(2).value;
      rows.push({
        number: Number(row.getCell(1).value),
        date: date instanceof Date ? date.toISOString().slice(0, 10) : row.getCell(2).text,
        name: row.getCell(3).text,
        description: row.getCell(4).text,
        status: row.getCell(6).text,
        taskId: row.getCell(7).text,
        updateId: row.getCell(8).text,
      });
    }
  });
  return { rows, sheet };
}
