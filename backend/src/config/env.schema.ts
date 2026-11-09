import { z } from 'zod';

const booleanFromString = z.enum(['true', 'false']).transform((value) => value === 'true');

const commaSeparatedList = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0),
);

/** Treats an empty string (e.g. `GOOGLE_CLIENT_ID=`) as "not set". */
const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined));

const secret = (name: string) =>
  z.string().min(32, `${name} must be at least 32 characters (use a random value)`);

/** Express `trust proxy` setting. */
const trustProxy = z
  .string()
  .trim()
  .default('false')
  .transform((value): boolean | number | string => {
    if (value === 'false' || value === '') {
      return false;
    }
    if (value === 'true') {
      return 'loopback';
    }
    return /^\d+$/.test(value) ? Number(value) : value;
  });

/**
 * Rejects placeholder or low-entropy secrets (checked in production): the example values
 * would let anyone sign access and CSRF tokens.
 */
export function weakSecret(value: string): string | null {
  if (/change[-_ ]?me|example|placeholder|secret/i.test(value)) {
    return 'is a placeholder; generate a random value (e.g. openssl rand -base64 48)';
  }
  if (new Set(value).size < 16) {
    return 'has too little variety to be random; generate a random value';
  }
  return null;
}

const positiveInt = (defaultValue: number, max: number) =>
  z.coerce.number().int().min(1).max(max).default(defaultValue);

/**
 * Schema for every environment variable the API reads.
 * The application refuses to start when validation fails.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    API_PREFIX: z
      .string()
      .trim()
      .regex(
        /^[a-z0-9-]+(\/[a-z0-9-]+)*$/i,
        'API_PREFIX must be a path without leading/trailing slashes',
      )
      .default('api'),
    CORS_ORIGINS: commaSeparatedList.default(['http://localhost:5173']),
    /** Serve Swagger UI / OpenAPI JSON. Default: on, except in production. */
    SWAGGER_ENABLED: booleanFromString.optional(),
    /**
     * Reverse proxies whose X-Forwarded-For is trusted (correct client IPs for rate limiting):
     * false (none), true (loopback), a hop count such as 1 or 2, or addresses / subnets /
     * Express names such as `loopback, uniquelocal` or `10.0.0.0/8`.
     */
    TRUST_PROXY: trustProxy,
    DATABASE_URL: z.url({
      protocol: /^postgres(ql)?$/,
      error: 'DATABASE_URL must be a postgresql:// connection string',
    }),

    /** Public URL of the web client, used to build links in emails. */
    FRONTEND_URL: z.url().default('http://localhost:5173'),

    // Authentication
    JWT_ACCESS_SECRET: secret('JWT_ACCESS_SECRET'),
    ACCESS_TOKEN_TTL_SECONDS: positiveInt(900, 86_400),
    REFRESH_TOKEN_TTL_DAYS: positiveInt(7, 90),
    /** Absolute session lifetime: a session ends this long after sign-in, even if refreshed. */
    SESSION_MAX_DAYS: positiveInt(30, 365),
    CSRF_SECRET: secret('CSRF_SECRET'),
    /** Must be true in production (cookies only sent over HTTPS). */
    COOKIE_SECURE: booleanFromString.default(false),
    PASSWORD_RESET_TTL_MINUTES: positiveInt(30, 1_440),
    /** Google OAuth 2.0 Web client ID. Google sign-in is disabled when empty. */
    GOOGLE_CLIENT_ID: optionalString,

    // Rate limiting
    /** Failed + successful login attempts allowed per IP + email address within 15 minutes. */
    LOGIN_RATE_LIMIT: positiveInt(5, 1_000),
    /** Requests per minute per IP to public auth endpoints (register, login, reset, ...). */
    AUTH_RATE_LIMIT: positiveInt(20, 10_000),
    /** Login attempts allowed per email address within 15 minutes, from any IP (brute force). */
    LOGIN_ACCOUNT_RATE_LIMIT: positiveInt(20, 10_000),
    /** Requests per minute per IP to any endpoint. */
    API_RATE_LIMIT: positiveInt(300, 100_000),
    /** Task changes (create, edit, delete) per minute per user. */
    WRITE_RATE_LIMIT: positiveInt(60, 10_000),

    // Workbooks
    /** Directory for .xlsx files (absolute, or relative to the backend's working directory). */
    WORKBOOK_STORAGE_DIR: z.string().trim().min(1).default('storage/workbooks'),
    MAX_WORKBOOKS_PER_USER: positiveInt(20, 200),
    /** Dated task entries per workbook (each is an Excel row rebuilt on every change). */
    MAX_ENTRIES_PER_WORKBOOK: positiveInt(10_000, 100_000),

    // Excel synchronisation (outbox worker)
    /** Run the background worker in this process (disable on API-only instances or in tests). */
    EXCEL_SYNC_WORKER_ENABLED: booleanFromString.default(true),
    /** How often the worker looks for due jobs (it is also woken up right after each change). */
    EXCEL_SYNC_POLL_MS: positiveInt(2_000, 3_600_000),
    /** Jobs processed in parallel per process (different workbooks; one writer per workbook). */
    EXCEL_SYNC_CONCURRENCY: positiveInt(2, 32),
    /** Attempts before a job is marked DEAD and an alert is raised. */
    EXCEL_SYNC_MAX_ATTEMPTS: positiveInt(8, 100),
    /** First retry delay; doubles per attempt up to EXCEL_SYNC_RETRY_MAX_MS (with jitter). */
    EXCEL_SYNC_RETRY_BASE_MS: positiveInt(5_000, 3_600_000),
    EXCEL_SYNC_RETRY_MAX_MS: positiveInt(900_000, 86_400_000),
    /** A PROCESSING job older than this is assumed abandoned (crashed worker) and reclaimed. */
    EXCEL_SYNC_LEASE_MS: positiveInt(120_000, 3_600_000),
    /** Optional webhook (e.g. Slack/Teams incoming webhook) that receives failure alerts as JSON. */
    ALERT_WEBHOOK_URL: z
      .string()
      .trim()
      .optional()
      .transform((value) => (value ? value : undefined))
      .pipe(z.url({ protocol: /^https?$/ }).optional()),

    // Logging
    /** "json" writes one JSON object per log line (for log aggregation); "text" is for humans. */
    LOG_FORMAT: z.enum(['text', 'json']).default('text'),
    /** One structured log line per HTTP request. Default: on in production. */
    ACCESS_LOG: booleanFromString.optional(),

    // Email
    /** SMTP connection URL (smtp://user:pass@host:587). When empty, emails are written to the log. */
    SMTP_URL: optionalString,
    MAIL_FROM: z.string().default('Daily Task Update <no-reply@localhost>'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'COOKIE_SECURE must be true in production',
      });
    }
    if (env.NODE_ENV === 'production') {
      for (const name of ['JWT_ACCESS_SECRET', 'CSRF_SECRET'] as const) {
        const problem = weakSecret(env[name]);
        if (problem) {
          ctx.addIssue({ code: 'custom', path: [name], message: `${name} ${problem}` });
        }
      }
    }
    if (env.JWT_ACCESS_SECRET === env.CSRF_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['CSRF_SECRET'],
        message: 'CSRF_SECRET must differ from JWT_ACCESS_SECRET',
      });
    }
  })
  .transform((env) => ({
    ...env,
    SWAGGER_ENABLED: env.SWAGGER_ENABLED ?? env.NODE_ENV !== 'production',
    ACCESS_LOG: env.ACCESS_LOG ?? env.NODE_ENV === 'production',
  }));

export type Env = z.infer<typeof envSchema>;
