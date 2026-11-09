import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { WriteRateLimit } from '../auth/decorators/rate-limit.decorator.js';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiErrorResponseDto } from '../../common/dto/api-error-response.dto.js';
import { ApiZodBody } from '../../common/validation/zod-openapi.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { workbookContentDisposition } from './content-disposition.js';
import { WorkbookDto, WorkbookListDto, WorkbookSyncStatusDto } from './dto/workbook.dto.js';
import { XLSX_MIME_TYPE } from './workbook.constants.js';
import {
  type CreateWorkbookInput,
  createWorkbookSchema,
  type DeleteWorkbookQuery,
  deleteWorkbookQuerySchema,
  type RenameWorkbookInput,
  renameWorkbookSchema,
  workbookIdParamSchema,
} from './workbooks.schemas.js';
import { WorkbooksService } from './workbooks.service.js';

/** The signed-in user's Excel workbooks. Other users' workbooks always return 404. */
@ApiTags('Workbooks')
@ApiCookieAuth('access_token')
@ApiUnauthorizedResponse({ type: ApiErrorResponseDto, description: 'Not signed in' })
@Controller('workbooks')
export class WorkbooksController {
  constructor(private readonly workbooks: WorkbooksService) {}

  @Get()
  @ApiOperation({
    summary: 'List my workbooks',
    description: 'An empty list means first-time setup.',
  })
  @ApiOkResponse({ type: WorkbookListDto })
  list(@CurrentUser() user: AuthUser): Promise<WorkbookListDto> {
    return this.workbooks.list(user.id);
  }

  @WriteRateLimit()
  @Post()
  @ApiSecurity('csrf')
  @ApiOperation({
    summary: 'Create a workbook',
    description:
      'Creates an .xlsx file with a formatted "Daily Tasks" sheet. The first workbook becomes the default.',
  })
  @ApiZodBody(createWorkbookSchema)
  @ApiCreatedResponse({ type: WorkbookDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto, description: 'Invalid name' })
  @ApiConflictResponse({ type: ApiErrorResponseDto, description: 'Name taken or limit reached' })
  create(
    @CurrentUser() user: AuthUser,
    @Body({ schema: createWorkbookSchema }) body: CreateWorkbookInput,
  ): Promise<WorkbookDto> {
    return this.workbooks.create(user.id, body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a workbook' })
  @ApiOkResponse({ type: WorkbookDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', { schema: workbookIdParamSchema }) id: string,
  ): Promise<WorkbookDto> {
    return this.workbooks.get(user.id, id);
  }

  @WriteRateLimit()
  @Patch(':id')
  @ApiSecurity('csrf')
  @ApiOperation({ summary: 'Rename a workbook', description: 'Requires the current `version`.' })
  @ApiZodBody(renameWorkbookSchema)
  @ApiOkResponse({ type: WorkbookDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto, description: 'Name taken or version conflict' })
  rename(
    @CurrentUser() user: AuthUser,
    @Param('id', { schema: workbookIdParamSchema }) id: string,
    @Body({ schema: renameWorkbookSchema }) body: RenameWorkbookInput,
  ): Promise<WorkbookDto> {
    return this.workbooks.rename(user.id, id, body);
  }

  @WriteRateLimit()
  @Post(':id/default')
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('csrf')
  @ApiOperation({ summary: 'Make a workbook the default for new tasks' })
  @ApiOkResponse({ type: WorkbookListDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  setDefault(
    @CurrentUser() user: AuthUser,
    @Param('id', { schema: workbookIdParamSchema }) id: string,
  ): Promise<WorkbookListDto> {
    return this.workbooks.setDefault(user.id, id);
  }

  @WriteRateLimit()
  @Post(':id/sync')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiSecurity('csrf')
  @ApiOperation({
    summary: 'Resynchronise the Excel file',
    description:
      'Queues a full rebuild of the file from the saved tasks (normally automatic; use it to ' +
      'recover after failures). Processed in the background; poll GET /:id/sync-status.',
  })
  @ApiAcceptedResponse({ type: WorkbookSyncStatusDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  resync(
    @CurrentUser() user: AuthUser,
    @Param('id', { schema: workbookIdParamSchema }) id: string,
  ): Promise<WorkbookSyncStatusDto> {
    return this.workbooks.resync(user.id, id);
  }

  @Get(':id/sync-status')
  @ApiOperation({ summary: 'Excel synchronisation status of a workbook' })
  @ApiOkResponse({ type: WorkbookSyncStatusDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  syncStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', { schema: workbookIdParamSchema }) id: string,
  ): Promise<WorkbookSyncStatusDto> {
    return this.workbooks.syncStatus(user.id, id);
  }

  @WriteRateLimit()
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiSecurity('csrf')
  @ApiOperation({
    summary: 'Delete a workbook and its file',
    description: 'Pass `version` to make sure the workbook has not changed since it was shown.',
  })
  @ApiQuery({ name: 'version', required: false, type: Number })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto, description: 'Version conflict' })
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', { schema: workbookIdParamSchema }) id: string,
    @Query({ schema: deleteWorkbookQuerySchema }) query: DeleteWorkbookQuery,
  ): Promise<void> {
    await this.workbooks.remove(user.id, id, query.version);
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Download the workbook (.xlsx)' })
  @ApiProduces(XLSX_MIME_TYPE)
  @ApiOkResponse({ description: 'The Excel file' })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async download(
    @CurrentUser() user: AuthUser,
    @Param('id', { schema: workbookIdParamSchema }) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.workbooks.download(user.id, id);
    res.set({
      'Content-Type': XLSX_MIME_TYPE,
      'Content-Length': String(file.data.length),
      'Content-Disposition': workbookContentDisposition(file.name),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(file.data);
  }
}
