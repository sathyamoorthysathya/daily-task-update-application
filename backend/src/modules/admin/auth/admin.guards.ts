import {
  applyDecorators,
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiForbiddenResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../../../common/dto/api-error-response.dto.js';
import { AuditService } from '../../../common/monitoring/audit.service.js';
import { Public } from '../../auth/decorators/public.decorator.js';
import {
  ADMIN_SESSION_COOKIE,
  AdminErrorCode,
  type AdminIdentity,
  type AdminRequest,
} from '../admin.constants.js';
import { AdminAuthService } from './admin-auth.service.js';

/** Admin API only from the addresses in ADMIN_ALLOWED_IPS (when set). */
@Injectable()
export class AdminIpGuard implements CanActivate {
  constructor(
    private readonly adminAuth: AdminAuthService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    if (this.adminAuth.isIpAllowed(request.ip)) {
      return true;
    }
    await this.audit.record({
      event: 'admin.ip_blocked',
      outcome: 'FAILURE',
      details: { method: request.method, path: request.path },
    });
    throw new ForbiddenException({
      code: AdminErrorCode.IpNotAllowed,
      message: 'The admin panel is not available from this network.',
    });
  }
}

/** Requires a valid admin session cookie; attaches the administrator to the request. */
@Injectable()
export class AdminSessionGuard implements CanActivate {
  constructor(private readonly adminAuth: AdminAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const cookies = request.cookies as Record<string, string | undefined> | undefined;
    const token = cookies?.[ADMIN_SESSION_COOKIE];
    if (!token) {
      throw new UnauthorizedException({
        code: AdminErrorCode.Unauthenticated,
        message: 'Administrator sign-in required.',
      });
    }
    request.admin = await this.adminAuth.authenticate(token);
    return true;
  }
}

/**
 * Admin endpoints that need no admin session (sign-in). `Public()` only opts out of the
 * application users' JWT guard: administrators are a separate kind of account.
 */
export const AdminArea = () =>
  applyDecorators(
    Public(),
    UseGuards(AdminIpGuard),
    ApiForbiddenResponse({
      type: ApiErrorResponseDto,
      description: 'Missing CSRF token, or the client address is not allowed',
    }),
  );

/** Admin endpoints: a signed-in administrator (admin session cookie) is required. */
export const AdminOnly = () =>
  applyDecorators(
    Public(),
    UseGuards(AdminIpGuard, AdminSessionGuard),
    ApiCookieAuth(ADMIN_SESSION_COOKIE),
    ApiUnauthorizedResponse({ type: ApiErrorResponseDto, description: 'No admin session' }),
    ApiForbiddenResponse({
      type: ApiErrorResponseDto,
      description: 'Missing CSRF token, or the client address is not allowed',
    }),
  );

/** Injects the signed-in administrator (set by AdminSessionGuard). */
export const CurrentAdmin = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AdminIdentity => {
    const { admin } = ctx.switchToHttp().getRequest<AdminRequest>();
    if (!admin) {
      throw new UnauthorizedException({
        code: AdminErrorCode.Unauthenticated,
        message: 'Administrator sign-in required.',
      });
    }
    return admin;
  },
);
