import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import type { Request } from 'express';
import type { Env } from '../../config/env.schema.js';
import { AuditService } from '../monitoring/audit.service.js';
import { ErrorReporter } from '../monitoring/error-reporter.service.js';
import { STATUS_CODES } from 'node:http';
import type { ApiErrorResponseDto } from '../dto/api-error-response.dto.js';
import { mapPrismaError } from './prisma-error.mapper.js';

interface ResolvedError {
  statusCode: number;
  message: string | string[];
  code?: string;
  errors?: FieldError[];
  details?: unknown;
}

interface FieldError {
  field: string;
  message: string;
}

/**
 * Global exception filter: every error leaves the API in the same JSON shape
 * (ApiErrorResponseDto). Unexpected errors are logged and never leak internals.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  private readonly hideInternals: boolean;

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    @Optional() private readonly reporter?: ErrorReporter,
    @Optional() private readonly audit?: AuditService,
    @Optional() config?: ConfigService<Env, true>,
  ) {
    this.hideInternals = config?.get('NODE_ENV', { infer: true }) === 'production';
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request & { user?: { id?: string } }>();
    const { statusCode, message, code, errors, details: rawDetails } = this.resolve(exception);
    // Public health responses must not reveal internal error messages (paths, hosts).
    const details =
      this.hideInternals && statusCode === 503 ? stripMessages(rawDetails) : rawDetails;
    const requestId = request.requestId;

    const body: ApiErrorResponseDto = {
      statusCode,
      error: STATUS_CODES[statusCode] ?? 'Error',
      message,
      ...(code === undefined ? {} : { code }),
      ...(errors === undefined ? {} : { errors }),
      ...(details === undefined ? {} : { details }),
      path: String(httpAdapter.getRequestUrl(request)),
      method: String(httpAdapter.getRequestMethod(request)),
      timestamp: new Date().toISOString(),
      ...(requestId ? { requestId } : {}),
    };

    const context = {
      requestId,
      method: body.method,
      path: request.path,
      userId: request.user?.id,
    };
    if (statusCode >= 500 && !(exception instanceof HttpException)) {
      // Unexpected error: logged with its stack and raised as a (throttled) alert.
      if (this.reporter) {
        this.reporter.report(exception, { source: 'http', ...context });
      } else {
        this.logger.error(
          `${body.method} ${body.path} -> ${statusCode}`,
          exception instanceof Error ? exception.stack : String(exception),
        );
      }
    } else if (statusCode >= 500) {
      this.logger.error({ event: 'http.error', status: statusCode, ...context, message });
    } else if (statusCode === 403 && this.audit) {
      // Authorization and CSRF refusals are security-relevant.
      void this.audit.record({
        event: 'access.denied',
        outcome: 'FAILURE',
        userId: context.userId,
        details: { method: body.method, path: context.path ?? null, code: code ?? null },
      });
    }

    httpAdapter.reply(ctx.getResponse(), body, statusCode);
  }

  private resolve(exception: unknown): ResolvedError {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const response = exception.getResponse();

      if (typeof response === 'string') {
        return { statusCode, message: response };
      }

      const { message, code, errors, details } = response as {
        message?: unknown;
        code?: unknown;
        errors?: unknown;
        details?: unknown;
      };
      if (typeof message === 'string' || isStringArray(message)) {
        return {
          statusCode,
          message,
          ...(typeof code === 'string' ? { code } : {}),
          ...(isFieldErrorArray(errors) ? { errors } : {}),
          ...(details === undefined ? {} : { details }),
        };
      }

      // Structured payloads without a message (e.g. Terminus health results) are kept as details.
      return { statusCode, message: exception.message, details: response };
    }

    return (
      mapPrismaError(exception) ?? {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
      }
    );
  }
}

/** Keeps the structure (indicator names and statuses) of health details, drops messages. */
function stripMessages(details: unknown): unknown {
  if (Array.isArray(details)) {
    return details.map(stripMessages);
  }
  if (typeof details !== 'object' || details === null) {
    return details;
  }
  return Object.fromEntries(
    Object.entries(details)
      // Terminus nests failing indicators under `error` (an object): only text is dropped.
      .filter(
        ([key, value]) =>
          key !== 'message' && key !== 'stack' && !(key === 'error' && typeof value === 'string'),
      )
      .map(([key, value]) => [key, stripMessages(value)]),
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isFieldErrorArray(value: unknown): value is FieldError[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as FieldError).field === 'string' &&
        typeof (item as FieldError).message === 'string',
    )
  );
}
