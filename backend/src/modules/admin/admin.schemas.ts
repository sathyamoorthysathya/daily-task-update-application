import { z } from 'zod';
import { ADMIN_PASSWORD_MAX_LENGTH, adminNewPasswordSchema } from './admin-policy.js';

/** Empty query parameters (e.g. "?search=") mean "not filtered". */
const optionalParam = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const passwordInput = (label: string) =>
  z
    .string({ error: `${label} is required` })
    .min(1, `${label} is required`)
    .max(ADMIN_PASSWORD_MAX_LENGTH, `${label} is incorrect`);

const codeSchema = z
  .string({ error: 'Enter the 6-digit code from your authenticator app' })
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app');

export const adminLoginSchema = z.object({
  // No format rules on sign-in: only presence and length (the same answer for any wrong name).
  username: z
    .string({ error: 'Username is required' })
    .trim()
    .toLowerCase()
    .min(1, 'Username is required')
    .max(64, 'Invalid username or password'),
  password: passwordInput('Password'),
  /** Required (second step) when the administrator has two-step verification turned on. */
  code: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    codeSchema.optional(),
  ),
});

export const adminChangePasswordSchema = z.object({
  currentPassword: passwordInput('Current password'),
  newPassword: adminNewPasswordSchema,
});

export const twoFactorSetupSchema = z.object({ password: passwordInput('Password') });
export const twoFactorEnableSchema = z.object({ code: codeSchema });
export const twoFactorDisableSchema = z.object({
  password: passwordInput('Password'),
  code: codeSchema,
});

/** IANA time zone of the administrator's browser: days and hours are counted in it. */
const timeZoneSchema = z
  .string()
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown time zone');

const page = optionalParam(z.coerce.number().int().min(1).max(100_000)).transform((v) => v ?? 1);
const pageSize = optionalParam(z.coerce.number().int().min(5).max(100)).transform((v) => v ?? 20);

export const periodQuerySchema = z.object({
  days: optionalParam(z.coerce.number().int().min(1).max(365)).transform((v) => v ?? 30),
  tz: optionalParam(timeZoneSchema).transform((v) => v ?? 'UTC'),
});

export const USER_STATUS_FILTERS = ['all', 'active', 'disabled', 'unverified'] as const;
export const USER_SORTS = ['newest', 'oldest', 'name', 'last_seen'] as const;

export const listUsersQuerySchema = z.object({
  /** Name or email (contains, case-insensitive). */
  search: optionalParam(z.string().trim().max(200, 'Search must be at most 200 characters')),
  status: optionalParam(z.enum(USER_STATUS_FILTERS)).transform((v) => v ?? 'all'),
  sort: optionalParam(z.enum(USER_SORTS)).transform((v) => v ?? 'newest'),
  page,
  pageSize,
});

export const disableUserSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(500, 'Reason must be at most 500 characters')
    .optional()
    .transform((value) => (value ? value : null)),
});

export const listVisitsQuerySchema = z.object({
  days: optionalParam(z.coerce.number().int().min(1).max(365)).transform((v) => v ?? 30),
  /** Exact page route, e.g. "/tasks/:id". */
  path: optionalParam(z.string().trim().max(200)),
  userId: optionalParam(z.uuid('Invalid user ID')),
  /** Signed-in visits only / signed-out visits only. */
  audience: optionalParam(z.enum(['all', 'signed_in', 'signed_out'])).transform((v) => v ?? 'all'),
  page,
  pageSize,
});

/** Groups of audit events shown on the Security page. */
export const SECURITY_CATEGORIES = ['all', 'sign_in', 'account', 'admin', 'access'] as const;

export const listSecurityEventsQuerySchema = z.object({
  days: optionalParam(z.coerce.number().int().min(1).max(365)).transform((v) => v ?? 30),
  category: optionalParam(z.enum(SECURITY_CATEGORIES)).transform((v) => v ?? 'all'),
  outcome: optionalParam(z.enum(['SUCCESS', 'FAILURE'])),
  /** Email, IP address or event name (contains). */
  search: optionalParam(z.string().trim().max(200, 'Search must be at most 200 characters')),
  page,
  pageSize,
});

export type AdminLoginInput = z.infer<typeof adminLoginSchema>;
export type AdminChangePasswordInput = z.infer<typeof adminChangePasswordSchema>;
export type PeriodQuery = z.infer<typeof periodQuerySchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type ListVisitsQuery = z.infer<typeof listVisitsQuerySchema>;
export type ListSecurityEventsQuery = z.infer<typeof listSecurityEventsQuerySchema>;
