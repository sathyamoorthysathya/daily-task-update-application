import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { Env } from '../../config/env.schema.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Sends email through SMTP (SMTP_URL). Without SMTP_URL, outside production, messages are
 * written to the application log so flows such as password reset can be tested locally.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter?: Transporter;
  private readonly from: string;
  private readonly logOnly: boolean;

  constructor(config: ConfigService<Env, true>) {
    const smtpUrl = config.get('SMTP_URL', { infer: true });
    this.from = config.get('MAIL_FROM', { infer: true });
    this.transporter = smtpUrl ? createTransport(smtpUrl) : undefined;
    this.logOnly = !smtpUrl && config.get('NODE_ENV', { infer: true }) !== 'production';
    if (!smtpUrl) {
      this.logger.warn(
        this.logOnly
          ? 'SMTP_URL is not set: emails will be written to the log (development only).'
          : 'SMTP_URL is not set: emails cannot be delivered.',
      );
    }
  }

  async send(message: MailMessage): Promise<void> {
    if (this.transporter) {
      await this.transporter.sendMail({ from: this.from, ...message });
      return;
    }
    if (this.logOnly) {
      this.logger.log(`Email to ${message.to} | ${message.subject}\n${message.text}`);
      return;
    }
    throw new Error('Email delivery is not configured (SMTP_URL)');
  }
}
