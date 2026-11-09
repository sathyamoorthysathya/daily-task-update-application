import { expect, test } from '@playwright/test';
import { PASSWORD, signUp, uniqueEmail } from './support/app.ts';

test.describe('authentication', () => {
  test('protected pages send anonymous visitors to sign in, then back', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('a new user registers, creates the first workbook and lands on the dashboard', async ({
    page,
  }) => {
    await page.goto('/register');
    await page.getByLabel('Name').fill('Rita Register');
    await page.getByLabel('Email').fill(uniqueEmail('register'));
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirm password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();

    // First-time workflow: create the Excel sheet before anything else.
    await expect(page.getByRole('heading', { name: 'Create your Excel sheet' })).toBeVisible();
    await page.getByLabel('Workbook name').fill('Daily Tasks');
    await page.getByRole('button', { name: 'Create Excel sheet' }).click();
    await expect(page.getByText(/is ready/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('validates the registration form in the browser', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Password', { exact: true }).fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Password must be at least 8 characters')).toBeVisible();
    await expect(page).toHaveURL(/\/register/);
  });

  test('signs in, rejects a wrong password generically, and signs out', async ({
    page,
    browser,
  }) => {
    const user = await signUp(page, 'signin');
    const fresh = await browser.newPage();

    await fresh.goto('/login');
    await fresh.getByLabel('Email').fill(user.email);
    await fresh.getByLabel('Password').fill('Wrong-password-9');
    await fresh.getByRole('button', { name: 'Sign in' }).click();
    await expect(fresh.getByRole('alert')).toContainText('Invalid email or password');

    await fresh.getByLabel('Password').fill(PASSWORD);
    await fresh.getByRole('button', { name: 'Sign in' }).click();
    await expect(fresh).not.toHaveURL(/\/login/);

    await fresh.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(fresh.getByText('You have been signed out.')).toBeVisible();
    // The session is gone on the server too: protected pages need a new sign-in.
    await fresh.goto('/tasks');
    await expect(fresh.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await fresh.close();
  });

  test('session cookies are not readable by scripts', async ({ page }) => {
    await signUp(page, 'cookies');
    await page.goto('/dashboard');
    const visible = await page.evaluate(() => document.cookie);
    expect(visible).not.toContain('access_token');
    expect(visible).not.toContain('refresh_token');

    const cookies = await page.context().cookies();
    for (const name of ['access_token', 'refresh_token']) {
      const cookie = cookies.find((c) => c.name === name);
      expect(cookie?.httpOnly, name).toBe(true);
      expect(cookie?.sameSite, name).not.toBe('None');
    }
  });
});
