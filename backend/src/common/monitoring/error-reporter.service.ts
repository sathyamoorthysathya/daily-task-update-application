import { Injectable, Logger } from '@nestjs/common';
import { AlertService } from './alert.service.js';

export interface ErrorContext {
  requestId?: string;
  method?: string;
  path?: string;
  userId?: string;
  /** Where the error was caught, e.g. "http" or "process.unhandledRejection". */
  source: string;
}

/** Same error signature at most once per window to the alert channel (logs get every one). */
const ALERT_WINDOW_MS = 10 * 60_000;
const MAX_TRACKED_SIGNATURES = 500;

/**
 * Error monitoring: every unexpected error is logged with its stack and request context, and
 * raised as an alert (webhook) — throttled per error signature so an outage produces one
 * alert per 10 minutes per distinct error instead of thousands.
 */
@Injectable()
export class ErrorReporter {
  private readonly logger = new Logger('ErrorReporter');
  private readonly lastAlerted = new Map<string, number>();

  constructor(private readonly alerts: AlertService) {}

  report(error: unknown, context: ErrorContext): void {
    const err = error instanceof Error ? error : new Error(String(error));
    const signature = `${context.source}|${err.name}|${err.message.split('\n')[0]?.slice(0, 200)}`;
    this.logger.error(
      {
        event: 'error.unexpected',
        ...context,
        errorName: err.name,
        error: err.message,
      },
      err.stack,
    );

    const now = Date.now();
    const last = this.lastAlerted.get(signature);
    if (last !== undefined && now - last < ALERT_WINDOW_MS) {
      return;
    }
    if (this.lastAlerted.size >= MAX_TRACKED_SIGNATURES) {
      this.lastAlerted.clear();
    }
    this.lastAlerted.set(signature, now);
    void this.alerts.raise({
      type: 'server_error',
      severity: 'critical',
      message: `Unexpected ${err.name} (${context.source}): ${err.message.slice(0, 300)}`,
      context: { ...context, errorName: err.name },
    });
  }
}
