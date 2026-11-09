import { ConsoleLogger, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { ErrorReporter } from './common/monitoring/error-reporter.service.js';
import type { Env } from './config/env.schema.js';

/** Must stay below the orchestrator's grace period (docker-compose: stop_grace_period 30s). */
const SHUTDOWN_TIMEOUT_MS = 25_000;

async function bootstrap(): Promise<void> {
  // Logs written during startup are buffered until the configured logger is installed.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  // LOG_FORMAT=json: one JSON object per line (structured fields such as event, jobId and
  // workbookId stay machine-readable for log aggregation).
  app.useLogger(new ConsoleLogger({ json: config.get('LOG_FORMAT', { infer: true }) === 'json' }));
  configureApp(app);
  const logger = new Logger('Bootstrap');

  // Error monitoring for errors outside request handling (timers, background work).
  const reporter = app.get(ErrorReporter);
  process.on('unhandledRejection', (reason) =>
    reporter.report(reason, { source: 'process.unhandledRejection' }),
  );
  process.on('uncaughtException', (error) => {
    reporter.report(error, { source: 'process.uncaughtException' });
    // The process state is unknown: exit and let the orchestrator restart it.
    setTimeout(() => process.exit(1), 1_000).unref();
  });

  // Graceful shutdown (enableShutdownHooks): stop the Excel worker after its current jobs,
  // finish in-flight HTTP requests, then close the database pool. Never hang forever.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      logger.log({ event: 'shutdown.started', signal });
      setTimeout(() => {
        logger.error({ event: 'shutdown.timeout', timeoutMs: SHUTDOWN_TIMEOUT_MS });
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS).unref();
    });
  }

  const port = config.get('PORT', { infer: true });
  const apiPrefix = config.get('API_PREFIX', { infer: true });
  await app.listen(port);

  logger.log(`API listening on http://localhost:${port}/${apiPrefix}`);
  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    logger.log(`Swagger UI available at http://localhost:${port}/${apiPrefix}/docs`);
  }
}

await bootstrap();
