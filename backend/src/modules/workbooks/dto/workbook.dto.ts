import { ApiProperty } from '@nestjs/swagger';

export class WorkbookDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Daily Tasks 2026' })
  name!: string;

  @ApiProperty({ description: 'Pre-selected workbook for new tasks' })
  isDefault!: boolean;

  @ApiProperty({ example: 0, description: 'Number of tasks recorded in the workbook' })
  taskCount!: number;

  @ApiProperty({ example: 1, description: 'Number the next new task will most likely receive' })
  nextTaskNumber!: number;

  @ApiProperty({ example: 6512, description: 'Size of the .xlsx file in bytes' })
  sizeBytes!: number;

  @ApiProperty({
    enum: ['synced', 'pending', 'retrying', 'failed'],
    description:
      'synced: file contains every saved change; pending: queued or being written; ' +
      'retrying: a sync failed and will be retried; failed: retries exhausted (alert raised)',
  })
  syncStatus!: 'synced' | 'pending' | 'retrying' | 'failed';

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Error of the last failed sync attempt, while the workbook is retrying or failed',
  })
  syncError!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  lastSyncedAt!: string | null;

  @ApiProperty({
    example: 1,
    description: 'Send back when renaming or deleting (optimistic locking)',
  })
  version!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class WorkbookListDto {
  @ApiProperty({ type: [WorkbookDto], description: 'Oldest first' })
  workbooks!: WorkbookDto[];

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  defaultWorkbookId!: string | null;

  @ApiProperty({ example: 20, description: 'Maximum number of workbooks per user' })
  limit!: number;
}

export class WorkbookSyncStatusDto {
  @ApiProperty({ format: 'uuid' })
  workbookId!: string;

  @ApiProperty({ enum: ['synced', 'pending', 'retrying', 'failed'] })
  state!: 'synced' | 'pending' | 'retrying' | 'failed';

  @ApiProperty({ description: 'Version of the saved task data' })
  dataVersion!: number;

  @ApiProperty({ description: 'Version contained in the Excel file' })
  syncedVersion!: number;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  lastSyncedAt!: string | null;

  @ApiProperty({ description: 'Jobs queued or being processed' })
  pendingJobs!: number;

  @ApiProperty({ description: 'Jobs waiting for a retry after a failure' })
  retryingJobs!: number;

  @ApiProperty({ description: 'Jobs that exhausted their retries (until a later sync succeeds)' })
  failedJobs!: number;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  nextRetryAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastError!: string | null;
}
