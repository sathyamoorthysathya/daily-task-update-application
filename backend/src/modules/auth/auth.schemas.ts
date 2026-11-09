import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 8;
/** Upper bound protects the Argon2 hasher from oversized inputs. */
export const PASSWORD_MAX_LENGTH = 128;

export const emailSchema = z
  .string({ error: 'Email is required' })
  .trim()
  .toLowerCase()
  .min(1, 'Email is required')
  .max(254, 'Email must be at most 254 characters')
  .pipe(z.email('Enter a valid email address'));

export const nameSchema = z
  .string({ error: 'Name is required' })
  .trim()
  .min(1, 'Name is required')
  .max(100, 'Name must be at most 100 characters');

/** Policy for new passwords (registration and reset). */
export const newPasswordSchema = z
  .string({ error: 'Password is required' })
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`)
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/\d/, 'Password must contain at least one number');

export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: newPasswordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  // No policy checks on login: only presence and the hashing upper bound.
  password: z
    .string({ error: 'Password is required' })
    .min(1, 'Password is required')
    .max(PASSWORD_MAX_LENGTH, 'Invalid email or password'),
});

export const googleLoginSchema = z.object({
  credential: z.string({ error: 'Google credential is required' }).min(1).max(4096),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string({ error: 'Reset token is required' }).min(1, 'Reset token is required').max(256),
  password: newPasswordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z
    .string({ error: 'Current password is required' })
    .min(1, 'Current password is required')
    .max(PASSWORD_MAX_LENGTH, 'Current password is incorrect'),
  newPassword: newPasswordSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type GoogleLoginInput = z.infer<typeof googleLoginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
