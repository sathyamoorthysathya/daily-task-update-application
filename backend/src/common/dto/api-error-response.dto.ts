import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Shape of every error response returned by the API (see AllExceptionsFilter). */
export class ApiErrorResponseDto {
  @ApiProperty({ example: 404 })
  statusCode!: number;

  @ApiProperty({ example: 'Not Found' })
  error!: string;

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: 'Cannot GET /api/unknown',
  })
  message!: string | string[];

  @ApiPropertyOptional({
    description: 'Machine-readable error code for clients (e.g. TOKEN_EXPIRED, EMAIL_TAKEN)',
    example: 'INVALID_CREDENTIALS',
  })
  code?: string;

  @ApiPropertyOptional({
    description: 'Per-field validation errors',
    example: [{ field: 'email', message: 'Enter a valid email address' }],
  })
  errors?: { field: string; message: string }[];

  @ApiPropertyOptional({
    description: 'Additional structured information (e.g. failing health indicators)',
  })
  details?: unknown;

  @ApiProperty({ example: '/api/unknown' })
  path!: string;

  @ApiProperty({ example: 'GET' })
  method!: string;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  timestamp!: string;

  @ApiPropertyOptional({
    description: 'Request ID (also in the X-Request-Id header); quote it when reporting a problem',
    example: '01a1baa9-07dd-74ec-80d1-1cd489a6998f',
  })
  requestId?: string;
}
