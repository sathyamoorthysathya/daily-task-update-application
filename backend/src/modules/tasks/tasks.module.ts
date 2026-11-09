import { Module } from '@nestjs/common';
import { WorkbooksModule } from '../workbooks/workbooks.module.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

@Module({
  imports: [WorkbooksModule],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
