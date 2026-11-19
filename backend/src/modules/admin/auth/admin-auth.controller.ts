import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';
import { ApiErrorResponseDto } from '../../../common/dto/api-error-response.dto.js';
import { ApiZodBody } from '../../../common/validation/zod-openapi.js';
import { versionedApiPath } from '../../../common/versioning.js';
import type { Env } from '../../../config/env.schema.js';
import { AuthRateLimit, LoginRateLimit } from '../../auth/decorators/rate-limit.decorator.js';
import { ADMIN_SESSION_COOKIE, type AdminIdentity } from '../admin.constants.js';
import {
  type AdminChangePasswordInput,
  adminChangePasswordSchema,
  type AdminLoginInput,
  adminLoginSchema,
  twoFactorDisableSchema,
  twoFactorEnableSchema,
  twoFactorSetupSchema,
} from '../admin.schemas.js';
import {
  type AdminAccountDto,
  AdminAuthService,
  AdminLockedException,
  type AdminProfileDto,
  type AdminSessionDto,
} from './admin-auth.service.js';
import { AdminArea, AdminOnly, CurrentAdmin } from './admin.guards.js';

/** Administrator sign-in, sessions, password and two-step verification. */
@ApiTags('Admin: account')
@ApiSecurity('csrf')
@ApiTooManyRequestsResponse({ type: ApiErrorResponseDto, description: 'Rate limit or lockout' })
@Controller('admin/auth')
export class AdminAuthController {
  private readonly cookie: CookieOptions;

  constructor(
    private readonly adminAuth: AdminAuthService,
    config: ConfigService<Env, true>,
  ) {
    // Sent only to the admin API, never readable by scripts, never sent cross-site.
    this.cookie = {
      httpOnly: true,
      secure: config.get('COOKIE_SECURE', { infer: true }),
      sameSite: 'strict',
      path: `${versionedApiPath(config.get('API_PREFIX', { infer: true }))}/admin`,
    };
  }

  @AdminArea()
  @AuthRateLimit()
  @LoginRateLimit()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Administrator sign-in',
    description:
      'Username and password; with two-step verification on, a first attempt without `code` answers 401 TWO_FACTOR_REQUIRED. Repeated failures lock the account (429 ACCOUNT_LOCKED with Retry-After).',
  })
  @ApiZodBody(adminLoginSchema)
  @ApiOkResponse({ description: 'Signed in; the admin_session cookie is set' })
  @ApiUnauthorizedResponse({
    type: ApiErrorResponseDto,
    description: 'INVALID_CREDENTIALS, TWO_FACTOR_REQUIRED or TWO_FACTOR_INVALID',
  })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponseDto, description: 'Validation failed' })
  async login(
    @Body({ schema: adminLoginSchema }) body: AdminLoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ admin: AdminProfileDto }> {
    try {
      const { token, profile } = await this.adminAuth.login(body, {
        userAgent: req.get('user-agent'),
        ipAddress: req.ip,
      });
      res.cookie(ADMIN_SESSION_COOKIE, token, {
        ...this.cookie,
        maxAge: this.adminAuth.sessionMaxMs,
      });
      return { admin: profile };
    } catch (error) {
      if (error instanceof AdminLockedException) {
        res.setHeader('Retry-After', String(error.retryAfterSeconds));
      }
      throw error;
    }
  }

  @AdminArea()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Administrator sign-out (ends this session)' })
  @ApiNoContentResponse()
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    const token = cookies?.[ADMIN_SESSION_COOKIE];
    if (token) {
      try {
        const admin = await this.adminAuth.authenticate(token);
        await this.adminAuth.logout(admin);
      } catch {
        await this.adminAuth.revokeToken(token);
      }
    }
    res.clearCookie(ADMIN_SESSION_COOKIE, this.cookie);
  }

  @AdminOnly()
  @Get('me')
  @ApiOperation({ summary: 'The signed-in administrator' })
  @ApiOkResponse({ description: 'Profile, previous sign-in and session limits' })
  me(@CurrentAdmin() admin: AdminIdentity): Promise<AdminProfileDto> {
    return this.adminAuth.getProfile(admin);
  }

  @AdminOnly()
  @Get('sessions')
  @ApiOperation({ summary: "The administrator's active sessions" })
  @ApiOkResponse({ description: 'Active sessions, most recently used first' })
  async sessions(@CurrentAdmin() admin: AdminIdentity): Promise<{ sessions: AdminSessionDto[] }> {
    return { sessions: await this.adminAuth.listSessions(admin) };
  }

  @AdminOnly()
  @Post('sessions/revoke-others')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign out all other sessions of this administrator' })
  @ApiOkResponse({ description: 'Number of sessions ended' })
  async revokeOthers(@CurrentAdmin() admin: AdminIdentity): Promise<{ revoked: number }> {
    return { revoked: await this.adminAuth.revokeOtherSessions(admin) };
  }

  @AdminOnly()
  @Get('admins')
  @ApiOperation({ summary: 'All administrator accounts' })
  @ApiOkResponse({ description: 'Administrators (no secrets)' })
  async admins(): Promise<{ admins: AdminAccountDto[] }> {
    return { admins: await this.adminAuth.listAdmins() };
  }

  @AdminOnly()
  @AuthRateLimit()
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Change the administrator password',
    description: 'Requires the current password. Signs out the other sessions.',
  })
  @ApiZodBody(adminChangePasswordSchema)
  @ApiNoContentResponse()
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponseDto })
  async changePassword(
    @CurrentAdmin() admin: AdminIdentity,
    @Body({ schema: adminChangePasswordSchema }) body: AdminChangePasswordInput,
  ): Promise<void> {
    await this.adminAuth.changePassword(admin, body);
  }

  @AdminOnly()
  @AuthRateLimit()
  @Post('two-factor/setup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start setting up two-step verification',
    description: 'Returns a new secret and otpauth:// link for an authenticator app.',
  })
  @ApiZodBody(twoFactorSetupSchema)
  @ApiOkResponse({ description: '{ secret, otpauthUri }' })
  @ApiConflictResponse({ type: ApiErrorResponseDto, description: 'Already on' })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponseDto })
  setupTwoFactor(
    @CurrentAdmin() admin: AdminIdentity,
    @Body({ schema: twoFactorSetupSchema }) body: { password: string },
  ): Promise<{ secret: string; otpauthUri: string }> {
    return this.adminAuth.startTwoFactorSetup(admin, body.password);
  }

  @AdminOnly()
  @AuthRateLimit()
  @Post('two-factor/enable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Turn on two-step verification with a code from the app' })
  @ApiZodBody(twoFactorEnableSchema)
  @ApiNoContentResponse()
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponseDto })
  async enableTwoFactor(
    @CurrentAdmin() admin: AdminIdentity,
    @Body({ schema: twoFactorEnableSchema }) body: { code: string },
  ): Promise<void> {
    await this.adminAuth.enableTwoFactor(admin, body.code);
  }

  @AdminOnly()
  @AuthRateLimit()
  @Post('two-factor/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Turn off two-step verification (password and a current code)' })
  @ApiZodBody(twoFactorDisableSchema)
  @ApiNoContentResponse()
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponseDto })
  async disableTwoFactor(
    @CurrentAdmin() admin: AdminIdentity,
    @Body({ schema: twoFactorDisableSchema }) body: { password: string; code: string },
  ): Promise<void> {
    await this.adminAuth.disableTwoFactor(admin, body.password, body.code);
  }
}
