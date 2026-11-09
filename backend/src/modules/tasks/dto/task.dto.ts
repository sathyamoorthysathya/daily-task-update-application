import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TASK_STATUS_VALUES } from '../task-status.js';

export class TaskUpdateDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  taskId!: string;

  @ApiProperty({ example: '2026-11-07', description: 'Calendar date of this update' })
  entryDate!: string;

  @ApiProperty({ enum: TASK_STATUS_VALUES })
  status!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ type: String, nullable: true })
  reference!: string | null;

  @ApiProperty({ description: 'Send back when editing (optimistic locking)' })
  version!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class TaskDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  workbookId!: string;

  @ApiProperty({ example: 12, description: 'Sequential per workbook' })
  taskNumber!: number;

  @ApiProperty({ example: 'Prepare GST report' })
  name!: string;

  @ApiProperty({ enum: TASK_STATUS_VALUES, description: 'Status of the latest update' })
  status!: string;

  @ApiProperty({ example: '2026-11-07' })
  lastEntryDate!: string;

  @ApiProperty({ description: 'Number of dated updates' })
  entryCount!: number;

  @ApiProperty({ description: 'Send back when renaming or deleting (optimistic locking)' })
  version!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class WorkbookRefDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Daily Tasks 2026' })
  name!: string;
}

export class TaskHistoryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    enum: ['TASK_CREATED', 'ENTRY_ADDED', 'ENTRY_UPDATED', 'TASK_RENAMED', 'TASK_DELETED'],
  })
  action!: string;

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  taskUpdateId!: string | null;

  @ApiProperty({ description: 'New values, or { field: { from, to } } for edits' })
  changes!: unknown;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class TaskDetailDto extends TaskDto {
  @ApiProperty({ type: WorkbookRefDto })
  workbook!: WorkbookRefDto;

  @ApiProperty({ type: [TaskUpdateDto], description: 'Newest first' })
  updates!: TaskUpdateDto[];

  @ApiProperty({ type: [TaskHistoryDto], description: 'Oldest first' })
  history!: TaskHistoryDto[];
}

/** An existing task with the same name, as shown in the duplicate dialog. */
export class TaskMatchDto {
  @ApiProperty({ type: TaskDto })
  task!: TaskDto;

  @ApiProperty({ example: 'Daily Tasks 2026' })
  workbookName!: string;

  @ApiProperty({
    type: TaskUpdateDto,
    description:
      '"Update Existing Task" edits this update: the one on the requested date, otherwise the latest',
  })
  targetUpdate!: TaskUpdateDto;

  @ApiProperty({
    description:
      'An update already exists on the requested date, so a new daily entry is not possible',
  })
  hasUpdateOnDate!: boolean;
}

export class TaskLookupDto {
  @ApiPropertyOptional({ type: TaskMatchDto, nullable: true })
  match!: TaskMatchDto | null;
}

export class ExcelSyncDto {
  @ApiProperty({ format: 'uuid' })
  workbookId!: string;

  @ApiProperty({
    enum: ['queued', 'unchanged'],
    description:
      'queued: saved in the database; the Excel file is updated in the background ' +
      '(see GET /workbooks/:id/sync-status); unchanged: nothing changed, no Excel update needed',
  })
  status!: 'queued' | 'unchanged';

  @ApiProperty({ type: String, nullable: true, format: 'uuid', description: 'Excel sync job' })
  jobId!: string | null;
}

export class SaveTaskResultDto {
  @ApiProperty({ type: TaskDto })
  task!: TaskDto;

  @ApiProperty({ type: TaskUpdateDto })
  update!: TaskUpdateDto;

  @ApiProperty({ type: ExcelSyncDto })
  excelSync!: ExcelSyncDto;
}

export class RecentTaskUpdateDto extends TaskUpdateDto {
  @ApiProperty({ format: 'uuid' })
  workbookId!: string;

  @ApiProperty()
  taskNumber!: number;

  @ApiProperty()
  taskName!: string;
}

