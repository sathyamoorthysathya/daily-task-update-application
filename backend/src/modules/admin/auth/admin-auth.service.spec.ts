import type { ConfigService } from '@nestjs/config';
import type { AuditService } from '../../../common/monitoring/audit.service.js';
import type { Env } from '../../../config/env.schema.js';
import type { PrismaService } from '../../../database/prisma.service.js';
import type { PasswordService } from '../../auth/password/password.service.js';
import { AdminAuthService } from './admin-auth.service.js';

function serviceWith(allowedIps: string[]) {
  const values: Partial<Env> = {
    ADMIN_SESSION_IDLE_MINUTES: 30,
    ADMIN_SESSION_MAX_HOURS: 8,
    ADMIN_LOCKOUT_THRESHOLD: 5,
    ADMIN_LOCKOUT_MINUTES: 15,
    ADMIN_ALLOWED_IPS: allowedIps,
    JWT_ACCESS_SECRET: 'a-test-secret-of-at-least-32-characters!!',
  };
  const config = { get: (key: keyof Env) => values[key] } as unknown as ConfigService<Env, true>;
  return new AdminAuthService(
    {} as PrismaService,
    {} as PasswordService,
    {} as AuditService,
    config,
  );
}

describe('AdminAuthService IP allow-list', () => {
  it('allows every address when ADMIN_ALLOWED_IPS is empty', () => {
    expect(serviceWith([]).isIpAllowed('203.0.113.7')).toBe(true);
    expect(serviceWith([]).isIpAllowed(undefined)).toBe(true);
  });

  it('allows only the listed addresses and ranges', () => {
    const service = serviceWith(['203.0.113.7', '10.0.0.0/8', '2001:db8::/32']);
    expect(service.isIpAllowed('203.0.113.7')).toBe(true);
    expect(service.isIpAllowed('::ffff:203.0.113.7')).toBe(true);
    expect(service.isIpAllowed('10.20.30.40')).toBe(true);
    expect(service.isIpAllowed('2001:db8::1')).toBe(true);
    expect(service.isIpAllowed('203.0.113.8')).toBe(false);
    expect(service.isIpAllowed('192.168.1.1')).toBe(false);
    expect(service.isIpAllowed(undefined)).toBe(false);
  });
});
