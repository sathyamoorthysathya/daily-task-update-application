import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthErrorCode } from '../../modules/auth/auth.constants.js';
import type { AuthenticatedRequest, AuthUser } from '../../modules/auth/auth.types.js';

const OWNER_PARAM_KEY = 'authorization:ownerParam';

/**
 * Route-level ownership check: the route parameter `param` must equal the authenticated
 * user's id, e.g. `@OwnerOnly('id')` on `GET /users/:id`.
 */
@Injectable()
export class OwnershipGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const param = this.reflector.get<string | undefined>(OWNER_PARAM_KEY, context.getHandler());
    if (!param) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw new UnauthorizedException({
        code: AuthErrorCode.Unauthenticated,
        message: 'Authentication required. Please sign in.',
      });
    }
    if (request.params[param] !== request.user.id) {
      throw new ForbiddenException({
        code: AuthErrorCode.Forbidden,
        message: "You don't have permission to access this resource.",
      });
    }
    return true;
  }
}

export const OwnerOnly = (param: string) =>
  applyDecorators(SetMetadata(OWNER_PARAM_KEY, param), UseGuards(OwnershipGuard));

/**
 * Service-level ownership check for loaded resources (e.g. a task with `userId`).
 * Responds 404 rather than 403 so other users' resource IDs are not disclosed.
 */
export function assertOwnership<T extends { userId: string }>(
  resource: T | null | undefined,
  user: AuthUser,
): T {
  if (!resource || resource.userId !== user.id) {
    throw new NotFoundException('Resource not found');
  }
  return resource;
}
