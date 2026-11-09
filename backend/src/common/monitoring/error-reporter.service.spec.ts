import { Logger } from '@nestjs/common';
import type { AlertService } from './alert.service.js';
import { ErrorReporter } from './error-reporter.service.js';

describe('ErrorReporter', () => {
  let raise: ReturnType<typeof vi.fn>;
  let reporter: ErrorReporter;
  let logError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    raise = vi.fn().mockResolvedValue(undefined);
    reporter = new ErrorReporter({ raise } as unknown as AlertService);
    logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('logs every error with its context and stack', () => {
    const error = new TypeError('boom');
    reporter.report(error, { source: 'http', requestId: 'r-1', path: '/api/tasks' });

    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'error.unexpected',
        source: 'http',
        requestId: 'r-1',
        errorName: 'TypeError',
        error: 'boom',
      }),
      error.stack,
    );
  });

  it('raises one alert per error signature per 10 minutes', () => {
    for (let i = 0; i < 5; i += 1) {
      reporter.report(new Error('database unreachable'), { source: 'http' });
    }
    reporter.report(new Error('another problem'), { source: 'http' });
    expect(raise).toHaveBeenCalledTimes(2);
    expect(raise).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'server_error', severity: 'critical' }),
    );
    expect(logError).toHaveBeenCalledTimes(6);

    vi.advanceTimersByTime(10 * 60_000 + 1);
    reporter.report(new Error('database unreachable'), { source: 'http' });
    expect(raise).toHaveBeenCalledTimes(3);
  });

  it('accepts non-Error values', () => {
    reporter.report('plain string', { source: 'process.unhandledRejection' });
    expect(raise).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('plain string') as string }),
    );
  });
});
