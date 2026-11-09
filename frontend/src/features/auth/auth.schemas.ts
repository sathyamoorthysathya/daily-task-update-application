import { z } from 'zod';

// Mirrors backend/src/modules/auth/auth.schemas.ts so users get instant feedback.
// The backend remains the source of truth and re-validates every request.

const email = z
  .string()
  .trim()
  .min(1, 'Email is required')
  .max(254, 'Email must be at most 254 characters')
  .pipe(z.email('Enter a valid email address'));

const newPassword = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/\d/, 'Password must contain at least one number');

const passwordsMatch = {
  check: (values: { password: string; confirmPassword: string }) =>
    values.password === values.confirmPassword,
  params: { path: ['confirmPassword'], message: 'Passwords do not match' },
};

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required'),
});

export const registerSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Name is required')
      .max(100, 'Name must be at most 100 characters'),
    email,
    password: newPassword,
    confirmPassword: z.string(),
  })
  .refine(passwordsMatch.check, passwordsMatch.params);

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({ password: newPassword, confirmPassword: z.string() })
  .refine(passwordsMatch.check, passwordsMatch.params);

export const PASSWORD_HINT = 'At least 8 characters, including a letter and a number.';

/** Field errors from a failed Zod parse (first message per field). */
export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path.join('.');
    result[field] ??= issue.message;
  }
  return result;
}
