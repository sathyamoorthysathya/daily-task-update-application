import { ApiBody } from '@nestjs/swagger';
import { z } from 'zod';

type ApiBodySchema = NonNullable<
  Extract<Parameters<typeof ApiBody>[0], { schema?: unknown }>['schema']
>;

/** Documents a Zod request body in the OpenAPI document. */
export function ApiZodBody(schema: z.ZodType, description?: string): MethodDecorator {
  return ApiBody({
    description,
    schema: z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input' }) as ApiBodySchema,
  });
}
