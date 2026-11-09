import { BadRequestException, StandardSchemaValidationPipe } from '@nestjs/common';
import type { StandardSchemaV1 } from '@standard-schema/spec';

function fieldOf(issue: StandardSchemaV1.Issue): string {
  return (issue.path ?? [])
    .map((segment) => (typeof segment === 'object' ? String(segment.key) : String(segment)))
    .join('.');
}

/**
 * Validates every parameter declared with a Standard Schema (Zod), e.g.
 * `@Body({ schema: loginSchema })`, and reports failures as
 * `400 { code: 'VALIDATION_FAILED', message: [...], errors: [{ field, message }] }`.
 */
export function createValidationPipe(): StandardSchemaValidationPipe {
  return new StandardSchemaValidationPipe({
    exceptionFactory: (issues) => {
      const errors = issues.map((issue) => ({ field: fieldOf(issue), message: issue.message }));
      return new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: errors.map(({ field, message }) => (field ? `${field}: ${message}` : message)),
        errors,
      });
    },
  });
}
