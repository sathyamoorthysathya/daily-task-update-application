import { Module } from '@nestjs/common';
import { WorkbookLockService } from './workbook-lock.service.js';
import { WorkbookStorageService } from './workbook-storage.service.js';
import { WorkbookSyncService } from './workbook-sync.service.js';
import { ExcelSyncQueue } from './sync/excel-sync-queue.service.js';
import { ExcelSyncWorker } from './sync/excel-sync.worker.js';
import { WorkbookTemplateService } from './workbook-template.service.js';
import { WorkbooksController } from './workbooks.controller.js';
import { WorkbooksService } from './workbooks.service.js';

@Module({
  controllers: [WorkbooksController],
  providers: [
    WorkbooksService,
    WorkbookStorageService,
    WorkbookTemplateService,
    WorkbookLockService,
    WorkbookSyncService,
    ExcelSyncQueue,
    ExcelSyncWorker,
  ],
  exports: [
    WorkbooksService,
    WorkbookStorageService,
    WorkbookLockService,
    WorkbookSyncService,
    ExcelSyncQueue,
    ExcelSyncWorker,
  ],
})
export class WorkbooksModule {}
