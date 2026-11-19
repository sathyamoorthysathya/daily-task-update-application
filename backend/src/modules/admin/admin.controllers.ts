import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiSecurity,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../../common/dto/api-error-response.dto.js';
import { ApiZodBody } from '../../common/validation/zod-openapi.js';
import { userIdParamSchema } from '../users/users.schemas.js';
import { type AdminIdentity } from './admin.constants.js';
import {
  disableUserSchema,
  type ListSecurityEventsQuery,
  listSecurityEventsQuerySchema,
  type ListUsersQuery,
  listUsersQuerySchema,
  type ListVisitsQuery,
  listVisitsQuerySchema,
  type PeriodQuery,
  periodQuerySchema,
  SECURITY_CATEGORIES,
  USER_SORTS,
  USER_STATUS_FILTERS,
} from './admin.schemas.js';
import { AdminOnly, CurrentAdmin } from './auth/admin.guards.js';
import {
  type ActivityDto,
  AdminInsightsService,
  type OverviewDto,
  type Paged,
  type VisitDto,
} from './insights/admin-insights.service.js';
import {
  AdminSecurityService,
  type SecurityEventDto,
  type SecuritySummaryDto,
} from './security/admin-security.service.js';
import {
  type AdminUserDetailDto,
  type AdminUserRowDto,
  AdminUsersService,
} from './users/admin-users.service.js';

const PeriodQueries =
  () => (target: object, key: string | symbol, descriptor: PropertyDescriptor) => {
    ApiQuery({ name: 'days', required: false, type: Number, description: '1-365 (default 30)' })(
      target,
      key,
      descriptor,
    );
    ApiQuery({
      name: 'tz',
      required: false,
      example: 'Asia/Kolkata',
      description: 'IANA time zone the days are counted in (default UTC)',
    })(target, key, descriptor);
  };

@ApiTags('Admin: insights')
@AdminOnly()
@Controller('admin')
export class AdminInsightsController {
  constructor(private readonly insights: AdminInsightsService) {}

  @Get('overview')
  @PeriodQueries()
  @ApiOperation({ summary: 'Key figures: users, activity, content and security' })
  @ApiOkResponse({ description: 'Overview of the application' })
  overview(@Query({ schema: periodQuerySchema }) query: PeriodQuery): Promise<OverviewDto> {
    return this.insights.overview(query);
  }

  @Get('activity')
  @PeriodQueries()
  @ApiOperation({ summary: 'Page visits: per day, per page, per device/browser/system, per hour' })
  @ApiOkResponse({ description: 'Page visit analytics' })
  activity(@Query({ schema: periodQuerySchema }) query: PeriodQuery): Promise<ActivityDto> {
    return this.insights.activity(query);
  }

  @Get('activity/visits')
  @ApiOperation({ summary: 'Visit log: who opened which page, when' })
  @ApiQuery({ name: 'days', required: false, type: Number })
  @ApiQuery({ name: 'path', required: false, example: '/tasks/:id' })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'audience', required: false, enum: ['all', 'signed_in', 'signed_out'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ description: 'Visits, newest first' })
  visits(
    @Query({ schema: listVisitsQuerySchema }) query: ListVisitsQuery,
  ): Promise<Paged<VisitDto>> {
    return this.insights.visits(query);
  }
}

@ApiTags('Admin: users')
@AdminOnly()
@ApiNotFoundResponse({ type: ApiErrorResponseDto, description: 'No such user' })
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  @ApiOperation({ summary: 'Search and list application users' })
  @ApiQuery({ name: 'search', required: false, description: 'Name or email' })
  @ApiQuery({ name: 'status', required: false, enum: USER_STATUS_FILTERS })
  @ApiQuery({ name: 'sort', required: false, enum: USER_SORTS })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ description: 'One page of users' })
  list(
    @Query({ schema: listUsersQuerySchema }) query: ListUsersQuery,
  ): Promise<Paged<AdminUserRowDto>> {
    return this.users.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: "A user's profile, usage, sessions, visits and security events" })
  @ApiOkResponse({ description: 'User details' })
  detail(@Param('id', { schema: userIdParamSchema }) id: string): Promise<AdminUserDetailDto> {
    return this.users.detail(id);
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('csrf')
  @ApiOperation({
    summary: 'Disable a user',
    description: 'The user is signed out everywhere and cannot sign in until enabled again.',
  })
  @ApiZodBody(disableUserSchema)
  @ApiOkResponse({ description: 'Updated user details' })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponseDto })
  disable(
    @CurrentAdmin() admin: AdminIdentity,
    @Param('id', { schema: userIdParamSchema }) id: string,
    @Body({ schema: disableUserSchema }) body: { reason: string | null },
  ): Promise<AdminUserDetailDto> {
    return this.users.disable(admin, id, body.reason);
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('csrf')
  @ApiOperation({ summary: 'Enable a disabled user' })
  @ApiOkResponse({ description: 'Updated user details' })
  enable(
    @CurrentAdmin() admin: AdminIdentity,
    @Param('id', { schema: userIdParamSchema }) id: string,
  ): Promise<AdminUserDetailDto> {
    return this.users.enable(admin, id);
  }

  @Post(':id/sign-out')
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('csrf')
  @ApiOperation({ summary: 'Sign a user out of every device' })
  @ApiOkResponse({ description: 'Number of sessions ended' })
  signOut(
    @CurrentAdmin() admin: AdminIdentity,
    @Param('id', { schema: userIdParamSchema }) id: string,
  ): Promise<{ revoked: number }> {
    return this.users.signOutEverywhere(admin, id);
  }
}

@ApiTags('Admin: security')
@AdminOnly()
@Controller('admin/security')
export class AdminSecurityController {
  constructor(private readonly security: AdminSecurityService) {}

  @Get()
  @PeriodQueries()
  @ApiOperation({ summary: 'Sign-in failures, suspicious addresses, targeted accounts' })
  @ApiOkResponse({ description: 'Security summary' })
  summary(@Query({ schema: periodQuerySchema }) query: PeriodQuery): Promise<SecuritySummaryDto> {
    return this.security.summary(query);
  }

  @Get('events')
  @ApiOperation({ summary: 'Audit log' })
  @ApiQuery({ name: 'days', required: false, type: Number })
  @ApiQuery({ name: 'category', required: false, enum: SECURITY_CATEGORIES })
  @ApiQuery({ name: 'outcome', required: false, enum: ['SUCCESS', 'FAILURE'] })
  @ApiQuery({ name: 'search', required: false, description: 'Email, name, IP or event' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ description: 'Audit events, newest first' })
  events(
    @Query({ schema: listSecurityEventsQuerySchema }) query: ListSecurityEventsQuery,
  ): Promise<Paged<SecurityEventDto>> {
    return this.security.events(query);
  }
}
