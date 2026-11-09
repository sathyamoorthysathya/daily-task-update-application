import { envSchema } from './env.schema.js';

const required = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
  JWT_ACCESS_SECRET: 'j'.repeat(32),
  CSRF_SECRET: 'c'.repeat(32),
};

describe('envSchema', () => {
  it('applies defaults when only the required variables are provided', () => {
    const env = envSchema.parse(required);

    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      API_PREFIX: 'api',
      CORS_ORIGINS: ['http://localhost:5173'],
      SWAGGER_ENABLED: true,
      FRONTEND_URL: 'http://localhost:5173',
      ACCESS_TOKEN_TTL_SECONDS: 900,
      REFRESH_TOKEN_TTL_DAYS: 7,
      COOKIE_SECURE: false,
      LOGIN_RATE_LIMIT: 5,
      AUTH_RATE_LIMIT: 20,
      ...required,
    });
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
  });

  it('coerces and transforms string values', () => {
    const env = envSchema.parse({
      ...required,
      PORT: '4000',
      SWAGGER_ENABLED: 'false',
      CORS_ORIGINS: 'http://a.test, http://b.test,',
      GOOGLE_CLIENT_ID: '',
    });

    expect(env.PORT).toBe(4000);
    expect(env.SWAGGER_ENABLED).toBe(false);
    expect(env.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
  });

  it('rejects a missing or non-PostgreSQL DATABASE_URL', () => {
    expect(envSchema.safeParse({ ...required, DATABASE_URL: undefined }).success).toBe(false);
    expect(envSchema.safeParse({ ...required, DATABASE_URL: 'mysql://localhost/db' }).success).toBe(
      false,
    );
  });

  it('rejects an invalid PORT or API_PREFIX', () => {
    expect(envSchema.safeParse({ ...required, PORT: '70000' }).success).toBe(false);
    expect(envSchema.safeParse({ ...required, API_PREFIX: '/api/' }).success).toBe(false);
  });

  it('requires strong, distinct secrets', () => {
    expect(envSchema.safeParse({ ...required, JWT_ACCESS_SECRET: 'short' }).success).toBe(false);
    expect(
      envSchema.safeParse({ ...required, CSRF_SECRET: required.JWT_ACCESS_SECRET }).success,
    ).toBe(false);
  });

  describe('production', () => {
    const production = {
      ...required,
      NODE_ENV: 'production',
      COOKIE_SECURE: 'true',
      JWT_ACCESS_SECRET: 'q8Zr3vT1yXwP0aLm5KcN7bHd2GfJ4sEu9oViRtYeWx6',
      CSRF_SECRET: 'Lp4Wn8Qz2Xc6Vb0Mk1Jh5Gf9Ds3Ae7RtYuIoP-_xZq',
    };

    it('requires secure cookies', () => {
      expect(envSchema.safeParse({ ...production, COOKIE_SECURE: 'false' }).success).toBe(false);
      expect(envSchema.safeParse(production).success).toBe(true);
    });

    it('rejects placeholder and low-entropy secrets', () => {
      for (const weak of [
        'change-me-to-a-long-random-string-of-32-chars',
        'CHANGE_ME_at_least_32_random_characters',
        'j'.repeat(64),
      ]) {
        expect(envSchema.safeParse({ ...production, JWT_ACCESS_SECRET: weak }).success).toBe(false);
        expect(envSchema.safeParse({ ...production, CSRF_SECRET: weak }).success).toBe(false);
      }
      // Development keeps working with simple local values.
      expect(envSchema.safeParse(required).success).toBe(true);
    });

    it('turns Swagger off and access logs on by default', () => {
      expect(envSchema.parse(production)).toMatchObject({
        SWAGGER_ENABLED: false,
        ACCESS_LOG: true,
      });
      expect(envSchema.parse({ ...production, SWAGGER_ENABLED: 'true' }).SWAGGER_ENABLED).toBe(
        true,
      );
      expect(envSchema.parse(required)).toMatchObject({ SWAGGER_ENABLED: true, ACCESS_LOG: false });
    });
  });

  it('parses TRUST_PROXY as off, loopback, a hop count or a list', () => {
    const trust = (value?: string) =>
      envSchema.parse({ ...required, TRUST_PROXY: value }).TRUST_PROXY;
    expect(trust()).toBe(false);
    expect(trust('false')).toBe(false);
    expect(trust('true')).toBe('loopback');
    expect(trust('2')).toBe(2);
    expect(trust('loopback, 10.0.0.0/8')).toBe('loopback, 10.0.0.0/8');
  });
});
