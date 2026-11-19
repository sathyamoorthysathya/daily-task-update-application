import { expect, test } from '@playwright/test';
import { ADMIN_PASSWORD, ADMIN_USERNAME, EXTERNAL_URL } from '../settings.ts';
import { api, createWorkbook, PASSWORD, signUp } from './support/app.ts';

// The test administrator exists only on the API started by Playwright.
test.skip(Boolean(EXTERNAL_URL), 'needs the test administrator (ADMIN_USERNAME)');

test('an administrator sees users and the pages they visit, and can disable an account', async ({
  page,
  browser,
}) => {
  // A user opens a few pages.
  const user = await signUp(page, 'admin-view', 'Vera Visitor');
  await createWorkbook(page, 'Main');
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Welcome, Vera Visitor!' })).toBeVisible();
  await page.goto('/report');
  await expect(page.getByRole('heading', { name: 'Work report' })).toBeVisible();

  // The admin panel has its own sign-in, in its own browser context.
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await admin.goto('/admin/users');
  await expect(admin.getByRole('heading', { name: 'Admin sign-in' })).toBeVisible();
  await admin.getByLabel('Username').fill(ADMIN_USERNAME);
  await admin.getByLabel('Password').fill(ADMIN_PASSWORD);
  await admin.getByRole('button', { name: 'Sign in' }).click();

  // Back to the page asked for.
  await expect(admin.getByRole('heading', { name: 'Users' })).toBeVisible();
  await admin.getByRole('searchbox', { name: 'Search users' }).fill(user.email);
  await expect(admin).toHaveURL(/search=/);
  await admin.getByRole('link', { name: /Vera Visitor/ }).click();

  await expect(admin.getByRole('heading', { name: 'Vera Visitor' })).toBeVisible();
  const visits = admin.getByRole('region', { name: 'Recent page visits' });
  await expect(visits.getByText('Work report', { exact: true })).toBeVisible();
  await expect(visits.getByText('Dashboard', { exact: true })).toBeVisible();

  // Disabling signs the user out and blocks sign-in.
  await admin.getByRole('button', { name: 'Disable account' }).click();
  const dialog = admin.getByRole('dialog', { name: 'Disable Vera Visitor?' });
  await dialog.getByLabel(/Reason/).fill('Playwright check');
  await dialog.getByRole('button', { name: 'Disable account' }).click();
  await expect(admin.getByText(/was disabled and signed out/)).toBeVisible();

  expect((await api(page).get('/api/v1/auth/me')).status()).toBe(401);
  const login = await api(page).post('/api/v1/auth/login', {
    email: user.email,
    password: PASSWORD,
  });
  expect(login.status()).toBe(403);

  // The overview and the security page load.
  const nav = admin.getByRole('navigation', { name: 'Admin' });
  await nav.getByRole('link', { name: 'Overview' }).click();
  await expect(admin.getByRole('region', { name: 'Key figures' })).toBeVisible();
  await nav.getByRole('link', { name: 'Security' }).click();
  await expect(admin.getByRole('heading', { name: 'Audit log' })).toBeVisible();
  await expect(admin.getByText('User disabled by an admin').first()).toBeVisible();

  // The application user's pages do not accept the admin session.
  await admin.goto('/dashboard');
  await expect(admin.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await adminContext.close();
});