export class RecentTaskUpdatesDto {
  @ApiProperty({ type: [RecentTaskUpdateDto], description: 'Newest date first' })
  updates!: RecentTaskUpdateDto[];
}

export class TaskListItemDto extends TaskDto {
  @ApiProperty({ type: WorkbookRefDto })
  workbook!: WorkbookRefDto;

  @ApiProperty({ description: 'Description of the latest dated update' })
  latestDescription!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Reference of the latest update' })
  latestReference!: string | null;
}

export class TaskPageDto {
  @ApiProperty({ type: [TaskListItemDto] })
  items!: TaskListItemDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  pageSize!: number;

  @ApiProperty({ example: 57, description: 'Tasks matching the filters' })
  total!: number;

  @ApiProperty({ example: 3 })
  totalPages!: number;
}

export class SaveTaskSummaryDto {
  @ApiProperty({ type: TaskDto })
  task!: TaskDto;

  @ApiProperty({ type: ExcelSyncDto })
  excelSync!: ExcelSyncDto;
}

export class DeleteTaskResultDto {
  @ApiProperty({ format: 'uuid' })
  taskId!: string;

  @ApiProperty({ type: ExcelSyncDto })
  excelSync!: ExcelSyncDto;
}

export class StatusCountsDto {
  @ApiProperty({ example: 3 }) TO_DO!: number;
  @ApiProperty({ example: 5 }) IN_PROGRESS!: number;
  @ApiProperty({ example: 1 }) PENDING!: number;
  @ApiProperty({ example: 12 }) COMPLETED!: number;
  @ApiProperty({ example: 0 }) ON_HOLD!: number;
}

export class SummaryTotalsDto {
  @ApiProperty({ description: 'Tasks (not deleted)', example: 21 })
  tasks!: number;

  @ApiProperty({ description: 'Dated task entries (Excel rows)', example: 48 })
  entries!: number;

  @ApiProperty({ example: 2 })
  workbooks!: number;

  @ApiProperty({ description: 'Tasks whose latest status is Completed', example: 12 })
  completed!: number;

  @ApiProperty({ description: 'Tasks not completed yet', example: 9 })
  open!: number;

  @ApiProperty({ description: 'Completed tasks in % of all tasks (0-100)', example: 57 })
  completionRate!: number;
}

export class ActivityDayDto {
  @ApiProperty({ example: '2026-11-08' })
  date!: string;

  @ApiProperty({ description: 'Entries dated this day', example: 4 })
  entries!: number;

  @ApiProperty({ description: 'Of those, entries with status Completed', example: 1 })
  completed!: number;
}

export class SummaryPeriodsDto {
  @ApiProperty({ description: 'Entries dated today', example: 3 })
  today!: number;

  @ApiProperty({ description: 'Entries dated in the 7 days up to today', example: 15 })
  last7Days!: number;

  @ApiProperty({ description: 'Entries dated in the 7 days before that', example: 11 })
  previous7Days!: number;
}

export class WorkbookProgressDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Daily Tasks' })
  name!: string;

  @ApiProperty({ example: 14 })
  tasks!: number;

  @ApiProperty({ example: 9 })
  completed!: number;

  @ApiProperty({ type: StatusCountsDto })
  byStatus!: StatusCountsDto;
}

export class TaskSummaryDto {
  @ApiProperty({ description: 'The date the activity window ends on', example: '2026-11-08' })
  today!: string;

  @ApiProperty({ type: SummaryTotalsDto })
  totals!: SummaryTotalsDto;

  @ApiProperty({ type: StatusCountsDto, description: 'Tasks by their latest status' })
  byStatus!: StatusCountsDto;

  @ApiProperty({ type: [ActivityDayDto], description: 'One item per day, oldest first' })
  activity!: ActivityDayDto[];

  @ApiProperty({ type: SummaryPeriodsDto })
  periods!: SummaryPeriodsDto;

  @ApiProperty({ type: [WorkbookProgressDto], description: 'Oldest workbook first' })
  workbooks!: WorkbookProgressDto[];
}
