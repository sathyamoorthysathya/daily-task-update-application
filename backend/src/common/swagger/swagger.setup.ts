import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../dto/api-error-response.dto.js';

/**
 * Serves Swagger UI at `/<prefix>/docs` and the OpenAPI JSON at `/<prefix>/docs-json`.
 */
export function setupSwagger(app: INestApplication, apiPrefix: string): void {
  const config = new DocumentBuilder()
    .setTitle('Daily Task Update API')
    .setDescription(
      'REST API for the Daily Task Update application.\n\n' +
        '**Authentication** uses HttpOnly cookies set by `/auth/login`, `/auth/register` or ' +
        '`/auth/google`. **CSRF:** call `GET /auth/csrf`, then click _Authorize_ and paste the ' +
        'returned `csrfToken` into `csrf` before calling POST/PUT/PATCH/DELETE endpoints.',
    )
    .setVersion('0.2.0')
    .addCookieAuth('access_token', { type: 'apiKey', in: 'cookie', name: 'access_token' })
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-CSRF-Token' }, 'csrf')
    .addGlobalResponse({
      status: 500,
      description: 'Unexpected server error',
      type: ApiErrorResponseDto,
    })
    .build();

  const documentFactory = () =>
    SwaggerModule.createDocument(app, config, { extraModels: [ApiErrorResponseDto] });

  SwaggerModule.setup(`${apiPrefix}/docs`, app, documentFactory, {
    jsonDocumentUrl: `${apiPrefix}/docs-json`,
    customSiteTitle: 'Daily Task Update API',
  });
}
