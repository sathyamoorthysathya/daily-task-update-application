import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { WriteRateLimit } from '../auth/decorators/rate-limit.decorator.js';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../../common/dto/api-error-response.dto.js';
import { ApiZodBody } from '../../common/validation/zod-openapi.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import {
  DeleteTaskResultDto,
  RecentTaskUpdatesDto,
  TaskSummaryDto,
  SaveTaskResultDto,
  SaveTaskSummaryDto,
  TaskDetailDto,
  TaskLookupDto,
  TaskPageDto,
  TaskReportDto,
} from './dto/task.dto.js';
import {
  type AddTaskUpdateInput,
  addTaskUpdateSchema,
  type CreateTaskInput,
  createTaskSchema,
  type DeleteTaskQuery,
  deleteTaskQuerySchema,
  type EditTaskUpdateInput,
  editTaskUpdateSchema,
  type ListTasksQuery,
  listTasksQuerySchema,
  type ListTaskUpdatesQuery,
  listTaskUpdatesQuerySchema,
  type TaskSummaryQuery,
  taskSummaryQuerySchema,
  type LookupTaskQuery,
  lookupTaskQuerySchema,
  type RenameTaskInput,
  renameTaskSchema,
  type ReportDownloadQuery,
  reportDownloadQuerySchema,
  REPORT_FORMATS,
  type TaskReportQuery,
  taskReportQuerySchema,
  TASK_SORTS,
  uuidParamSchema,
} from './tasks.schemas.js';
import { TASK_STATUS_VALUES } from './task-status.js';
import { workbookContentDisposition } from '../workbooks/content-disposition.js';
import { XLSX_MIME_TYPE } from '../workbooks/workbook.constants.js';
import { TasksService } from './tasks.service.js';

