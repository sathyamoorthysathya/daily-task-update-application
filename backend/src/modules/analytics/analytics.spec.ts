import { describeUserAgent } from '../../common/http/user-agent.js';
import { adminPasswordProblem, adminUsernameSchema } from '../admin/admin-policy.js';
import { normalizePagePath } from './page-path.js';

describe('normalizePagePath', () => {
  it('keeps app routes and replaces IDs', () => {
    expect(normalizePagePath('/dashboard')).toBe('/dashboard');
    expect(normalizePagePath('/tasks/0190a000-0000-7000-8000-000000000001')).toBe('/tasks/:id');
    expect(normalizePagePath('/tasks/42/')).toBe('/tasks/:id');
    expect(normalizePagePath('/')).toBe('/');
    expect(normalizePagePath('/Workbooks/New')).toBe('/workbooks/new');
  });

  it('drops query strings and fragments (search terms, reset tokens)', () => {
    expect(normalizePagePath('/tasks?search=salary')).toBe('/tasks');
    expect(normalizePagePath('/reset-password?token=abc#x')).toBe('/reset-password');
  });

  it('refuses admin pages and anything that is not a plain path', () => {
    expect(normalizePagePath('/admin')).toBeNull();
    expect(normalizePagePath('/admin/users')).toBeNull();
    expect(normalizePagePath('https://evil.example/x')).toBeNull();
    expect(normalizePagePath('dashboard')).toBeNull();
    expect(normalizePagePath('/tasks/<script>')).toBeNull();
    expect(normalizePagePath(`/${'a'.repeat(250)}`)).toBeNull();
  });
});

describe('describeUserAgent', () => {
  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
      { deviceType: 'desktop', browser: 'Edge', os: 'Windows', bot: false },
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      { deviceType: 'mobile', browser: 'Safari', os: 'iOS', bot: false },
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
      { deviceType: 'mobile', browser: 'Chrome', os: 'Android', bot: false },
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      { deviceType: 'tablet', browser: 'Chrome', os: 'Android', bot: false },
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0',
      { deviceType: 'desktop', browser: 'Firefox', os: 'macOS', bot: false },
    ],
    [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      { deviceType: 'desktop', browser: 'Other', os: 'Other', bot: true },
    ],
  ])('describes %s', (ua, expected) => {
    expect(describeUserAgent(ua)).toEqual(expected);
  });

  it('treats a missing header as a bot', () => {
    expect(describeUserAgent(undefined).bot).toBe(true);
  });
});

describe('administrator policy', () => {
  it('normalises and validates usernames', () => {
    expect(adminUsernameSchema.parse('  Alice.Admin ')).toBe('alice.admin');
    expect(adminUsernameSchema.safeParse('ab').success).toBe(false);
    expect(adminUsernameSchema.safeParse('-alice').success).toBe(false);
    expect(adminUsernameSchema.safeParse('alice admin').success).toBe(false);
    expect(adminUsernameSchema.safeParse('a'.repeat(33)).success).toBe(false);
  });

  it('requires strong passwords', () => {
    expect(adminPasswordProblem('Str0ng-Admin-Pass')).toBeNull();
    expect(adminPasswordProblem('Short-1a')).toMatch(/at least 12/);
    expect(adminPasswordProblem('alllowercase-123')).toMatch(/upper-case/);
    expect(adminPasswordProblem('NoNumbersHere-!')).toMatch(/number/);
    expect(adminPasswordProblem('NoSymbols12345')).toMatch(/symbol/);
    expect(adminPasswordProblem('Alice-Admin-2026', 'alice')).toMatch(/username/);
    expect(adminPasswordProblem('My-Password-2026')).toMatch(/easy to guess/);
  });
});
