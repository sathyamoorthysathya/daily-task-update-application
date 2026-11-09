import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { AuditOutcome, Prisma } from '../../generated/prisma/client.js';
import { currentRequest } from './request-store.js';

export type AuditEventName =
  | 'auth.register'
  | 'auth.login'
  | 'auth.google_login'
  | 'auth.refresh_token_reuse'
  | 'auth.session_expired'
  | 'auth.logout'
  | 'auth.logout_all'
  | 'auth.password_changed'
  | 'auth.password_reset_requested'
  | 'auth.password_reset'
  | 'access.denied'
  | 'profile.updated'
  | 'profile.avatar_changed'
  | 'workbook.created'
  | 'workbook.renamed'
  | 'workbook.deleted'
  | 'workbook.resync_requested';

export interface AuditRecord {
  event: AuditEventName;
  outcome?: AuditOutcome;
  userId?: string | null;
  /** Only for events without a known user (e.g. a failed login); never logged. */
  email?: string | null;
  resourceType?: 'user' | 'session' | 'workbook' | 'task';
  resourceId?: string | null;
  /** Reasons, counts and names; never passwords, tokens or other secrets. */
  details?: Prisma.InputJsonObject;
}

/**
 * Security audit log: security-relevant events are stored in the append-only `audit_events`
 * table (with the request's IP, user agent and request ID) and written to the structured log.
 * Recording never breaks the request: a failure to store is logged as an error instead.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(private readonly prisma: PrismaService) {}

  async record(record: AuditRecord): Promise<void> {
    const request = currentRequest();
    const outcome = record.outcome ?? 'SUCCESS';
    const entry = {
      event: record.event,
      outcome,
      userId: record.userId ?? null,
      resourceType: record.resourceType ?? null,
      resourceId: record.resourceId ?? null,
      ip: request?.ip?.slice(0, 64) ?? null,
      userAgent: request?.userAgent?.slice(0, 300) ?? null,
      requestId: request?.requestId ?? null,
    };
    // The structured log carries no email addresses (personal data); the table does.
    this.logger.log({ audit: true, ...entry, details: record.details });
    try {
      await this.prisma.auditEvent.create({
        data: {
          ...entry,
          email: record.email?.slice(0, 254) ?? null,
          ...(record.details ? { details: record.details } : {}),
        },
      });
    } catch (error) {
      this.logger.error({
        event: 'audit.write_failed',
        auditEvent: record.event,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
