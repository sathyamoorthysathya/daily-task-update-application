import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema.js';

export interface Alert {
  /** Machine-readable alert type, e.g. "excel_sync_failed". */
  type: string;
  severity: 'warning' | 'critical';
  message: string;
  /** IDs and error details only; never personal data such as email addresses. */
  context: Record<string, unknown>;
}

/**
 * Raises operational alerts: always as a structured error log line (`event: "alert"`), and,
 * when ALERT_WEBHOOK_URL is set, as a JSON POST (compatible with Slack/Teams incoming webhooks
 * through the `text` field). Delivery problems are logged and never thrown.
 */
@Injectable()
export class AlertService {
  private readonly logger = new Logger('Alerts');
  private readonly webhookUrl: string | undefined;

  constructor(config: ConfigService<Env, true>) {
    this.webhookUrl = config.get('ALERT_WEBHOOK_URL', { infer: true });
  }

  async raise(alert: Alert): Promise<void> {
    const event = { event: 'alert', ...alert, raisedAt: new Date().toISOString() };
    this.logger.error(event);
    if (!this.webhookUrl) {
      return;
    }
    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `[${alert.severity.toUpperCase()}] ${alert.message}`,
          ...event,
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        throw new Error(`Webhook answered ${response.status}`);
      }
    } catch (error) {
      this.logger.warn({
        event: 'alert.delivery_failed',
        type: alert.type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
