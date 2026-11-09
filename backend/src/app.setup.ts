import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import {
  REQUEST_ID_HEADER,
  requestContext,
} from './common/monitoring/request-context.middleware.js';
import { setupSwagger } from './common/swagger/swagger.setup.js';
import type { Env } from './config/env.schema.js';
import { CSRF_HEADER } from './modules/auth/auth.constants.js';

/**
 * HTTP-level application setup shared by `main.ts` and the e2e tests,
 * so tests exercise exactly the same configuration as the running server.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const apiPrefix = config.get('API_PREFIX', { infer: true });
  const express = app as NestExpressApplication;

  // Client IPs (rate limiting, audit log) come from X-Forwarded-For only for trusted proxies.
  const trustProxy = config.get('TRUST_PROXY', { infer: true });
  if (trustProxy !== false) {
    express.set('trust proxy', trustProxy);
  }
  express.disable('x-powered-by');

  app.use(
    requestContext({
      apiPrefix,
      accessLog: config.get('ACCESS_LOG', { infer: true }),
    }),
  );
  app.use(securityHeaders(apiPrefix));
  // Explicit body limits: JSON bodies are small forms; uploads use multipart with own limits.
  express.useBodyParser('json', { limit: '100kb' });
  express.useBodyParser('urlencoded', { limit: '20kb', extended: false });
  app.use(cookieParser());
  app.setGlobalPrefix(apiPrefix);
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    // Authentication uses cookies, so cross-origin clients must send credentials.
    credentials: true,
    allowedHeaders: ['Content-Type', 'Accept', CSRF_HEADER, REQUEST_ID_HEADER],
    exposedHeaders: [REQUEST_ID_HEADER, 'Content-Disposition'],
    maxAge: 600,
  });
  // Runs shutdown hooks on SIGTERM/SIGINT: stop the Excel worker, close the HTTP server and
  // the database pool.
  app.enableShutdownHooks();

  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    setupSwagger(app, apiPrefix);
  }
}

/**
 * Secure HTTP headers (helmet). API responses are JSON or files and never need to run scripts,
 * so they get a deny-all Content-Security-Policy; only the Swagger UI pages get a policy that
 * lets them load their own scripts and styles.
 */
function securityHeaders(apiPrefix: string) {
  const common = {
    // HSTS is ignored over plain HTTP and enforced by browsers once served over HTTPS.
    strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true },
    // Profile pictures may be shown by a web client on a sibling subdomain.
    crossOriginResourcePolicy: { policy: 'same-site' as const },
    referrerPolicy: { policy: 'no-referrer' as const },
  };
  const api = helmet({
    ...common,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        imgSrc: ["'self'", 'data:'],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
  });
  const docs = helmet({
    ...common,
    contentSecurityPolicy: {
      directives: {
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
  });
  const docsPath = `/${apiPrefix}/docs`;
  return (req: Request, res: Response, next: NextFunction) =>
    req.path.startsWith(docsPath) ? docs(req, res, next) : api(req, res, next);
}
