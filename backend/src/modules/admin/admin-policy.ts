import { z } from 'zod';

export const ADMIN_PASSWORD_MIN_LENGTH = 12;
/** Upper bound protects the Argon2 hasher from oversized inputs. */
export const ADMIN_PASSWORD_MAX_LENGTH = 128;

/** Administrator usernames: unique, case-insensitive (stored lower-case). */
export const adminUsernameSchema = z
  .string({ error: 'Username is required' })
  .trim()
  .toLowerCase()
  .min(3, 'Username must be at least 3 characters')
  .max(32, 'Username must be at most 32 characters')
  .regex(
    /^[a-z0-9][a-z0-9._-]*$/,
    'Username may only contain letters, numbers, dots, dashes and underscores, and must start with a letter or number',
  );

/**
 * Policy for administrator passwords: stricter than for app users (the admin panel sees every
 * user's data). Returns the first problem, or null.
 */
export function adminPasswordProblem(password: string, username?: string): string | null {
  if (password.length < ADMIN_PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${ADMIN_PASSWORD_MIN_LENGTH} characters`;
  }
  if (password.length > ADMIN_PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${ADMIN_PASSWORD_MAX_LENGTH} characters`;
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) {
    return 'Password must contain upper-case and lower-case letters';
  }
  if (!/\d/.test(password)) {
    return 'Password must contain at least one number';
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return 'Password must contain at least one symbol (for example ! # - _)';
  }
  if (username && password.toLowerCase().includes(username.toLowerCase())) {
    return 'Password must not contain the username';
  }
  if (/change[-_ ]?me|password|admin123|qwerty/i.test(password)) {
    return 'Password is too easy to guess';
  }
  return null;
}

/** A new administrator password (the username check is done where the username is known). */
export const adminNewPasswordSchema = z
  .string({ error: 'Password is required' })
  .superRefine((value, ctx) => {
    const problem = adminPasswordProblem(value);
    if (problem) {
      ctx.addIssue({ code: 'custom', message: problem });
    }
  });
