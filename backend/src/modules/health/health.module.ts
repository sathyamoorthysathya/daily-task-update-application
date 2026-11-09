import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { WorkbooksModule } from '../workbooks/workbooks.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [TerminusModule, WorkbooksModule],
  controllers: [HealthController],
})
export class HealthModule {}
