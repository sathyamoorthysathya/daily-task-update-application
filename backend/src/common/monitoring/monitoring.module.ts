import { Global, Module } from '@nestjs/common';
import { AlertService } from './alert.service.js';
import { AuditService } from './audit.service.js';
import { ErrorReporter } from './error-reporter.service.js';

/** Alerts, error monitoring and the security audit log, available to every module. */
@Global()
@Module({
  providers: [AlertService, ErrorReporter, AuditService],
  exports: [AlertService, ErrorReporter, AuditService],
})
export class MonitoringModule {}
