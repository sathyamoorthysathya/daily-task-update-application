import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { requestStore } from './request-store.js';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/** A safe incoming request ID (from a proxy or load balancer) is kept; anything else is replaced. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

declare module 'express' {
  interface Request {
    /** Correlates logs, error responses and alerts of one request. */
    requestId?: string;
  }
}

/**
 * Assigns every request an ID (returned in the X-Request-Id header and in error bodies) and,
 * when enabled, writes one structured access-log line per request. Query strings are omitted
 * from logs (they can contain search terms); health checks are not logged.
 */
export function requestContext(options: { accessLog: boolean; apiPrefix: string }) {
  const logger = new Logger('HTTP');
  const quietPrefix = `/${options.apiPrefix}/health`;

  return (req: Request, res: Response, next: NextFunction): void => {
    const incoming = req.get(REQUEST_ID_HEADER);
    const requestId = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    req.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);

    if (options.accessLog && !req.path.startsWith(quietPrefix)) {
      const started = process.hrtime.bigint();
      res.on('finish', () => {
        const entry = {
          event: 'http.request',
          requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n),
          ip: req.ip,
          userId: (req as Request & { user?: { id?: string } }).user?.id,
        };
        if (res.statusCode >= 500) {
          logger.error(entry);
        } else if (res.statusCode >= 400) {
          logger.warn(entry);
        } else {
          logger.log(entry);
        }
      });
    }
    requestStore.run({ requestId, ip: req.ip, userAgent: req.get('user-agent') ?? undefined }, () =>
      next(),
    );
  };
}
