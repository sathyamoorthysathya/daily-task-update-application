import { expect, test } from '@playwright/test';
import { createTask, createWorkbook, signUp } from './support/app.ts';

test.describe('security in the browser', () => {
  test('user-provided text is rendered as text, never executed (stored XSS)', async ({ page }) => {
    const payload = '<img src=x onerror="window.__xss=1">"><script>window.__xss=2</script>';
    let dialogs = 0;
    page.on('dialog', (dialog) => {
      dialogs += 1;
      void dialog.dismiss();
    });

    await signUp(page, 'xss', payload);
    // Workbook names become file names: the API rejects < > " (tested in the API suites).
    await createWorkbook(page, 'XSS check');
    const created = await createTask(page, { name: payload, description: payload });

    for (const url of ['/dashboard', '/tasks', `/tasks/${created.task.id}`, '/workbooks']) {
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      expect(await page.evaluate(() => (window as { __xss?: number }).__xss), url).toBeUndefined();
    }
    await page.goto(`/tasks/${created.task.id}`);
    await expect(page.getByRole('heading', { name: payload })).toBeVisible();
    expect(await page.locator('img[src="x"]').count()).toBe(0);
    expect(dialogs).toBe(0);
  });

  test('a link reference is only clickable for http(s) URLs and opens safely', async ({ page }) => {
    await signUp(page, 'links');
    await createWorkbook(page, 'Main');
    const created = await createTask(page, {
      name: 'Linked task',
      reference: 'https://docs.example.com/spec',
    });
    await page.goto(`/tasks/${created.task.id}`);
    const link = page.getByRole('link', { name: 'https://docs.example.com/spec' }).first();
    await expect(link).toHaveAttribute('href', 'https://docs.example.com/spec');
    await expect(link).toHaveAttribute('rel', /noopener/);
    await expect(link).toHaveAttribute('target', '_blank');
  });

  test('API responses carry security headers and a request ID', async ({ page }) => {
    await signUp(page, 'headers');
    const res = await page.request.get('/api/auth/me');
    expect(res.status()).toBe(200);
    const headers = res.headers();
    expect(headers['content-security-policy']).toContain("default-src 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['strict-transport-security']).toContain('max-age=');
    expect(headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers['x-powered-by']).toBeUndefined();
  });

  test('state-changing requests without the CSRF token are refused', async ({ page }) => {
    await signUp(page, 'csrf');
    const res = await page.request.post('/api/workbooks', { data: { name: 'Forged' } });
    expect(res.status()).toBe(403);
  });
});
