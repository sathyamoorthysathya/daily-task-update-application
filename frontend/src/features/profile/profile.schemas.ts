import { z } from 'zod';
import type { Profile, ProfileUpdate } from './profile.types';

// Mirrors backend/src/modules/users/profile/profile.schemas.ts for instant feedback;
// the backend re-validates every request.

export const MAX_YEARS_OF_EXPERIENCE = 60;
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const optionalText = (label: string, max: number) =>
  z.string().trim().max(max, `${label} must be at most ${max} characters`);

/** Form values are strings (as typed); `toProfileUpdate` converts them for the API. */
export const profileFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(100, 'Name must be at most 100 characters'),
  phone: optionalText('Phone number', 32).refine((value) => {
    if (value === '') {
      return true;
    }
    const digits = value.replace(/\D/g, '').length;
    return /^\+?[\d\s().-]+$/.test(value) && digits >= 7 && digits <= 15;
  }, 'Enter a valid phone number, e.g. +1 555 123 4567'),
  companyName: optionalText('Company name', 120),
  jobRole: optionalText('Job role', 100),
  industry: z.string(),
  yearsOfExperience: z
    .string()
    .trim()
    .refine(
      (value) => value === '' || (/^\d+$/.test(value) && Number(value) <= MAX_YEARS_OF_EXPERIENCE),
      `Enter a whole number from 0 to ${MAX_YEARS_OF_EXPERIENCE}`,
    ),
});

export type ProfileFormValues = z.input<typeof profileFormSchema>;

export function toFormValues(profile: Profile): ProfileFormValues {
  return {
    name: profile.name,
    phone: profile.phone ?? '',
    companyName: profile.companyName ?? '',
    jobRole: profile.jobRole ?? '',
    industry: profile.industry ?? '',
    yearsOfExperience: profile.yearsOfExperience?.toString() ?? '',
  };
}

export function toProfileUpdate(values: z.output<typeof profileFormSchema>): ProfileUpdate {
  const orNull = (value: string) => (value === '' ? null : value);
  return {
    name: values.name,
    phone: orNull(values.phone),
    companyName: orNull(values.companyName),
    jobRole: orNull(values.jobRole),
    industry: orNull(values.industry),
    yearsOfExperience: values.yearsOfExperience === '' ? null : Number(values.yearsOfExperience),
  };
}

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(128, 'Password must be at most 128 characters')
      .regex(/[A-Za-z]/, 'Password must contain at least one letter')
      .regex(/\d/, 'Password must contain at least one number'),
    confirmPassword: z.string(),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })
  .refine((values) => values.newPassword !== values.currentPassword, {
    path: ['newPassword'],
    message: 'Choose a password different from your current one.',
  });

/** Client-side checks before uploading (the server re-validates the actual file contents). */
export function avatarFileError(file: File): string | null {
  if (!AVATAR_TYPES.includes(file.type)) {
    return 'Choose a JPEG, PNG or WebP image.';
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return 'The image must be 2 MB or smaller.';
  }
  return null;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
