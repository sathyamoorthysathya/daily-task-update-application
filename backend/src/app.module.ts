import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { MonitoringModule } from './common/monitoring/monitoring.module.js';
import { throttlerOptionsFactory } from './common/throttling/throttler.config.js';
import { createValidationPipe } from './common/validation/validation.pipe.js';
import { envSchema } from './config/env.schema.js';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CsrfGuard } from './modules/auth/csrf/csrf.guard.js';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard.js';
import { HealthModule } from './modules/health/health.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { TasksModule } from './modules/tasks/tasks.module.js';
import { WorkbooksModule } from './modules/workbooks/workbooks.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: envSchema,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: throttlerOptionsFactory,
    }),
    DatabaseModule,
    MonitoringModule,
    // Feature modules
    HealthModule,
    AuthModule,
    UsersModule,
    WorkbooksModule,
    TasksModule,
  ],
  providers: [
    // Registered through DI (not app.useGlobal*) so they also apply in e2e tests.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_PIPE, useFactory: createValidationPipe },
    // Global guards run in this order: rate limiting, CSRF, authentication.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
