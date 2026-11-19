import { StandardSchemaValidationPipe, UnprocessableEntityException } from '@nestjs/common';
import type { StandardSchemaV1 } from '@standard-schema/spec';

function fieldOf(issue: StandardSchemaV1.Issue): string {
  return (issue.path ?? [])
    .map((segment) => (typeof segment === 'object' ? String(segment.key) : String(segment)))
    .join('.');
}

/**
 * Validates every parameter declared with a Standard Schema (Zod), e.g.
 * `@Body({ schema: loginSchema })`, and reports failures as
 * `422 { code: 'VALIDATION_FAILED', message: [...], errors: [{ field, message }] }`
 * (422 Unprocessable Entity: the request is well-formed, its values are not valid).
 */
export function createValidationPipe(): StandardSchemaValidationPipe {
  return new StandardSchemaValidationPipe({
    exceptionFactory: (issues) => {
      const errors = issues.map((issue) => ({ field: fieldOf(issue), message: issue.message }));
      return new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        message: errors.map(({ field, message }) => (field ? `${field}: ${message}` : message)),
        errors,
      });
    },
  });
}
