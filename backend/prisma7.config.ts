// Prisma CLI configuration (Prisma ORM 7.10+ reads `prisma7.config.ts`).
// The CLI does not load `.env` on its own, so dotenv is imported explicitly.
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
