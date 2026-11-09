import { useState } from 'react';
import type { z } from 'zod';
import { ApiError, errorMessage } from '../../lib/api/api-error';
import { zodFieldErrors } from './auth.schemas';

/** Field + form-level error state shared by the auth forms. */
export function useFormErrors() {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  function reset() {
    setFieldErrors({});
    setFormError(null);
  }

  /** Validates values; on failure records field errors and returns null. */
  function validate<T>(schema: z.ZodType<T>, values: unknown): T | null {
    reset();
    const result = schema.safeParse(values);
    if (!result.success) {
      setFieldErrors(zodFieldErrors(result.error));
      return null;
    }
    return result.data;
  }

  /** Shows server-side errors: field errors from validation, otherwise a form message. */
  function handleError(error: unknown) {
    if (error instanceof ApiError && Object.keys(error.fieldErrors).length > 0) {
      setFieldErrors(error.fieldErrors);
      return;
    }
    setFormError(errorMessage(error));
  }

  /** Hides a field's error once the user edits that field. */
  function clearFieldError(field: string) {
    setFieldErrors((current) => {
      if (!(field in current)) {
        return current;
      }
      const rest = { ...current };
      delete rest[field];
      return rest;
    });
  }

  return { fieldErrors, formError, setFormError, validate, handleError, reset, clearFieldError };
}
