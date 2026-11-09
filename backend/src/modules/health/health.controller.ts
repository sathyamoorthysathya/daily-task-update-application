import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
  PrismaHealthIndicator,
  type HealthCheckResult,
} from '@nestjs/terminus';
import { PrismaService } from '../../database/prisma.service.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { WorkbookStorageService } from '../workbooks/workbook-storage.service.js';

const DATABASE_PING_TIMEOUT_MS = 1500;

@ApiTags('Health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly indicators: HealthIndicatorService,
    private readonly workbookStorage: WorkbookStorageService,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({
    summary: 'Readiness check',
    description:
      'Reports whether the API, its PostgreSQL database and the workbook storage are available.',
  })
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () =>
        this.prismaHealth.pingCheck('database', this.prisma).withTimeout(DATABASE_PING_TIMEOUT_MS),
      () =>
        this.indicators
          .check('workbookStorage')
          .attempt(() => this.workbookStorage.assertWritable())
          .withTimeout(DATABASE_PING_TIMEOUT_MS),
    ]);
  }

  @Get('live')
  @HealthCheck()
  @ApiOperation({
    summary: 'Liveness check',
    description: 'Reports whether the API process is running. Does not touch the database.',
  })
  live(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }
}
