import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthErrorCode, CSRF_COOKIE, CSRF_HEADER } from '../auth.constants.js';
import { CsrfService } from './csrf.service.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Global guard: every state-changing request must carry a valid CSRF token. */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly csrf: CsrfService) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) {
      return true;
    }

    const cookies = request.cookies as Record<string, string | undefined> | undefined;
    if (!this.csrf.verify(cookies?.[CSRF_COOKIE], request.get(CSRF_HEADER))) {
      throw new ForbiddenException({
        code: AuthErrorCode.CsrfTokenInvalid,
        message: 'Invalid or missing CSRF token. Refresh the page and try again.',
      });
    }
    return true;
  }
}
