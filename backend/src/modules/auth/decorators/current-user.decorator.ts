import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthErrorCode } from '../auth.constants.js';
import type { AuthenticatedRequest, AuthUser } from '../auth.types.js';

/** Injects the authenticated user (set by JwtAuthGuard) into a route handler. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const { user } = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!user) {
    throw new UnauthorizedException({
      code: AuthErrorCode.Unauthenticated,
      message: 'Authentication required',
    });
  }
  return user;
});
