import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ACCESS_TOKEN_COOKIE, AuthErrorCode } from '../auth.constants.js';
import type { AuthenticatedRequest } from '../auth.types.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { TokenService } from '../tokens/token.service.js';

/**
 * Global guard: every route requires a valid access token cookie unless marked @Public().
 * The token's session must still be active, so logout revokes access immediately.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic || context.getType() !== 'http') {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookies = request.cookies as Record<string, string | undefined> | undefined;
    const token = cookies?.[ACCESS_TOKEN_COOKIE];
    if (!token) {
      throw new UnauthorizedException({
        code: AuthErrorCode.Unauthenticated,
        message: 'Authentication required. Please sign in.',
      });
    }

    const payload = await this.tokens.verifyAccessToken(token);
    if (!(await this.tokens.isSessionActive(payload.sub, payload.sid))) {
      throw new UnauthorizedException({
        code: AuthErrorCode.SessionRevoked,
        message: 'Your session has ended. Please sign in again.',
      });
    }

    request.user = { id: payload.sub, sessionId: payload.sid };
    return true;
  }
}