@ApiTags('Tasks')
@ApiCookieAuth('access_token')
@ApiUnauthorizedResponse({ type: ApiErrorResponseDto, description: 'Not signed in' })
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @ApiOperation({
    summary: 'List my tasks (paginated)',
    description:
      'search matches the task name (contains, case-insensitive) or the task number ("12" / "#12"). ' +
      'from/to keep tasks with at least one dated update in that range. Deleted tasks are excluded.',
  })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'status', required: false, enum: TASK_STATUS_VALUES })
  @ApiQuery({ name: 'workbookId', required: false })
  @ApiQuery({ name: 'from', required: false, example: '2026-11-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-11-30' })
  @ApiQuery({ name: 'sort', required: false, enum: TASK_SORTS })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, description: '1-100 (default 20)' })
  @ApiOkResponse({ type: TaskPageDto })
  list(
    @CurrentUser() user: AuthUser,
    @Query({ schema: listTasksQuerySchema }) query: ListTasksQuery,
  ): Promise<TaskPageDto> {
    return this.tasks.list(user.id, query);
  }

  @Get('recent-updates')
  @ApiOperation({ summary: 'Recent task updates (newest first)' })
  @ApiQuery({ name: 'workbookId', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOkResponse({ type: RecentTaskUpdatesDto })
  listRecent(
    @CurrentUser() user: AuthUser,
    @Query({ schema: listTaskUpdatesQuerySchema }) query: ListTaskUpdatesQuery,
  ): Promise<RecentTaskUpdatesDto> {
    return this.tasks.listRecent(user.id, query);
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Dashboard summary',
    description:
      'Task counts by status, daily activity for the last `days` days up to `today` (the ' +
      "user's local date), week-over-week entries and progress per workbook.",
  })
  @ApiQuery({ name: 'today', required: false, example: '2026-11-08' })
  @ApiQuery({ name: 'days', required: false, type: Number, example: 14 })
  @ApiOkResponse({ type: TaskSummaryDto })
  summary(
    @CurrentUser() user: AuthUser,
    @Query({ schema: taskSummaryQuerySchema }) query: TaskSummaryQuery,
  ): Promise<TaskSummaryDto> {
    return this.tasks.summary(user.id, query);
  }

  @Get('report')
  @ApiOperation({
    summary: 'Work report',
    description:
      'Daily entries dated in [from, to] (oldest first) with their tasks, and the totals of the ' +
      'period. Without from/to it covers all work. Returns at most 2000 entries.',
  })
  @ApiQuery({ name: 'from', required: false, example: '2026-11-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-11-30' })
  @ApiQuery({ name: 'workbookId', required: false })
  @ApiOkResponse({ type: TaskReportDto })
  report(
    @CurrentUser() user: AuthUser,
    @Query({ schema: taskReportQuerySchema }) query: TaskReportQuery,
  ): Promise<TaskReportDto> {
    return this.tasks.report(user.id, query);
  }

  @Get('report/download')
  @ApiOperation({
    summary: 'Download the work report (.xlsx or .pdf)',
    description:
      'The same entries as GET /tasks/report. xlsx: Summary, Tasks and Daily log sheets; ' +
      'pdf: A4 landscape with the totals, a task table and the daily log.',
  })
  @ApiQuery({ name: 'from', required: false, example: '2026-11-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-11-30' })
  @ApiQuery({ name: 'workbookId', required: false })
  @ApiQuery({ name: 'format', required: false, enum: REPORT_FORMATS, description: 'Default xlsx' })
  @ApiProduces(XLSX_MIME_TYPE, 'application/pdf')
  @ApiOkResponse({ description: 'The report file' })
  async downloadReport(
    @CurrentUser() user: AuthUser,
    @Query({ schema: reportDownloadQuerySchema }) query: ReportDownloadQuery,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.tasks.exportReport(user.id, query);
    res.set({
      'Content-Type': query.format === 'pdf' ? 'application/pdf' : XLSX_MIME_TYPE,
      'Content-Length': String(file.data.length),
      'Content-Disposition': workbookContentDisposition(file.fileName, query.format),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(file.data);
  }

  @Get('lookup')
  @ApiOperation({
    summary: 'Find an existing task with the same name',
    description: 'Case- and space-insensitive, within the chosen (or default) workbook.',
  })
  @ApiQuery({ name: 'name', required: true })
  @ApiQuery({ name: 'workbookId', required: false })
  @ApiQuery({ name: 'entryDate', required: false, example: '2026-11-07' })
  @ApiOkResponse({ type: TaskLookupDto })
  lookup(
    @CurrentUser() user: AuthUser,
    @Query({ schema: lookupTaskQuerySchema }) query: LookupTaskQuery,
  ): Promise<TaskLookupDto> {
    return this.tasks.lookup(user.id, query);
  }

  @WriteRateLimit()
  @Post()
  @ApiSecurity('csrf')
  @ApiOperation({
    summary: 'Create a task',
    description:
      'Creates the task (auto-numbered per workbook) with its first dated update, then updates ' +
      'the Excel file. Without workbookId the default workbook is used.',
  })
  @ApiZodBody(createTaskSchema)
  @ApiCreatedResponse({ type: SaveTaskResultDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto, description: 'Invalid input or no workbook' })
  @ApiConflictResponse({
    type: ApiErrorResponseDto,
    description: 'TASK_ALREADY_EXISTS: `details` describes the existing task',
  })
  create(
    @CurrentUser() user: AuthUser,
    @Body({ schema: createTaskSchema }) body: CreateTaskInput,
  ): Promise<SaveTaskResultDto> {
    return this.tasks.create(user.id, body);
  }

  @Get(':taskId')
  @ApiOperation({ summary: 'A task with all its dated updates and history' })
  @ApiOkResponse({ type: TaskDetailDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  get(
    @CurrentUser() user: AuthUser,
    @Param('taskId', { schema: uuidParamSchema }) taskId: string,
  ): Promise<TaskDetailDto> {
    return this.tasks.get(user.id, taskId);
  }

  @WriteRateLimit()
  @Patch(':taskId')
  @ApiSecurity('csrf')
  @ApiOperation({
    summary: 'Rename a task or change its details',
    description:
      'Changes the name and/or assigned by, priority, project and due date (omitted details ' +
      'stay as they are; null clears one). Requires the task version; the Excel rows follow.',
  })
  @ApiZodBody(renameTaskSchema)
  @ApiOkResponse({ type: SaveTaskSummaryDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto, description: 'Name taken or version conflict' })
  rename(
    @CurrentUser() user: AuthUser,
    @Param('taskId', { schema: uuidParamSchema }) taskId: string,
    @Body({ schema: renameTaskSchema }) body: RenameTaskInput,
  ): Promise<SaveTaskSummaryDto> {
    return this.tasks.rename(user.id, taskId, body);
  }

  @WriteRateLimit()
  @Delete(':taskId')
  @ApiSecurity('csrf')
  @ApiOperation({
    summary: 'Delete a task',
    description:
      'Removes the task and its dated updates from lists and from the Excel workbook. The records ' +
      'and the audit trail are kept in the database (soft delete). Requires the task version.',
  })
  @ApiQuery({ name: 'version', required: true, type: Number })
  @ApiOkResponse({ type: DeleteTaskResultDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto, description: 'Version conflict' })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('taskId', { schema: uuidParamSchema }) taskId: string,
    @Query({ schema: deleteTaskQuerySchema }) query: DeleteTaskQuery,
  ): Promise<DeleteTaskResultDto> {
    return this.tasks.remove(user.id, taskId, query.version);
  }

  @WriteRateLimit()
  @Post(':taskId/updates')
  @ApiSecurity('csrf')
  @ApiOperation({
    summary: 'Create a new daily entry for an existing task',
    description: 'Adds a dated update linked to the task; existing updates are not changed.',
  })
  @ApiZodBody(addTaskUpdateSchema)
  @ApiCreatedResponse({ type: SaveTaskResultDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto, description: 'Entry exists for that date' })
  addUpdate(
    @CurrentUser() user: AuthUser,
    @Param('taskId', { schema: uuidParamSchema }) taskId: string,
    @Body({ schema: addTaskUpdateSchema }) body: AddTaskUpdateInput,
  ): Promise<SaveTaskResultDto> {
    return this.tasks.addUpdate(user.id, taskId, body);
  }

  @WriteRateLimit()
  @Patch(':taskId/updates/:updateId')
  @ApiSecurity('csrf')
  @ApiOperation({
    summary: 'Update an existing task entry',
    description: 'Requires the current version; the previous values are kept in the history.',
  })
  @ApiZodBody(editTaskUpdateSchema)
  @ApiOkResponse({ type: SaveTaskResultDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto, description: 'Version conflict' })
  editUpdate(
    @CurrentUser() user: AuthUser,
    @Param('taskId', { schema: uuidParamSchema }) taskId: string,
    @Param('updateId', { schema: uuidParamSchema }) updateId: string,
    @Body({ schema: editTaskUpdateSchema }) body: EditTaskUpdateInput,
  ): Promise<SaveTaskResultDto> {
    return this.tasks.editUpdate(user.id, taskId, updateId, body);
  }
}
