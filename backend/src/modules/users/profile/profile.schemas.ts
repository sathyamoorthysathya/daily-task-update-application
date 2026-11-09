import { z } from 'zod';
import { nameSchema } from '../../auth/auth.schemas.js';
import { INDUSTRIES } from './industries.js';

export const MAX_YEARS_OF_EXPERIENCE = 60;

const emptyToNull = (value: string) => (value === '' ? null : value);

/** Optional free text: trimmed; `''` or `null` clears the value; omitted = unchanged. */
const optionalText = (label: string, max: number) =>
  z
    .string({ error: `${label} must be text` })
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .transform(emptyToNull)
    .nullable()
    .optional();

/** Accepts international formats such as "+1 (555) 123-4567"; 7-15 digits (E.164 maximum). */
export const phoneSchema = z
  .string({ error: 'Phone number must be text' })
  .trim()
  .max(32, 'Phone number must be at most 32 characters')
  .refine((value) => {
    if (value === '') {
      return true;
    }
    const digits = value.replace(/\D/g, '').length;
    return /^\+?[\d\s().-]+$/.test(value) && digits >= 7 && digits <= 15;
  }, 'Enter a valid phone number, e.g. +1 555 123 4567')
  .transform((value) => emptyToNull(value.replace(/\s+/g, ' ')))
  .nullable()
  .optional();

export const updateProfileSchema = z.strictObject(
  {
    name: nameSchema.optional(),
    phone: phoneSchema,
    companyName: optionalText('Company name', 120),
    jobRole: optionalText('Job role', 100),
    industry: z
      .string({ error: 'Industry must be text' })
      .trim()
      .refine(
        (value) => value === '' || (INDUSTRIES as readonly string[]).includes(value),
        'Select an industry from the list',
      )
      .transform(emptyToNull)
      .nullable()
      .optional(),
    yearsOfExperience: z
      .number({ error: 'Years of experience must be a number' })
      .int('Years of experience must be a whole number')
      .min(0, 'Years of experience cannot be negative')
      .max(
        MAX_YEARS_OF_EXPERIENCE,
        `Years of experience must be ${MAX_YEARS_OF_EXPERIENCE} or less`,
      )
      .nullable()
      .optional(),
  },
  // Rejects attempts to change fields that are not editable here (email, id, ...).
  {
    error: (issue) =>
      issue.code === 'unrecognized_keys'
        ? `Field cannot be changed: ${issue.keys.join(', ')}`
        : undefined,
  },
);

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
