import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Prisma } from '../../generated/prisma/client.js';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema.js';
import type { AuditService } from '../monitoring/audit.service.js';
import type { ErrorReporter } from '../monitoring/error-reporter.service.js';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

const request = { url: '/api/resource', method: 'POST' };
const response = {};

interface Deps {
  reporter?: { report: ReturnType<typeof vi.fn> };
  audit?: { record: ReturnType<typeof vi.fn> };
  production?: boolean;
}

function setup(deps: Deps = {}) {
  const reply = vi.fn();
  const adapterHost = {
    httpAdapter: {
      getRequestUrl: (req: typeof request) => req.url,
      getRequestMethod: (req: typeof request) => req.method,
      reply,
    },
  } as unknown as HttpAdapterHost;
  const host = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ArgumentsHost;

  const config = { get: () => (deps.production ? 'production' : 'development') };
  const filter = new AllExceptionsFilter(
    adapterHost,
    deps.reporter as unknown as ErrorReporter,
    deps.audit as unknown as AuditService,
    config as unknown as ConfigService<Env, true>,
  );
  const run = (exception: unknown) => {
    filter.catch(exception, host);
    const [res, body, status] = reply.mock.lastCall as [unknown, Record<string, unknown>, number];
    expect(res).toBe(response);
    return { body, status };
  };
  return { run };
}

describe('AllExceptionsFilter', () => {
  let loggerError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    loggerError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('formats an HttpException with the standard envelope', () => {
    const { body, status } = setup().run(new NotFoundException('Task not found'));

    expect(status).toBe(404);
    expect(body).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'Task not found',
      path: '/api/resource',
      method: 'POST',
      timestamp: expect.any(String) as unknown,
    });
  });

  it('keeps validation message arrays', () => {
    const { body, status } = setup().run(
      new BadRequestException(['title must be a string', 'date is required']),
    );

    expect(status).toBe(400);
    expect(body.message).toEqual(['title must be a string', 'date is required']);
  });

  it('keeps structured payloads without a message as details', () => {
    const healthResult = { status: 'error', error: { database: { status: 'down' } } };
    const { body, status } = setup().run(new ServiceUnavailableException(healthResult));

    expect(status).toBe(503);
    expect(body.error).toBe('Service Unavailable');
    expect(body.details).toEqual(healthResult);
  });

  it('maps Prisma unique constraint violations to 409', () => {
    const error = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: Prisma.prismaVersion.client,
    });

    const { body, status } = setup().run(error);

    expect(status).toBe(HttpStatus.CONFLICT);
    expect(body.message).toBe('A record with the same unique value already exists');
  });

  it('maps Prisma record-not-found errors to 404', () => {
    const error = new Prisma.PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: Prisma.prismaVersion.client,
    });

    expect(setup().run(error).status).toBe(HttpStatus.NOT_FOUND);
  });

  it('hides details of unexpected errors behind a generic 500', () => {
    const { body, status } = setup().run(new Error('secret connection string leaked'));

    expect(status).toBe(500);
    expect(body.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(loggerError).toHaveBeenCalled();
  });

  it('reports unexpected errors to error monitoring, but not expected HTTP errors', () => {
    const reporter = { report: vi.fn() };
    const { run } = setup({ reporter });

    const error = new Error('db down');
    run(error);
    run(new ServiceUnavailableException('maintenance'));
    run(new NotFoundException());

    expect(reporter.report).toHaveBeenCalledTimes(1);
    expect(reporter.report).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ source: 'http' }),
    );
  });

  it('records refused (403) requests in the audit log', () => {
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    setup({ audit }).run(
      new ForbiddenException({ code: 'CSRF_TOKEN_INVALID', message: 'Invalid CSRF token' }),
    );

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'access.denied',
        outcome: 'FAILURE',
        details: expect.objectContaining({ code: 'CSRF_TOKEN_INVALID' }) as unknown,
      }),
    );
  });

  it('strips internal error messages from health details in production', () => {
    const healthResult = {
      status: 'error',
      error: {
        workbookStorage: { status: 'down', message: "EACCES: permission denied, '/data/x'" },
      },
    };
    const { body } = setup({ production: true }).run(new ServiceUnavailableException(healthResult));

    expect(body.details).toEqual({
      status: 'error',
      error: { workbookStorage: { status: 'down' } },
    });
    expect(JSON.stringify(body)).not.toContain('EACCES');
  });
});
