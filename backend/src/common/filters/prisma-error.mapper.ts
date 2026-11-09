import { HttpStatus } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';

export interface MappedError {
  statusCode: HttpStatus;
  message: string;
}

const INTERNAL_ERROR: MappedError = {
  statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
  message: 'Internal server error',
};

/**
 * Translates Prisma client errors into HTTP-friendly errors.
 * Returns `undefined` for anything that is not a Prisma error.
 * Reference: https://www.prisma.io/docs/orm/reference/error-reference
 */
export function mapPrismaError(exception: unknown): MappedError | undefined {
  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    switch (exception.code) {
      case 'P2000':
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'A provided value is too long for its field',
        };
      case 'P2002':
        return {
          statusCode: HttpStatus.CONFLICT,
          message: 'A record with the same unique value already exists',
        };
      case 'P2003':
        return {
          statusCode: HttpStatus.CONFLICT,
          message: 'The operation violates a relation constraint',
        };
      case 'P2025':
        return { statusCode: HttpStatus.NOT_FOUND, message: 'The requested record was not found' };
      default:
        return INTERNAL_ERROR;
    }
  }

  if (exception instanceof Prisma.PrismaClientInitializationError) {
    return { statusCode: HttpStatus.SERVICE_UNAVAILABLE, message: 'Database is unavailable' };
  }

  if (
    exception instanceof Prisma.PrismaClientUnknownRequestError ||
    exception instanceof Prisma.PrismaClientRustPanicError ||
    exception instanceof Prisma.PrismaClientValidationError
  ) {
    return INTERNAL_ERROR;
  }

  return undefined;
}
